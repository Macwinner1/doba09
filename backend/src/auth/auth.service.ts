import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { LoginInput, RegisterInput } from '@feyi/shared';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { MailService } from '../mail/mail.service';
import { passwordChangedEmail, passwordResetEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends AuthTokens {
  user: { id: string; email: string; name: string };
}

const BCRYPT_ROUNDS = 12;

/**
 * Long enough for a page to navigate and open a socket, short enough that a
 * ticket which never gets redeemed is not worth stealing.
 */
const SOCKET_TICKET_TTL_SECONDS = 60;

/**
 * Long enough to find the email and act on it, short enough that a link sitting
 * in a shared or later-compromised inbox stops being useful quickly.
 */
const PASSWORD_RESET_TTL_MINUTES = 30;

/** Per email address, not per IP. See allowResetRequest. */
const RESET_REQUESTS_PER_HOUR = 3;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
  ) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) throw new ConflictException('That email is already registered');

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      },
      select: { id: true, email: true, name: true },
    });

    return { user, ...(await this.issueTokens(user.id, user.email)) };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    // Hash even when the user is missing, so response time doesn't reveal
    // which emails are registered.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvaliduO';
    const valid = await bcrypt.compare(input.password, hash);

    if (!user || !valid) throw new UnauthorizedException('Invalid email or password');

    return {
      user: { id: user.id, email: user.email, name: user.name },
      ...(await this.issueTokens(user.id, user.email)),
    };
  }

  /**
   * Rotating refresh: the presented token is revoked as it is redeemed, so a
   * stolen token is usable at most once and its reuse is detectable.
   */
  async refresh(presentedToken: string): Promise<AuthResult> {
    const tokenHash = this.hashToken(presentedToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return {
      user: stored.user,
      ...(await this.issueTokens(stored.user.id, stored.user.email)),
    };
  }

  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(presentedToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Begin a password reset.
   *
   * Deliberately returns nothing and reveals nothing. An unknown address takes
   * the same path and produces the same response as a real one, because a
   * "no such account" reply turns this endpoint into a tool for discovering who
   * has an account here.
   */
  async requestPasswordReset(email: string, requestIp?: string): Promise<void> {
    /*
     * Rate limit by address, not just by IP.
     *
     * The resource being protected is somebody's inbox, and the abuse worth
     * stopping is flooding it — which a distributed attacker does from many
     * IPs, sailing past any per-IP limit. Keying on the address stops that.
     *
     * It also fixes the reverse problem: schools and cybercafés put dozens of
     * users behind one NAT'd address, and a tight per-IP limit would lock out
     * the sixth teacher to forget their password that afternoon.
     */
    if (!(await this.allowResetRequest(email))) {
      this.logger.warn(`Password reset rate limit reached for ${email}`);
      // Still returns normally: a distinct response here would reveal both the
      // limit and, indirectly, that the address is worth limiting.
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });

    if (!user) {
      this.logger.log(`Password reset requested for unknown address ${email}`);
      return;
    }

    // Invalidate outstanding tokens so only the newest link works. Otherwise
    // every past reset email stays live until it expires.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(32).toString('base64url');

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
        requestIp,
      },
    });

    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    const url = `${appUrl.replace(/\/$/, '')}/reset-password?token=${token}`;

    await this.mail.send(passwordResetEmail(user.email, url, PASSWORD_RESET_TTL_MINUTES));
  }

  /**
   * At most RESET_REQUESTS_PER_HOUR emails to one address per hour.
   *
   * INCR then EXPIRE on first use gives a fixed window that costs one round
   * trip and cleans itself up.
   */
  private async allowResetRequest(email: string): Promise<boolean> {
    const key = `pwreset:rate:${this.hashToken(email.toLowerCase())}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, 3600);
    return count <= RESET_REQUESTS_PER_HOUR;
  }

  /**
   * Complete a password reset.
   *
   * Redeeming the token, changing the hash and revoking every refresh token
   * happen in one transaction. That last part is the security-critical bit: if
   * someone reset their password because an attacker had gotten in, leaving the
   * attacker's session alive would defeat the entire exercise.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: { select: { id: true, email: true } } },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException(
        'That reset link is invalid or has expired. Please request a new one.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    // Tells the real owner that something happened, even if they weren't the
    // one who did it.
    await this.mail.send(passwordChangedEmail(record.user.email));
    this.logger.log(`Password reset completed for user ${record.userId}`);
  }

  /**
   * Mint a single-use credential for opening a host socket.
   *
   * The access token lives in an httpOnly cookie that JavaScript cannot read,
   * and the socket connects to a different origin than the page, so the cookie
   * never rides along with the handshake. Rather than hand the access token to
   * page scripts, we issue a ticket.
   *
   * It is deliberately opaque random bytes rather than a JWT. A JWT is valid
   * to anyone holding it until it expires, so a ticket leaked through a proxy
   * log or browser history would be replayable for its whole lifetime. This is
   * server-side state that is destroyed the instant it is redeemed, and only
   * its hash is stored — a dump of Redis yields nothing usable.
   */
  async issueSocketTicket(userId: string): Promise<string> {
    const ticket = randomBytes(32).toString('base64url');

    await this.redis.client.set(
      this.socketTicketKey(ticket),
      userId,
      'EX',
      SOCKET_TICKET_TTL_SECONDS,
    );

    return ticket;
  }

  /**
   * Redeem a socket ticket, returning the user it belongs to.
   *
   * GETDEL makes reading and destroying it one atomic operation, so two
   * simultaneous redemptions cannot both succeed.
   */
  async consumeSocketTicket(ticket: string): Promise<string | null> {
    if (!ticket) return null;
    return this.redis.client.getdel(this.socketTicketKey(ticket));
  }

  private socketTicketKey(ticket: string): string {
    return `socket:ticket:${this.hashToken(ticket)}`;
  }

  private async issueTokens(userId: string, email: string): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        // jsonwebtoken types `expiresIn` as a literal duration union, which an
        // env-sourced string can never satisfy. The format is validated by
        // `refreshTtlMs`'s regex, so the cast is checked elsewhere.
        expiresIn: this.config.getOrThrow<string>(
          'JWT_ACCESS_TTL',
        ) as unknown as number,
      },
    );

    // The refresh token is opaque random bytes, not a JWT. Nothing needs to
    // read a claim out of it, and we only ever store its hash.
    const refreshToken = randomBytes(48).toString('base64url');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlMs()),
      },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  refreshTtlMs(): number {
    const ttl = this.config.getOrThrow<string>('JWT_REFRESH_TTL');
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) throw new Error(`Unparseable JWT_REFRESH_TTL: ${ttl}`);

    const value = Number(match[1]);
    const unit = match[2] as 's' | 'm' | 'h' | 'd';
    const multiplier = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
    return value * multiplier;
  }
}

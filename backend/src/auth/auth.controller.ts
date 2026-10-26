import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from '@feyi/shared';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AuthService, type AuthResult } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondWithSession(await this.auth.register(body), res);
  }

  @Post('login')
  @HttpCode(200)
  // Login is the obvious brute-force target, so it gets the tightest bucket.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondWithSession(await this.auth.login(body), res);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.refresh_token as string | undefined;
    if (!token) throw new UnauthorizedException('No refresh token');
    return this.respondWithSession(await this.auth.refresh(token), res);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.refresh_token as string | undefined);
    res.clearCookie('access_token', this.cookieBase());
    res.clearCookie('refresh_token', this.cookieBase());
  }

  /**
   * Always 204, whether or not the address is registered.
   *
   * Any difference in status, body or timing would let someone enumerate which
   * emails have accounts here — so the endpoint tells the caller nothing.
   */
  @Post('forgot-password')
  @HttpCode(204)
  /*
   * A backstop against one machine hammering the endpoint, nothing more. The
   * meaningful limit is per email address, inside the service — a per-IP cap
   * tight enough to stop inbox flooding would also lock out a school where
   * forty teachers share one public address.
   */
  @Throttle({ default: { limit: 30, ttl: 15 * 60_000 } })
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.requestPasswordReset(body.email, req.ip);
  }

  @Post('reset-password')
  @HttpCode(204)
  // Tokens are 32 random bytes, so guessing is not the threat this guards
  // against — it only stops a client spinning on the endpoint.
  @Throttle({ default: { limit: 30, ttl: 15 * 60_000 } })
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.resetPassword(body.token, body.password);

    // Every session is revoked server-side; clear this browser's cookies too so
    // it doesn't sit on an access token that outlives the change.
    res.clearCookie('access_token', this.cookieBase());
    res.clearCookie('refresh_token', { ...this.cookieBase(), path: '/api/auth' });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }

  /** Exchanged for a host socket connection; see AuthService.issueSocketTicket. */
  @Post('socket-ticket')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async socketTicket(@CurrentUser() user: AuthUser) {
    return { ticket: await this.auth.issueSocketTicket(user.id) };
  }

  /**
   * Tokens go out as httpOnly cookies so page scripts can never read them —
   * the main reason an XSS bug doesn't become an account takeover.
   */
  private respondWithSession(result: AuthResult, res: Response) {
    const base = this.cookieBase();

    res.cookie('access_token', result.accessToken, {
      ...base,
      maxAge: 15 * 60 * 1000,
    });
    res.cookie('refresh_token', result.refreshToken, {
      ...base,
      path: '/api/auth',
      maxAge: this.auth.refreshTtlMs(),
    });

    return { user: result.user };
  }

  private cookieBase() {
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? ('none' as const) : ('lax' as const),
      path: '/',
    };
  }
}

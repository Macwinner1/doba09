import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  GAME_EVENTS,
  playerAnswerSchema,
  playerJoinSchema,
  pinSchema,
  type Ack,
  type ClientToServerEvents,
  type HostCreateGameResult,
  type PlayerAnswerResult,
  type PlayerJoinResult,
  type ServerToClientEvents,
} from '@feyi/shared';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Namespace, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { RedisService } from '../redis/redis.service';
import { GameBroadcaster } from './game.broadcaster';
import { GameEngineService, GameError } from './game-engine.service';
import type { SocketSession } from './game.types';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents> & {
  data: { session?: SocketSession; answerAttempts?: number };
};

/**
 * Only origins named in CORS_ORIGIN may open a socket.
 *
 * Evaluated per connection rather than baked in, because the decorator runs
 * before ConfigModule has loaded the environment. Reflecting whatever origin
 * asked — the previous behaviour — would let any site on the internet drive a
 * game from a visitor's browser.
 */
function isAllowedOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  const allowed = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // Native clients and server-to-server callers send no Origin header at all;
  // the header is only meaningful as a defence for browsers.
  callback(null, !origin || allowed.includes(origin));
}

@WebSocketGateway({
  namespace: '/game',
  cors: { origin: isAllowedOrigin, credentials: true },
  // Long-poll fallback matters on flaky mobile networks where a WebSocket
  // upgrade sometimes never completes.
  transports: ['websocket', 'polling'],
})
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(GameGateway.name);

  // Because this gateway declares a namespace, Nest injects the Namespace here
  // rather than the root Server.
  @WebSocketServer()
  namespace!: Namespace<ClientToServerEvents, ServerToClientEvents>;

  constructor(
    private readonly engine: GameEngineService,
    private readonly broadcaster: GameBroadcaster,
    private readonly redis: RedisService,
    private readonly auth: AuthService,
  ) {}

  afterInit(namespace: Namespace): void {
    // The Redis adapter is what lets a second backend instance exist: without
    // it, a broadcast only reaches sockets connected to the emitting process.
    // It is set on the root server, which re-inits the adapter for every
    // namespace including this one.
    namespace.server.adapter(
      createAdapter(this.redis.pubClient, this.redis.subClient),
    );
    this.broadcaster.register(namespace);
    this.logger.log('Game gateway ready (Redis adapter attached)');
  }

  handleConnection(client: GameSocket): void {
    client.data.answerAttempts = 0;
  }

  async handleDisconnect(client: GameSocket): Promise<void> {
    const session = client.data.session;
    if (!session || session.role !== 'player' || !session.playerId) return;

    // Players keep their seat and score; only the presence flag flips.
    await this.engine
      .markDisconnected(session.pin, session.playerId)
      .catch(() => undefined);
  }

  // === latency ============================================================

  /**
   * Round-trip probe. The client echoes its own clock, we reply with ours; the
   * client then reports nothing — we derive RTT server-side on the next call.
   * Keeping the measurement on our side is the point.
   */
  @SubscribeMessage(GAME_EVENTS.LATENCY_PING)
  async onLatencyPing(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() body: { clientTime: number },
  ) {
    const session = client.data.session;
    const sentAt = client.data as unknown as { lastPingAt?: number };

    if (sentAt.lastPingAt && session?.role === 'player' && session.playerId) {
      await this.engine.recordLatency(
        session.pin,
        session.playerId,
        Date.now() - sentAt.lastPingAt,
      );
    }
    sentAt.lastPingAt = Date.now();

    return { serverTime: Date.now(), clientTime: body?.clientTime ?? 0 };
  }

  // === player events ======================================================

  @SubscribeMessage(GAME_EVENTS.PLAYER_JOIN)
  async onPlayerJoin(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<PlayerJoinResult>> {
    return this.handle(async () => {
      const parsed = playerJoinSchema.safeParse(body);
      if (!parsed.success) {
        throw new GameError(
          'NICKNAME_INVALID',
          parsed.error.issues[0]?.message ?? 'Invalid join request',
        );
      }

      const { pin, nickname } = parsed.data;
      const { player, quizTitle } = await this.engine.joinPlayer(pin, nickname);

      this.bindPlayerSocket(client, pin, player.id);

      client.emit(
        GAME_EVENTS.GAME_STATE,
        await this.engine.buildStateFor(pin, { role: 'player', playerId: player.id }),
      );

      return {
        playerId: player.id,
        rejoinToken: player.rejoinToken,
        nickname: player.nickname,
        quizTitle,
      };
    });
  }

  @SubscribeMessage(GAME_EVENTS.PLAYER_REJOIN)
  async onPlayerRejoin(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() body: { pin?: string; rejoinToken?: string },
  ): Promise<Ack<PlayerJoinResult>> {
    return this.handle(async () => {
      const pin = pinSchema.parse(body?.pin);
      const token = String(body?.rejoinToken ?? '');
      const { player, quizTitle } = await this.engine.rejoinPlayer(pin, token);

      this.bindPlayerSocket(client, pin, player.id);

      client.emit(
        GAME_EVENTS.GAME_STATE,
        await this.engine.buildStateFor(pin, { role: 'player', playerId: player.id }),
      );

      return {
        playerId: player.id,
        rejoinToken: player.rejoinToken,
        nickname: player.nickname,
        quizTitle,
      };
    });
  }

  @SubscribeMessage(GAME_EVENTS.PLAYER_ANSWER)
  async onPlayerAnswer(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<PlayerAnswerResult>> {
    // Stamped before any await, so queueing inside our own process cannot cost
    // a player points.
    const receivedAt = Date.now();

    return this.handle(async () => {
      const session = this.requirePlayer(client);

      // A well-behaved client sends one answer per question. A flood is either
      // a bug or an attack; either way it stops here rather than at Redis.
      client.data.answerAttempts = (client.data.answerAttempts ?? 0) + 1;
      if (client.data.answerAttempts > 200) {
        throw new GameError('RATE_LIMITED', 'Too many answers');
      }

      const parsed = playerAnswerSchema.safeParse(body);
      if (!parsed.success) throw new GameError('INTERNAL', 'Malformed answer');

      await this.engine.submitAnswer({
        pin: session.pin,
        playerId: session.playerId!,
        questionId: parsed.data.questionId,
        choiceIndex: parsed.data.choiceIndex,
        clientElapsedMs: parsed.data.clientElapsedMs,
        receivedAt,
      });

      return { received: true as const, choiceIndex: parsed.data.choiceIndex };
    });
  }

  @SubscribeMessage(GAME_EVENTS.PLAYER_LEAVE)
  async onPlayerLeave(@ConnectedSocket() client: GameSocket): Promise<Ack<null>> {
    return this.handle(async () => {
      const session = client.data.session;
      if (session?.role === 'player' && session.playerId) {
        await this.engine.markDisconnected(session.pin, session.playerId);
      }
      client.disconnect(true);
      return null;
    });
  }

  // === host events ========================================================

  @SubscribeMessage(GAME_EVENTS.HOST_CREATE_GAME)
  async onHostCreateGame(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() body: { quizId?: string; ticket?: string },
  ): Promise<Ack<HostCreateGameResult>> {
    return this.handle(async () => {
      const hostId = await this.authenticateHost(client, body?.ticket);
      const quizId = String(body?.quizId ?? '');
      if (!quizId) throw new GameError('QUIZ_NOT_FOUND', 'No quiz specified');

      const { meta, questionCount } = await this.engine.createGame(hostId, quizId);

      this.bindHostSocket(client, meta.pin);
      client.emit(
        GAME_EVENTS.GAME_STATE,
        await this.engine.buildStateFor(meta.pin, { role: 'host' }),
      );

      return {
        pin: meta.pin,
        gameId: meta.gameId,
        hostToken: meta.hostToken,
        quizTitle: meta.quizTitle,
        questionCount,
      };
    });
  }

  @SubscribeMessage(GAME_EVENTS.HOST_REJOIN)
  async onHostRejoin(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() body: { pin?: string; hostToken?: string },
  ): Promise<Ack<HostCreateGameResult>> {
    return this.handle(async () => {
      const pin = pinSchema.parse(body?.pin);
      const meta = await this.engine.requireMeta(pin);

      // The host token is the only credential checked here. It is issued once,
      // over an authenticated socket, and never leaves the host's device.
      if (!body?.hostToken || body.hostToken !== meta.hostToken) {
        throw new GameError('NOT_HOST', 'You are not hosting this game');
      }

      await this.engine.rejoinHost(pin);
      this.bindHostSocket(client, pin);

      const quiz = await this.engine.requireQuiz(pin);
      client.emit(GAME_EVENTS.GAME_STATE, await this.engine.buildStateFor(pin, { role: 'host' }));

      return {
        pin,
        gameId: meta.gameId,
        hostToken: meta.hostToken,
        quizTitle: meta.quizTitle,
        questionCount: quiz.questions.length,
      };
    });
  }

  @SubscribeMessage(GAME_EVENTS.HOST_START)
  async onHostStart(@ConnectedSocket() client: GameSocket): Promise<Ack<null>> {
    return this.handle(async () => {
      await this.engine.startGame(this.requireHost(client).pin);
      return null;
    });
  }

  @SubscribeMessage(GAME_EVENTS.HOST_NEXT)
  async onHostNext(@ConnectedSocket() client: GameSocket): Promise<Ack<null>> {
    return this.handle(async () => {
      await this.engine.advance(this.requireHost(client).pin);
      return null;
    });
  }

  @SubscribeMessage(GAME_EVENTS.HOST_SKIP)
  async onHostSkip(@ConnectedSocket() client: GameSocket): Promise<Ack<null>> {
    return this.handle(async () => {
      await this.engine.skipQuestion(this.requireHost(client).pin);
      return null;
    });
  }

  @SubscribeMessage(GAME_EVENTS.HOST_KICK)
  async onHostKick(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() body: { playerId?: string },
  ): Promise<Ack<null>> {
    return this.handle(async () => {
      const session = this.requireHost(client);
      if (body?.playerId) await this.engine.kickPlayer(session.pin, body.playerId);
      return null;
    });
  }

  @SubscribeMessage(GAME_EVENTS.HOST_END)
  async onHostEnd(@ConnectedSocket() client: GameSocket): Promise<Ack<null>> {
    return this.handle(async () => {
      await this.engine.endGame(this.requireHost(client).pin);
      return null;
    });
  }

  // === helpers ============================================================

  /**
   * Uniform ack envelope. Every handler returns `{ok:true,data}` or
   * `{ok:false,code,error}`, so the client never has to distinguish an expected
   * refusal from a crash.
   */
  private async handle<T>(fn: () => Promise<T>): Promise<Ack<T>> {
    try {
      return { ok: true, data: await fn() };
    } catch (err) {
      if (err instanceof GameError) {
        return { ok: false, code: err.code, error: err.message };
      }
      this.logger.error(`Unhandled gateway error: ${String(err)}`);
      return { ok: false, code: 'INTERNAL', error: 'Something went wrong' };
    }
  }

  /**
   * Establishes who is hosting, by redeeming a single-use socket ticket.
   *
   * Nothing else is accepted — not the access token, not a cookie. That keeps
   * exactly one credential type able to open a host socket, and it is one that
   * stops working the moment it is used.
   */
  private async authenticateHost(client: GameSocket, ticket?: string): Promise<string> {
    const presented = ticket ?? (client.handshake.auth?.token as string | undefined);
    if (!presented) throw new GameError('NOT_HOST', 'You must be signed in to host');

    const userId = await this.auth.consumeSocketTicket(presented);
    if (!userId) {
      throw new GameError('NOT_HOST', 'Your host session expired, please try again');
    }

    return userId;
  }

  private bindPlayerSocket(client: GameSocket, pin: string, playerId: string): void {
    client.data.session = { pin, role: 'player', playerId };
    void client.join([
      GameBroadcaster.roomAll(pin),
      GameBroadcaster.roomPlayers(pin),
      GameBroadcaster.roomPlayer(pin, playerId),
    ]);
  }

  private bindHostSocket(client: GameSocket, pin: string): void {
    client.data.session = { pin, role: 'host' };
    void client.join([GameBroadcaster.roomAll(pin), GameBroadcaster.roomHost(pin)]);
  }

  private requireHost(client: GameSocket): SocketSession {
    const session = client.data.session;
    if (session?.role !== 'host') throw new GameError('NOT_HOST', 'You are not the host');
    return session;
  }

  private requirePlayer(client: GameSocket): SocketSession {
    const session = client.data.session;
    if (session?.role !== 'player' || !session.playerId) {
      throw new GameError('SESSION_INVALID', 'You have not joined a game');
    }
    return session;
  }
}

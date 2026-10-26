import { Injectable } from '@nestjs/common';
import { GAME_STATE_TTL_SECONDS, type GamePhase } from '@feyi/shared';
import { RedisService } from '../redis/redis.service';
import type {
  GameMeta,
  GameQuizSnapshot,
  StoredAnswer,
  StoredPlayer,
} from './game.types';

/**
 * All live game state lives here, in Redis.
 *
 * Two properties this buys us that in-process state would not: any backend
 * instance can serve any socket (so we can scale horizontally behind the
 * Socket.IO Redis adapter), and a backend restart mid-game doesn't wipe
 * everyone's scores.
 */
@Injectable()
export class GameStateRepository {
  constructor(private readonly redis: RedisService) {}

  // --- key layout ---------------------------------------------------------
  private metaKey(pin: string) { return `game:${pin}:meta`; }
  private quizKey(pin: string) { return `game:${pin}:quiz`; }
  private playersKey(pin: string) { return `game:${pin}:players`; }
  private nicknamesKey(pin: string) { return `game:${pin}:nicknames`; }
  private tokensKey(pin: string) { return `game:${pin}:tokens`; }
  private answersKey(pin: string, q: number) { return `game:${pin}:answers:${q}`; }
  private distKey(pin: string, q: number) { return `game:${pin}:dist:${q}`; }

  private allKeys(pin: string, questionCount: number): string[] {
    const keys = [
      this.metaKey(pin),
      this.quizKey(pin),
      this.playersKey(pin),
      this.nicknamesKey(pin),
      this.tokensKey(pin),
    ];
    for (let i = 0; i < questionCount; i++) {
      keys.push(this.answersKey(pin, i), this.distKey(pin, i));
    }
    return keys;
  }

  // --- lifecycle ----------------------------------------------------------

  async createGame(meta: GameMeta, quiz: GameQuizSnapshot): Promise<void> {
    await this.redis.client
      .multi()
      .set(this.metaKey(meta.pin), JSON.stringify(meta), 'EX', GAME_STATE_TTL_SECONDS)
      .set(this.quizKey(meta.pin), JSON.stringify(quiz), 'EX', GAME_STATE_TTL_SECONDS)
      .exec();
  }

  /**
   * Claim a PIN atomically. SET NX is what makes two hosts launching at the
   * same instant safe — the loser gets false and retries with a new PIN.
   */
  async claimPin(pin: string): Promise<boolean> {
    const result = await this.redis.client.set(
      `game:${pin}:lock`,
      '1',
      'EX',
      GAME_STATE_TTL_SECONDS,
      'NX',
    );
    return result === 'OK';
  }

  async destroyGame(pin: string, questionCount: number): Promise<void> {
    await this.redis.client.del(
      ...this.allKeys(pin, questionCount),
      `game:${pin}:lock`,
    );
  }

  // --- meta ---------------------------------------------------------------

  async getMeta(pin: string): Promise<GameMeta | null> {
    const raw = await this.redis.client.get(this.metaKey(pin));
    return raw ? (JSON.parse(raw) as GameMeta) : null;
  }

  async setMeta(meta: GameMeta): Promise<void> {
    await this.redis.client.set(
      this.metaKey(meta.pin),
      JSON.stringify(meta),
      'EX',
      GAME_STATE_TTL_SECONDS,
    );
  }

  async patchMeta(pin: string, patch: Partial<GameMeta>): Promise<GameMeta | null> {
    const meta = await this.getMeta(pin);
    if (!meta) return null;
    const next = { ...meta, ...patch };
    await this.setMeta(next);
    return next;
  }

  async setPhase(pin: string, phase: GamePhase): Promise<GameMeta | null> {
    return this.patchMeta(pin, { phase });
  }

  async getQuiz(pin: string): Promise<GameQuizSnapshot | null> {
    const raw = await this.redis.client.get(this.quizKey(pin));
    return raw ? (JSON.parse(raw) as GameQuizSnapshot) : null;
  }

  // --- players ------------------------------------------------------------

  /**
   * Reserve a nickname atomically.
   *
   * SADD returning 0 means someone else took it between our check and our
   * write. Doing this as one operation is the only way to keep two players
   * typing "Ada" simultaneously from both getting in.
   */
  async reserveNickname(pin: string, nickname: string): Promise<boolean> {
    const added = await this.redis.client.sadd(
      this.nicknamesKey(pin),
      nickname.toLowerCase(),
    );
    await this.redis.client.expire(this.nicknamesKey(pin), GAME_STATE_TTL_SECONDS);
    return added === 1;
  }

  async releaseNickname(pin: string, nickname: string): Promise<void> {
    await this.redis.client.srem(this.nicknamesKey(pin), nickname.toLowerCase());
  }

  async addPlayer(pin: string, player: StoredPlayer): Promise<void> {
    await this.redis.client
      .multi()
      .hset(this.playersKey(pin), player.id, JSON.stringify(player))
      .hset(this.tokensKey(pin), player.rejoinToken, player.id)
      .expire(this.playersKey(pin), GAME_STATE_TTL_SECONDS)
      .expire(this.tokensKey(pin), GAME_STATE_TTL_SECONDS)
      .exec();
  }

  async getPlayer(pin: string, playerId: string): Promise<StoredPlayer | null> {
    const raw = await this.redis.client.hget(this.playersKey(pin), playerId);
    return raw ? (JSON.parse(raw) as StoredPlayer) : null;
  }

  async savePlayer(pin: string, player: StoredPlayer): Promise<void> {
    await this.redis.client.hset(
      this.playersKey(pin),
      player.id,
      JSON.stringify(player),
    );
  }

  async getPlayerIdByToken(pin: string, token: string): Promise<string | null> {
    return this.redis.client.hget(this.tokensKey(pin), token);
  }

  async getPlayers(pin: string): Promise<StoredPlayer[]> {
    const all = await this.redis.client.hgetall(this.playersKey(pin));
    return Object.values(all).map((raw) => JSON.parse(raw) as StoredPlayer);
  }

  async countPlayers(pin: string): Promise<number> {
    return this.redis.client.hlen(this.playersKey(pin));
  }

  async removePlayer(pin: string, player: StoredPlayer): Promise<void> {
    await this.redis.client
      .multi()
      .hdel(this.playersKey(pin), player.id)
      .hdel(this.tokensKey(pin), player.rejoinToken)
      .srem(this.nicknamesKey(pin), player.nickname.toLowerCase())
      .exec();
  }

  async setConnected(pin: string, playerId: string, connected: boolean): Promise<void> {
    const player = await this.getPlayer(pin, playerId);
    if (!player) return;
    player.connected = connected;
    await this.savePlayer(pin, player);
  }

  // --- answers ------------------------------------------------------------

  /**
   * Record an answer, but only the player's first one for this question.
   *
   * HSETNX is the whole anti-double-submit mechanism: it writes only if the
   * field is absent and tells us which happened, in a single round trip. A
   * read-then-write would let a fast double-tap through.
   */
  async recordAnswer(
    pin: string,
    questionIndex: number,
    answer: StoredAnswer,
  ): Promise<boolean> {
    const key = this.answersKey(pin, questionIndex);
    const written = await this.redis.client.hsetnx(
      key,
      answer.playerId,
      JSON.stringify(answer),
    );

    if (written === 0) return false;

    // Only increment the distribution for answers we actually accepted, so the
    // host's bar chart can't be inflated by repeat taps.
    await this.redis.client
      .multi()
      .hincrby(this.distKey(pin, questionIndex), String(answer.choiceIndex), 1)
      .expire(key, GAME_STATE_TTL_SECONDS)
      .expire(this.distKey(pin, questionIndex), GAME_STATE_TTL_SECONDS)
      .exec();

    return true;
  }

  async hasAnswered(pin: string, questionIndex: number, playerId: string): Promise<boolean> {
    return (
      (await this.redis.client.hexists(this.answersKey(pin, questionIndex), playerId)) === 1
    );
  }

  async countAnswers(pin: string, questionIndex: number): Promise<number> {
    return this.redis.client.hlen(this.answersKey(pin, questionIndex));
  }

  async getAnswers(pin: string, questionIndex: number): Promise<StoredAnswer[]> {
    const all = await this.redis.client.hgetall(this.answersKey(pin, questionIndex));
    return Object.values(all).map((raw) => JSON.parse(raw) as StoredAnswer);
  }

  async getAnswer(
    pin: string,
    questionIndex: number,
    playerId: string,
  ): Promise<StoredAnswer | null> {
    const raw = await this.redis.client.hget(this.answersKey(pin, questionIndex), playerId);
    return raw ? (JSON.parse(raw) as StoredAnswer) : null;
  }

  async getDistribution(pin: string, questionIndex: number): Promise<Record<number, number>> {
    const all = await this.redis.client.hgetall(this.distKey(pin, questionIndex));
    const out: Record<number, number> = {};
    for (const [choice, count] of Object.entries(all)) {
      out[Number(choice)] = Number(count);
    }
    return out;
  }
}

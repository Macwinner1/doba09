import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  GAME_EVENTS,
  MAX_PLAYERS_PER_GAME,
  QUESTION_INTRO_MS,
  calculateScore,
  compensateForLatency,
  rankPlayers,
  type AnswerDistribution,
  type GameErrorCode,
  type GameStatePayload,
  type LeaderboardEntry,
  type LobbyPlayer,
  type PlayerQuestionResult,
  type PodiumEntry,
  type PublicQuestion,
} from '@feyi/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { QuizzesService } from '../quizzes/quizzes.service';
import { GameBroadcaster } from './game.broadcaster';
import { GameStateRepository } from './game-state.repository';
import { GameResultsService } from './game-results.service';
import { PinService } from './pin.service';
import type {
  GameMeta,
  GameQuestion,
  GameQuizSnapshot,
  StoredAnswer,
  StoredPlayer,
} from './game.types';

/** Thrown for expected, user-facing failures; the gateway turns these into acks. */
export class GameError extends Error {
  constructor(readonly code: GameErrorCode, message: string) {
    super(message);
  }
}

@Injectable()
export class GameEngineService implements OnModuleDestroy {
  private readonly logger = new Logger(GameEngineService.name);

  /**
   * Question timers, keyed by PIN.
   *
   * These are in-process. The instance holding the host's socket is the one
   * that starts a question, so it is also the one that closes it — which keeps
   * this correct for a single instance and for a multi-instance deployment
   * where the host stays put. If a host reconnects to a different instance
   * mid-question, `rejoinHost` re-arms the timer from `questionEndsAt`.
   */
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly state: GameStateRepository,
    private readonly pins: PinService,
    private readonly quizzes: QuizzesService,
    private readonly broadcaster: GameBroadcaster,
    private readonly results: GameResultsService,
  ) {}

  onModuleDestroy(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }

  // === lifecycle ==========================================================

  async createGame(hostId: string, quizId: string) {
    const quiz = await this.quizzes.findForGame(quizId, hostId).catch(() => null);
    if (!quiz) throw new GameError('QUIZ_NOT_FOUND', 'Quiz not found');
    if (quiz.questions.length === 0) {
      throw new GameError('QUIZ_EMPTY', 'That quiz has no questions yet');
    }

    const snapshot: GameQuizSnapshot = {
      quizId: quiz.id,
      title: quiz.title,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        type: q.type,
        text: q.text,
        imageUrl: q.imageUrl,
        timeLimit: q.timeLimit,
        points: q.points,
        choices: q.choices.map((c, index) => ({
          id: c.id,
          index,
          text: c.text,
          isCorrect: c.isCorrect,
        })),
        correctChoiceIndex: Math.max(
          0,
          q.choices.findIndex((c) => c.isCorrect),
        ),
      })),
    };

    const pin = await this.pins.allocate();
    const meta: GameMeta = {
      gameId: randomUUID(),
      pin,
      hostId,
      hostToken: randomBytes(32).toString('base64url'),
      quizId: quiz.id,
      quizTitle: quiz.title,
      phase: 'LOBBY',
      currentQuestionIndex: -1,
      questionStartedAt: null,
      questionEndsAt: null,
      startedAt: Date.now(),
      persisted: false,
    };

    await this.state.createGame(meta, snapshot);
    this.logger.log(`Game ${pin} created for quiz "${quiz.title}"`);

    return { meta, questionCount: snapshot.questions.length };
  }

  async requireMeta(pin: string): Promise<GameMeta> {
    const meta = await this.state.getMeta(pin);
    if (!meta) throw new GameError('GAME_NOT_FOUND', 'No game with that PIN');
    return meta;
  }

  async requireQuiz(pin: string): Promise<GameQuizSnapshot> {
    const quiz = await this.state.getQuiz(pin);
    if (!quiz) throw new GameError('GAME_NOT_FOUND', 'No game with that PIN');
    return quiz;
  }

  // === joining ============================================================

  async joinPlayer(pin: string, nickname: string) {
    const meta = await this.requireMeta(pin);

    // Late joining is deliberately closed. Letting someone in at question 6
    // means they can never catch up, which reads as broken rather than strict.
    if (meta.phase !== 'LOBBY') {
      throw new GameError('GAME_ALREADY_STARTED', 'That game has already started');
    }

    if ((await this.state.countPlayers(pin)) >= MAX_PLAYERS_PER_GAME) {
      throw new GameError('GAME_FULL', 'That game is full');
    }

    if (!(await this.state.reserveNickname(pin, nickname))) {
      throw new GameError('NICKNAME_TAKEN', 'Someone already took that name');
    }

    const player: StoredPlayer = {
      id: randomUUID(),
      nickname,
      rejoinToken: randomBytes(24).toString('base64url'),
      score: 0,
      streak: 0,
      longestStreak: 0,
      correctCount: 0,
      connected: true,
      rttMs: 0,
      joinedAt: Date.now(),
      lastGain: 0,
    };

    await this.state.addPlayer(pin, player);
    await this.broadcastLobby(pin);

    return { player, quizTitle: meta.quizTitle };
  }

  async rejoinPlayer(pin: string, rejoinToken: string) {
    const meta = await this.requireMeta(pin);
    const playerId = await this.state.getPlayerIdByToken(pin, rejoinToken);
    if (!playerId) throw new GameError('SESSION_INVALID', 'That session has expired');

    const player = await this.state.getPlayer(pin, playerId);
    if (!player) throw new GameError('SESSION_INVALID', 'That session has expired');

    player.connected = true;
    await this.state.savePlayer(pin, player);
    await this.broadcastLobby(pin);

    return { player, quizTitle: meta.quizTitle };
  }

  async markDisconnected(pin: string, playerId: string): Promise<void> {
    // The seat and score are kept — a locked phone or a tunnel must not cost
    // a player their game. Cleanup happens on the Redis TTL.
    await this.state.setConnected(pin, playerId, false);
    await this.broadcastLobby(pin);
  }

  async kickPlayer(pin: string, playerId: string): Promise<void> {
    const player = await this.state.getPlayer(pin, playerId);
    if (!player) return;

    await this.state.removePlayer(pin, player);
    this.broadcaster.toPlayer(pin, playerId, GAME_EVENTS.PLAYER_KICKED, {
      reason: 'The host removed you from this game',
    });
    await this.broadcastLobby(pin);
  }

  async recordLatency(pin: string, playerId: string, rttMs: number): Promise<void> {
    const player = await this.state.getPlayer(pin, playerId);
    if (!player) return;

    // Smooth the estimate so one unlucky sample can't skew a player's scoring
    // for the rest of the game.
    player.rttMs = player.rttMs === 0 ? rttMs : Math.round(player.rttMs * 0.7 + rttMs * 0.3);
    await this.state.savePlayer(pin, player);
  }

  // === host controls ======================================================

  async startGame(pin: string): Promise<void> {
    const meta = await this.requireMeta(pin);
    if (meta.phase !== 'LOBBY') {
      throw new GameError('INVALID_PHASE', 'That game is already running');
    }
    await this.beginQuestion(pin, 0);
  }

  /**
   * The host's single "advance" control. What it does depends on the phase,
   * which keeps the client dumb — it sends the same event every time.
   */
  async advance(pin: string): Promise<void> {
    const meta = await this.requireMeta(pin);

    switch (meta.phase) {
      case 'QUESTION_RESULTS':
        return this.showLeaderboard(pin);

      case 'LEADERBOARD': {
        const quiz = await this.requireQuiz(pin);
        const next = meta.currentQuestionIndex + 1;
        return next >= quiz.questions.length
          ? this.showPodium(pin)
          : this.beginQuestion(pin, next);
      }

      case 'LOBBY':
        return this.startGame(pin);

      default:
        throw new GameError('INVALID_PHASE', 'Nothing to advance to right now');
    }
  }

  /** Host cut the timer short. */
  async skipQuestion(pin: string): Promise<void> {
    const meta = await this.requireMeta(pin);
    if (meta.phase !== 'QUESTION_ACTIVE' && meta.phase !== 'QUESTION_INTRO') {
      throw new GameError('INVALID_PHASE', 'No question is running');
    }
    await this.endQuestion(pin);
  }

  async endGame(pin: string, reason = 'The host ended this game'): Promise<void> {
    const meta = await this.state.getMeta(pin);
    if (!meta) return;

    this.clearTimer(pin);
    await this.state.setPhase(pin, 'ENDED');
    await this.persistIfNeeded(pin);

    this.broadcaster.toAll(pin, GAME_EVENTS.GAME_ENDED, { reason });

    const quiz = await this.state.getQuiz(pin);
    await this.state.destroyGame(pin, quiz?.questions.length ?? 0);
    this.logger.log(`Game ${pin} ended: ${reason}`);

    // Deferred, because this call usually originates from the host's own
    // `host:end` event. Disconnecting the room synchronously would cut the
    // host's socket before its ack could flush, leaving the client waiting on
    // a reply that never arrives.
    setTimeout(() => {
      void this.broadcaster.disconnectAll(pin).catch(() => undefined);
    }, 250);
  }

  // === question flow ======================================================

  private async beginQuestion(pin: string, index: number): Promise<void> {
    const quiz = await this.requireQuiz(pin);
    const question = quiz.questions[index];
    if (!question) throw new GameError('INVALID_PHASE', 'No such question');

    this.clearTimer(pin);

    const now = Date.now();
    const startsAt = now + QUESTION_INTRO_MS;

    await this.state.patchMeta(pin, {
      phase: 'QUESTION_INTRO',
      currentQuestionIndex: index,
      questionStartedAt: null,
      questionEndsAt: null,
    });

    this.broadcaster.toAll(pin, GAME_EVENTS.QUESTION_INTRO, {
      index,
      total: quiz.questions.length,
      text: question.text,
      type: question.type,
      startsAt,
      serverTime: now,
    });

    // The intro countdown exists so every device is showing the question before
    // the clock starts — otherwise a slow phone is scored on time it never had.
    this.timers.set(
      pin,
      setTimeout(() => {
        void this.activateQuestion(pin, index).catch((err) =>
          this.logger.error(`Failed to activate question in ${pin}: ${err}`),
        );
      }, QUESTION_INTRO_MS),
    );
  }

  private async activateQuestion(pin: string, index: number): Promise<void> {
    const quiz = await this.requireQuiz(pin);
    const question = quiz.questions[index];
    if (!question) return;

    const startedAt = Date.now();
    const endsAt = startedAt + question.timeLimit * 1000;

    await this.state.patchMeta(pin, {
      phase: 'QUESTION_ACTIVE',
      questionStartedAt: startedAt,
      questionEndsAt: endsAt,
    });

    this.broadcaster.toAll(pin, GAME_EVENTS.QUESTION_START, {
      question: this.toPublicQuestion(question, index, quiz.questions.length),
      startedAt,
      endsAt,
      serverTime: startedAt,
    });

    this.armQuestionTimer(pin, endsAt - Date.now());
  }

  private armQuestionTimer(pin: string, durationMs: number): void {
    this.clearTimer(pin);
    this.timers.set(
      pin,
      setTimeout(() => {
        void this.endQuestion(pin).catch((err) =>
          this.logger.error(`Failed to end question in ${pin}: ${err}`),
        );
      }, Math.max(0, durationMs)),
    );
  }

  /**
   * Accept an answer.
   *
   * `receivedAt` is stamped by the gateway the instant the packet lands. The
   * client's own `clientElapsedMs` is stored but never scored — trusting it
   * would let anyone claim a 10ms response.
   */
  async submitAnswer(params: {
    pin: string;
    playerId: string;
    questionId: string;
    choiceIndex: number;
    clientElapsedMs: number;
    receivedAt: number;
  }): Promise<void> {
    const { pin, playerId, questionId, choiceIndex, clientElapsedMs, receivedAt } = params;

    const meta = await this.requireMeta(pin);
    if (meta.phase !== 'QUESTION_ACTIVE' || meta.questionStartedAt === null) {
      throw new GameError('ANSWER_TOO_LATE', 'That question has closed');
    }

    const quiz = await this.requireQuiz(pin);
    const question = quiz.questions[meta.currentQuestionIndex];
    if (!question) throw new GameError('INVALID_PHASE', 'No question is running');

    // Guards against a late packet for the previous question being scored
    // against the current one.
    if (question.id !== questionId) {
      throw new GameError('ANSWER_TOO_LATE', 'That question has closed');
    }
    if (meta.questionEndsAt !== null && receivedAt > meta.questionEndsAt) {
      throw new GameError('ANSWER_TOO_LATE', 'That question has closed');
    }
    if (choiceIndex < 0 || choiceIndex >= question.choices.length) {
      throw new GameError('INTERNAL', 'That answer does not exist');
    }

    const player = await this.state.getPlayer(pin, playerId);
    if (!player) throw new GameError('SESSION_INVALID', 'You are not in this game');

    const rawResponseMs = receivedAt - meta.questionStartedAt;
    const responseMs = Math.round(compensateForLatency(rawResponseMs, player.rttMs));
    const isCorrect = choiceIndex === question.correctChoiceIndex;

    const answer: StoredAnswer = {
      playerId,
      choiceIndex,
      responseMs,
      clientElapsedMs,
      isCorrect,
      pointsAwarded: calculateScore({
        isCorrect,
        responseMs,
        timeLimitSeconds: question.timeLimit,
        pointsPossible: question.points,
      }),
    };

    const accepted = await this.state.recordAnswer(pin, meta.currentQuestionIndex, answer);
    if (!accepted) {
      throw new GameError('ALREADY_ANSWERED', 'You already answered this one');
    }

    const [answered, total] = await Promise.all([
      this.state.countAnswers(pin, meta.currentQuestionIndex),
      this.state.countPlayers(pin),
    ]);

    // The host sees a live count, never who picked what — that would let a
    // projected screen give the answer away.
    this.broadcaster.toHost(pin, GAME_EVENTS.QUESTION_ANSWER_COUNT, { answered, total });

    // Everyone is in; no reason to make the room watch a dead timer.
    if (answered >= total && total > 0) {
      await this.endQuestion(pin);
    }
  }

  private async endQuestion(pin: string): Promise<void> {
    const meta = await this.requireMeta(pin);
    if (meta.phase !== 'QUESTION_ACTIVE' && meta.phase !== 'QUESTION_INTRO') return;

    this.clearTimer(pin);

    const quiz = await this.requireQuiz(pin);
    const index = meta.currentQuestionIndex;
    const question = quiz.questions[index];
    if (!question) return;

    await this.state.patchMeta(pin, {
      phase: 'QUESTION_RESULTS',
      questionEndsAt: Date.now(),
    });

    const [players, answers, rawDistribution] = await Promise.all([
      this.state.getPlayers(pin),
      this.state.getAnswers(pin, index),
      this.state.getDistribution(pin, index),
    ]);

    const answerByPlayer = new Map(answers.map((a) => [a.playerId, a]));

    // Apply the question's results to every player's running totals. Scores are
    // computed at submit time and only banked here, so the leaderboard can
    // never disagree with what a player was told they earned.
    const updated = players.map((player) => {
      const answer = answerByPlayer.get(player.id);
      const gained = answer?.pointsAwarded ?? 0;
      const correct = answer?.isCorrect ?? false;
      const streak = correct ? player.streak + 1 : 0;

      return {
        ...player,
        score: player.score + gained,
        lastGain: gained,
        streak,
        longestStreak: Math.max(player.longestStreak, streak),
        correctCount: player.correctCount + (correct ? 1 : 0),
      };
    });

    await Promise.all(updated.map((p) => this.state.savePlayer(pin, p)));

    const ranked = rankPlayers(updated);
    const rankById = new Map(ranked.map((p) => [p.id, p]));

    const distribution: AnswerDistribution[] = question.choices.map((choice) => ({
      choiceIndex: choice.index,
      count: rawDistribution[choice.index] ?? 0,
      isCorrect: choice.index === question.correctChoiceIndex,
    }));

    this.broadcaster.toHost(pin, GAME_EVENTS.QUESTION_END, {
      questionId: question.id,
      correctChoiceIndex: question.correctChoiceIndex,
      distribution,
    });

    // Each player is told only their own outcome.
    for (const player of updated) {
      const answer = answerByPlayer.get(player.id);
      const entry = rankById.get(player.id);
      const rank = entry?.rank ?? ranked.length;
      const ahead = ranked.find((p) => p.rank < rank);

      const result: PlayerQuestionResult = {
        answered: Boolean(answer),
        choiceIndex: answer?.choiceIndex ?? null,
        isCorrect: answer?.isCorrect ?? false,
        pointsAwarded: answer?.pointsAwarded ?? 0,
        responseMs: answer?.responseMs ?? null,
        totalScore: player.score,
        rank,
        streak: player.streak,
        pointsBehindNext: ahead ? ahead.score - player.score : null,
      };

      this.broadcaster.toPlayer(pin, player.id, GAME_EVENTS.QUESTION_END, {
        questionId: question.id,
        correctChoiceIndex: question.correctChoiceIndex,
        distribution,
        yourResult: result,
      });
    }
  }

  private async showLeaderboard(pin: string): Promise<void> {
    await this.state.setPhase(pin, 'LEADERBOARD');

    const players = await this.state.getPlayers(pin);
    const ranked = rankPlayers(players);

    const toEntry = (p: (typeof ranked)[number]): LeaderboardEntry => ({
      playerId: p.id,
      nickname: p.nickname,
      score: p.score,
      rank: p.rank,
      gained: p.lastGain,
      streak: p.streak,
    });

    this.broadcaster.toHost(pin, GAME_EVENTS.LEADERBOARD_UPDATE, {
      top: ranked.slice(0, 5).map(toEntry),
      isFinal: false,
    });

    for (const player of ranked) {
      this.broadcaster.toPlayer(pin, player.id, GAME_EVENTS.LEADERBOARD_UPDATE, {
        top: ranked.slice(0, 5).map(toEntry),
        isFinal: false,
        you: toEntry(player),
      });
    }
  }

  private async showPodium(pin: string): Promise<void> {
    const meta = await this.requireMeta(pin);
    const quiz = await this.requireQuiz(pin);

    await this.state.setPhase(pin, 'PODIUM');

    const ranked = rankPlayers(await this.state.getPlayers(pin));
    const podium: PodiumEntry[] = ranked.slice(0, 3).map((p) => ({
      rank: p.rank,
      playerId: p.id,
      nickname: p.nickname,
      score: p.score,
    }));

    const summary = {
      sessionId: meta.gameId,
      quizTitle: meta.quizTitle,
      playerCount: ranked.length,
      questionCount: quiz.questions.length,
      podium,
    };

    this.broadcaster.toHost(pin, GAME_EVENTS.GAME_PODIUM, { podium, summary });

    for (const player of ranked) {
      this.broadcaster.toPlayer(pin, player.id, GAME_EVENTS.GAME_PODIUM, {
        podium,
        summary,
        you: { rank: player.rank, score: player.score, nickname: player.nickname },
      });
    }

    // Persist here rather than on ENDED: this is the moment the result is
    // final, and the host may simply close the tab afterwards.
    await this.persistIfNeeded(pin);
  }

  private async persistIfNeeded(pin: string): Promise<void> {
    const meta = await this.state.getMeta(pin);
    if (!meta || meta.persisted) return;

    // Nothing worth a report if the game never got past the lobby.
    if (meta.currentQuestionIndex < 0) return;

    const quiz = await this.state.getQuiz(pin);
    if (!quiz) return;

    const players = await this.state.getPlayers(pin);
    if (players.length === 0) return;

    const answersByQuestion = await Promise.all(
      quiz.questions.map((_, i) => this.state.getAnswers(pin, i)),
    );

    try {
      await this.results.persist({ meta, quiz, players, answersByQuestion });
      await this.state.patchMeta(pin, { persisted: true });
    } catch (err) {
      // A reporting failure must not take the game down with it — the players
      // have already seen their results.
      this.logger.error(`Failed to persist results for game ${pin}: ${err}`);
    }
  }

  // === state snapshots ====================================================

  /**
   * The full resync payload. Everything about reconnection reduces to sending
   * this, which is why it is worth keeping it complete.
   */
  async buildStateFor(
    pin: string,
    viewer: { role: 'host' } | { role: 'player'; playerId: string },
  ): Promise<GameStatePayload> {
    const meta = await this.requireMeta(pin);
    const quiz = await this.requireQuiz(pin);
    const question = quiz.questions[meta.currentQuestionIndex];

    const payload: GameStatePayload = {
      pin,
      phase: meta.phase,
      quizTitle: meta.quizTitle,
      questionCount: quiz.questions.length,
      currentQuestionIndex: meta.currentQuestionIndex,
      serverTime: Date.now(),
    };

    if (question && (meta.phase === 'QUESTION_ACTIVE' || meta.phase === 'QUESTION_RESULTS')) {
      payload.question = this.toPublicQuestion(
        question,
        meta.currentQuestionIndex,
        quiz.questions.length,
      );
      if (meta.questionEndsAt !== null) payload.questionEndsAt = meta.questionEndsAt;
    }

    if (viewer.role === 'host' || meta.phase === 'LOBBY') {
      payload.players = (await this.state.getPlayers(pin)).map(this.toLobbyPlayer);
    }

    if (viewer.role === 'player') {
      const player = await this.state.getPlayer(pin, viewer.playerId);
      if (player) {
        const ranked = rankPlayers(await this.state.getPlayers(pin));
        payload.you = {
          playerId: player.id,
          nickname: player.nickname,
          score: player.score,
          rank: ranked.find((p) => p.id === player.id)?.rank ?? 0,
          hasAnswered:
            meta.currentQuestionIndex >= 0 &&
            (await this.state.hasAnswered(pin, meta.currentQuestionIndex, player.id)),
        };
      }
    }

    return payload;
  }

  /**
   * Re-arm the question timer after a host reconnects. Without this, a host who
   * refreshes mid-question leaves the timer orphaned and the question never ends.
   */
  async rejoinHost(pin: string): Promise<GameMeta> {
    const meta = await this.requireMeta(pin);

    if (meta.phase === 'QUESTION_ACTIVE' && meta.questionEndsAt !== null) {
      const remaining = meta.questionEndsAt - Date.now();
      if (remaining <= 0) {
        await this.endQuestion(pin);
      } else if (!this.timers.has(pin)) {
        this.armQuestionTimer(pin, remaining);
      }
    }

    return meta;
  }

  private async broadcastLobby(pin: string): Promise<void> {
    const players = await this.state.getPlayers(pin);
    this.broadcaster.toAll(pin, GAME_EVENTS.LOBBY_PLAYERS, {
      players: players.map(this.toLobbyPlayer),
      count: players.length,
    });
  }

  private toLobbyPlayer(p: StoredPlayer): LobbyPlayer {
    return { id: p.id, nickname: p.nickname, connected: p.connected };
  }

  /** Strips the answer key. The only way a question reaches a client. */
  private toPublicQuestion(q: GameQuestion, index: number, total: number): PublicQuestion {
    return {
      id: q.id,
      index,
      total,
      type: q.type,
      text: q.text,
      imageUrl: q.imageUrl,
      timeLimit: q.timeLimit,
      points: q.points,
      choices: q.choices.map((c) => ({ index: c.index, text: c.text })),
    };
  }

  private clearTimer(pin: string): void {
    const timer = this.timers.get(pin);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(pin);
    }
  }
}

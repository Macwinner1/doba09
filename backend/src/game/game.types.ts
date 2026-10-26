import type { GamePhase, QuestionType } from '@feyi/shared';

/**
 * The authoritative snapshot of a quiz, taken at launch and stored in Redis.
 *
 * Snapshotting matters for two reasons: the engine never touches Postgres on the
 * hot path, and a host editing the quiz in another tab cannot mutate a game that
 * is already in flight.
 */
export interface GameQuizSnapshot {
  quizId: string;
  title: string;
  questions: GameQuestion[];
}

export interface GameQuestion {
  id: string;
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  timeLimit: number;
  points: number;
  choices: GameChoice[];
  correctChoiceIndex: number;
}

export interface GameChoice {
  id: string;
  index: number;
  text: string;
  isCorrect: boolean;
}

/** Game-level metadata. Small, JSON-encoded, read on nearly every event. */
export interface GameMeta {
  gameId: string;
  pin: string;
  hostId: string;
  hostToken: string;
  quizId: string;
  quizTitle: string;
  phase: GamePhase;
  currentQuestionIndex: number;
  /** Server clock at which the live question opened. Basis for all scoring. */
  questionStartedAt: number | null;
  questionEndsAt: number | null;
  startedAt: number;
  persisted: boolean;
}

export interface StoredPlayer {
  id: string;
  nickname: string;
  rejoinToken: string;
  score: number;
  streak: number;
  longestStreak: number;
  correctCount: number;
  connected: boolean;
  /** Server-measured round-trip time, used to compensate response times. */
  rttMs: number;
  joinedAt: number;
  /** Points gained on the most recent question — drives the "+640" animation. */
  lastGain: number;
}

export interface StoredAnswer {
  playerId: string;
  choiceIndex: number;
  /** Latency-compensated, server-measured. This is what scoring uses. */
  responseMs: number;
  /** What the client claimed. Kept only for tamper analytics. */
  clientElapsedMs: number;
  isCorrect: boolean;
  pointsAwarded: number;
}

/** What a socket is authenticated as, once it has joined a game. */
export interface SocketSession {
  pin: string;
  role: 'host' | 'player';
  playerId?: string;
}

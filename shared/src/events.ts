import type {
  AnswerDistribution,
  GamePhase,
  GameSummary,
  LeaderboardEntry,
  LobbyPlayer,
  PlayerQuestionResult,
  PodiumEntry,
  PublicQuestion,
} from './types.js';

/**
 * The socket contract. Both apps type their Socket.IO instance against these
 * maps, so adding an event or changing a payload breaks compilation on the
 * side that hasn't caught up — which is exactly what we want.
 */

export const GAME_EVENTS = {
  // player -> server
  PLAYER_JOIN: 'player:join',
  PLAYER_REJOIN: 'player:rejoin',
  PLAYER_ANSWER: 'player:answer',
  PLAYER_LEAVE: 'player:leave',

  // host -> server
  HOST_CREATE_GAME: 'host:create-game',
  HOST_REJOIN: 'host:rejoin',
  HOST_START: 'host:start',
  HOST_NEXT: 'host:next',
  HOST_SKIP: 'host:skip',
  HOST_KICK: 'host:kick',
  HOST_END: 'host:end',

  // server -> clients
  GAME_STATE: 'game:state',
  GAME_ERROR: 'game:error',
  GAME_ENDED: 'game:ended',
  LOBBY_PLAYERS: 'lobby:players',
  PLAYER_KICKED: 'player:kicked',
  QUESTION_INTRO: 'question:intro',
  QUESTION_START: 'question:start',
  QUESTION_TICK: 'question:tick',
  QUESTION_ANSWER_COUNT: 'question:answer-count',
  QUESTION_END: 'question:end',
  LEADERBOARD_UPDATE: 'leaderboard:update',
  GAME_PODIUM: 'game:podium',

  // latency handshake
  LATENCY_PING: 'latency:ping',
  LATENCY_PONG: 'latency:pong',
} as const;

/** Ack envelope. Every client->server event replies with one of these. */
export type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: GameErrorCode };

export type GameErrorCode =
  | 'GAME_NOT_FOUND'
  | 'GAME_ALREADY_STARTED'
  | 'GAME_FULL'
  | 'NICKNAME_TAKEN'
  | 'NICKNAME_INVALID'
  | 'NOT_HOST'
  | 'INVALID_PHASE'
  | 'ALREADY_ANSWERED'
  | 'ANSWER_TOO_LATE'
  | 'SESSION_INVALID'
  | 'QUIZ_NOT_FOUND'
  | 'QUIZ_EMPTY'
  | 'RATE_LIMITED'
  | 'INTERNAL';

// --- client -> server payloads -------------------------------------------

export interface PlayerJoinPayload {
  pin: string;
  nickname: string;
}
export interface PlayerJoinResult {
  playerId: string;
  /** Opaque token that lets this player reclaim their seat and score. */
  rejoinToken: string;
  nickname: string;
  quizTitle: string;
}

export interface PlayerRejoinPayload {
  pin: string;
  rejoinToken: string;
}

export interface PlayerAnswerPayload {
  questionId: string;
  choiceIndex: number;
  /**
   * The client's own view of elapsed time. Recorded for analytics and for
   * detecting tampering — it is NOT used for scoring. The server scores off
   * its own receive timestamp.
   */
  clientElapsedMs: number;
}
export interface PlayerAnswerResult {
  received: true;
  /** Echoed so the client can lock the right button without guessing. */
  choiceIndex: number;
}

export interface HostCreateGamePayload {
  quizId: string;
  /**
   * Single-use credential from POST /api/auth/socket-ticket.
   *
   * Carried in the payload rather than the socket handshake on purpose: a tab
   * that hosts a second game reuses its existing socket, whose handshake still
   * holds the first — already redeemed — ticket.
   */
  ticket: string;
}
export interface HostCreateGameResult {
  pin: string;
  gameId: string;
  hostToken: string;
  quizTitle: string;
  questionCount: number;
}

export interface HostRejoinPayload {
  pin: string;
  hostToken: string;
}

export interface HostKickPayload {
  playerId: string;
}

// --- server -> client payloads -------------------------------------------

/**
 * Full state snapshot. Sent on connect, on reconnect, and any time the server
 * needs a client to resync. This single event is what makes reconnection cheap:
 * the client throws away local state and rebuilds from it.
 */
export interface GameStatePayload {
  pin: string;
  phase: GamePhase;
  quizTitle: string;
  questionCount: number;
  currentQuestionIndex: number;
  players?: LobbyPlayer[];
  question?: PublicQuestion;
  /** Server clock at send time, so the client can align its countdown. */
  serverTime: number;
  /** Wall-clock ms at which the current question closes, if one is running. */
  questionEndsAt?: number;
  you?: {
    playerId: string;
    nickname: string;
    score: number;
    rank: number;
    hasAnswered: boolean;
  };
}

export interface QuestionIntroPayload {
  index: number;
  total: number;
  /** Shown on the host screen during the pre-question countdown. */
  text: string;
  type: string;
  startsAt: number;
  serverTime: number;
}

export interface QuestionStartPayload {
  question: PublicQuestion;
  startedAt: number;
  endsAt: number;
  serverTime: number;
}

export interface QuestionTickPayload {
  remainingMs: number;
}

export interface QuestionAnswerCountPayload {
  answered: number;
  total: number;
}

export interface QuestionEndPayload {
  questionId: string;
  correctChoiceIndex: number;
  distribution: AnswerDistribution[];
  /** Only ever sent to the player it belongs to. */
  yourResult?: PlayerQuestionResult;
}

export interface LeaderboardPayload {
  top: LeaderboardEntry[];
  isFinal: boolean;
  you?: LeaderboardEntry;
}

export interface PodiumPayload {
  podium: PodiumEntry[];
  summary: GameSummary;
  you?: { rank: number; score: number; nickname: string };
}

export interface GameErrorPayload {
  code: GameErrorCode;
  message: string;
}

// --- typed socket maps ----------------------------------------------------

export interface ClientToServerEvents {
  [GAME_EVENTS.PLAYER_JOIN]: (
    p: PlayerJoinPayload,
    ack: (r: Ack<PlayerJoinResult>) => void,
  ) => void;
  [GAME_EVENTS.PLAYER_REJOIN]: (
    p: PlayerRejoinPayload,
    ack: (r: Ack<PlayerJoinResult>) => void,
  ) => void;
  [GAME_EVENTS.PLAYER_ANSWER]: (
    p: PlayerAnswerPayload,
    ack: (r: Ack<PlayerAnswerResult>) => void,
  ) => void;
  [GAME_EVENTS.PLAYER_LEAVE]: (ack: (r: Ack<null>) => void) => void;

  [GAME_EVENTS.HOST_CREATE_GAME]: (
    p: HostCreateGamePayload,
    ack: (r: Ack<HostCreateGameResult>) => void,
  ) => void;
  [GAME_EVENTS.HOST_REJOIN]: (
    p: HostRejoinPayload,
    ack: (r: Ack<HostCreateGameResult>) => void,
  ) => void;
  [GAME_EVENTS.HOST_START]: (ack: (r: Ack<null>) => void) => void;
  [GAME_EVENTS.HOST_NEXT]: (ack: (r: Ack<null>) => void) => void;
  [GAME_EVENTS.HOST_SKIP]: (ack: (r: Ack<null>) => void) => void;
  [GAME_EVENTS.HOST_KICK]: (
    p: HostKickPayload,
    ack: (r: Ack<null>) => void,
  ) => void;
  [GAME_EVENTS.HOST_END]: (ack: (r: Ack<null>) => void) => void;

  [GAME_EVENTS.LATENCY_PING]: (
    p: { clientTime: number },
    ack: (r: { serverTime: number; clientTime: number }) => void,
  ) => void;
}

export interface ServerToClientEvents {
  [GAME_EVENTS.GAME_STATE]: (p: GameStatePayload) => void;
  [GAME_EVENTS.GAME_ERROR]: (p: GameErrorPayload) => void;
  [GAME_EVENTS.GAME_ENDED]: (p: { reason: string }) => void;
  [GAME_EVENTS.LOBBY_PLAYERS]: (p: { players: LobbyPlayer[]; count: number }) => void;
  [GAME_EVENTS.PLAYER_KICKED]: (p: { reason: string }) => void;
  [GAME_EVENTS.QUESTION_INTRO]: (p: QuestionIntroPayload) => void;
  [GAME_EVENTS.QUESTION_START]: (p: QuestionStartPayload) => void;
  [GAME_EVENTS.QUESTION_TICK]: (p: QuestionTickPayload) => void;
  [GAME_EVENTS.QUESTION_ANSWER_COUNT]: (p: QuestionAnswerCountPayload) => void;
  [GAME_EVENTS.QUESTION_END]: (p: QuestionEndPayload) => void;
  [GAME_EVENTS.LEADERBOARD_UPDATE]: (p: LeaderboardPayload) => void;
  [GAME_EVENTS.GAME_PODIUM]: (p: PodiumPayload) => void;
}

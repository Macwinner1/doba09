/** Domain types shared by both apps. */

export type QuestionType = 'MULTIPLE_CHOICE' | 'TRUE_FALSE';

/**
 * The phases a live game moves through. The server owns this state machine
 * absolutely; clients only ever render the phase they are told they are in.
 *
 *   LOBBY -> QUESTION_INTRO -> QUESTION_ACTIVE -> QUESTION_RESULTS -> LEADERBOARD
 *              ^                                                          |
 *              +----------------------------------------------------------+
 *                                                                         |
 *                                              (after last question) -> PODIUM -> ENDED
 */
export type GamePhase =
  | 'LOBBY'
  | 'QUESTION_INTRO'
  | 'QUESTION_ACTIVE'
  | 'QUESTION_RESULTS'
  | 'LEADERBOARD'
  | 'PODIUM'
  | 'ENDED';

/** A choice as the *player* is allowed to see it — deliberately no `isCorrect`. */
export interface PublicChoice {
  index: number;
  text: string;
}

/** A question as broadcast at question start. Never carries the correct answer. */
export interface PublicQuestion {
  id: string;
  index: number;
  total: number;
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  timeLimit: number;
  points: number;
  choices: PublicChoice[];
}

export interface LobbyPlayer {
  id: string;
  nickname: string;
  connected: boolean;
}

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  score: number;
  rank: number;
  /** Score gained on the question just played — drives the "+640" animation. */
  gained: number;
  streak: number;
}

/** What a single player learns about their own answer once the timer ends. */
export interface PlayerQuestionResult {
  answered: boolean;
  choiceIndex: number | null;
  isCorrect: boolean;
  pointsAwarded: number;
  responseMs: number | null;
  totalScore: number;
  rank: number;
  streak: number;
  /** Points behind the player directly above — the "you're 120 points behind" nudge. */
  pointsBehindNext: number | null;
}

/** Aggregate answer counts for the host's bar chart. */
export interface AnswerDistribution {
  choiceIndex: number;
  count: number;
  isCorrect: boolean;
}

export interface PodiumEntry {
  rank: number;
  playerId: string;
  nickname: string;
  score: number;
}

export interface GameSummary {
  sessionId: string;
  quizTitle: string;
  playerCount: number;
  questionCount: number;
  podium: PodiumEntry[];
}

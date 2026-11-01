'use client';

import type {
  AnswerDistribution,
  GamePhase,
  GameStatePayload,
  LeaderboardEntry,
  LobbyPlayer,
  PlayerQuestionResult,
  PodiumEntry,
  PublicQuestion,
} from '@feyi/shared';
import { create } from 'zustand';

interface GameState {
  connected: boolean;
  error: string | null;

  pin: string | null;
  quizTitle: string;
  phase: GamePhase;
  questionCount: number;
  currentQuestionIndex: number;

  players: LobbyPlayer[];
  question: PublicQuestion | null;
  /** Server clock at which the live question closes, already clock-corrected. */
  questionEndsAt: number | null;
  /** Local clock minus server clock. Applied so a skewed device still counts down right. */
  clockOffset: number;

  answeredChoice: number | null;
  answerCount: { answered: number; total: number };
  correctChoiceIndex: number | null;
  distribution: AnswerDistribution[];
  myResult: PlayerQuestionResult | null;

  leaderboard: LeaderboardEntry[];
  myLeaderboardEntry: LeaderboardEntry | null;
  podium: PodiumEntry[];
  standings: PodiumEntry[];
  myPodium: { rank: number; score: number; nickname: string } | null;

  me: { playerId: string; nickname: string; score: number; rank: number } | null;

  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  applyState: (payload: GameStatePayload) => void;
  reset: () => void;
}

const initial = {
  connected: false,
  error: null,
  pin: null,
  quizTitle: '',
  phase: 'LOBBY' as GamePhase,
  questionCount: 0,
  currentQuestionIndex: -1,
  players: [],
  question: null,
  questionEndsAt: null,
  clockOffset: 0,
  answeredChoice: null,
  answerCount: { answered: 0, total: 0 },
  correctChoiceIndex: null,
  distribution: [],
  myResult: null,
  leaderboard: [],
  myLeaderboardEntry: null,
  podium: [],
  standings: [],
  myPodium: null,
  me: null,
};

export const useGameStore = create<GameState>((set) => ({
  ...initial,

  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),

  /**
   * Applies a server snapshot wholesale. Every reconnect funnels through here,
   * which is why the client can afford to keep no durable state of its own.
   */
  applyState: (payload) =>
    set((state) => ({
      pin: payload.pin,
      phase: payload.phase,
      quizTitle: payload.quizTitle,
      questionCount: payload.questionCount,
      currentQuestionIndex: payload.currentQuestionIndex,
      players: payload.players ?? state.players,
      question: payload.question ?? state.question,
      questionEndsAt: payload.questionEndsAt ?? null,
      // Devices with a wrong system clock are common; anchoring to the server's
      // clock keeps every countdown honest.
      clockOffset: Date.now() - payload.serverTime,
      answeredChoice: payload.you?.hasAnswered ? state.answeredChoice : null,
      me: payload.you
        ? {
            playerId: payload.you.playerId,
            nickname: payload.you.nickname,
            score: payload.you.score,
            rank: payload.you.rank,
          }
        : state.me,
    })),

  reset: () => set(initial),
}));

/** Direct setters for socket handlers, kept off the store's public surface. */
export const gameActions = {
  set: useGameStore.setState,
};

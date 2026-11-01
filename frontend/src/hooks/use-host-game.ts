'use client';

import {
  GAME_EVENTS,
  type GameStatePayload,
  type HostCreateGameResult,
  type LeaderboardPayload,
  type PodiumPayload,
  type QuestionAnswerCountPayload,
  type QuestionEndPayload,
  type QuestionIntroPayload,
  type QuestionStartPayload,
} from '@feyi/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emitWithAck, getSocket, type GameSocket } from '@/lib/socket';
import { apiFetch } from '@/lib/api';
import { storage } from '@/lib/utils';
import { gameActions, useGameStore } from '@/store/game-store';

/**
 * Drives the presenter screen.
 *
 * The host receives strictly more than players do — the answer key, the live
 * answer count, the full leaderboard — because this screen is the projector.
 */
export function useHostGame(pin: string | null) {
  const socketRef = useRef<GameSocket | null>(null);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    if (!pin) return;

    const socket = getSocket();
    socketRef.current = socket;

    const onConnect = () => {
      gameActions.set({ connected: true });

      // Re-arm the game after a refresh. The host token was issued over an
      // authenticated socket and lives only in this tab.
      const token = storage.loadHost(pin);
      if (!token) {
        setFatal('This tab is not hosting that game.');
        return;
      }

      emitWithAck<HostCreateGameResult>(socket, GAME_EVENTS.HOST_REJOIN, {
        pin,
        hostToken: token,
      })
        .then(() => setReady(true))
        .catch((err: Error) => setFatal(err.message));
    };

    const onDisconnect = () => gameActions.set({ connected: false });
    const onState = (payload: GameStatePayload) => useGameStore.getState().applyState(payload);

    const onLobby = (payload: { players: GameStatePayload['players']; count: number }) =>
      gameActions.set({ players: payload.players ?? [] });

    const onIntro = (payload: QuestionIntroPayload) =>
      gameActions.set({
        phase: 'QUESTION_INTRO',
        currentQuestionIndex: payload.index,
        questionCount: payload.total,
        clockOffset: Date.now() - payload.serverTime,
        answerCount: { answered: 0, total: 0 },
        correctChoiceIndex: null,
        distribution: [],
      });

    const onQuestionStart = (payload: QuestionStartPayload) =>
      gameActions.set({
        phase: 'QUESTION_ACTIVE',
        question: payload.question,
        questionEndsAt: payload.endsAt,
        clockOffset: Date.now() - payload.serverTime,
        currentQuestionIndex: payload.question.index,
        correctChoiceIndex: null,
        distribution: [],
      });

    const onAnswerCount = (payload: QuestionAnswerCountPayload) =>
      gameActions.set({ answerCount: payload });

    const onQuestionEnd = (payload: QuestionEndPayload) =>
      gameActions.set({
        phase: 'QUESTION_RESULTS',
        correctChoiceIndex: payload.correctChoiceIndex,
        distribution: payload.distribution,
      });

    const onLeaderboard = (payload: LeaderboardPayload) =>
      gameActions.set({ phase: 'LEADERBOARD', leaderboard: payload.top });

    const onPodium = (payload: PodiumPayload) =>
      gameActions.set({ phase: 'PODIUM', podium: payload.podium, standings: payload.standings ?? [] });

    const onEnded = () => gameActions.set({ phase: 'ENDED' });

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(GAME_EVENTS.GAME_STATE, onState);
    socket.on(GAME_EVENTS.LOBBY_PLAYERS, onLobby);
    socket.on(GAME_EVENTS.QUESTION_INTRO, onIntro);
    socket.on(GAME_EVENTS.QUESTION_START, onQuestionStart);
    socket.on(GAME_EVENTS.QUESTION_ANSWER_COUNT, onAnswerCount);
    socket.on(GAME_EVENTS.QUESTION_END, onQuestionEnd);
    socket.on(GAME_EVENTS.LEADERBOARD_UPDATE, onLeaderboard);
    socket.on(GAME_EVENTS.GAME_PODIUM, onPodium);
    socket.on(GAME_EVENTS.GAME_ENDED, onEnded);

    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(GAME_EVENTS.GAME_STATE, onState);
      socket.off(GAME_EVENTS.LOBBY_PLAYERS, onLobby);
      socket.off(GAME_EVENTS.QUESTION_INTRO, onIntro);
      socket.off(GAME_EVENTS.QUESTION_START, onQuestionStart);
      socket.off(GAME_EVENTS.QUESTION_ANSWER_COUNT, onAnswerCount);
      socket.off(GAME_EVENTS.QUESTION_END, onQuestionEnd);
      socket.off(GAME_EVENTS.LEADERBOARD_UPDATE, onLeaderboard);
      socket.off(GAME_EVENTS.GAME_PODIUM, onPodium);
      socket.off(GAME_EVENTS.GAME_ENDED, onEnded);
    };
  }, [pin]);

  const control = useCallback(async (event: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    await emitWithAck(socket, event).catch((err: Error) =>
      gameActions.set({ error: err.message }),
    );
  }, []);

  return {
    ready,
    fatal,
    start: () => control(GAME_EVENTS.HOST_START),
    next: () => control(GAME_EVENTS.HOST_NEXT),
    skip: () => control(GAME_EVENTS.HOST_SKIP),
    end: () => control(GAME_EVENTS.HOST_END),
    kick: async (playerId: string) => {
      const socket = socketRef.current;
      if (socket) await emitWithAck(socket, GAME_EVENTS.HOST_KICK, { playerId }).catch(() => {});
    },
  };
}

/** Opens a new game for a quiz and returns its PIN. */
export async function createGame(quizId: string): Promise<HostCreateGameResult> {
  // The auth cookie is httpOnly and scoped to this origin, so it never reaches
  // the socket server. A single-use ticket carries the identity instead, and is
  // fetched fresh every time because redeeming one destroys it.
  const { ticket } = await apiFetch<{ ticket: string }>('/api/auth/socket-ticket', {
    method: 'POST',
  });

  const socket = getSocket();

  if (!socket.connected) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not reach the server')), 10_000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  const result = await emitWithAck<HostCreateGameResult>(socket, GAME_EVENTS.HOST_CREATE_GAME, {
    quizId,
    ticket,
  });
  storage.saveHost(result.pin, result.hostToken);
  return result;
}

'use client';

import {
  GAME_EVENTS,
  type GameStatePayload,
  type LeaderboardPayload,
  type PlayerJoinResult,
  type PodiumPayload,
  type QuestionEndPayload,
  type QuestionIntroPayload,
  type QuestionStartPayload,
} from '@feyi/shared';
import { useCallback, useEffect, useRef } from 'react';
import { emitWithAck, getSocket, type GameSocket } from '@/lib/socket';
import { storage } from '@/lib/utils';
import { gameActions, useGameStore } from '@/store/game-store';

/**
 * Owns the player's socket for the lifetime of the play page.
 *
 * Every server event maps to a store update and nothing else — the UI is a
 * pure function of the phase the server last declared, which is what makes
 * reconnection a non-event.
 */
export function usePlayerGame(pin: string) {
  const socketRef = useRef<GameSocket | null>(null);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    const onConnect = () => {
      gameActions.set({ connected: true, error: null });

      // A reconnect must reclaim the same seat and score, so we always try the
      // stored token before showing the nickname form again.
      const saved = storage.loadPlayer(pin);
      if (saved) {
        emitWithAck<PlayerJoinResult>(socket, GAME_EVENTS.PLAYER_REJOIN, {
          pin,
          rejoinToken: saved.rejoinToken,
        }).catch(() => storage.clearPlayer(pin));
      }
    };

    const onDisconnect = () => gameActions.set({ connected: false });

    const onState = (payload: GameStatePayload) =>
      useGameStore.getState().applyState(payload);

    const onIntro = (payload: QuestionIntroPayload) =>
      gameActions.set({
        phase: 'QUESTION_INTRO',
        currentQuestionIndex: payload.index,
        questionCount: payload.total,
        clockOffset: Date.now() - payload.serverTime,
        answeredChoice: null,
        myResult: null,
        correctChoiceIndex: null,
      });

    const onQuestionStart = (payload: QuestionStartPayload) =>
      gameActions.set({
        phase: 'QUESTION_ACTIVE',
        question: payload.question,
        questionEndsAt: payload.endsAt,
        clockOffset: Date.now() - payload.serverTime,
        currentQuestionIndex: payload.question.index,
        questionCount: payload.question.total,
        answeredChoice: null,
        myResult: null,
        correctChoiceIndex: null,
      });

    const onQuestionEnd = (payload: QuestionEndPayload) =>
      gameActions.set({
        phase: 'QUESTION_RESULTS',
        correctChoiceIndex: payload.correctChoiceIndex,
        distribution: payload.distribution,
        myResult: payload.yourResult ?? null,
      });

    const onLeaderboard = (payload: LeaderboardPayload) =>
      gameActions.set({
        phase: 'LEADERBOARD',
        leaderboard: payload.top,
        myLeaderboardEntry: payload.you ?? null,
      });

    const onPodium = (payload: PodiumPayload) =>
      gameActions.set({
        phase: 'PODIUM',
        podium: payload.podium,
        // ?? []: a backend deployed before this field existed omits it.
        standings: payload.standings ?? [],
        myPodium: payload.you ?? null,
      });

    const onKicked = (payload: { reason: string }) => {
      storage.clearPlayer(pin);
      gameActions.set({ phase: 'ENDED', error: payload.reason });
    };

    const onEnded = (payload: { reason: string }) => {
      storage.clearPlayer(pin);
      gameActions.set({ phase: 'ENDED', error: payload.reason });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(GAME_EVENTS.GAME_STATE, onState);
    socket.on(GAME_EVENTS.QUESTION_INTRO, onIntro);
    socket.on(GAME_EVENTS.QUESTION_START, onQuestionStart);
    socket.on(GAME_EVENTS.QUESTION_END, onQuestionEnd);
    socket.on(GAME_EVENTS.LEADERBOARD_UPDATE, onLeaderboard);
    socket.on(GAME_EVENTS.GAME_PODIUM, onPodium);
    socket.on(GAME_EVENTS.PLAYER_KICKED, onKicked);
    socket.on(GAME_EVENTS.GAME_ENDED, onEnded);

    if (socket.connected) onConnect();

    // A periodic probe keeps the server's per-player RTT estimate current, so
    // latency compensation tracks a connection that degrades mid-game.
    const pingTimer = setInterval(() => {
      if (socket.connected) socket.emit(GAME_EVENTS.LATENCY_PING, { clientTime: Date.now() }, () => {});
    }, 5_000);

    return () => {
      clearInterval(pingTimer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(GAME_EVENTS.GAME_STATE, onState);
      socket.off(GAME_EVENTS.QUESTION_INTRO, onIntro);
      socket.off(GAME_EVENTS.QUESTION_START, onQuestionStart);
      socket.off(GAME_EVENTS.QUESTION_END, onQuestionEnd);
      socket.off(GAME_EVENTS.LEADERBOARD_UPDATE, onLeaderboard);
      socket.off(GAME_EVENTS.GAME_PODIUM, onPodium);
      socket.off(GAME_EVENTS.PLAYER_KICKED, onKicked);
      socket.off(GAME_EVENTS.GAME_ENDED, onEnded);
    };
  }, [pin]);

  const join = useCallback(
    async (nickname: string) => {
      const socket = socketRef.current ?? getSocket();
      const result = await emitWithAck<PlayerJoinResult>(socket, GAME_EVENTS.PLAYER_JOIN, {
        pin,
        nickname,
      });
      storage.savePlayer(pin, {
        playerId: result.playerId,
        rejoinToken: result.rejoinToken,
        nickname: result.nickname,
      });
      return result;
    },
    [pin],
  );

  const answer = useCallback(async (choiceIndex: number) => {
    const socket = socketRef.current;
    const { question, questionEndsAt, clockOffset, answeredChoice } = useGameStore.getState();
    if (!socket || !question || answeredChoice !== null) return;

    // Lock the button immediately. Waiting for the server ack would leave a
    // window where an impatient player taps a second shape.
    gameActions.set({ answeredChoice: choiceIndex });

    const elapsed =
      questionEndsAt !== null
        ? Math.max(0, question.timeLimit * 1000 - (questionEndsAt + clockOffset - Date.now()))
        : 0;

    try {
      await emitWithAck(socket, GAME_EVENTS.PLAYER_ANSWER, {
        questionId: question.id,
        choiceIndex,
        clientElapsedMs: Math.round(elapsed),
      });
    } catch (err) {
      // Roll the lock back only if the server actually refused it.
      gameActions.set({
        answeredChoice: null,
        error: err instanceof Error ? err.message : 'Could not send your answer',
      });
    }
  }, []);

  return { join, answer };
}

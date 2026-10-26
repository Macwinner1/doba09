import {
  FULL_POINTS_GRACE_MS,
  MAX_LATENCY_COMPENSATION_MS,
} from './constants.js';

export interface ScoreInput {
  isCorrect: boolean;
  /** Milliseconds from the server's question-start stamp to the answer landing. */
  responseMs: number;
  /** The question's time limit, in seconds. */
  timeLimitSeconds: number;
  /** Face value of the question (0, 1000 or 2000). */
  pointsPossible: number;
}

/**
 * Kahoot's scoring curve:
 *
 *   points = round( (1 - (responseMs / timeLimitMs) / 2) * pointsPossible )
 *
 * So a correct answer is worth between 50% and 100% of face value depending on
 * speed, and a wrong answer is worth nothing. The halving is what makes the
 * game feel fair — being slow costs you, but never more than half.
 */
export function calculateScore({
  isCorrect,
  responseMs,
  timeLimitSeconds,
  pointsPossible,
}: ScoreInput): number {
  if (!isCorrect || pointsPossible <= 0) return 0;

  // Sub-grace answers are indistinguishable from instantaneous once network
  // jitter is accounted for, so we stop trying to rank them.
  if (responseMs <= FULL_POINTS_GRACE_MS) return pointsPossible;

  const timeLimitMs = timeLimitSeconds * 1000;
  if (responseMs >= timeLimitMs) return Math.round(pointsPossible * 0.5);

  const ratio = responseMs / timeLimitMs;
  return Math.round((1 - ratio / 2) * pointsPossible);
}

/**
 * Correct a raw response time for the player's connection quality.
 *
 * `rttMs` is measured by the server's own ping handshake, not reported by the
 * client, and the correction is capped. Both details matter: an uncapped or
 * client-supplied value would let a player claim enormous latency, answer at
 * their leisure, and still be scored as if they were instant.
 */
export function compensateForLatency(rawResponseMs: number, rttMs: number): number {
  const oneWay = Math.min(
    Math.max(rttMs, 0) / 2,
    MAX_LATENCY_COMPENSATION_MS,
  );
  return Math.max(0, rawResponseMs - oneWay);
}

/** Dense ranking by score, ties broken by nickname so ordering is stable. */
export function rankPlayers<T extends { score: number; nickname: string }>(
  players: T[],
): (T & { rank: number })[] {
  const sorted = [...players].sort(
    (a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname),
  );

  let lastScore: number | null = null;
  let lastRank = 0;

  return sorted.map((player, i) => {
    const rank = player.score === lastScore ? lastRank : i + 1;
    lastScore = player.score;
    lastRank = rank;
    return { ...player, rank };
  });
}

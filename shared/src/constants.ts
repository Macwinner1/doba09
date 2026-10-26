/**
 * Tuning constants shared by client and server.
 *
 * Anything here that affects scoring or timing is enforced server-side. The
 * client imports these purely so its countdown and layout match what the
 * server is actually doing.
 */

/** Game PINs are 6 digits, never leading-zero, so they read cleanly on a projector. */
export const PIN_LENGTH = 6;
export const PIN_MIN = 100_000;
export const PIN_MAX = 999_999;

/** Nickname rules — enforced on join, mirrored in the client input. */
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 15;

/** Above this, a single game is split-screened in the host lobby UI. */
export const MAX_PLAYERS_PER_GAME = 200;

/** Question timing bounds, in seconds. */
export const MIN_TIME_LIMIT = 5;
export const MAX_TIME_LIMIT = 240;
export const DEFAULT_TIME_LIMIT = 20;

/** Point values a host can assign to a question. Mirrors Kahoot's 0/1x/2x. */
export const POINTS_OPTIONS = [0, 1000, 2000] as const;
export const DEFAULT_POINTS = 1000;

/** Multiple choice supports 2-4 options; true/false is a fixed 2. */
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 4;

/**
 * A correct answer inside this window is treated as instantaneous and earns
 * full points. Without it, network jitter alone would cost the fastest players
 * points they earned.
 */
export const FULL_POINTS_GRACE_MS = 500;

/**
 * Ceiling on the one-way latency we will compensate for. A player on a genuinely
 * bad connection gets help up to this bound; beyond it we stop, because an
 * uncapped correction is a cheat vector (fake a huge RTT, answer late, still win).
 */
export const MAX_LATENCY_COMPENSATION_MS = 500;

/** Countdown shown before a question goes live, so everyone starts together. */
export const QUESTION_INTRO_MS = 3_000;

/** How long results/leaderboard stay up before the host can advance. */
export const RESULTS_MIN_DISPLAY_MS = 1_500;

/** A disconnected player keeps their seat and score this long before being dropped. */
export const PLAYER_RECONNECT_GRACE_MS = 60_000;

/** Live game state TTL in Redis — a forgotten game cleans itself up. */
export const GAME_STATE_TTL_SECONDS = 60 * 60 * 6;

/**
 * The four answer slots, in fixed order. Colour and shape are part of the
 * product: players match the shape on their phone to the shape on the big
 * screen, which is what lets the phone stay text-free.
 */
export const ANSWER_SLOTS = [
  { index: 0, shape: 'triangle', color: '#E21B3C', name: 'red' },
  { index: 1, shape: 'diamond', color: '#1368CE', name: 'blue' },
  { index: 2, shape: 'circle', color: '#D89E00', name: 'yellow' },
  { index: 3, shape: 'square', color: '#26890C', name: 'green' },
] as const;

export type AnswerSlot = (typeof ANSWER_SLOTS)[number];

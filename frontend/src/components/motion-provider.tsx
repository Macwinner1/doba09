'use client';

import { MotionConfig } from 'framer-motion';

/**
 * Makes framer-motion honour the OS "reduce motion" setting.
 *
 * This is not automatic — framer-motion defaults to `reducedMotion: "never"`,
 * and the `prefers-reduced-motion` block in globals.css only governs CSS
 * animations. Without this provider every JS-driven animation in the game would
 * ignore the preference entirely.
 *
 * With "user", transform and layout animations are skipped for those users
 * while opacity still crossfades, so content never gets stuck invisible.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

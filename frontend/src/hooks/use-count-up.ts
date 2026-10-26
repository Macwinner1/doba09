'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Animates a number toward its target.
 *
 * A score that snaps from 1,200 to 1,950 is information; a score that races
 * there is a reward. Driven by rAF rather than an interval so it stays in step
 * with the compositor and pauses when the tab is hidden.
 */
export function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;

    // Honour the OS setting: land on the value immediately instead of racing.
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Ease-out cubic: fast off the mark, settles gently on the final figure.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));

      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      // Bank the target so an interrupted count resumes from here rather than
      // replaying from the previous value.
      fromRef.current = target;
    };
  }, [target, durationMs]);

  return value;
}

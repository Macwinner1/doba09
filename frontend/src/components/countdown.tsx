'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Countdown ring.
 *
 * Purely cosmetic — the server decides when a question actually closes. It is
 * driven off the server's `endsAt` corrected by the measured clock offset, so a
 * device with a wrong system clock still shows the right number.
 */
export function Countdown({
  endsAt,
  clockOffset,
  totalSeconds,
}: {
  endsAt: number;
  clockOffset: number;
  totalSeconds: number;
}) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, endsAt + clockOffset - Date.now()),
  );

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, endsAt + clockOffset - Date.now()));
    tick();
    // 100ms rather than 1s so the ring animates smoothly instead of stepping.
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [endsAt, clockOffset]);

  const seconds = Math.ceil(remaining / 1000);
  const fraction = totalSeconds > 0 ? remaining / (totalSeconds * 1000) : 0;
  const circumference = 2 * Math.PI * 45;

  return (
    <div className="relative h-24 w-24" role="timer" aria-live="off">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke={seconds <= 5 ? '#e21b3c' : '#ffffff'}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, fraction)))}
          className="transition-[stroke-dashoffset] duration-100 ease-linear"
        />
      </svg>
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center font-display text-4xl font-extrabold text-white tabular-nums',
          // The last five seconds pulse. On a projector this is the cue people
          // feel before they read the number.
          seconds <= 5 && seconds > 0 && 'animate-pulse text-feyi-red',
        )}
      >
        {seconds}
      </div>
    </div>
  );
}

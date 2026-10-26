'use client';

import { cn } from '@/lib/utils';

/**
 * A generated avatar for an anonymous player.
 *
 * Players never sign in, so there is no picture to show — but a lobby of thirty
 * plain text names reads as a spreadsheet. Deriving a shape and colour from the
 * nickname gives everyone something to spot themselves by on the big screen.
 *
 * Deterministic on purpose: the same nickname always produces the same avatar,
 * on every device, with no state to store or sync.
 */

const PALETTE = [
  ['#e21b3c', '#ff7a90'],
  ['#1368ce', '#6aa8ff'],
  ['#d89e00', '#ffd54a'],
  ['#26890c', '#6fd94f'],
  ['#8b5cf6', '#c4a6ff'],
  ['#ec4899', '#ff9ecb'],
  ['#0891b2', '#5fd3e8'],
  ['#f97316', '#ffb173'],
] as const;

/** FNV-1a: tiny, fast, and spreads similar nicknames apart well. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h);
}

export function PlayerAvatar({
  nickname,
  size = 40,
  className,
}: {
  nickname: string;
  size?: number;
  className?: string;
}) {
  const h = hash(nickname.toLowerCase());
  const [base, accent] = PALETTE[h % PALETTE.length]!;
  const face = h % 4;
  const initial = nickname.trim().charAt(0).toUpperCase() || '?';

  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 40 40" className="h-full w-full">
        <circle cx="20" cy="20" r="20" fill={base} />
        {/* A second shape keeps two players with the same initial distinct. */}
        {face === 0 && <circle cx="20" cy="27" r="13" fill={accent} opacity="0.55" />}
        {face === 1 && <rect x="6" y="22" width="28" height="18" rx="6" fill={accent} opacity="0.55" />}
        {face === 2 && <path d="M20 8 34 34H6Z" fill={accent} opacity="0.5" />}
        {face === 3 && <path d="M20 12 32 20 20 36 8 20Z" fill={accent} opacity="0.5" />}
      </svg>
      <span
        className="absolute font-display font-extrabold text-white drop-shadow"
        style={{ fontSize: size * 0.44 }}
      >
        {initial}
      </span>
    </span>
  );
}

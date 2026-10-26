'use client';

import { cn } from '@/lib/utils';

/**
 * A generated cover for a quiz.
 *
 * Quizzes have no artwork yet (image upload isn't built), and a library of
 * identical white rectangles is hard to scan. Deriving a gradient and a glyph
 * from the quiz id gives each one a stable identity a host can recognise at a
 * glance — the same quiz looks the same on every device, with nothing stored.
 */

const GRADIENTS = [
  'from-violet-500 to-fuchsia-600',
  'from-sky-500 to-indigo-600',
  'from-amber-400 to-orange-600',
  'from-emerald-400 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-cyan-400 to-blue-600',
  'from-lime-400 to-green-600',
  'from-purple-500 to-indigo-700',
] as const;

const GLYPHS = ['◆', '●', '▲', '■', '★', '⬢'] as const;

function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h);
}

export function QuizCover({
  seed,
  title,
  className,
}: {
  seed: string;
  title: string;
  className?: string;
}) {
  const h = hash(seed);
  const gradient = GRADIENTS[h % GRADIENTS.length]!;
  const glyph = GLYPHS[(h >> 3) % GLYPHS.length]!;

  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br',
        gradient,
        className,
      )}
      aria-hidden="true"
    >
      {/* Oversized, clipped glyph — texture rather than a symbol to be read. */}
      <span className="absolute -bottom-3 -right-2 text-6xl text-white/20">{glyph}</span>
      <span className="font-display text-2xl font-extrabold text-white drop-shadow">
        {title.trim().charAt(0).toUpperCase() || '?'}
      </span>
    </div>
  );
}

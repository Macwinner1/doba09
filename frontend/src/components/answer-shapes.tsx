import { ANSWER_SLOTS } from '@feyi/shared';
import { cn } from '@/lib/utils';

/**
 * The four answer shapes.
 *
 * Shape carries the meaning, not just colour — a player who cannot distinguish
 * red from green still matches triangle to triangle. This is the reason the
 * player's phone can stay free of question text at all.
 */
export function AnswerShape({ index, className }: { index: number; className?: string }) {
  const common = cn('h-full w-full', className);

  switch (index) {
    case 0:
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true">
          <path d="M12 3 22 21H2Z" fill="currentColor" />
        </svg>
      );
    case 1:
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true">
          <path d="M12 2 22 12 12 22 2 12Z" fill="currentColor" />
        </svg>
      );
    case 2:
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="2" fill="currentColor" />
        </svg>
      );
  }
}

export const SLOT_BG = [
  'bg-feyi-red',
  'bg-feyi-blue',
  'bg-feyi-yellow',
  'bg-feyi-green',
] as const;

export function slotName(index: number): string {
  return ANSWER_SLOTS[index]?.name ?? 'answer';
}

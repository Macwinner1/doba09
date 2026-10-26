'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { playSound } from '@/lib/sound';

type Variant = 'primary' | 'light' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg' | 'xl';

/*
 * Each variant pairs a face colour with a darker edge. The edge is what the
 * .feyi-press utility compresses on tap, so the pairing is functional rather
 * than a shade choice.
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-feyi-purple border-feyi-purple-deep text-white',
  light: 'bg-white border-slate-300 text-feyi-purple',
  ghost: 'bg-white/15 border-white/25 text-white backdrop-blur',
  danger: 'bg-feyi-red border-feyi-red-deep text-white',
  success: 'bg-feyi-green border-feyi-green-deep text-white',
};

const SIZES: Record<Size, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-6 py-3 text-base',
  // Sized past the 44px minimum tap target — these get hit in a hurry.
  lg: 'px-8 py-4 text-lg',
  xl: 'px-12 py-5 text-2xl',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Set false for controls that already make their own noise. */
  clickSound?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', clickSound = true, className, onClick, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      onClick={(e) => {
        if (clickSound) playSound('tap');
        onClick?.(e);
      }}
      className={cn(
        'feyi-press rounded-chunk font-display font-extrabold shadow-chunk',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
});

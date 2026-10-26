'use client';

import { PIN_LENGTH, pinSchema } from '@feyi/shared';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SoundToggle } from '@/components/sound-toggle';
import { Button } from '@/components/ui/button';

/**
 * The join screen — the app's front door.
 *
 * Kept intentionally bare: a player arriving here is standing in a room being
 * told a number out loud, so the only thing on screen is the box for it.
 */
export default function JoinPage() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = pinSchema.safeParse(pin);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check that PIN');
      return;
    }
    router.push(`/play/${parsed.data}`);
  }

  return (
    <main className="feyi-bg flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <SoundToggle className="absolute right-4 top-4" />

      {/*
       * The entrance here is CSS, not framer-motion, and that is deliberate.
       *
       * This is the app's front door: every player loads it on a phone, often
       * on poor mobile data. Anything that starts at opacity 0 and waits for
       * JavaScript to reveal it is an empty purple screen if the bundle is slow
       * or fails. CSS animations run off the stylesheet at first paint, need no
       * hydration, and are already covered by the prefers-reduced-motion block.
       *
       * In-game screens animate with framer-motion freely — JS is mandatory
       * there anyway, since without a socket there is no game to show.
       */}
      <h1 className="feyi-pop feyi-bob mb-10 font-display text-7xl font-extrabold tracking-tight text-white drop-shadow-[0_6px_0_rgba(0,0,0,0.25)] sm:text-8xl">
        Feyi
      </h1>

      <form
        onSubmit={submit}
        className="feyi-pop w-full max-w-sm rounded-chunk bg-white p-6 shadow-lift"
      >
        <label htmlFor="pin" className="sr-only">
          Game PIN
        </label>
        <input
          id="pin"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH));
            setError(null);
          }}
          // numeric keypad on phones, and no autocorrect getting in the way
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          placeholder="Game PIN"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'pin-error' : undefined}
          className="w-full rounded-2xl border-4 border-slate-200 bg-slate-50 px-4 py-4 text-center font-display text-3xl font-extrabold tracking-[0.25em] outline-none transition focus:border-feyi-purple focus:bg-white"
        />

        {error && (
          <motion.p
            initial={{ x: -6 }}
            animate={{ x: [6, -5, 4, -2, 0] }}
            transition={{ duration: 0.35 }}
            id="pin-error"
            role="alert"
            className="mt-3 text-center text-sm font-bold text-feyi-red"
          >
            {error}
          </motion.p>
        )}

        <Button
          type="submit"
          size="lg"
          className="mt-4 w-full"
          disabled={pin.length !== PIN_LENGTH}
        >
          Enter
        </Button>
      </form>

      <Link
        href="/dashboard"
        className="mt-8 rounded-full px-4 py-2 text-sm font-bold text-white/80 underline underline-offset-4 transition hover:text-white"
      >
        Hosting a game? Sign in
      </Link>
    </main>
  );
}

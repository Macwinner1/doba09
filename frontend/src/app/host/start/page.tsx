'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { createGame } from '@/hooks/use-host-game';

/**
 * Opens a game, then hands off to /host/[pin].
 *
 * The redirect matters: the PIN in the URL is what lets a host refresh or
 * recover the presenter screen without killing the game.
 */
function StartGame() {
  const router = useRouter();
  const params = useSearchParams();
  const quizId = params.get('quizId');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!quizId) {
      setError('No quiz selected');
      return;
    }
    // React Strict Mode double-invokes effects in development; without this
    // guard every host would silently open two games.
    if (started.current) return;
    started.current = true;

    createGame(quizId)
      .then((game) => router.replace(`/host/${game.pin}`))
      .catch((err: Error) => setError(err.message));
  }, [quizId, router]);

  return (
    <main className="feyi-bg flex min-h-screen items-center justify-center px-4">
      <div className="text-center text-white">
        {error ? (
          <>
            <p className="text-2xl font-black">{error}</p>
            <a href="/dashboard" className="mt-6 inline-block rounded-lg bg-white px-6 py-3 font-bold text-feyi-purple">
              Back to my quizzes
            </a>
          </>
        ) : (
          <p className="text-2xl font-black">Setting up your game…</p>
        )}
      </div>
    </main>
  );
}

export default function StartGamePage() {
  return (
    <Suspense fallback={null}>
      <StartGame />
    </Suspense>
  );
}

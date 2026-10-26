'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { QuizCover } from '@/components/quiz-cover';
import { RequireAuth, useUser } from '@/components/require-auth';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api';

interface QuizSummary {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  _count: { questions: number; sessions: number };
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  );
}

function Dashboard() {
  const user = useUser();
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiFetch<QuizSummary[]>('/api/quizzes')
      .then(setQuizzes)
      // A 401 has already navigated to /login by this point, so anything
      // arriving here is a genuine failure worth offering a retry for.
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) return;
        setError(err instanceof Error ? err.message : 'Could not load your quizzes');
      });
  }, []);

  useEffect(load, [load]);

  async function remove(id: string, title: string) {
    if (!confirm(`Delete “${title}”? Past game reports are kept.`)) return;

    setBusyId(id);
    try {
      await apiFetch(`/api/quizzes/${id}`, { method: 'DELETE' });
      setQuizzes((current) => (current ?? []).filter((q) => q.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that quiz');
    } finally {
      setBusyId(null);
    }
  }

  async function duplicate(id: string) {
    setBusyId(id);
    try {
      await apiFetch(`/api/quizzes/${id}/duplicate`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not duplicate that quiz');
    } finally {
      setBusyId(null);
    }
  }

  const totalGames = (quizzes ?? []).reduce((sum, q) => sum + q._count.sessions, 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userName={user.name} />

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-extrabold text-slate-900">
              Hi {user.name.split(' ')[0]} 👋
            </h1>
            <p className="mt-1 font-semibold text-slate-500">
              {quizzes === null
                ? 'Loading your library…'
                : `${quizzes.length} quiz${quizzes.length === 1 ? '' : 'zes'} · ${totalGames} game${totalGames === 1 ? '' : 's'} hosted`}
            </p>
          </div>

          <Link href="/create/new">
            <Button size="lg">+ New quiz</Button>
          </Link>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-chunk bg-red-50 px-5 py-4"
          >
            <p className="font-bold text-feyi-red">{error}</p>
            <Button variant="light" size="sm" onClick={load}>
              Try again
            </Button>
          </div>
        )}

        {quizzes === null && !error && <CardSkeleton />}

        {quizzes?.length === 0 && (
          <div className="rounded-chunk border-4 border-dashed border-slate-200 bg-white p-12 text-center">
            <div className="mx-auto mb-4 text-6xl" aria-hidden="true">
              🎲
            </div>
            <p className="mb-1 font-display text-2xl font-extrabold text-slate-800">
              Your library is empty
            </p>
            <p className="mb-6 font-semibold text-slate-500">
              Build a quiz and have the room playing in minutes.
            </p>
            <Link href="/create/new">
              <Button size="lg">Create your first quiz</Button>
            </Link>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {(quizzes ?? []).map((quiz) => (
            <article
              key={quiz.id}
              className="group flex flex-col rounded-chunk border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-chunk"
            >
              <div className="flex gap-4">
                <QuizCover seed={quiz.id} title={quiz.title} className="h-20 w-20" />

                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-display text-xl font-extrabold text-slate-900">
                    {quiz.title}
                  </h2>
                  {quiz.description && (
                    <p className="line-clamp-2 text-sm font-semibold text-slate-500">
                      {quiz.description}
                    </p>
                  )}
                  <p className="mt-1 flex flex-wrap gap-x-3 text-xs font-bold uppercase tracking-wide text-slate-400">
                    <span>
                      {quiz._count.questions} question{quiz._count.questions === 1 ? '' : 's'}
                    </span>
                    <span>
                      {quiz._count.sessions} game{quiz._count.sessions === 1 ? '' : 's'}
                    </span>
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/host/start?quizId=${quiz.id}`} className="flex-1">
                  <Button variant="success" size="md" className="w-full">
                    ▶ Host
                  </Button>
                </Link>
                <Link href={`/create/${quiz.id}`}>
                  <Button variant="light" size="md">
                    Edit
                  </Button>
                </Link>
                <Button
                  variant="light"
                  size="md"
                  disabled={busyId === quiz.id}
                  title="Duplicate"
                  onClick={() => duplicate(quiz.id)}
                >
                  ⧉
                </Button>
                <Button
                  variant="light"
                  size="md"
                  disabled={busyId === quiz.id}
                  title="Delete"
                  className="text-feyi-red"
                  onClick={() => remove(quiz.id, quiz.title)}
                >
                  ✕
                </Button>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
      <span className="sr-only">Loading your quizzes…</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-44 animate-pulse rounded-chunk bg-slate-200" />
      ))}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { RequireAuth, useUser } from '@/components/require-auth';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api';

interface SessionSummary {
  id: string;
  quizTitle: string;
  pin: string;
  startedAt: string;
  endedAt: string | null;
  playerCount: number;
  questionCount: number;
}

/**
 * Past games.
 *
 * The API for this was built with the game engine and then had no UI at all —
 * the dashboard would tell a host "12 games played" with nowhere to go.
 */
export default function ReportsPage() {
  return (
    <RequireAuth>
      <Reports />
    </RequireAuth>
  );
}

function Reports() {
  const user = useUser();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiFetch<SessionSummary[]>('/api/reports')
      .then(setSessions)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) return;
        setError(err instanceof Error ? err.message : 'Could not load your reports');
      });
  }, []);

  useEffect(load, [load]);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userName={user.name} />

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-1 font-display text-4xl font-extrabold text-slate-900">Reports</h1>
        <p className="mb-8 font-semibold text-slate-500">How your games actually went.</p>

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

        {sessions === null && !error && (
          <div className="space-y-3" aria-busy="true">
            <span className="sr-only">Loading reports…</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-chunk bg-slate-200" />
            ))}
          </div>
        )}

        {sessions?.length === 0 && (
          <div className="rounded-chunk border-4 border-dashed border-slate-200 bg-white p-12 text-center">
            <div className="mb-3 text-5xl" aria-hidden="true">
              📊
            </div>
            <p className="mb-1 font-display text-2xl font-extrabold text-slate-800">
              No games yet
            </p>
            <p className="mb-6 font-semibold text-slate-500">
              Host a quiz and the results will show up here.
            </p>
            <Link href="/dashboard">
              <Button size="lg">Go to my quizzes</Button>
            </Link>
          </div>
        )}

        <ul className="space-y-3">
          {(sessions ?? []).map((session) => (
            <li key={session.id}>
              <Link
                href={`/reports/${session.id}`}
                className="flex flex-wrap items-center justify-between gap-4 rounded-chunk border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-chunk"
              >
                <div className="min-w-0">
                  <h2 className="truncate font-display text-xl font-extrabold text-slate-900">
                    {session.quizTitle}
                  </h2>
                  <p className="text-sm font-semibold text-slate-500">
                    {formatDate(session.startedAt)} · PIN {session.pin}
                  </p>
                </div>

                <div className="flex gap-6 text-center">
                  <Stat value={session.playerCount} label="players" />
                  <Stat value={session.questionCount} label="questions" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="font-display text-2xl font-extrabold text-slate-900 tabular-nums">{value}</p>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}

// Not exported: Next only permits a fixed set of exports from a page module.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

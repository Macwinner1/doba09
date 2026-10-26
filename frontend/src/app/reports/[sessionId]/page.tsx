'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { PlayerAvatar } from '@/components/player-avatar';
import { RequireAuth, useUser } from '@/components/require-auth';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Report {
  session: {
    id: string;
    quizTitle: string;
    pin: string;
    startedAt: string;
    endedAt: string | null;
    playerCount: number;
    questionCount: number;
  };
  standings: {
    rank: number;
    nickname: string;
    score: number;
    correctCount: number;
    longestStreak: number;
  }[];
  questions: {
    id: string;
    order: number;
    text: string;
    answered: number;
    correct: number;
    accuracy: number | null;
    averageResponseMs: number | null;
  }[];
}

export default function ReportPage() {
  return (
    <RequireAuth>
      <ReportDetail />
    </RequireAuth>
  );
}

function ReportDetail() {
  const user = useUser();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiFetch<Report>(`/api/reports/${sessionId}`)
      .then(setReport)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) return;
        setError(err instanceof Error ? err.message : 'Could not load that report');
      });
  }, [sessionId]);

  useEffect(load, [load]);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userName={user.name} />

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link
          href="/reports"
          className="mb-4 inline-block text-sm font-extrabold text-slate-500 hover:text-slate-800"
        >
          ← All reports
        </Link>

        {error && (
          <div role="alert" className="rounded-chunk bg-red-50 px-5 py-4">
            <p className="mb-3 font-bold text-feyi-red">{error}</p>
            <Button variant="light" size="sm" onClick={load}>
              Try again
            </Button>
          </div>
        )}

        {!report && !error && (
          <div className="h-96 animate-pulse rounded-chunk bg-slate-200" aria-busy="true" />
        )}

        {report && (
          <>
            <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-4xl font-extrabold text-slate-900">
                  {report.session.quizTitle}
                </h1>
                <p className="font-semibold text-slate-500">
                  {new Date(report.session.startedAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}{' '}
                  · {report.session.playerCount} players
                </p>
              </div>

              <Button variant="light" size="md" onClick={() => downloadCsv(report)}>
                ⬇ Export CSV
              </Button>
            </header>

            <section className="mb-8">
              <h2 className="mb-3 font-display text-2xl font-extrabold text-slate-900">
                Question breakdown
              </h2>
              <p className="mb-4 text-sm font-semibold text-slate-500">
                Anything in red is worth going over again.
              </p>

              <ul className="space-y-2">
                {report.questions.map((q) => (
                  <li
                    key={q.id}
                    className="flex flex-wrap items-center gap-4 rounded-chunk border border-slate-200 bg-white p-4"
                  >
                    <span className="font-display text-lg font-extrabold text-slate-400">
                      {q.order + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-slate-800">{q.text}</p>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn('h-full rounded-full', accuracyColor(q.accuracy))}
                          style={{ width: `${Math.round((q.accuracy ?? 0) * 100)}%` }}
                        />
                      </div>
                    </div>

                    <div className="text-right">
                      <p
                        className={cn(
                          'font-display text-xl font-extrabold tabular-nums',
                          accuracyText(q.accuracy),
                        )}
                      >
                        {q.accuracy === null ? '—' : `${Math.round(q.accuracy * 100)}%`}
                      </p>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                        {q.correct}/{q.answered} correct
                      </p>
                    </div>

                    {q.averageResponseMs !== null && (
                      <div className="w-16 text-right">
                        <p className="font-bold text-slate-700 tabular-nums">
                          {(q.averageResponseMs / 1000).toFixed(1)}s
                        </p>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                          avg
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="mb-3 font-display text-2xl font-extrabold text-slate-900">
                Final standings
              </h2>

              <ul className="space-y-2">
                {report.standings.map((p) => (
                  <li
                    key={`${p.rank}-${p.nickname}`}
                    className="flex items-center gap-4 rounded-chunk border border-slate-200 bg-white p-4"
                  >
                    <span className="w-8 text-center font-display text-xl font-extrabold text-slate-400 tabular-nums">
                      {p.rank}
                    </span>
                    <PlayerAvatar nickname={p.nickname} size={36} />
                    <span className="flex-1 truncate font-display text-lg font-extrabold text-slate-900">
                      {p.nickname}
                    </span>

                    {p.longestStreak > 1 && (
                      <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-extrabold text-orange-600">
                        🔥 {p.longestStreak}
                      </span>
                    )}

                    <span className="w-20 text-right text-sm font-bold text-slate-500 tabular-nums">
                      {p.correctCount} right
                    </span>
                    <span className="w-24 text-right font-display text-xl font-extrabold text-slate-900 tabular-nums">
                      {p.score}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function accuracyColor(accuracy: number | null): string {
  if (accuracy === null) return 'bg-slate-300';
  if (accuracy >= 0.8) return 'bg-feyi-green';
  if (accuracy >= 0.5) return 'bg-feyi-yellow';
  return 'bg-feyi-red';
}

function accuracyText(accuracy: number | null): string {
  if (accuracy === null) return 'text-slate-400';
  if (accuracy >= 0.8) return 'text-feyi-green';
  if (accuracy >= 0.5) return 'text-feyi-yellow';
  return 'text-feyi-red';
}

/**
 * CSV export, built in the browser from data already on screen.
 *
 * No endpoint needed: the report is fully loaded, so generating the file here
 * costs one function instead of a round trip. This is the piece schools and
 * training teams actually ask for — results they can put in a spreadsheet.
 */
function downloadCsv(report: Report): void {
  const escape = (value: string | number | null): string => {
    const s = String(value ?? '');
    // Quote anything containing a delimiter, quote or newline, doubling quotes.
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows: (string | number | null)[][] = [
    ['Feyi report', report.session.quizTitle],
    ['Played', new Date(report.session.startedAt).toISOString()],
    ['Players', report.session.playerCount],
    [],
    ['Rank', 'Nickname', 'Score', 'Correct answers', 'Longest streak'],
    ...report.standings.map((p) => [p.rank, p.nickname, p.score, p.correctCount, p.longestStreak]),
    [],
    ['#', 'Question', 'Answered', 'Correct', 'Accuracy %', 'Avg response (s)'],
    ...report.questions.map((q) => [
      q.order + 1,
      q.text,
      q.answered,
      q.correct,
      q.accuracy === null ? '' : Math.round(q.accuracy * 100),
      q.averageResponseMs === null ? '' : (q.averageResponseMs / 1000).toFixed(2),
    ]),
  ];

  const csv = rows.map((row) => row.map(escape).join(',')).join('\n');
  // BOM so Excel opens UTF-8 nicknames correctly instead of mangling them.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `feyi-${report.session.quizTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

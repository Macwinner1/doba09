'use client';

import {
  DEFAULT_POINTS,
  DEFAULT_TIME_LIMIT,
  MAX_CHOICES,
  POINTS_OPTIONS,
  quizInputSchema,
  type QuizInput,
} from '@feyi/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AnswerShape, SLOT_BG } from '@/components/answer-shapes';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetch, redirectToLogin } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Where an in-progress quiz waits out a sign-in round trip. */
const DRAFT_KEY = 'feyi:quiz-draft';

type DraftChoice = { text: string; isCorrect: boolean };

/** The schema accepts only 0/1000/2000, so the draft carries that same union. */
type PointsValue = (typeof POINTS_OPTIONS)[number];

function toPoints(value: number): PointsValue {
  return (POINTS_OPTIONS as readonly number[]).includes(value)
    ? (value as PointsValue)
    : DEFAULT_POINTS;
}

type DraftQuestion = {
  type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  text: string;
  timeLimit: number;
  points: PointsValue;
  choices: DraftChoice[];
};

function blankQuestion(): DraftQuestion {
  return {
    type: 'MULTIPLE_CHOICE',
    text: '',
    timeLimit: DEFAULT_TIME_LIMIT,
    points: DEFAULT_POINTS,
    choices: [
      { text: '', isCorrect: true },
      { text: '', isCorrect: false },
      { text: '', isCorrect: false },
      { text: '', isCorrect: false },
    ],
  };
}

/**
 * Quiz builder.
 *
 * Validated with the very same Zod schema the API enforces, so the form can
 * never accept something the server will reject.
 */
export default function BuilderPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const router = useRouter();
  const isNew = quizId === 'new';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<DraftQuestion[]>([blankQuestion()]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [restored, setRestored] = useState(false);

  /*
   * Restore a draft that survived a sign-in round trip. Runs before the fetch
   * below so a recovered draft is never overwritten by the saved version.
   */
  useEffect(() => {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;

    sessionStorage.removeItem(DRAFT_KEY);
    try {
      const draft = JSON.parse(raw) as {
        quizId: string;
        title: string;
        description: string;
        questions: DraftQuestion[];
      };
      // Only restore into the quiz it came from.
      if (draft.quizId !== quizId) return;

      setTitle(draft.title);
      setDescription(draft.description);
      setQuestions(draft.questions);
      setRestored(true);
      setLoading(false);
    } catch {
      // A corrupt draft is not worth surfacing; it has already been cleared.
    }
  }, [quizId]);

  useEffect(() => {
    if (isNew || restored) return;

    apiFetch<{
      title: string;
      description: string;
      questions: {
        type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
        text: string;
        timeLimit: number;
        points: number;
        choices: { text: string; isCorrect: boolean }[];
      }[];
    }>(`/api/quizzes/${quizId}`)
      .then((quiz) => {
        setTitle(quiz.title);
        setDescription(quiz.description);
        setQuestions(
          quiz.questions.length > 0
            ? quiz.questions.map((q) => ({
                type: q.type,
                text: q.text,
                timeLimit: q.timeLimit,
                points: toPoints(q.points),
                choices: q.choices.map((c) => ({ text: c.text, isCorrect: c.isCorrect })),
              }))
            : [blankQuestion()],
        );
      })
      // A 401 has already navigated to /login, so only real failures show here.
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) return;
        setError(err instanceof Error ? err.message : 'Could not load that quiz');
      })
      .finally(() => setLoading(false));
  }, [isNew, quizId, restored]);

  function patchQuestion(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function patchChoice(qIndex: number, cIndex: number, patch: Partial<DraftChoice>) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qIndex
          ? { ...q, choices: q.choices.map((c, j) => (j === cIndex ? { ...c, ...patch } : c)) }
          : q,
      ),
    );
  }

  /** Exactly one correct answer, so marking one clears the rest. */
  function markCorrect(qIndex: number, cIndex: number) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qIndex
          ? { ...q, choices: q.choices.map((c, j) => ({ ...c, isCorrect: j === cIndex })) }
          : q,
      ),
    );
  }

  function setType(qIndex: number, type: DraftQuestion['type']) {
    setQuestions((qs) =>
      qs.map((q, i) => {
        if (i !== qIndex) return q;
        if (type === 'TRUE_FALSE') {
          return {
            ...q,
            type,
            choices: [
              { text: 'True', isCorrect: q.choices[0]?.isCorrect ?? true },
              { text: 'False', isCorrect: !(q.choices[0]?.isCorrect ?? true) },
            ],
          };
        }
        return { ...q, type, choices: blankQuestion().choices };
      }),
    );
  }

  async function save() {
    setError(null);

    const payload: QuizInput = {
      title,
      description,
      visibility: 'PRIVATE',
      // Empty options are dropped rather than rejected — a 3-answer question is
      // perfectly valid, and making people delete blank boxes is busywork.
      questions: questions.map((q) => ({
        ...q,
        choices: q.choices.filter((c) => c.text.trim().length > 0),
      })),
    };

    const parsed = quizInputSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(`${issue?.path.join(' → ') ?? 'Quiz'}: ${issue?.message ?? 'is invalid'}`);
      return;
    }

    setSaving(true);
    try {
      await apiFetch(isNew ? '/api/quizzes' : `/api/quizzes/${quizId}`, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify(parsed.data),
        // Handled below: bouncing straight to the login page would throw away
        // everything they just typed.
        redirectOnAuthFailure: false,
      });
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        /*
         * The silent refresh in apiFetch has already been tried and failed, so
         * the session is genuinely over. Stash the draft before sending them to
         * sign in — losing a quiz someone spent ten minutes writing because a
         * token lapsed is the worst possible moment to be strict.
         */
        sessionStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ quizId, title, description, questions }),
        );
        setError(null);
        redirectToLogin('expired');
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  /** Reorder by one slot, keeping the moved question selected. */
  function moveQuestion(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;

    setQuestions((qs) => {
      const next = [...qs];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
    setActive(target);
  }

  function duplicateQuestion(index: number) {
    setQuestions((qs) => {
      const next = [...qs];
      // Deep-copy the choices, or both copies would share one array.
      next.splice(index + 1, 0, {
        ...qs[index]!,
        choices: qs[index]!.choices.map((c) => ({ ...c })),
      });
      return next;
    });
    setActive(index + 1);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl animate-pulse px-4 py-8" aria-busy="true">
          <span className="sr-only">Loading your quiz…</span>
          <div className="mb-6 h-14 rounded-chunk bg-slate-200" />
          <div className="grid gap-6 md:grid-cols-[220px_1fr]">
            <div className="h-96 rounded-chunk bg-slate-200" />
            <div className="h-96 rounded-chunk bg-slate-200" />
          </div>
        </div>
      </div>
    );
  }

  const question = questions[active] ?? questions[0]!;
  const incomplete = questions.filter(
    (q) => !q.text.trim() || q.choices.filter((c) => c.text.trim()).length < 2,
  ).length;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* Sticky action bar: the title and Save are needed from anywhere in a
          long quiz, so they never scroll away. */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link
            href="/dashboard"
            className="rounded-xl px-2 py-2 text-sm font-extrabold text-slate-500 transition hover:bg-slate-100"
          >
            ← Back
          </Link>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled quiz"
            aria-label="Quiz title"
            className="min-w-0 flex-1 rounded-xl border-4 border-transparent bg-slate-100 px-3 py-2 font-display text-xl font-extrabold outline-none transition focus:border-feyi-purple focus:bg-white"
          />

          <Button onClick={save} disabled={saving} size="md">
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add a short description (optional)"
          aria-label="Quiz description"
          className="mb-4 w-full rounded-xl border-4 border-transparent bg-white px-4 py-2.5 font-semibold shadow-sm outline-none transition focus:border-feyi-purple"
        />

        {restored && (
          <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 font-bold text-emerald-800">
            We kept your work while you signed back in. Hit Save when you&apos;re ready.
          </p>
        )}

        {error && (
          <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 font-bold text-feyi-red">
            {error}
          </p>
        )}

        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          {/* Question rail */}
          <nav className="space-y-2" aria-label="Questions">
            {questions.map((q, i) => (
              <button
                key={i}
                onClick={() => setActive(i)}
                aria-current={i === active ? 'true' : undefined}
                className={cn(
                  'w-full rounded-2xl border-4 bg-white p-3 text-left transition',
                  i === active
                    ? 'border-feyi-purple shadow-chunk'
                    : 'border-transparent shadow-sm hover:border-slate-200',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-extrabold text-slate-400">
                    {i + 1}
                  </span>
                  {/* Flags an unfinished question before Save has to reject it. */}
                  {(!q.text.trim() || q.choices.filter((c) => c.text.trim()).length < 2) && (
                    <span title="Not finished" className="text-xs text-amber-500">
                      ●
                    </span>
                  )}
                </div>

                <p className="mt-1 line-clamp-2 text-sm font-bold text-slate-700">
                  {q.text.trim() || 'Untitled question'}
                </p>

                {/* Miniature of the answer tiles, so the rail is scannable. */}
                <div className="mt-2 flex gap-1">
                  {q.choices.map((c, j) => (
                    <span
                      key={j}
                      className={cn(
                        'h-1.5 flex-1 rounded-full',
                        SLOT_BG[j] ?? 'bg-slate-300',
                        !c.text.trim() && 'opacity-25',
                      )}
                    />
                  ))}
                </div>
              </button>
            ))}

            <button
              onClick={() => {
                setQuestions((qs) => [...qs, blankQuestion()]);
                setActive(questions.length);
              }}
              className="w-full rounded-2xl border-4 border-dashed border-slate-300 px-3 py-3 text-sm font-extrabold text-slate-500 transition hover:border-feyi-purple hover:text-feyi-purple"
            >
              + Add question
            </button>
          </nav>

          {/* Editor */}
          <section className="rounded-chunk bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-extrabold text-slate-900">
                Question {active + 1}
              </span>

              <div className="ml-auto flex gap-1">
                <IconButton label="Move up" disabled={active === 0} onClick={() => moveQuestion(active, -1)}>
                  ↑
                </IconButton>
                <IconButton
                  label="Move down"
                  disabled={active === questions.length - 1}
                  onClick={() => moveQuestion(active, 1)}
                >
                  ↓
                </IconButton>
                <IconButton label="Duplicate question" onClick={() => duplicateQuestion(active)}>
                  ⧉
                </IconButton>
                <IconButton
                  label="Delete question"
                  disabled={questions.length === 1}
                  className="text-feyi-red"
                  onClick={() => {
                    setQuestions((qs) => qs.filter((_, i) => i !== active));
                    setActive((a) => Math.max(0, a - 1));
                  }}
                >
                  ✕
                </IconButton>
              </div>
            </div>

            <textarea
              value={question.text}
              onChange={(e) => patchQuestion(active, { text: e.target.value })}
              placeholder="Type your question"
              aria-label="Question text"
              rows={2}
              className="w-full resize-none rounded-2xl border-4 border-slate-200 bg-slate-50 px-4 py-3 font-display text-xl font-extrabold outline-none transition focus:border-feyi-purple focus:bg-white"
            />

            <div className="mt-4 flex flex-wrap gap-2">
              <PillGroup
                label="Type"
                value={question.type}
                options={[
                  { value: 'MULTIPLE_CHOICE', label: 'Multiple choice' },
                  { value: 'TRUE_FALSE', label: 'True / false' },
                ]}
                onChange={(v) => setType(active, v as DraftQuestion['type'])}
              />

              <PillGroup
                label="Time"
                value={String(question.timeLimit)}
                options={[5, 10, 20, 30, 60, 120].map((s) => ({
                  value: String(s),
                  label: `${s}s`,
                }))}
                onChange={(v) => patchQuestion(active, { timeLimit: Number(v) })}
              />

              <PillGroup
                label="Points"
                value={String(question.points)}
                options={POINTS_OPTIONS.map((p) => ({
                  value: String(p),
                  label: p === 0 ? 'None' : `${p / 1000}×`,
                }))}
                onChange={(v) => patchQuestion(active, { points: toPoints(Number(v)) })}
              />
            </div>

            <p className="mb-2 mt-6 text-sm font-bold text-slate-500">
              Tap the circle to mark the correct answer
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {question.choices.slice(0, MAX_CHOICES).map((choice, cIndex) => (
                <div
                  key={cIndex}
                  className={cn(
                    'flex items-center gap-3 rounded-2xl p-3 text-white shadow-chunk transition',
                    SLOT_BG[cIndex] ?? 'bg-slate-500',
                    // Fade options that are still blank; they're dropped on save.
                    !choice.text.trim() && 'opacity-60',
                  )}
                >
                  <span className="h-6 w-6 shrink-0 drop-shadow">
                    <AnswerShape index={cIndex} />
                  </span>

                  <input
                    value={choice.text}
                    onChange={(e) => patchChoice(active, cIndex, { text: e.target.value })}
                    placeholder={`Answer ${cIndex + 1}`}
                    aria-label={`Answer option ${cIndex + 1}`}
                    readOnly={question.type === 'TRUE_FALSE'}
                    className="min-w-0 flex-1 rounded-xl bg-white/95 px-3 py-2 font-bold text-slate-900 outline-none focus:ring-4 focus:ring-white/60"
                  />

                  <button
                    onClick={() => markCorrect(active, cIndex)}
                    aria-label={`Mark answer ${cIndex + 1} correct`}
                    aria-pressed={choice.isCorrect}
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-4 border-white transition',
                      choice.isCorrect ? 'bg-white text-feyi-green' : 'bg-transparent',
                    )}
                  >
                    {choice.isCorrect && <span className="text-lg font-black">✓</span>}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <p className="mt-6 text-center text-sm font-bold text-slate-400">
          {questions.length} question{questions.length === 1 ? '' : 's'}
          {incomplete > 0 && ` · ${incomplete} still need${incomplete === 1 ? 's' : ''} work`}
        </p>
      </main>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'h-9 w-9 rounded-xl bg-slate-100 font-extrabold text-slate-600 transition hover:bg-slate-200 disabled:opacity-30',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A labelled row of options — faster to hit than a native select, and it
 *  shows every choice at once so the trade-offs are visible. */
function PillGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-extrabold transition',
              value === option.value
                ? 'bg-white text-feyi-purple shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

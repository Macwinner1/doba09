'use client';

import { resetPasswordSchema } from '@feyi/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiFetch, clearSignedInHint } from '@/lib/api';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPassword />
    </Suspense>
  );
}

function ResetPassword() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Confirmation is checked here only — the API has no second field, since
    // a typo is a UI concern rather than a security one.
    if (password !== confirm) {
      setError('Those passwords don’t match');
      return;
    }

    const parsed = resetPasswordSchema.safeParse({ token, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your new password');
      return;
    }

    setBusy(true);
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      // Resetting revokes every session, so this browser is signed out too.
      clearSignedInHint();
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset your password');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Shell>
        <Card>
          <h1 className="mb-2 font-display text-2xl font-extrabold text-slate-900">
            That link looks incomplete
          </h1>
          <p className="mb-6 font-semibold text-slate-500">
            Reset links expire after 30 minutes and only work once. Ask for a fresh one.
          </p>
          <Link href="/forgot-password">
            <Button size="lg" className="w-full">
              Send a new link
            </Button>
          </Link>
        </Card>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <Card>
          <div className="mb-3 text-center text-5xl" aria-hidden="true">
            ✅
          </div>
          <h1 className="mb-2 text-center font-display text-2xl font-extrabold text-slate-900">
            Password updated
          </h1>
          <p className="mb-6 text-center font-semibold text-slate-500">
            You&apos;ve been signed out everywhere else. Sign in with your new password.
          </p>
          <Link href="/login">
            <Button size="lg" className="w-full">
              Sign in
            </Button>
          </Link>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={submit} className="feyi-pop w-full max-w-sm rounded-chunk bg-white p-6 shadow-lift">
        <h1 className="mb-1 font-display text-3xl font-extrabold text-feyi-purple">
          Set a new password
        </h1>
        <p className="mb-6 text-sm font-semibold text-slate-500">
          At least 8 characters, with an uppercase letter, a lowercase letter and a number.
        </p>

        <Field
          id="password"
          label="New password"
          value={password}
          onChange={(v) => {
            setPassword(v);
            setError(null);
          }}
        />
        <Field
          id="confirm"
          label="Confirm new password"
          value={confirm}
          onChange={(v) => {
            setConfirm(v);
            setError(null);
          }}
        />

        {error && (
          <p role="alert" className="mb-3 text-sm font-bold text-feyi-red">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={busy} className="w-full">
          {busy ? 'Saving…' : 'Update password'}
        </Button>
      </form>
    </Shell>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-bold text-slate-700">
        {label}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        autoComplete="new-password"
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border-4 border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold outline-none transition focus:border-feyi-purple focus:bg-white"
      />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="feyi-bg flex min-h-screen items-center justify-center px-4 py-10">
      {children}
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="feyi-pop w-full max-w-sm rounded-chunk bg-white p-6 shadow-lift">{children}</div>;
}

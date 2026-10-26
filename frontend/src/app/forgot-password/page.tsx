'use client';

import { forgotPasswordSchema } from '@feyi/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check that email address');
      return;
    }

    setBusy(true);
    try {
      await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
    } catch {
      /*
       * Swallowed on purpose. The server answers identically for a registered
       * and an unregistered address; surfacing a failure here would undo that
       * and let someone probe which emails have accounts.
       */
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <Shell>
        <div className="feyi-pop w-full max-w-sm rounded-chunk bg-white p-6 text-center shadow-lift">
          <div className="mb-3 text-5xl" aria-hidden="true">
            📬
          </div>
          <h1 className="mb-2 font-display text-2xl font-extrabold text-slate-900">
            Check your inbox
          </h1>
          {/* Careful wording: never confirms whether an account exists. */}
          <p className="mb-6 font-semibold text-slate-500">
            If an account exists for <strong className="text-slate-700">{email}</strong>, a reset
            link is on its way. It expires in 30 minutes.
          </p>
          <Link href="/login">
            <Button variant="light" size="md" className="w-full">
              Back to sign in
            </Button>
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={submit} className="feyi-pop w-full max-w-sm rounded-chunk bg-white p-6 shadow-lift">
        <h1 className="mb-1 font-display text-3xl font-extrabold text-feyi-purple">
          Forgot your password?
        </h1>
        <p className="mb-6 text-sm font-semibold text-slate-500">
          Enter your email and we&apos;ll send you a link to set a new one.
        </p>

        <label htmlFor="email" className="mb-1 block text-sm font-bold text-slate-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          autoComplete="email"
          autoFocus
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          className="w-full rounded-xl border-4 border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold outline-none transition focus:border-feyi-purple focus:bg-white"
        />

        {error && (
          <p role="alert" className="mt-3 text-sm font-bold text-feyi-red">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={busy} className="mt-4 w-full">
          {busy ? 'Sending…' : 'Send reset link'}
        </Button>

        <Link
          href="/login"
          className="mt-4 block text-center text-sm font-bold text-slate-500 underline underline-offset-4"
        >
          Back to sign in
        </Link>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="feyi-bg flex min-h-screen items-center justify-center px-4 py-10">
      {children}
    </main>
  );
}

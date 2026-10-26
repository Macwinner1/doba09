'use client';

import { loginSchema, registerSchema } from '@feyi/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiFetch, markSignedIn } from '@/lib/api';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', name: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Set by redirectToLogin when a session runs out mid-task. Landing on a bare
  // sign-in form with no explanation is what made this feel like a bug.
  const expired = params.get('reason') === 'expired';

  /*
   * Where to go after signing in. Only same-origin paths are honoured — taking
   * an arbitrary URL from the query string would turn this into an open
   * redirect, and a link that lands on a real login form then bounces to an
   * attacker's page is a credible phishing route.
   */
  const nextParam = params.get('next');
  const next = nextParam && /^\/(?!\/)/.test(nextParam) ? nextParam : '/dashboard';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const schema = mode === 'login' ? loginSchema : registerSchema;
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your details');
      return;
    }

    setBusy(true);
    try {
      await apiFetch(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      markSignedIn();
      // Full navigation so the new session cookie is in play everywhere.
      window.location.href = next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="feyi-bg flex min-h-screen items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm rounded-chunk bg-white p-6 shadow-lift">
        <h1 className="mb-1 font-display text-4xl font-extrabold text-feyi-purple">Feyi</h1>

        {expired && (
          <p
            role="status"
            className="mb-4 mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800"
          >
            Your session timed out. Sign in and we&apos;ll take you straight back.
          </p>
        )}

        {params.get('reason') === 'required' && (
          <p
            role="status"
            className="mb-4 mt-3 rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700"
          >
            Sign in to host a game.
          </p>
        )}

        <p className="mb-6 text-sm font-semibold text-slate-500">
          {mode === 'login' ? 'Sign in to host a game' : 'Create a host account'}
        </p>

        {mode === 'register' && (
          <Field
            label="Name"
            value={form.name}
            onChange={(name) => setForm({ ...form, name })}
            autoComplete="name"
          />
        )}

        <Field
          label="Email"
          type="email"
          value={form.email}
          onChange={(email) => setForm({ ...form, email })}
          autoComplete="email"
        />

        <Field
          label="Password"
          type="password"
          value={form.password}
          onChange={(password) => setForm({ ...form, password })}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />

        {mode === 'register' && (
          <p className="-mt-2 mb-3 text-xs text-slate-500">
            At least 8 characters, with an uppercase letter, a lowercase letter and a number.
          </p>
        )}

        {error && (
          <p role="alert" className="mb-3 text-sm font-semibold text-feyi-red">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={busy} className="w-full">
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </Button>

        {mode === 'login' && (
          <Link
            href="/forgot-password"
            className="mt-4 block text-center text-sm font-bold text-slate-500 underline underline-offset-4"
          >
            Forgot your password?
          </Link>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
          className="mt-4 w-full text-sm font-semibold text-slate-600 underline underline-offset-4"
        >
          {mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
        </button>
      </form>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  const id = `field-${label.toLowerCase()}`;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-bold text-slate-700">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border-4 border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold outline-none transition focus:border-feyi-purple focus:bg-white"
      />
    </div>
  );
}

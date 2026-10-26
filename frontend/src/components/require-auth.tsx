'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

const AuthContext = createContext<AuthUser | null>(null);

/** The signed-in host. Only valid inside RequireAuth, which guarantees one. */
export function useUser(): AuthUser {
  const user = useContext(AuthContext);
  if (!user) throw new Error('useUser must be used inside <RequireAuth>');
  return user;
}

/**
 * Gate for host-only pages.
 *
 * Confirms the session once on mount. apiFetch already renews a merely-stale
 * token behind the scenes and redirects to /login when the session is really
 * over, so by the time children render there is a signed-in user.
 *
 * The point of centralising this is consistency: previously each page invented
 * its own 401 handling, and the dashboard's happened to be broken.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch<{ user: AuthUser }>('/api/auth/me')
      .then(({ user: me }) => {
        if (!cancelled) setUser(me);
      })
      // No error branch: a real auth failure has already navigated away, and
      // anything else leaves the skeleton up rather than flashing a broken page.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return <AuthSkeleton />;

  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}

/** Shaped like the dashboard so the page doesn't jump when content lands. */
function AuthSkeleton() {
  return (
    <main className="mx-auto max-w-4xl animate-pulse px-4 py-10" aria-busy="true">
      <span className="sr-only">Loading your account…</span>
      <div className="mb-8 flex items-center justify-between">
        <div className="h-9 w-56 rounded-xl bg-slate-200" />
        <div className="flex gap-3">
          <div className="h-11 w-28 rounded-chunk bg-slate-200" />
          <div className="h-11 w-28 rounded-chunk bg-slate-200" />
        </div>
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-chunk bg-slate-200" />
        ))}
      </div>
    </main>
  );
}

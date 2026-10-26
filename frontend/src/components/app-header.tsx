'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { apiFetch, clearSignedInHint } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Shared chrome for the creator side.
 *
 * Hosts move between their library, their reports and the builder constantly;
 * before this each page had its own ad-hoc header and there was no way to reach
 * reports at all.
 */
export function AppHeader({ userName }: { userName?: string }) {
  const pathname = usePathname();

  async function signOut() {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    clearSignedInHint();
    window.location.href = '/login';
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
        <Link href="/dashboard" className="font-display text-2xl font-extrabold text-feyi-purple">
          Feyi
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink href="/dashboard" active={pathname === '/dashboard'}>
            Quizzes
          </NavLink>
          <NavLink href="/reports" active={pathname.startsWith('/reports')}>
            Reports
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {userName && (
            <span className="hidden text-sm font-bold text-slate-500 sm:inline">{userName}</span>
          )}
          <button
            onClick={signOut}
            className="rounded-xl px-3 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-xl px-3 py-2 text-sm font-extrabold transition',
        active ? 'bg-purple-100 text-feyi-purple' : 'text-slate-600 hover:bg-slate-100',
      )}
    >
      {children}
    </Link>
  );
}

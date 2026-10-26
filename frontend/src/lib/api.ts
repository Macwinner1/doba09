'use client';

/**
 * The single door to the API.
 *
 * Two jobs beyond fetching: it carries the HTTP status on the error it throws,
 * and it keeps a signed-in host signed in.
 *
 * Access tokens last 15 minutes, refresh tokens 30 days. Without the silent
 * refresh below, every host was thrown out a quarter of an hour into a session
 * that had 30 days left on it.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Auth endpoints must never trigger a refresh — see refreshSession. */
const AUTH_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/logout',
];

/**
 * One refresh at a time, shared by every caller.
 *
 * This is not an optimisation, it is a correctness requirement. Refresh tokens
 * rotate — redeeming one revokes it. If the dashboard fires three requests that
 * all 401 together and each kicked off its own refresh, the first would succeed
 * and the other two would present a token that had just been revoked, which
 * reads as token reuse and logs the user out for real.
 */
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        // Callers already awaiting this promise still get its result; clearing
        // the slot only means the *next* 401 starts a fresh attempt.
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/*
 * A hint about whether this browser ever had a session.
 *
 * The auth cookies are httpOnly, so scripts cannot see them — and without this
 * we could not tell "your session ran out" from "you were never signed in", and
 * would greet a first-time visitor with a timeout notice about a session they
 * never had. Purely a UI hint; it grants no access on its own.
 */
const SIGNED_IN_HINT = 'feyi:was-signed-in';

export function markSignedIn(): void {
  try {
    window.localStorage.setItem(SIGNED_IN_HINT, '1');
  } catch {
    // Private mode can refuse storage; the hint is optional.
  }
}

export function clearSignedInHint(): void {
  try {
    window.localStorage.removeItem(SIGNED_IN_HINT);
  } catch {
    /* ignore */
  }
}

function wasEverSignedIn(): boolean {
  try {
    return window.localStorage.getItem(SIGNED_IN_HINT) === '1';
  } catch {
    return false;
  }
}

/**
 * Send the user to sign in, remembering why and where they were.
 *
 * A hard navigation rather than a router push: the session is gone, and
 * throwing away all in-memory state is exactly what we want.
 */
export function redirectToLogin(reason?: 'expired' | 'required'): void {
  if (typeof window === 'undefined') return;

  reason ??= wasEverSignedIn() ? 'expired' : 'required';
  if (reason === 'expired') clearSignedInHint();

  const here = window.location.pathname + window.location.search;
  if (window.location.pathname.startsWith('/login')) return;

  const params = new URLSearchParams({ reason });
  // Only worth returning to a real destination, not back to the login page.
  if (here && here !== '/') params.set('next', here);

  window.location.href = `/login?${params.toString()}`;
}

interface ApiFetchOptions extends RequestInit {
  /** Internal: false on the retry so one refresh can't loop. */
  allowRefresh?: boolean;
  /** Set false to handle a 401 yourself instead of bouncing to login. */
  redirectOnAuthFailure?: boolean;
}

export async function apiFetch<T>(path: string, init: ApiFetchOptions = {}): Promise<T> {
  const { allowRefresh = true, redirectOnAuthFailure = true, ...requestInit } = init;

  const res = await fetch(path, {
    ...requestInit,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(requestInit.headers ?? {}) },
  });

  if (res.status === 401 && allowRefresh && !AUTH_PATHS.includes(path)) {
    // Try to renew silently and replay the original request. The user should
    // never learn that their access token had a 15-minute life.
    if (await refreshSession()) {
      return apiFetch<T>(path, { ...init, allowRefresh: false });
    }

    if (redirectOnAuthFailure) redirectToLogin();
    throw new ApiError('Your session has expired. Please sign in again.', 401);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string | string[];
      errors?: unknown;
    };

    // Nest returns `message` as an array for some validation failures.
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : body.message;

    throw new ApiError(message || `Request failed (${res.status})`, res.status, body.errors);
  }

  return res.status === 204 ? (null as T) : ((await res.json()) as T);
}

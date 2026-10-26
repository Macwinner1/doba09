'use client';

import type { ClientToServerEvents, ServerToClientEvents } from '@feyi/shared';
import { io, type Socket } from 'socket.io-client';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i;

/**
 * Where the socket server lives, from this device's point of view.
 *
 * The subtlety is scan-to-join. A player opens the lobby QR on their phone and
 * lands on `http://192.168.1.5:3000`; if we then dialled the configured
 * `http://localhost:4000`, the phone would be calling its *own* loopback and
 * the socket would never connect. So whenever the configured value is a
 * loopback address, we follow the hostname the page was actually served from
 * and keep only the API's port.
 *
 * A real deployment configures a proper host (api.example.com), which is not a
 * loopback and is therefore used verbatim.
 */
function resolveApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

  if (typeof window === 'undefined') return configured;

  try {
    const url = new URL(configured);
    if (!LOOPBACK.test(url.hostname)) return configured;

    url.protocol = window.location.protocol;
    url.hostname = window.location.hostname;
    return url.origin;
  } catch {
    return configured;
  }
}

/**
 * One socket per tab, created lazily.
 *
 * Reconnection settings are deliberately patient: a player on mobile data will
 * drop out repeatedly, and the server holds their seat and score, so the right
 * behaviour is to keep trying rather than surface an error.
 */
let socket: GameSocket | null = null;

export function getSocket(auth?: Record<string, unknown>): GameSocket {
  if (!socket) {
    socket = io(`${resolveApiUrl()}/game`, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
      auth,
    });
  } else if (auth) {
    socket.auth = auth;
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** Promise wrapper over Socket.IO's ack callback, matching the server's envelope. */
export function emitWithAck<T>(
  sock: GameSocket,
  event: string,
  payload?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The server did not respond')), 10_000);

    const handler = (ack: { ok: boolean; data?: T; error?: string }) => {
      clearTimeout(timer);
      if (ack?.ok) resolve(ack.data as T);
      else reject(new Error(ack?.error ?? 'Something went wrong'));
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emitter = sock as any;
    payload === undefined ? emitter.emit(event, handler) : emitter.emit(event, payload, handler);
  });
}

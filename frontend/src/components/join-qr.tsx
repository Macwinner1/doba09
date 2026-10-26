'use client';

import { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';

/**
 * Scan-to-join code for the lobby screen.
 *
 * It encodes the full join URL including the PIN, so scanning lands the player
 * straight on the nickname screen — they never type six digits. The PIN stays
 * on screen beside it, because not every phone camera scans reliably and
 * someone always arrives late.
 */
export function JoinQr({ pin }: { pin: string }) {
  // Resolved after mount: `window` doesn't exist during SSR, and rendering a
  // guessed origin first would cause a hydration mismatch.
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(process.env.NEXT_PUBLIC_APP_URL || window.location.origin);
  }, []);

  if (!origin) {
    return <div className="h-[188px] w-[188px] animate-pulse rounded-xl bg-white/20" />;
  }

  const joinUrl = `${origin}/play/${pin}`;

  /*
   * A host presenting from localhost would otherwise put up a QR that every
   * phone in the room fails to open, with nothing on screen explaining why.
   * Worth saying out loud rather than letting them find out mid-lesson.
   */
  const unreachableFromPhones = /^https?:\/\/(localhost|127\.0\.0\.1|\[?::1\]?)/i.test(origin);

  return (
    <div className="flex flex-col items-center">
      {/* White card gives the code its quiet zone — scanners need the light
          border, and it must not sit directly on the purple. */}
      <div className="rounded-xl bg-white p-3 shadow-xl">
        <QRCode
          value={joinUrl}
          size={160}
          // Medium recovery tolerates a camera at the back of a room and the
          // odd head in the way, without making the modules too dense to read.
          level="M"
          bgColor="#ffffff"
          fgColor="#1e1b2e"
          aria-label={`Scan to join game ${pin}`}
        />
      </div>

      <p className="mt-2 text-sm font-bold text-white/80">Scan to join</p>

      <p className="mt-1 max-w-[220px] break-all text-center text-xs text-white/60">
        {joinUrl.replace(/^https?:\/\//, '')}
      </p>

      {unreachableFromPhones && (
        <p className="mt-2 max-w-[240px] rounded-lg bg-feyi-yellow/95 px-3 py-2 text-center text-xs font-bold text-black">
          Phones can&apos;t reach “localhost”. Open this page at your
          machine&apos;s network address instead — or set NEXT_PUBLIC_APP_URL.
        </p>
      )}
    </div>
  );
}

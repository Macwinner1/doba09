'use client';

import { useEffect, useState } from 'react';
import { isSoundEnabled, playSound, setSoundEnabled } from '@/lib/sound';
import { cn } from '@/lib/utils';

/**
 * Sound on/off.
 *
 * Reads its initial value after mount rather than during render: the setting
 * lives in localStorage, and reading it on the server would produce markup
 * that disagrees with the client.
 */
export function SoundToggle({ className }: { className?: string }) {
  const [on, setOn] = useState(false);

  useEffect(() => setOn(isSoundEnabled()), []);

  return (
    <button
      type="button"
      onClick={() => {
        const next = !on;
        setOn(next);
        setSoundEnabled(next);
        // The click doubles as the gesture that unlocks the AudioContext, so
        // this confirmation tone is also the proof it worked.
        if (next) playSound('join');
      }}
      aria-pressed={on}
      aria-label={on ? 'Turn sound off' : 'Turn sound on'}
      title={on ? 'Sound on' : 'Sound off'}
      className={cn(
        'rounded-full bg-white/15 p-2.5 text-white backdrop-blur transition hover:bg-white/25',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50',
        className,
      )}
    >
      {on ? <SpeakerOn /> : <SpeakerOff />}
    </button>
  );
}

function SpeakerOn() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" strokeLinecap="round" />
    </svg>
  );
}

function SpeakerOff() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
      <path d="m16 9 5 6M21 9l-5 6" strokeLinecap="round" />
    </svg>
  );
}

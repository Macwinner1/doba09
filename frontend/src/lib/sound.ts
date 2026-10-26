'use client';

/**
 * Game audio, synthesised in the browser.
 *
 * Everything here is generated with oscillators rather than loaded from files.
 * That keeps the app asset-free — nothing to download on a phone tethered to
 * mobile data mid-lesson, and no third-party request.
 *
 * Two rules the browser imposes and one we impose:
 *  - An AudioContext cannot start without a user gesture, so it is created
 *    lazily on the first interaction.
 *  - Sound is OFF by default. A teacher's laptop suddenly playing music to a
 *    silent room is a genuine failure, not a delight.
 */

export type SoundName =
  | 'tap'
  | 'join'
  | 'lock'
  | 'tick'
  | 'tickUrgent'
  | 'correct'
  | 'wrong'
  | 'whoosh'
  | 'fanfare';

const STORAGE_KEY = 'feyi:sound-enabled';

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let enabled = false;
let initialised = false;

/** Read the saved preference. Defaults to off. */
export function isSoundEnabled(): boolean {
  if (!initialised && typeof window !== 'undefined') {
    enabled = window.localStorage.getItem(STORAGE_KEY) === 'true';
    initialised = true;
  }
  return enabled;
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  initialised = true;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  }
  if (next) void ensureContext();
}

async function ensureContext(): Promise<AudioContext | null> {
  if (typeof window === 'undefined') return null;

  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.25;
    masterGain.connect(ctx.destination);
  }

  // Browsers suspend contexts created outside a gesture; resume on first use.
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);

  return ctx;
}

interface ToneSpec {
  freq: number;
  /** Seconds from now that this tone starts. */
  at?: number;
  duration?: number;
  type?: OscillatorType;
  gain?: number;
  /** Slide to this frequency across the tone — used for whooshes and stings. */
  slideTo?: number;
}

function tone(audio: AudioContext, out: GainNode, spec: ToneSpec): void {
  const {
    freq,
    at = 0,
    duration = 0.12,
    type = 'sine',
    gain = 0.6,
    slideTo,
  } = spec;

  const start = audio.currentTime + at;
  const osc = audio.createOscillator();
  const env = audio.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), start + duration);
  }

  // A short attack and exponential decay: without the ramps every note ends in
  // an audible click.
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(env);
  env.connect(out);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

const RECIPES: Record<SoundName, (audio: AudioContext, out: GainNode) => void> = {
  tap: (a, g) => tone(a, g, { freq: 420, duration: 0.06, type: 'triangle', gain: 0.3 }),

  join: (a, g) => {
    tone(a, g, { freq: 523, duration: 0.1, type: 'triangle' });
    tone(a, g, { freq: 784, at: 0.08, duration: 0.12, type: 'triangle' });
  },

  lock: (a, g) =>
    tone(a, g, { freq: 300, slideTo: 140, duration: 0.16, type: 'square', gain: 0.35 }),

  tick: (a, g) => tone(a, g, { freq: 900, duration: 0.04, type: 'sine', gain: 0.22 }),

  // Higher and harder as the clock runs down — the pressure cue.
  tickUrgent: (a, g) => tone(a, g, { freq: 1250, duration: 0.05, type: 'square', gain: 0.3 }),

  correct: (a, g) => {
    // Major arpeggio: unmistakably "yes" without needing a voice-over.
    tone(a, g, { freq: 523, duration: 0.1, type: 'triangle' });
    tone(a, g, { freq: 659, at: 0.08, duration: 0.1, type: 'triangle' });
    tone(a, g, { freq: 1046, at: 0.16, duration: 0.22, type: 'triangle' });
  },

  wrong: (a, g) => {
    tone(a, g, { freq: 200, duration: 0.18, type: 'sawtooth', gain: 0.32 });
    tone(a, g, { freq: 150, at: 0.12, duration: 0.26, type: 'sawtooth', gain: 0.3 });
  },

  whoosh: (a, g) =>
    tone(a, g, { freq: 220, slideTo: 900, duration: 0.35, type: 'sine', gain: 0.25 }),

  fanfare: (a, g) => {
    [523, 659, 784, 1046].forEach((freq, i) =>
      tone(a, g, { freq, at: i * 0.11, duration: 0.3, type: 'triangle', gain: 0.5 }),
    );
    tone(a, g, { freq: 1568, at: 0.46, duration: 0.6, type: 'triangle', gain: 0.45 });
  },
};

/** Fire and forget. Silent when disabled, and never throws into the UI. */
export function playSound(name: SoundName): void {
  if (!isSoundEnabled()) return;

  void ensureContext()
    .then((audio) => {
      if (audio && masterGain) RECIPES[name](audio, masterGain);
    })
    .catch(() => undefined);
}

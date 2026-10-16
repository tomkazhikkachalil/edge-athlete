'use client';

// ── The round timer's bell (Oct 16 2026) ────────────────────────────────────
// A short synthesized tone — no audio file to fetch — and a vibration where
// the phone has one (Android; iOS Safari has no vibrate, so sound only).
// Browsers allow sound only after a user gesture, so arm() runs inside the
// timer's Start tap and keeps ONE AudioContext for the session. A locked
// screen suspends it on iOS; the recorder keeps the screen awake while
// recording, and says so when it cannot (RoundTimerPanel).

type Ctx = AudioContext;
let ctx: Ctx | null = null;

function audioContextCtor(): (new () => Ctx) | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { webkitAudioContext?: new () => Ctx };
  return (window.AudioContext as (new () => Ctx) | undefined) ?? w.webkitAudioContext ?? null;
}

/** Create (or wake) the audio context — call from a tap. */
export function armBell(): void {
  try {
    const C = audioContextCtor();
    if (!C) return;
    if (!ctx) ctx = new C();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  } catch {
    ctx = null;
  }
}

/**
 * Ring: `kind` 'work' is two high tones (go), 'rest' one lower tone, 'end'
 * three. Silent when no context could be made; never throws.
 */
export function ringBell(kind: 'work' | 'rest' | 'end'): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(kind === 'end' ? [300, 120, 300, 120, 300] : kind === 'work' ? [200, 100, 200] : [400]);
    }
  } catch {
    // vibration refused: the tone still plays
  }
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const tones = kind === 'end' ? [880, 880, 880] : kind === 'work' ? [988, 988] : [660];
    const t0 = ctx.currentTime;
    tones.forEach((hz, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      const start = t0 + i * 0.28;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.6, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + 0.26);
    });
  } catch {
    // an audio failure never breaks the timer
  }
}

// ── The pinned showcase: up to six bests at the top of Training (pure) ──────
// Training redesign PR 7 (Nov 11 2026), Tom's decision 4. None of the apps
// reviewed lets an athlete choose which bests a visitor sees first; here the
// owner pins up to six — an exercise's best of one kind, or a test's best.
// A pin holds WHAT is pinned, never a value: the value is derived on read for
// whoever is looking (a visitor's from the sessions they may open), so a pin
// can never show a stale or a private number. Zero-import.
//
// `effort` (an activity's best effort) is in the table's CHECK and not
// written yet: an all-time best effort is not stored anywhere to pin.

export const MAX_PINS = 6;

export const PIN_RECORD_KINDS = ['heaviest', 'e1rm', 'reps', 'volume', 'duration'] as const;
export type PinRecordKind = (typeof PIN_RECORD_KINDS)[number];

export type TrainingPin = { kind: 'exercise'; ref: string; recordKind: PinRecordKind } | { kind: 'test'; ref: string };

/** An identity or a metric key: letters, digits, underscores, at most 80. */
const REF = /^[\p{L}\p{N}_]{1,80}$/u;

/** One pin from untrusted JSON, or null. */
export function parsePin(raw: unknown): TrainingPin | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { kind?: unknown; ref?: unknown; recordKind?: unknown };
  if (typeof r.ref !== 'string' || !REF.test(r.ref)) return null;
  if (r.kind === 'test') return { kind: 'test', ref: r.ref };
  if (r.kind === 'exercise' && typeof r.recordKind === 'string' && (PIN_RECORD_KINDS as readonly string[]).includes(r.recordKind)) {
    return { kind: 'exercise', ref: r.ref, recordKind: r.recordKind as PinRecordKind };
  }
  return null;
}

/** What makes two pins the same thing. */
export function pinKey(p: TrainingPin): string {
  return p.kind === 'exercise' ? `exercise:${p.ref}:${p.recordKind}` : `test:${p.ref}`;
}

/**
 * A whole list from untrusted JSON: every entry must be a pin, none twice, at
 * most six — or the list is refused (null). Order is the athlete's.
 */
export function parsePins(raw: unknown): TrainingPin[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_PINS) return null;
  const out: TrainingPin[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const pin = parsePin(item);
    if (!pin || seen.has(pinKey(pin))) return null;
    seen.add(pinKey(pin));
    out.push(pin);
  }
  return out;
}

export function isPinned(pins: readonly TrainingPin[], pin: TrainingPin): boolean {
  const key = pinKey(pin);
  return pins.some(p => pinKey(p) === key);
}

/** Tap a pin control: pinned → unpinned; unpinned → added at the end, or `full` when six are pinned (nothing is dropped to make room). */
export function togglePin(pins: readonly TrainingPin[], pin: TrainingPin): { pins: TrainingPin[] } | { full: true } {
  const key = pinKey(pin);
  if (pins.some(p => pinKey(p) === key)) return { pins: pins.filter(p => pinKey(p) !== key) };
  if (pins.length >= MAX_PINS) return { full: true };
  return { pins: [...pins, pin] };
}

/** A pin with the number a viewer may see, as the route answers it. */
export interface ResolvedPin {
  pin: TrainingPin;
  /** "Bench Press", "40-Yard Dash". */
  label: string;
  /** "Heaviest", "Est. 1-rep max" — an exercise pin's kind; null for a test. */
  kindLabel: string | null;
  /** "225 lbs", "4.95 sec" — already spelled. */
  display: string;
}

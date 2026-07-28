// Recurrence core — pure, dependency-free, unit-tested. All stepping is
// done on NAIVE wall-clock representations (Date.UTC fields holding local
// wall values in the EVENT's zone), so recurring events keep their local
// time across DST: weekly 18:00 America/New_York stays 18:00 in both
// January and July. The single hard function is zonedWallClockToUtc — a
// two-pass offset solver over Intl.DateTimeFormat (no tz database needed).
//
// Pinned DST edge semantics (unit-tested):
//   • ambiguous fall-back wall times → the EARLIER instant
//   • nonexistent spring-forward wall times → the LATER candidate
//     (the event lands after the gap — Google behavior)
// Monthly recurrences on days some months lack (29/30/31) SKIP those
// months (RFC 5545 / Google); yearly Feb 29 fires on leap years only.

export const MAX_OCCURRENCES = 104;
export const NEVER_HORIZON_MS = 183 * 86_400_000; // ~6 months rolling window
export const MAX_UNTIL_MS = 2 * 365 * 86_400_000; // until ≤ 2 years out

export type SeriesFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type SeriesEnds = 'never' | 'until' | 'count';

export interface SeriesRule {
  freq: SeriesFreq;
  interval_n: number;
  byweekday: number[] | null; // 0=Sunday..6=Saturday, weekly only
  ends: SeriesEnds;
  until_at: string | null;    // EXCLUSIVE instant
  count_n: number | null;
}

export interface WallClock {
  y: number;
  m: number; // 1-12
  d: number;
  hh: number;
  mm: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** The wall clock an instant shows in a zone. */
export function wallClockInZone(ms: number, timeZone: string): WallClock {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
}

const naiveUtc = (w: WallClock) => Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm);

/**
 * UTC instant whose wall clock in `timeZone` is the given local time.
 * Two-pass offset solver; see the header for gap/ambiguity semantics.
 */
export function zonedWallClockToUtc(
  y: number, m: number, d: number, hh: number, mm: number, timeZone: string
): number {
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let ts = target;
  const candidates: number[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const rendered = naiveUtc(wallClockInZone(ts, timeZone));
    if (rendered === target) return ts;
    ts += target - rendered;
    candidates.push(ts);
  }
  const rendered = naiveUtc(wallClockInZone(ts, timeZone));
  if (rendered === target) return ts;
  // No fixed point: the wall time falls in a spring-forward gap. Take the
  // LATER candidate so the event lands after the gap.
  return Math.max(...candidates);
}

/** Step a naive wall DATE by days (exact on naive-UTC ms). */
function addWallDays(w: WallClock, days: number): WallClock {
  const ms = Date.UTC(w.y, w.m - 1, w.d + days, w.hh, w.mm);
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

/** Day-of-week (0=Sun) of a naive wall date. */
function wallDow(w: WallClock): number {
  return new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
}

/** Days in a month (m 1-12). */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface OccurrenceTemplate {
  startWall: WallClock;  // first occurrence's start, wall parts in the event zone
  durationMin: number;   // WALL-CLOCK minutes from start to end (naive diff)
  timeZone: string;
}

export interface GeneratedOccurrence {
  starts_at: string;
  ends_at: string;
}

/**
 * Materialize occurrences for a rule. Always anchored to the FIRST
 * occurrence (template) — pass afterInstant to resume (cron): only starts
 * strictly after it are emitted, but stepping still walks from the anchor
 * so every-other-week parity is preserved.
 */
export function generateOccurrences(
  rule: SeriesRule,
  template: OccurrenceTemplate,
  opts: { afterInstant?: number; horizonInstant?: number; maxTotal?: number } = {}
): GeneratedOccurrence[] {
  const maxTotal = Math.min(opts.maxTotal ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
  const untilMs = rule.ends === 'until' && rule.until_at ? Date.parse(rule.until_at) : null;
  const countCap = rule.ends === 'count' && rule.count_n ? rule.count_n : null;
  const out: GeneratedOccurrence[] = [];
  let emittedTotal = 0; // occurrences counted from the anchor (incl. skipped-by-afterInstant)

  const emit = (startWall: WallClock): 'stop' | 'continue' => {
    if (countCap !== null && emittedTotal >= countCap) return 'stop';
    if (emittedTotal >= maxTotal) return 'stop';
    const startMs = zonedWallClockToUtc(
      startWall.y, startWall.m, startWall.d, startWall.hh, startWall.mm, template.timeZone
    );
    if (untilMs !== null && startMs >= untilMs) return 'stop';
    if (opts.horizonInstant !== undefined && startMs >= opts.horizonInstant) return 'stop';
    emittedTotal++;
    if (opts.afterInstant !== undefined && startMs <= opts.afterInstant) return 'continue';
    const endWall = addWallMinutes(startWall, template.durationMin);
    const endMs = zonedWallClockToUtc(
      endWall.y, endWall.m, endWall.d, endWall.hh, endWall.mm, template.timeZone
    );
    out.push({
      starts_at: new Date(startMs).toISOString(),
      ends_at: new Date(endMs).toISOString(),
    });
    return 'continue';
  };

  const start = template.startWall;

  if (rule.freq === 'daily') {
    for (let i = 0; ; i++) {
      if (emit(addWallDays(start, i * rule.interval_n)) === 'stop') break;
      if (i > MAX_OCCURRENCES * 2) break; // safety backstop
    }
  } else if (rule.freq === 'weekly') {
    const days = [...(rule.byweekday ?? [wallDow(start)])].sort((a, b) => a - b);
    // Anchor week = the Sunday-start week containing the first occurrence.
    const anchorWeekStart = addWallDays(start, -wallDow(start));
    outer: for (let week = 0; ; week += rule.interval_n) {
      const weekStart = addWallDays(anchorWeekStart, week * 7);
      for (const dow of days) {
        const candidate = addWallDays(weekStart, dow);
        // Skip candidates before the series' first occurrence.
        if (naiveUtc(candidate) < naiveUtc(start)) continue;
        if (emit(candidate) === 'stop') break outer;
      }
      if (week > MAX_OCCURRENCES * 14) break; // safety backstop
    }
  } else if (rule.freq === 'monthly') {
    for (let i = 0; ; i++) {
      const monthIndex = (start.m - 1) + i * rule.interval_n;
      const y = start.y + Math.floor(monthIndex / 12);
      const m = (monthIndex % 12) + 1;
      // Months lacking the day are SKIPPED (RFC 5545 / Google).
      if (start.d > daysInMonth(y, m)) {
        if (i > MAX_OCCURRENCES * 4) break;
        continue;
      }
      if (emit({ ...start, y, m }) === 'stop') break;
      if (i > MAX_OCCURRENCES * 4) break; // safety backstop
    }
  } else {
    for (let i = 0; ; i++) {
      const y = start.y + i * rule.interval_n;
      // Feb 29 fires on leap years only (skip rule).
      if (start.d > daysInMonth(y, start.m)) {
        if (i > MAX_OCCURRENCES * 4) break;
        continue;
      }
      if (emit({ ...start, y }) === 'stop') break;
      if (i > MAX_OCCURRENCES * 4) break; // safety backstop
    }
  }

  return out;
}

/** Step a wall clock by minutes (naive). */
function addWallMinutes(w: WallClock, minutes: number): WallClock {
  const ms = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm + minutes);
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

/** Wall-clock minutes between two instants as seen in a zone (naive diff). */
export function wallDurationMinutes(startsAtIso: string, endsAtIso: string, timeZone: string): number {
  const s = wallClockInZone(Date.parse(startsAtIso), timeZone);
  const e = wallClockInZone(Date.parse(endsAtIso), timeZone);
  return Math.round((naiveUtc(e) - naiveUtc(s)) / 60_000);
}

/**
 * Scoped time edits: keep an occurrence's own wall DATE (in newTimeZone),
 * apply a new time-of-day + wall duration.
 */
export function applyWallTime(
  occStartsAtIso: string,
  newTimeZone: string,
  newHH: number,
  newMM: number,
  durationMin: number,
  allDay: boolean
): GeneratedOccurrence {
  const wall = wallClockInZone(Date.parse(occStartsAtIso), newTimeZone);
  const startWall: WallClock = allDay
    ? { ...wall, hh: 0, mm: 0 }
    : { ...wall, hh: newHH, mm: newMM };
  const startMs = zonedWallClockToUtc(startWall.y, startWall.m, startWall.d, startWall.hh, startWall.mm, newTimeZone);
  const endWall = addWallMinutes(startWall, durationMin);
  const endMs = zonedWallClockToUtc(endWall.y, endWall.m, endWall.d, endWall.hh, endWall.mm, newTimeZone);
  return { starts_at: new Date(startMs).toISOString(), ends_at: new Date(endMs).toISOString() };
}

// ── Validation ───────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateRecurrenceInput(
  raw: unknown,
  firstStartsAtIso: string,
  firstEndsAtIso: string,
  timeZone: string
): { ok: true; rule: SeriesRule; occurrences: GeneratedOccurrence[] } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'Invalid repeat settings.' };
  }
  const body = raw as Record<string, unknown>;
  const freq = body.freq;
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly' && freq !== 'yearly') {
    return { ok: false, error: 'Unknown repeat frequency.' };
  }
  const interval = body.interval === undefined ? 1 : Number(body.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 12) {
    return { ok: false, error: 'Repeat interval must be between 1 and 12.' };
  }

  const startMs = Date.parse(firstStartsAtIso);
  const startWall = wallClockInZone(startMs, timeZone);
  const startDow = wallDow(startWall);

  let byweekday: number[] | null = null;
  if (freq === 'weekly') {
    const rawDays = Array.isArray(body.byweekday) ? body.byweekday : [startDow];
    const days = [...new Set(rawDays.map(Number))].sort((a, b) => a - b);
    if (days.length === 0 || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
      return { ok: false, error: 'Invalid repeat days.' };
    }
    if (!days.includes(startDow)) {
      return { ok: false, error: "Repeat days must include the event's start day." };
    }
    byweekday = days;
  } else if (body.byweekday !== undefined && body.byweekday !== null) {
    return { ok: false, error: 'Repeat days only apply to weekly events.' };
  }

  const endsRaw = (typeof body.ends === 'object' && body.ends !== null ? body.ends : {}) as Record<string, unknown>;
  const kind = endsRaw.kind ?? 'never';
  let until_at: string | null = null;
  let count_n: number | null = null;
  if (kind === 'until') {
    const until = typeof endsRaw.until === 'string' ? endsRaw.until : '';
    if (!DATE_RE.test(until)) {
      return { ok: false, error: 'Please choose a valid end date for the repeat.' };
    }
    const [y, m, d] = until.split('-').map(Number);
    // Exclusive bound: the midnight AFTER the chosen date, in the event zone.
    const untilMs = zonedWallClockToUtc(y, m, d + 1, 0, 0, timeZone);
    if (untilMs <= startMs) {
      return { ok: false, error: 'The repeat end date must be after the first event.' };
    }
    if (untilMs - startMs > MAX_UNTIL_MS) {
      return { ok: false, error: 'Repeats can run for at most two years.' };
    }
    until_at = new Date(untilMs).toISOString();
  } else if (kind === 'count') {
    count_n = Number(endsRaw.count);
    if (!Number.isInteger(count_n) || count_n < 1 || count_n > MAX_OCCURRENCES) {
      return { ok: false, error: `Repeat count must be between 1 and ${MAX_OCCURRENCES}.` };
    }
  } else if (kind !== 'never') {
    return { ok: false, error: 'Unknown repeat end setting.' };
  }

  const rule: SeriesRule = {
    freq, interval_n: interval, byweekday,
    ends: kind as SeriesEnds, until_at, count_n,
  };
  const template: OccurrenceTemplate = {
    startWall,
    durationMin: wallDurationMinutes(firstStartsAtIso, firstEndsAtIso, timeZone),
    timeZone,
  };
  const horizonInstant = rule.ends === 'never' ? startMs + NEVER_HORIZON_MS : undefined;
  const occurrences = generateOccurrences(rule, template, { horizonInstant });

  if (occurrences.length === 0) {
    return { ok: false, error: 'That repeat produces no events.' };
  }
  if (rule.ends === 'until' && occurrences.length >= MAX_OCCURRENCES) {
    return { ok: false, error: `That repeat would create more than ${MAX_OCCURRENCES} events — choose a shorter end date.` };
  }
  return { ok: true, rule, occurrences };
}

// ── Display ──────────────────────────────────────────────────────────────────

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FREQ_UNITS: Record<SeriesFreq, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};

export function describeRecurrence(rule: SeriesRule, timeZone: string): string {
  const [unit, units] = FREQ_UNITS[rule.freq];
  let base: string;
  if (rule.interval_n === 1) {
    base = `Repeats ${rule.freq === 'daily' ? 'daily' : rule.freq}`;
  } else {
    base = `Repeats every ${rule.interval_n} ${rule.interval_n === 1 ? unit : units}`;
  }
  if (rule.freq === 'weekly' && rule.byweekday?.length) {
    base += ` on ${rule.byweekday.map(d => DOW_LABELS[d]).join(', ')}`;
  }
  if (rule.ends === 'until' && rule.until_at) {
    // Exclusive bound → the last covered day is until_at - 1ms in the zone.
    const lastDay = wallClockInZone(Date.parse(rule.until_at) - 1, timeZone);
    const monthName = new Intl.DateTimeFormat('en-US', { month: 'short' })
      .format(new Date(Date.UTC(lastDay.y, lastDay.m - 1, lastDay.d)));
    base += ` · until ${monthName} ${lastDay.d}, ${lastDay.y}`;
  } else if (rule.ends === 'count' && rule.count_n) {
    base += ` · ${rule.count_n} times`;
  }
  return base;
}

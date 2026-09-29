// ── Weekly totals for the profile's Activities tab — pure ──────────────────
// Weeks start on Monday (ISO) and are keyed by the activity's LOCAL date
// (occurred_on), so a late-evening run never lands in tomorrow's week.

export interface TotalsRow {
  occurred_on: string;
  distance_m: number | string | null;
  moving_s: number | null;
  elapsed_s: number;
  elev_gain_m: number | string | null;
}

export interface WeekTotal {
  /** The Monday, YYYY-MM-DD. */
  weekStart: string;
  count: number;
  distanceM: number;
  /** Moving time where known, else elapsed. */
  seconds: number;
  elevGainM: number;
}

const DAY = 86_400_000;
const num = (v: number | string | null) => {
  const n = typeof v === 'number' ? v : v === null ? 0 : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The Monday on or before a YYYY-MM-DD date. */
export function mondayOf(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return date;
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(t - dow * DAY).toISOString().slice(0, 10);
}

/** The last `weeks` weeks ending with the week containing `today`, oldest
 *  first, every week present (zeros included) so a chart never skips one. */
export function weeklyTotals(rows: readonly TotalsRow[], today: string, weeks = 12): WeekTotal[] {
  const lastMonday = Date.parse(`${mondayOf(today)}T00:00:00Z`);
  const out: WeekTotal[] = [];
  const byWeek = new Map<string, WeekTotal>();
  for (let i = weeks - 1; i >= 0; i--) {
    const wk = new Date(lastMonday - i * 7 * DAY).toISOString().slice(0, 10);
    const w: WeekTotal = { weekStart: wk, count: 0, distanceM: 0, seconds: 0, elevGainM: 0 };
    out.push(w);
    byWeek.set(wk, w);
  }
  for (const r of rows) {
    const w = byWeek.get(mondayOf(r.occurred_on));
    if (!w) continue;
    w.count += 1;
    w.distanceM += num(r.distance_m);
    w.seconds += r.moving_s ?? r.elapsed_s;
    w.elevGainM += num(r.elev_gain_m);
  }
  for (const w of out) {
    w.distanceM = Math.round(w.distanceM);
    w.elevGainM = Math.round(w.elevGainM);
  }
  return out;
}

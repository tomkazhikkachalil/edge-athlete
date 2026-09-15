/**
 * Flights (Events program, phase 2) — pure. A flight is a label on the
 * PARTICIPANT (`sport_event_participants.flight`, 202 — one flight per
 * player for the whole tournament, the Golf Genius norm), so the boards
 * can rank within it. The organizer assigns by hand or from the frozen
 * indexes: `planFlights` splits the indexed players into N near-equal
 * flights (A, B, C … lowest indexes first) or into index BANDS; a player
 * with no index is never guessed into a flight — they are listed for the
 * organizer to place by hand.
 */
import { FLIGHT_MAX, normalizeFlight, type Parsed } from './validate';

export { flightsOf } from './overall';
export { FLIGHT_MAX, normalizeFlight };

export type FlightPlanSpec =
  | { mode: 'count'; count: number }
  | { mode: 'bands'; bands: Array<{ label: string; max_index: number }> };

export interface FlightPlanRow {
  participantId: string;
  handicapIndex: number | null;
}

export interface FlightPlan {
  assignments: Array<{ participantId: string; flight: string }>;
  /** Players with no index — left for the organizer, never guessed. */
  unindexed: string[];
}

export const FLIGHT_COUNT_MIN = 2;
export const FLIGHT_COUNT_MAX = 6;

/** A, B, C … (the 27th flight would be AA — nobody runs that many). */
export function flightLabel(i: number): string {
  let n = i;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function planFlights(rows: ReadonlyArray<FlightPlanRow>, spec: FlightPlanSpec): FlightPlan {
  const indexed = rows.filter(r => typeof r.handicapIndex === 'number' && Number.isFinite(r.handicapIndex)) as Array<{ participantId: string; handicapIndex: number }>;
  const unindexed = rows.filter(r => !(typeof r.handicapIndex === 'number' && Number.isFinite(r.handicapIndex))).map(r => r.participantId);
  const sorted = [...indexed].sort((a, b) => a.handicapIndex - b.handicapIndex || a.participantId.localeCompare(b.participantId));
  const assignments: FlightPlan['assignments'] = [];
  if (spec.mode === 'count') {
    const count = Math.min(FLIGHT_COUNT_MAX, Math.max(FLIGHT_COUNT_MIN, Math.floor(spec.count)));
    const groups = Math.min(count, sorted.length);
    if (groups > 0) {
      const base = Math.floor(sorted.length / groups);
      const extra = sorted.length % groups;
      let at = 0;
      for (let g = 0; g < groups; g++) {
        const size = base + (g < extra ? 1 : 0);
        for (const r of sorted.slice(at, at + size)) assignments.push({ participantId: r.participantId, flight: flightLabel(g) });
        at += size;
      }
    }
  } else {
    const bands = [...spec.bands].filter(b => b.label.trim().length > 0 && Number.isFinite(b.max_index)).sort((a, b) => a.max_index - b.max_index);
    if (bands.length > 0) {
      for (const r of sorted) {
        const band = bands.find(b => r.handicapIndex <= b.max_index) ?? bands[bands.length - 1];
        assignments.push({ participantId: r.participantId, flight: band.label.trim().slice(0, FLIGHT_MAX) });
      }
    }
  }
  return { assignments, unindexed };
}

/** The whole plan the PUT takes: `{assignments: [{participant_id, flight | null}]}` — every id an eligible player, no id twice. */
export function parseFlightsPlan(body: unknown, eligibleIds: ReadonlySet<string>): Parsed<Array<{ participant_id: string; flight: string | null }>> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'A JSON body is required' };
  const list = (body as Record<string, unknown>).assignments;
  if (!Array.isArray(list)) return { ok: false, error: 'assignments must be a list' };
  if (list.length > 500) return { ok: false, error: 'At most 500 assignments' };
  const out: Array<{ participant_id: string; flight: string | null }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (typeof item !== 'object' || item === null) return { ok: false, error: `assignments[${i}] must be an object` };
    const pid = (item as Record<string, unknown>).participant_id;
    if (typeof pid !== 'string' || !eligibleIds.has(pid)) return { ok: false, error: `assignments[${i}].participant_id is not an accepted, playing participant` };
    if (seen.has(pid)) return { ok: false, error: `assignments[${i}].participant_id appears twice` };
    seen.add(pid);
    const flight = normalizeFlight((item as Record<string, unknown>).flight, `assignments[${i}].flight`);
    if (!flight.ok) return flight;
    out.push({ participant_id: pid, flight: flight.value });
  }
  return { ok: true, value: out };
}

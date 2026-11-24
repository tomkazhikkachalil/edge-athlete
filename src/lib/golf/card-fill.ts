// ── The scorecard fill's rules (Nov 17 2026) — pure ─────────────────────────
// Production held 28,987 courses and 78 scorecards. Tom: fill the cards in the
// background from OpenGolfAPI (ODbL: copying is what the licence is for), so a
// pick finds its card already there. GolfCourseAPI stays on a pick only.
//
// Two rules live here, both strict, because a wrong card is worse than none:
//   linkDataset      which course in OpenGolfAPI's published file IS which of
//                    ours: the same facility name within 2 km, exactly one
//                    candidate each way. Two candidates is no link.
//   cardFillVerdict  whether a provider's card may be saved: it must be whole
//                    and agree with itself, with our row and with the map.
// (The published file's own scorecards are NOT used: measured Nov 17, 22 of
// its 15,667 courses carry all eighteen holes. It links ids; the card comes
// from the provider's detail answer, which is checked here.)

import { sameFacilityName } from '@/lib/golf/course-catalog';
import { sheetAgreesWithMap } from '@/lib/golf/map-sheet';
import { cardParsVerdict } from '@/lib/golf/sheet-merge';

/** A link needs the two points this close. */
export const LINK_MAX_KM = 2;

export interface LinkOurs { id: string; name: string; lat: number | null; lng: number | null }
export interface LinkTheirs { id: string; name: string; lat: number; lng: number }

/** A name as the link compares it. Two spellings the published file has and
 *  the catalog does not (measured Nov 18 2026): a trademark sign flattened
 *  onto the word ("Pebble Beach Golf Linkstm", "Spyglass Hilltm Golf Course":
 *  five names in the file, all one company's), and a dropped apostrophe
 *  ("Falcons Fire" for "Falcon's Fire"). Only for this comparison;
 *  sameFacilityName itself is not changed (it also guards catalog dedupe). */
export function linkName(name: string): string {
  return name.replace(/([A-Za-z]{2,})(tm|sm)\b/g, '$1').replace(/['’`]/g, '');
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const x = (bLng - aLng) * rad * Math.cos(((aLat + bLat) / 2) * rad);
  const y = (bLat - aLat) * rad;
  return 6371 * Math.sqrt(x * x + y * y);
}

/** One line of OpenGolfAPI's published NDJSON (a GeoJSON feature) as a link
 *  candidate, or null when it has no id, name or point. */
export function parseDatasetLine(line: string): LinkTheirs | null {
  try {
    const f = JSON.parse(line) as { geometry?: { coordinates?: unknown[] } | null; properties?: { id?: unknown; name?: unknown } | null };
    const [lng, lat] = f.geometry?.coordinates ?? [];
    const id = f.properties?.id;
    const name = f.properties?.name;
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim()) return null;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { id, name, lat, lng };
  } catch {
    return null;
  }
}

/** What makes two lines of the file the same entry: the name and the point. */
export function linkEntryKey(t: { name: string; lat: number; lng: number }): string {
  return `${linkName(t.name).trim().toLowerCase()}|${t.lat.toFixed(4)}|${t.lng.toFixed(4)}`;
}

export interface LinkResult {
  /** `alts`: the other ids of the SAME entry, when the file lists one course
   *  several times (the same name at the same point). The fill asks them in
   *  turn when the first id's card is refused. */
  pairs: Array<{ id: string; og: string; alts?: string[] }>;
  /** Ours with no candidate at all. */
  unmatched: number;
  /** Ours with two candidates, or sharing its one candidate with another of ours. */
  ambiguous: number;
  noCoords: number;
}

/** Which of theirs is which of ours. Exactly one candidate (same facility name
 *  within LINK_MAX_KM) for a row, and that candidate claimed by no other row:
 *  a 27-hole club's two rows both matching one entry link neither. */
export function linkDataset(ours: ReadonlyArray<LinkOurs>, theirs: ReadonlyArray<LinkTheirs>): LinkResult {
  const cell = (lat: number, lng: number) => `${Math.floor(lat * 10)}:${Math.floor(lng * 10)}`;
  // One course listed several times is ONE candidate: the same name at the
  // same point (to ~10 m) under different ids. Measured Nov 18 2026: 711 such
  // groups in the file; counted as rivals they made 271 of our rows
  // "ambiguous". Entries that differ in name or point stay rivals.
  interface Entry extends LinkTheirs { ids: string[] }
  const entries = new Map<string, Entry>();
  for (const t of theirs) {
    const name = linkName(t.name);
    const k = linkEntryKey(t);
    const e = entries.get(k);
    if (e) e.ids.push(t.id); else entries.set(k, { ...t, name, ids: [t.id] });
  }
  const grid = new Map<string, Entry[]>();
  for (const t of entries.values()) {
    const k = cell(t.lat, t.lng);
    const list = grid.get(k);
    if (list) list.push(t); else grid.set(k, [t]);
  }
  const result: LinkResult = { pairs: [], unmatched: 0, ambiguous: 0, noCoords: 0 };
  const single: Array<{ id: string; entry: Entry }> = [];
  for (const o of ours) {
    if (o.lat == null || o.lng == null) { result.noCoords++; continue; }
    const a = Math.floor(o.lat * 10);
    const b = Math.floor(o.lng * 10);
    const name = linkName(o.name);
    const near: Entry[] = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const t of grid.get(`${a + i}:${b + j}`) ?? []) {
          if (distanceKm(o.lat, o.lng, t.lat, t.lng) <= LINK_MAX_KM && sameFacilityName(name, t.name)) near.push(t);
        }
      }
    }
    if (near.length === 0) result.unmatched++;
    else if (near.length > 1) result.ambiguous++;
    else single.push({ id: o.id, entry: near[0] });
  }
  const claims = new Map<string, number>();
  for (const p of single) claims.set(p.entry.id, (claims.get(p.entry.id) ?? 0) + 1);
  for (const p of single) {
    if (claims.get(p.entry.id) !== 1) { result.ambiguous++; continue; }
    const [og, ...alts] = p.entry.ids;
    result.pairs.push(alts.length ? { id: p.id, og, alts } : { id: p.id, og });
  }
  return result;
}

export type CardFillVerdict =
  | 'ok'
  /** The provider answered no course, or a course with no holes. */
  | 'no_card'
  /** The answer's point is not where our course is. */
  | 'moved'
  /** Not a whole nine or eighteen numbered 1..n, or not the count the provider or our row states. */
  | 'hole_count'
  /** A par outside 3..6, or the pars do not add up to the provider's own total. */
  | 'par_sum'
  /** No hole carries a yardage for any tee. */
  | 'no_yardage'
  /** The pars disagree with the course's map card. */
  | 'map_disagrees';

export interface FillCard {
  lat?: number | null;
  lng?: number | null;
  total_par: number | null;
  holes_count: number | null;
  hole_data: ReadonlyArray<{ number: number; par: number; yardage: Record<string, number> }> | null;
}

/** May this provider card be saved on this course? Every check is the card
 *  against something independent: its own totals, our row, the map. */
export function cardFillVerdict(
  row: { lat: number | null; lng: number | null; holes_count: number | null },
  card: FillCard | null,
  mapSheet: ReadonlyArray<{ number: number; par: number }> | null
): CardFillVerdict {
  const holes = card?.hole_data ?? [];
  if (!card || holes.length === 0) return 'no_card';
  if (row.lat != null && row.lng != null && card.lat != null && card.lng != null && distanceKm(row.lat, row.lng, card.lat, card.lng) > LINK_MAX_KM) return 'moved';
  // The card's own arithmetic (sheet-merge.ts cardParsVerdict), then our row's hole count.
  const own = cardParsVerdict(card);
  if (own === 'hole_count') return own;
  if (row.holes_count != null && row.holes_count !== holes.length) return 'hole_count';
  if (own !== 'ok') return own;
  if (!holes.some(h => Object.values(h.yardage ?? {}).some(v => typeof v === 'number' && v > 0))) return 'no_yardage';
  if (!sheetAgreesWithMap(holes, mapSheet)) return 'map_disagrees';
  return 'ok';
}

/** A refused card is asked for again after this long (the provider's data moves). */
export const FILL_RETRY_MS = 90 * 24 * 60 * 60 * 1000;
/** The published file is read again after this long (new courses join). */
export const LINK_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
/** A link that failed or was cut short is not tried again before this long:
 *  the cron runs it ahead of the map phases, and a retry on every tick would
 *  take their time every two minutes. */
export const LINK_RETRY_MS = 6 * 60 * 60 * 1000;

/** Raised when linkDataset's rule changes, so the next tick links again under
 *  the new rule instead of waiting out the month. 2 = Nov 18 2026 (duplicate
 *  listings are one candidate; the two name spellings). */
export const LINK_RULE_VERSION = 2;

/** Is the link due? Never finished, finished over a month ago, or finished
 *  under an older rule; and in every case not attempted within LINK_RETRY_MS. */
export function linkDue(finishedAt: string | null | undefined, triedAt: string | null | undefined, now: number, finishedRule: number = LINK_RULE_VERSION): boolean {
  const done = finishedAt ? Date.parse(finishedAt) : NaN;
  const tried = triedAt ? Date.parse(triedAt) : NaN;
  if (Number.isFinite(tried) && now - tried < LINK_RETRY_MS) return false;
  return !Number.isFinite(done) || now - done > LINK_REFRESH_MS || finishedRule < LINK_RULE_VERSION;
}

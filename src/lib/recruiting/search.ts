// ── Scout search — the pure half (Recruiting skeleton R4) ─────────────────
// The query contract for GET /api/scout/search: a name/handle needle, a
// sport, a grad-year window — and, since data foundation F6 (Sep 13 2026),
// three PERFORMANCE filters read over athlete_performances (migration
// 194): `since` (a row on or after the day), `minProvenance` (this rung
// and above on the stored ladder) and `minHeadline` (the sport's one
// number, ordered by HEADLINE_DIRECTION). The performance filters apply
// only WITH a sport — a headline means nothing across sports. Zero heavy
// imports (the page reads it); provenance-copy is pure.

import { PROVENANCE_RANK, type SkillProvenanceKey } from '@/lib/sports/provenance-copy';

/** The STORED ladder (152 / 194), strongest first. */
export const PERFORMANCE_RUNGS = ['sanctioned', 'league_verified', 'club_recorded', 'self_reported', 'imported'] as const;
export type PerformanceRung = (typeof PERFORMANCE_RUNGS)[number];
export const isPerformanceRung = (v: unknown): v is PerformanceRung =>
  typeof v === 'string' && (PERFORMANCE_RUNGS as readonly string[]).includes(v);

/** A stored rung's word on the display ladder (official-stats.ts's rule:
 *  'self_reported' displays as 'entered'). */
const displayRung = (r: PerformanceRung): SkillProvenanceKey => (r === 'self_reported' ? 'entered' : r);

/** The stored rungs at or above `floor` — ONE ladder (PROVENANCE_RANK)
 *  decides, so the chips, the skill cards and this filter never disagree.
 *  'imported' sits above 'self_reported' on that ladder. */
export function rungsAtOrAbove(floor: PerformanceRung): PerformanceRung[] {
  const min = PROVENANCE_RANK[displayRung(floor)];
  return PERFORMANCE_RUNGS.filter(r => PROVENANCE_RANK[displayRung(r)] >= min);
}

/** The "Verified only" toggle's floor: a rung an ORG staffed, not the athlete. */
export const VERIFIED_FLOOR: PerformanceRung = 'club_recorded';

export interface RecruitingSearchParams {
  q: string;
  sport: string | null;
  gradFrom: number | null;
  gradTo: number | null;
  /** YYYY-MM-DD — a performance on or after this day. */
  since: string | null;
  /** This stored rung and above. */
  minProvenance: PerformanceRung | null;
  /** The sport's headline at or better than this (direction per sport). */
  minHeadline: number | null;
}

export const SCOUT_SEARCH_LIMIT = 50;
/** The bounded performance pass — rows, not athletes. */
export const PERFORMANCE_SCAN_LIMIT = 2000;
const GRAD_YEAR_MIN = 2000;
const GRAD_YEAR_MAX = 2100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function year(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= GRAD_YEAR_MIN && n <= GRAD_YEAR_MAX ? n : null;
}

function day(raw: string | null | undefined): string | null {
  if (!raw || !DATE_RE.test(raw)) return null;
  const t = Date.parse(`${raw}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === raw ? raw : null;
}

function headline(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && Math.abs(n) < 1e9 ? n : null;
}

/** Tolerant: junk reads as "no filter"; a reversed window is swapped. */
export function parseRecruitingSearchParams(get: (key: string) => string | null): RecruitingSearchParams {
  const q = (get('q') ?? '').trim().slice(0, 80);
  const sport = (get('sport') ?? '').trim().slice(0, 40) || null;
  let gradFrom = year(get('gradFrom'));
  let gradTo = year(get('gradTo'));
  if (gradFrom !== null && gradTo !== null && gradFrom > gradTo) [gradFrom, gradTo] = [gradTo, gradFrom];
  const since = day(get('since'));
  const rawRung = (get('minProvenance') ?? '').trim();
  const minProvenance = isPerformanceRung(rawRung) ? rawRung : null;
  const minHeadline = headline(get('minHeadline'));
  return { q, sport, gradFrom, gradTo, since, minProvenance, minHeadline };
}

/** True when the request asks a performance question (answered only with a sport). */
export const hasPerformanceFilters = (p: RecruitingSearchParams): boolean =>
  p.since !== null || p.minProvenance !== null || p.minHeadline !== null;

/** PostgREST `ilike` pattern for a contains-match: the wildcard characters
 *  and the filter separators in user text are escaped, never interpolated raw. */
export function containsPattern(needle: string): string {
  const escaped = needle.replace(/[\\%_]/g, c => `\\${c}`).replace(/[,.()]/g, ' ').trim();
  return `%${escaped}%`;
}

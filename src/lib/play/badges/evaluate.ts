import { OFFICIAL_PROVENANCE } from '@/lib/results/official';
import { BADGES, type BadgeDef } from './catalog';

/**
 * Which badges a write EARNS — the Play program (244). Pure.
 *
 * The input is what the post-write hook knows: the rows just written for
 * ONE profile, that profile's result count per sport (after the write),
 * how many sports they have results in, the golf handicap when a golf
 * round with a differential was written, and the badges already held. The
 * answer is the NEW awards only — a held badge is never re-awarded, so a
 * re-save of the same round changes nothing (the writer's insert is
 * ON CONFLICT DO NOTHING besides).
 *
 * Each award names the row that earned it (`sourceKey`, a performance
 * natural_key) and whether that row is VERIFIED — Tom: every result
 * counts, a verified one is marked.
 */

export interface EvalRow {
  natural_key: string;
  sport_key: string;
  occurred_on: string;
  metrics: Record<string, number>;
  outcome?: 'win' | 'loss' | 'tie' | null;
  /** The self-posted line's W / L / T lives in the context blob. */
  context?: Record<string, unknown> | null;
  provenance?: string | null;
}

export interface EvalInput {
  rows: readonly EvalRow[];
  /** Results per sport, INCLUDING the rows just written. */
  resultCounts: Readonly<Record<string, number>>;
  sportsPlayed: number;
  /** The golf handicap after the write (null = none, or provisional). */
  handicapIndex: number | null;
  held: ReadonlySet<string>;
}

export interface Award {
  badgeKey: string;
  sportKey: string | null;
  earnedOn: string;
  sourceKey: string | null;
  verified: boolean;
  detail: Record<string, number>;
}

export const isVerifiedRow = (row: Pick<EvalRow, 'provenance'>): boolean => !!row.provenance && OFFICIAL_PROVENANCE.has(row.provenance);

const isWin = (row: EvalRow): boolean => row.outcome === 'win' || (row.outcome == null && row.context?.result === 'W');

const newest = (rows: readonly EvalRow[]): EvalRow | undefined =>
  [...rows].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || a.natural_key.localeCompare(b.natural_key))[0];

/** The earning row for one definition, or null. A verified qualifying row is preferred (the mark is worth having). */
function earningRow(def: BadgeDef, sportRows: readonly EvalRow[], input: EvalInput): { row: EvalRow | null; detail: Record<string, number> } | null {
  const rule = def.rule;
  const pick = (rows: readonly EvalRow[]) => newest(rows.filter(isVerifiedRow)) ?? newest(rows);
  switch (rule.kind) {
    case 'results': {
      const count = input.resultCounts[def.sportKey ?? ''] ?? 0;
      if (count < rule.min || sportRows.length === 0) return null;
      return { row: newest(sportRows) ?? null, detail: { results: count } };
    }
    case 'win': {
      const wins = sportRows.filter(isWin);
      return wins.length > 0 ? { row: pick(wins) ?? null, detail: {} } : null;
    }
    case 'verified': {
      const v = sportRows.filter(isVerifiedRow);
      return v.length > 0 ? { row: newest(v) ?? null, detail: {} } : null;
    }
    case 'metric': {
      const hits = sportRows.filter(r => {
        const x = r.metrics[rule.metric];
        if (typeof x !== 'number' || !Number.isFinite(x)) return false;
        if (rule.holes !== undefined && r.metrics.holes !== rule.holes) return false;
        return rule.op === 'gte' ? x >= rule.value : x <= rule.value;
      });
      if (hits.length === 0) return null;
      const row = pick(hits)!;
      return { row, detail: { [rule.metric]: row.metrics[rule.metric] } };
    }
    case 'handicap': {
      if (input.handicapIndex === null || input.handicapIndex > rule.atMost || sportRows.length === 0) return null;
      return { row: newest(sportRows) ?? null, detail: { handicap_index: input.handicapIndex } };
    }
    case 'sports': {
      if (input.sportsPlayed < rule.min) return null;
      return { row: newest(input.rows) ?? null, detail: { sports: input.sportsPlayed } };
    }
  }
}

export function evaluateBadges(input: EvalInput, catalog: readonly BadgeDef[] = BADGES): Award[] {
  if (input.rows.length === 0) return [];
  const bySport = new Map<string, EvalRow[]>();
  for (const r of input.rows) {
    const list = bySport.get(r.sport_key);
    if (list) list.push(r);
    else bySport.set(r.sport_key, [r]);
  }
  const awards: Award[] = [];
  for (const def of catalog) {
    if (input.held.has(def.key)) continue;
    const sportRows = def.sportKey === null ? input.rows : bySport.get(def.sportKey) ?? [];
    if (def.sportKey !== null && sportRows.length === 0) continue;
    const hit = earningRow(def, sportRows, input);
    if (!hit) continue;
    awards.push({
      badgeKey: def.key,
      sportKey: def.sportKey,
      earnedOn: hit.row?.occurred_on ?? new Date().toISOString().slice(0, 10),
      sourceKey: hit.row?.natural_key ?? null,
      verified: hit.row ? isVerifiedRow(hit.row) : false,
      detail: hit.detail,
    });
  }
  return awards;
}

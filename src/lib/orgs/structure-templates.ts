// ── Structure templates + grid math (phase 1 round 2) — pure, node-tested ──
// The wizard's step-3 prefills (Tom, Aug 31: hockey + soccer + baseball)
// and the grid builder's derivation functions. Data + pure functions only —
// no registry import (the 113 convention; routes gate sport enablement).
//
// `defaults` are deliberately MODEST: a prefill should invite pruning a
// handful of rows, not deleting forty.

import type { DivisionDraftRow } from './wizard-validate';

export interface StructureTemplate {
  sportKey: 'ice_hockey' | 'soccer' | 'baseball';
  label: string;
  bands: string[];
  streams: string[];
  tiers: string[];
  defaults: { bands: string[]; streams: string[]; tiers: string[] };
}

export const STRUCTURE_TEMPLATES: StructureTemplate[] = [
  {
    sportKey: 'ice_hockey',
    label: 'Ice hockey',
    // The Hockey Canada age matrix.
    bands: ['U7', 'U9', 'U11', 'U13', 'U15', 'U18'],
    streams: ['Mixed', 'Girls'],
    tiers: ['AA', 'A', 'B', 'C', 'House'],
    defaults: { bands: ['U9', 'U11', 'U13', 'U15'], streams: ['Mixed'], tiers: ['A', 'B'] },
  },
  {
    sportKey: 'soccer',
    label: 'Soccer',
    bands: ['U8', 'U10', 'U12', 'U14', 'U16', 'U18', 'Senior'],
    streams: ['Boys', 'Girls', 'Coed'],
    tiers: ['Competitive', 'Recreational'],
    defaults: { bands: ['U10', 'U12', 'U14', 'U16'], streams: ['Boys', 'Girls'], tiers: ['Recreational'] },
  },
  {
    sportKey: 'baseball',
    label: 'Baseball',
    // The Baseball Canada ladder.
    bands: ['U7', 'U9', 'U11', 'U13', 'U15', 'U18'],
    streams: ['Mixed', 'Girls'],
    tiers: ['AAA', 'AA', 'A', 'B'],
    defaults: { bands: ['U9', 'U11', 'U13', 'U15'], streams: ['Mixed'], tiers: ['A'] },
  },
];

export function templateFor(sportKey: string): StructureTemplate | null {
  return STRUCTURE_TEMPLATES.find(t => t.sportKey === sportKey) ?? null;
}

/** 'U11 Girls A' — the stream is omitted when the grid runs a single
 *  stream, the tier when a single tier. Injective over (band, stream,
 *  tier) within one grid, so replay 23505s indicate REAL duplicates. */
export function buildDivisionName(
  band: string,
  stream: string | null,
  tier: string | null
): string {
  return [band, stream, tier].filter(Boolean).join(' ');
}

export function gridRowKey(
  sportKey: string,
  band: string,
  stream: string | null,
  tier: string | null
): string {
  return [sportKey, band, stream ?? '', tier ?? ''].join('|');
}

export interface GridSelections {
  bands: string[];
  streams: string[];
  tiers: string[];
}

/** The cross-product of the current selections, minus rows the user ✕'d
 *  (by gridRowKey — re-checking a box never resurrects a removed row).
 *  Singleton streams/tiers are omitted from names AND keys' display but
 *  kept in keys, so exclusions survive selection changes coherently. */
export function buildGridRows(
  sportKey: string,
  sel: GridSelections,
  excludedKeys: ReadonlySet<string>
): DivisionDraftRow[] {
  const streams = sel.streams.length > 0 ? sel.streams : [null];
  const tiers = sel.tiers.length > 0 ? sel.tiers : [null];
  const singleStream = sel.streams.length <= 1;
  const singleTier = sel.tiers.length <= 1;
  const rows: DivisionDraftRow[] = [];
  for (const band of sel.bands) {
    for (const stream of streams) {
      for (const tier of tiers) {
        if (excludedKeys.has(gridRowKey(sportKey, band, stream, tier))) continue;
        rows.push({
          sportKey,
          name: buildDivisionName(band, singleStream ? null : stream, singleTier ? null : tier),
          ageBand: band,
          genderStream: stream ?? undefined,
          tier: tier ?? undefined,
        });
      }
    }
  }
  return rows;
}

/** Hockey seasons span years (Sep–Aug); soccer/baseball are calendar.
 *  Pure in `now` for tests. */
export function defaultSeasonLabel(sportKey: string, now: Date = new Date()): string {
  const year = now.getFullYear();
  if (sportKey === 'ice_hockey') {
    // A season starting before September belongs to the PREVIOUS span.
    const startYear = now.getMonth() >= 8 ? year : year - 1;
    return `${startYear}–${String((startYear + 1) % 100).padStart(2, '0')} Season`;
  }
  return `${year} Season`;
}

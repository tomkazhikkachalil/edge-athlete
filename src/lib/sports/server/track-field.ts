import type { SupabaseClient } from '@supabase/supabase-js';
import { TRACK_EVENTS, formatRaceTime, isStatLineData } from '../stat-schemas';
import type {
  ServerSportModule,
  SkillCardContribution,
  SkillTile,
  SportStatsCard,
} from './types';

// ── Track & Field server module ──────────────────────────────────────────────
// PBs are best-is-lowest per event, from two sources with different trust:
// TRACKED = the fastest time across the athlete's PUBLIC race posts;
// SELF-REPORTED = the pb_* fields in track sport settings. Per event, a
// tracked PB always wins the display — the same verified-beats-claimed
// stance as the golf handicap pair. The generic sum-based stat-line card is
// nonsense for times, which is why this is a named module.

/** One event's best from each source (nulls where a source has nothing). */
export interface EventPBs {
  tracked: number | null;
  entered: number | null;
}

/** Fastest recorded time per event across public race posts. */
export function trackedPBs(lines: Array<Record<string, number>>): Map<string, number> {
  const best = new Map<string, number>();
  for (const stats of lines) {
    for (const event of TRACK_EVENTS) {
      const v = stats[event.key];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        const prior = best.get(event.key);
        if (prior === undefined || v < prior) best.set(event.key, v);
      }
    }
  }
  return best;
}

/** Self-reported PBs from the settings row (pb_100m … keys). */
export function enteredPBs(settings: Record<string, unknown> | null): Map<string, number> {
  const best = new Map<string, number>();
  for (const event of TRACK_EVENTS) {
    const v = settings?.[`pb_${event.label}`];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) best.set(event.key, v);
  }
  return best;
}

/**
 * Pure card math. Headline = shortest-distance event with any PB; remaining
 * events become tiles; a Races tile rides along when races were posted.
 * Every self-reported PB that renders (headline or tile) is consumed so it
 * doesn't also appear as a chip.
 */
export function buildTrackSkillContribution(
  tracked: Map<string, number>,
  entered: Map<string, number>,
  raceCount: number
): SkillCardContribution {
  const rendered: Array<{ label: string; value: string; provenance: 'tracked' | 'entered'; enteredKey?: string }> = [];
  for (const event of TRACK_EVENTS) {
    const t = tracked.get(event.key);
    const e = entered.get(event.key);
    if (t !== undefined) {
      rendered.push({ label: `${event.label} PB`, value: formatRaceTime(t), provenance: 'tracked' });
      // A self-reported PB for the same event is superseded, not shown.
      if (e !== undefined) rendered[rendered.length - 1].enteredKey = `pb_${event.label}`;
    } else if (e !== undefined) {
      rendered.push({
        label: `${event.label} PB`,
        value: formatRaceTime(e),
        provenance: 'entered',
        enteredKey: `pb_${event.label}`,
      });
    }
  }

  const [headline, ...rest] = rendered;
  const tiles: SkillTile[] = rest.map(({ label, value, provenance }) => ({ label, value, provenance }));
  if (raceCount > 0) tiles.push({ label: 'Races', value: String(raceCount), provenance: 'tracked' });

  return {
    headline: headline
      ? { value: headline.value, label: headline.label, provenance: headline.provenance }
      : null,
    tiles,
    consumedEnteredKeys: rendered.filter(r => r.enteredKey).map(r => r.enteredKey!),
  };
}

async function fetchRaceLines(
  profileId: string,
  supabase: SupabaseClient
): Promise<Array<Record<string, number>>> {
  const { data: posts } = await supabase
    .from('posts')
    .select('stats_data')
    .eq('profile_id', profileId)
    .eq('sport_key', 'track_field')
    .eq('visibility', 'public')
    .not('stats_data', 'is', null)
    .limit(200);
  return (posts || [])
    .map(p => p.stats_data)
    .filter(isStatLineData)
    .map(line => line.stats);
}

export const trackFieldServerModule: ServerSportModule = {
  async buildStatsCard(profileId, supabase): Promise<SportStatsCard | null> {
    const lines = await fetchRaceLines(profileId, supabase);
    if (lines.length === 0) return null;
    const best = trackedPBs(lines);
    const pbTiles = TRACK_EVENTS.filter(e => best.has(e.key))
      .slice(0, 2)
      .map(e => ({ label: `${e.label} PB`, value: formatRaceTime(best.get(e.key)!) }));
    return {
      label: 'Track & Field Stats',
      tiles: [{ label: 'Races', value: String(lines.length) }, ...pbTiles].slice(0, 3),
    };
  },

  async buildSkillCard(profileId, supabase, ctx): Promise<SkillCardContribution | null> {
    const lines = await fetchRaceLines(profileId, supabase);
    return buildTrackSkillContribution(trackedPBs(lines), enteredPBs(ctx.settings), lines.length);
  },
};

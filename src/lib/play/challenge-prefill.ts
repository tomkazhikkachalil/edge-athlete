import { getStatSchema } from '@/lib/sports/stat-schemas';
import { challengeMetrics } from './challenges';

/**
 * "Beat my 78" — a challenge prefilled from one of the athlete's OWN results
 * (the Play program, 244). Pure. A golf round offers its score, its length
 * and its course; a stat line its headline stat (the schema's first support
 * key it recorded — the number the card leads with). Anything else (a post
 * that is not a published result) offers nothing.
 */
export interface PrefillSource {
  id: string;
  status?: string | null;
  stats_data?: Record<string, unknown> | null;
  golf_round?: { id?: string; gross_score?: number; holes?: number; course?: string; course_name?: string } | null;
}

export interface ChallengePrefillFor {
  sportKey: string;
  prefill: { metric: string; target: number; holes?: 9 | 18 | null; sourceKey: string | null; courseName?: string | null };
}

export function challengePrefillFor(post: PrefillSource): ChallengePrefillFor | null {
  if (post.status && post.status !== 'published') return null;
  const r = post.golf_round;
  if (r && typeof r.gross_score === 'number' && r.gross_score > 0) {
    return {
      sportKey: 'golf',
      prefill: {
        metric: 'gross',
        target: r.gross_score,
        holes: r.holes === 9 ? 9 : 18,
        sourceKey: r.id ? `golf_round:${r.id}` : null,
        courseName: r.course || r.course_name || null,
      },
    };
  }
  const data = post.stats_data as { type?: unknown; sport_key?: unknown; stats?: Record<string, unknown> } | null | undefined;
  if (data?.type !== 'stat_line' || typeof data.sport_key !== 'string') return null;
  const schema = getStatSchema(data.sport_key);
  if (!schema || challengeMetrics(data.sport_key).length === 0) return null;
  const stats = data.stats ?? {};
  const has = (k: string) => typeof stats[k] === 'number' && Number.isFinite(stats[k] as number) && (stats[k] as number) > 0;
  const key = schema.supportKeys.find(has) ?? schema.fields.map(f => f.key).find(has);
  if (!key) return null;
  return { sportKey: data.sport_key, prefill: { metric: key, target: stats[key] as number, sourceKey: `post:${post.id}` } };
}

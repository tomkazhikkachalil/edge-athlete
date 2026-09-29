import type { SupabaseClient } from '@supabase/supabase-js';
import { SPORT_NAMES } from '@/lib/config/sports-config';
import { isPublicProfile, publicDisplayName, publicHandle, type MaskableProfile } from '@/lib/orgs/public-names';
import { OFFICIAL_PROVENANCE } from '@/lib/results/official';
import { isUuid } from '@/lib/uuid';
import { golfShareCard, shareableKind, statLineShareCard, type ShareCard } from './share-card';

/**
 * The share card's ONE reader — the Play program (244). Server-only,
 * VIEWER-INDEPENDENT (the service role, no session): the page and the image
 * answer the same thing to everyone, so both may be cached.
 *
 *  • `card` — a published, public result post (a golf round or a stat line)
 *    of a PUBLIC profile (isPublicProfile: claimed, unsupervised, public,
 *    not departed). The card reads the fact table for the round's hole
 *    counts and the verified mark.
 *  • `fallback` — a real post that has no public card (a private post, a
 *    private or supervised author): the page redirects to the in-app link,
 *    which runs the normal privacy gate for a signed-in viewer. The image
 *    is a 404. A stranger learns nothing the in-app link would not tell.
 *  • `null` — no such post, or not a result: a 404.
 */

type Admin = SupabaseClient;

export type ShareRead =
  | { card: ShareCard; profileId: string; handle: string | null }
  | { fallback: string }
  | null;

const PROFILE_COLUMNS = 'first_name, last_name, full_name, visibility, email, supervision_state, departed_at, handle';

export async function readShareCard(admin: Admin, postId: string): Promise<ShareRead> {
  if (!isUuid(postId)) return null;
  const { data: post } = await admin
    .from('posts')
    .select('id, profile_id, visibility, status, stats_data, round_id, sport_key, created_at')
    .eq('id', postId)
    .maybeSingle();
  if (!post) return null;
  const p = post as { id: string; profile_id: string; visibility: string | null; status: string | null; stats_data: unknown; round_id: string | null; sport_key: string | null; created_at: string };
  const isResult = !!p.round_id || (p.stats_data as { type?: unknown } | null)?.type === 'stat_line';
  if (!isResult) return null;
  const inApp = `/athlete/${p.profile_id}?post=${p.id}`;
  const kind = shareableKind({ visibility: p.visibility, status: p.status, stats_data: p.stats_data, has_round: !!p.round_id });
  if (!kind) return p.status === 'published' ? { fallback: inApp } : null;

  const { data: prof } = await admin.from('profiles').select(PROFILE_COLUMNS).eq('id', p.profile_id).maybeSingle();
  const profile = prof as (MaskableProfile & { handle: string | null }) | null;
  if (!profile || !isPublicProfile(profile)) return profile ? { fallback: inApp } : null;
  const athleteName = publicDisplayName(profile);
  const handle = publicHandle(profile);

  if (kind === 'golf') {
    const { data: round } = await admin
      .from('golf_rounds')
      .select('id, date, gross_score, par, holes, course, tee, profile_hidden_at')
      .eq('id', p.round_id!)
      .maybeSingle();
    const r = round as { id: string; date: string; gross_score: number | null; par: number | null; holes: number | null; course: string | null; tee: string | null; profile_hidden_at: string | null } | null;
    if (!r || r.profile_hidden_at || typeof r.gross_score !== 'number' || r.gross_score <= 0) return { fallback: inApp };
    const perf = await performanceOf(admin, `golf_round:${r.id}`);
    return {
      card: golfShareCard({ athleteName, date: r.date, gross: r.gross_score, par: r.par, holes: r.holes, course: r.course, tee: r.tee, metrics: perf.metrics, verified: perf.verified }),
      profileId: p.profile_id,
      handle,
    };
  }

  const data = p.stats_data as { sport_key?: string; date?: string; stats?: Record<string, unknown>; opponent?: string; result?: string; result_score?: string };
  const sportKey = data.sport_key ?? p.sport_key ?? '';
  const stats: Record<string, number> = {};
  for (const [k, v] of Object.entries(data.stats ?? {})) if (typeof v === 'number' && Number.isFinite(v)) stats[k] = v;
  const perf = await performanceOf(admin, `post:${p.id}`);
  const card = statLineShareCard({
    athleteName,
    sportKey,
    sportName: SPORT_NAMES[sportKey] ?? sportKey,
    date: data.date ?? p.created_at.slice(0, 10),
    stats,
    opponent: data.opponent ?? null,
    result: data.result ?? null,
    resultScore: data.result_score ?? null,
    verified: perf.verified,
  });
  return card ? { card, profileId: p.profile_id, handle } : { fallback: inApp };
}

async function performanceOf(admin: Admin, naturalKey: string): Promise<{ metrics: Record<string, number>; verified: boolean }> {
  const { data } = await admin.from('athlete_performances').select('metrics, provenance').eq('natural_key', naturalKey).maybeSingle();
  const row = data as { metrics: Record<string, number> | null; provenance: string | null } | null;
  return { metrics: row?.metrics ?? {}, verified: !!row?.provenance && OFFICIAL_PROVENANCE.has(row.provenance) };
}

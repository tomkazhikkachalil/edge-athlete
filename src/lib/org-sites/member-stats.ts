// ── Member stats reader (Onboarding v2 R5) ──────────────────────────────────
// The I/O half of src/lib/golf/member-stats.ts, keyed by MEMBERSHIP alone —
// the sibling of course-stats.ts (keyed by course, so a venue had to exist).
// Every member of the org, the golf rounds they posted ANYWHERE this year,
// filtered by the TWO-KEY RULE (a PUBLIC post on the round AND a PUBLIC
// profile), supervised athletes and stub profiles excluded from the list
// entirely (the crawlable-surface rule), names masked by publicDisplayName,
// a link only for a public profile (publicHandle). The handicap index rides
// along ONLY for a public profile — it is already public data there (the
// player page and /api/public/profile compute the same thing). Viewer-
// independent, bounded, never throws (the (public) reader contract).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { isPublicProfile, publicDisplayName, publicHandle, type MaskableProfile } from '@/lib/orgs/public-names';
import { isStubEmail } from '@/lib/config/stubs-config';
import { chunk } from '@/lib/chunk';
import { addDaysIso, utcToday } from '@/lib/competitions/golf-weeks';
import { selectPublicRounds } from '@/lib/golf/course-stats';
import {
  buildMemberStats,
  EMPTY_MEMBER_STATS,
  type MemberStats,
  type MemberStatsPerson,
  type MemberStatsRound,
} from '@/lib/golf/member-stats';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[MEMBER STATS]';
const MEMBER_CAP = 500;
const ROUNDS_CAP = 500;
const IN_BATCH = 200;
/** Handicap computations are the expensive part (≤60 rounds + holes each) — bound them. */
const HANDICAP_CAP = 40;

export { EMPTY_MEMBER_STATS };

export async function fetchPublicMemberStats(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  opts: { sinceDays?: number } = {}
): Promise<MemberStats> {
  try {
    const { data: members } = await admin
      .from('memberships')
      .select('profile_id')
      .eq(side === 'league' ? 'league_id' : 'club_id', orgId)
      .eq('scope_type', 'org')
      .eq('kind', 'follow')
      .limit(MEMBER_CAP);
    const memberIds = [...new Set((members ?? []).map(m => m.profile_id as string))];
    if (memberIds.length === 0) return EMPTY_MEMBER_STATS;

    // The people: every member profile that may appear on a crawlable page
    // (supervised and stubs dropped), masked names, links for public ones.
    const people: MemberStatsPerson[] = [];
    const publicProfileIds = new Set<string>();
    const publicPeople: string[] = [];
    for (const batch of chunk(memberIds, IN_BATCH)) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, handle, first_name, last_name, full_name, visibility, email, supervision_state')
        .in('id', batch);
      for (const p of (profiles ?? []) as (MaskableProfile & { id: string; handle?: string | null })[]) {
        if (p.supervision_state === 'supervised' || isStubEmail(p.email)) continue;
        const isPublic = isPublicProfile(p);
        if (isPublic) {
          publicProfileIds.add(p.id);
          publicPeople.push(p.id);
        }
        people.push({ profileId: p.id, name: publicDisplayName(p), handle: publicHandle(p), handicap: null });
      }
    }
    if (people.length === 0) return EMPTY_MEMBER_STATS;

    // The rounds: complete, outdoor, this year, by PUBLIC members (a private
    // profile's rounds never count toward a crawlable board).
    const since = addDaysIso(utcToday(), -(opts.sinceDays ?? 365));
    const roundRows: Record<string, unknown>[] = [];
    for (const batch of chunk(publicPeople, IN_BATCH)) {
      if (roundRows.length >= ROUNDS_CAP) break;
      let res = await admin
        .from('golf_rounds')
        .select('id, profile_id, date, holes, gross_score, course, created_at')
        .in('profile_id', batch)
        .eq('is_complete', true)
        .eq('round_type', 'outdoor')
        .gte('date', since)
        .order('date', { ascending: false })
        .limit(ROUNDS_CAP - roundRows.length);
      if (res.error?.code === '42703') {
        res = await admin
          .from('golf_rounds')
          .select('id, profile_id, date, holes, gross_score, course, created_at')
          .in('profile_id', batch)
          .eq('is_complete', true)
          .gte('date', since)
          .order('date', { ascending: false })
          .limit(ROUNDS_CAP - roundRows.length);
      }
      if (res.error) {
        console.error(`${TAG} rounds read error:`, res.error);
        break;
      }
      roundRows.push(...((res.data ?? []) as Record<string, unknown>[]));
    }
    const rounds: MemberStatsRound[] = roundRows.map(r => ({
      id: r.id as string,
      profileId: r.profile_id as string,
      date: String(r.date),
      holes: Number(r.holes ?? 18),
      gross: Number(r.gross_score ?? 0),
      createdAt: String(r.created_at ?? ''),
      courseName: (r.course as string | null) ?? null,
    }));

    // Key 1: a public, published post on the round.
    const publicPostRoundIds = new Set<string>();
    for (const batch of chunk(rounds.map(r => r.id), IN_BATCH)) {
      const { data: posts } = await admin
        .from('posts')
        .select('round_id, status')
        .in('round_id', batch)
        .eq('visibility', 'public');
      for (const p of posts ?? []) {
        if (p.status == null || p.status === 'published') publicPostRoundIds.add(p.round_id as string);
      }
    }
    const visible = selectPublicRounds(rounds, publicPostRoundIds, publicProfileIds);

    // The handicap index for public profiles (already public data there).
    const { fetchHandicapComputation } = await import('@/lib/golf/handicap-server');
    const { formatHandicapIndex } = await import('@/lib/golf/handicap');
    const withHandicap = people.filter(p => publicProfileIds.has(p.profileId)).slice(0, HANDICAP_CAP);
    await Promise.all(
      withHandicap.map(async p => {
        try {
          const hc = await fetchHandicapComputation(p.profileId, admin);
          if (hc.current) p.handicap = formatHandicapIndex(hc.current.index);
        } catch (error) {
          console.error(`${TAG} handicap failed:`, error);
        }
      })
    );

    const seasonFrom = `${utcToday().slice(0, 4)}-01-01`;
    return buildMemberStats({ people, rounds: visible, seasonFrom });
  } catch (error) {
    console.error(`${TAG} failed:`, error);
    return EMPTY_MEMBER_STATS;
  }
}

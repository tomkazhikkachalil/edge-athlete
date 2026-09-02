// ── Course stats reader (phase 6e S3) ───────────────────────────────────────
// The I/O half of src/lib/golf/course-stats.ts: the club's members'
// rounds at the club's course(s) over the last year, filtered by the
// TWO-KEY RULE (a PUBLIC post on the round AND a PUBLIC profile — the
// feed's rule, src/app/api/posts/route.ts), supervised athletes and stub
// profiles excluded, names masked by publicDisplayName. Viewer-
// independent, bounded, never throws (the (public) reader contract).
// Reads only: golf_rounds / golf_holes / posts / profiles / memberships —
// the frozen golf write path is untouched. Rounds arrive through that
// path, which purges nothing, so a new round reaches the page within the
// ISR window (≤300s) — the same staleness the standings live with.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import { isStubEmail } from '@/lib/config/stubs-config';
import { chunk } from '@/lib/chunk';
import { addDaysIso, utcToday } from '@/lib/competitions/golf-weeks';
import {
  buildCourseStats,
  selectPublicRounds,
  type CourseStats,
  type CourseStatsHole,
  type CourseStatsRound,
} from '@/lib/golf/course-stats';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[COURSE STATS]';
const MEMBER_CAP = 2000;
const ROUNDS_CAP = 500;
const IN_BATCH = 200;
const HOLE_BATCH_ROUNDS = 55; // 55 × 18 = 990 < PostgREST's 1000-row cap

export const EMPTY_COURSE_STATS: CourseStats = {
  roundsPosted: 0,
  byTee: [],
  courseRecord: [],
  hardestHoles: [],
  recentRounds: [],
};

export async function fetchPublicCourseStats(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  courseIds: string[],
  opts: { sinceDays?: number; parByHole?: Map<number, number> } = {}
): Promise<CourseStats> {
  if (courseIds.length === 0) return EMPTY_COURSE_STATS;
  try {
    const { data: members } = await admin
      .from('memberships')
      .select('profile_id')
      .eq(side === 'league' ? 'league_id' : 'club_id', orgId)
      .eq('scope_type', 'org')
      .limit(MEMBER_CAP);
    const memberIds = [...new Set((members ?? []).map(m => m.profile_id as string))];
    if (memberIds.length === 0) return EMPTY_COURSE_STATS;

    const since = addDaysIso(utcToday(), -(opts.sinceDays ?? 365));
    const roundRows: Record<string, unknown>[] = [];
    for (const batch of chunk(memberIds, IN_BATCH)) {
      if (roundRows.length >= ROUNDS_CAP) break;
      let res = await admin
        .from('golf_rounds')
        .select('id, profile_id, date, tee, holes, gross_score, created_at')
        .in('course_id', courseIds)
        .in('profile_id', batch)
        .eq('is_complete', true)
        .eq('round_type', 'outdoor')
        .gte('date', since)
        .order('date', { ascending: false })
        .limit(ROUNDS_CAP - roundRows.length);
      if (res.error?.code === '42703') {
        // No round_type column on this database — indoor rounds can't exist either.
        res = await admin
          .from('golf_rounds')
          .select('id, profile_id, date, tee, holes, gross_score, created_at')
          .in('course_id', courseIds)
          .in('profile_id', batch)
          .eq('is_complete', true)
          .gte('date', since)
          .order('date', { ascending: false })
          .limit(ROUNDS_CAP - roundRows.length);
      }
      if (res.error) {
        console.error(`${TAG} rounds read error:`, res.error);
        return EMPTY_COURSE_STATS;
      }
      roundRows.push(...((res.data ?? []) as Record<string, unknown>[]));
    }
    if (roundRows.length === 0) return EMPTY_COURSE_STATS;

    const rounds: CourseStatsRound[] = roundRows.map(r => ({
      id: r.id as string,
      profileId: r.profile_id as string,
      date: String(r.date),
      tee: (r.tee as string | null) ?? null,
      holes: Number(r.holes ?? 18),
      gross: Number(r.gross_score ?? 0),
      createdAt: String(r.created_at ?? ''),
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
    // Key 2: a public, claimed, unsupervised profile — and its masked name.
    const authorIds = [...new Set(rounds.map(r => r.profileId))];
    const publicProfileIds = new Set<string>();
    const nameById = new Map<string, string>();
    for (const batch of chunk(authorIds, IN_BATCH)) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, first_name, last_name, full_name, visibility, email, supervision_state')
        .in('id', batch);
      for (const p of (profiles ?? []) as (MaskableProfile & { id: string })[]) {
        if (p.visibility !== 'public' || p.supervision_state === 'supervised' || isStubEmail(p.email)) continue;
        publicProfileIds.add(p.id);
        nameById.set(p.id, publicDisplayName(p));
      }
    }
    const visible = selectPublicRounds(rounds, publicPostRoundIds, publicProfileIds);
    if (visible.length === 0) return EMPTY_COURSE_STATS;

    const holes: CourseStatsHole[] = [];
    for (const batch of chunk(visible.map(r => r.id), HOLE_BATCH_ROUNDS)) {
      const { data: rows } = await admin
        .from('golf_holes')
        .select('round_id, hole_number, par, strokes')
        .in('round_id', batch);
      for (const h of rows ?? []) {
        holes.push({
          roundId: h.round_id as string,
          hole: Number(h.hole_number),
          par: (h.par as number | null) ?? null,
          strokes: (h.strokes as number | null) ?? null,
        });
      }
    }
    return buildCourseStats({ rounds: visible, holes, nameById, parByHole: opts.parByHole });
  } catch (error) {
    console.error(`${TAG} failed:`, error);
    return EMPTY_COURSE_STATS;
  }
}

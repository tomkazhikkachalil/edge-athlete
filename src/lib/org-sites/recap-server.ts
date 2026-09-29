// ── One-click recap drafts — the reads and the ONE writer (R1) ──────────────
//   • recapCandidates — the org's finished contests of the last 30 days
//     (every competition it runs, public or not: a private one drafts for
//     members), each line home-first ("Comets 2–3 Blazers", the division
//     reader's words) with the recap already written, if any.
//   • createRecap — the draft for one contest: the contest must be the
//     org's; its masked view (`fetchContestView`, the ONE reader) becomes
//     the words (`recap.ts`); the post is a DRAFT (published_at null) with
//     `source_ref contest:<id>` — 243's partial UNIQUE makes a second click
//     (or a racing tab) land on the same draft, never a twin.
// Manager-gated by the route (manage_site). Never publishes, never bells.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, type OrgKind } from '@/lib/orgs/org-ref';
import { fetchContestView } from '@/lib/competitions/contest-view';
import { divisionSchedule } from '@/lib/teams/schedule';
import { CONTEST_FIELDS, resolveOutcomes, type CompetitionRow, type ContestRow } from '@/lib/teams/schedule-server';
import { NEWS_PER_SITE_MAX, isValidPageSlug, slugifyPageTitle } from './validate';
import { recapDraft, recapSourceRef } from './recap';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[NEWS RECAP]';
export const RECAP_WINDOW_DAYS = 30;
const CANDIDATES_MAX = 12;

export interface RecapCandidate {
  contestId: string;
  title: string;
  when: string | null;
  competitionName: string;
  /** The recap already drafted or posted for it, if any. */
  recapNewsId: string | null;
}

export type RecapOutcome =
  | { ok: true; post: { id: string; slug: string; title: string }; existing: boolean }
  | { ok: false; status: number; error: string; reason?: string };

async function siteOf(admin: Admin, orgId: string): Promise<{ id: string } | null> {
  const { data } = await admin.from('org_sites').select('id').eq(ORG_ID, orgId).maybeSingle();
  return (data as { id: string } | null) ?? null;
}

async function existingRecaps(admin: Admin, siteId: string, contestIds: readonly string[]): Promise<Map<string, { id: string; slug: string; title: string }> | null> {
  if (contestIds.length === 0) return new Map();
  const { data, error } = await admin
    .from('org_site_news')
    .select('id, slug, title, source_ref')
    .eq('site_id', siteId)
    .in('source_ref', contestIds.map(recapSourceRef))
    .is('deleted_at', null);
  if (error) {
    // Pre-243: no source_ref — recaps need the migration.
    if (error.code === '42703') return null;
    console.error(`${TAG} existing read failed:`, error);
    return new Map();
  }
  return new Map(((data ?? []) as { id: string; slug: string; title: string; source_ref: string }[]).map(r => [r.source_ref.slice('contest:'.length), { id: r.id, slug: r.slug, title: r.title }]));
}

export async function recapCandidates(admin: Admin, side: OrgKind, orgId: string): Promise<{ supported: boolean; candidates: RecapCandidate[] }> {
  try {
    const site = await siteOf(admin, orgId);
    if (!site) return { supported: true, candidates: [] };
    const { data: compsData } = await admin
      .from('competitions')
      .select('id, name, org_id, visibility, status, format, sport_key, scoring_rule')
      .eq(ORG_ID, orgId)
      .in('status', ['active', 'completed'])
      .limit(50);
    const comps = (compsData ?? []) as CompetitionRow[];
    if (comps.length === 0) return { supported: true, candidates: [] };
    const compById = new Map(comps.map(c => [c.id, c]));
    const since = new Date(Date.now() - RECAP_WINDOW_DAYS * 86_400_000).toISOString();
    const { data: contestData, error } = await admin
      .from('contests')
      .select(CONTEST_FIELDS)
      .in('competition_id', comps.map(c => c.id))
      .eq('status', 'completed')
      .or(`scheduled_at.gte.${since},and(scheduled_at.is.null,play_from.gte.${since.slice(0, 10)})`) // hardening-ok: `since` is the server clock, never input
      .limit(100);
    if (error) {
      console.error(`${TAG} contests read failed:`, error);
      return { supported: true, candidates: [] };
    }
    const rows = (contestData ?? []) as ContestRow[];
    const outcomes = await resolveOutcomes(admin, rows, compById);
    const lines = divisionSchedule({
      calendar: [],
      contests: rows.flatMap(c => {
        const comp = compById.get(c.competition_id);
        const outcome = outcomes.get(c.id);
        return comp && outcome ? [{ id: c.id, competitionName: comp.name, round: c.round, scheduledAt: c.scheduled_at, playFrom: c.play_from, status: c.status, eventId: null, outcome, href: null }] : [];
      }),
    }).results.slice(0, CANDIDATES_MAX);
    const ids = lines.map(l => l.key.slice('contest:'.length));
    const recapped = await existingRecaps(admin, site.id, ids);
    if (recapped === null) return { supported: false, candidates: [] };
    const compOf = new Map(rows.map(r => [r.id, compById.get(r.competition_id)?.name ?? '']));
    return {
      supported: true,
      candidates: lines.map((l, i) => ({ contestId: ids[i], title: l.title, when: l.when, competitionName: compOf.get(ids[i]) ?? '', recapNewsId: recapped.get(ids[i])?.id ?? null })),
    };
  } catch (e) {
    console.error(`${TAG} candidates failed:`, e);
    return { supported: true, candidates: [] };
  }
}

export async function createRecap(admin: Admin, input: { side: OrgKind; orgId: string; contestId: string; actorId: string }): Promise<RecapOutcome> {
  const site = await siteOf(admin, input.orgId);
  if (!site) return { ok: false, status: 404, error: 'Site not found' };
  // The contest must be the org's own.
  const { data: contest } = await admin.from('contests').select('id, competition:competitions(org_id)').eq('id', input.contestId).maybeSingle();
  const compOrg = (contest as { competition?: { org_id?: string } | { org_id?: string }[] | null } | null)?.competition;
  const orgOfContest = (Array.isArray(compOrg) ? compOrg[0] : compOrg)?.org_id;
  if (!contest || orgOfContest !== input.orgId) return { ok: false, status: 404, error: 'Game not found' };

  const already = await existingRecaps(admin, site.id, [input.contestId]);
  if (already === null) return { ok: false, status: 400, error: 'Recaps need a database update (migration 243) — ask your admin', reason: 'needs_243' };
  const found = already.get(input.contestId);
  if (found) return { ok: true, post: found, existing: true };

  const result = await fetchContestView(admin, input.contestId, { viewerId: input.actorId });
  if (!result) return { ok: false, status: 404, error: 'Game not found' };
  const draft = recapDraft(result.view);
  if (!draft) return { ok: false, status: 409, error: 'There is no final result to recap yet.', reason: 'no_result' };

  const { count } = await admin.from('org_site_news').select('id', { count: 'exact', head: true }).eq('site_id', site.id).is('deleted_at', null);
  if ((count ?? 0) >= NEWS_PER_SITE_MAX) return { ok: false, status: 400, error: `A site can have at most ${NEWS_PER_SITE_MAX} news posts` };

  const base = slugifyPageTitle(draft.title) || 'recap';
  const slugs = [base, ...Array.from({ length: 19 }, (_, i) => `${base}-${i + 2}`)].map(c => c.slice(0, 80)).filter(isValidPageSlug);
  for (const slug of slugs) {
    const { data: post, error } = await admin
      .from('org_site_news')
      .insert({
        site_id: site.id,
        slug,
        title: draft.title,
        summary: draft.summary,
        body: draft.blocks,
        audience: draft.audience,
        source_ref: recapSourceRef(input.contestId),
        created_by: input.actorId,
      })
      .select('id, slug, title')
      .single();
    if (post) return { ok: true, post: post as { id: string; slug: string; title: string }, existing: false };
    if (error?.code !== '23505') {
      console.error(`${TAG} insert failed:`, error);
      return { ok: false, status: 500, error: 'Could not draft the recap' };
    }
    // A 23505 is the slug — or a racing click that drafted this recap first.
    const raced = (await existingRecaps(admin, site.id, [input.contestId]))?.get(input.contestId);
    if (raced) return { ok: true, post: raced, existing: true };
  }
  return { ok: false, status: 409, error: 'Could not derive a free address from that title' };
}

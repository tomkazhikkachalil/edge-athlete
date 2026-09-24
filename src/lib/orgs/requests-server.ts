// ── Org requests — the self-service "Start a league / club" door (116 / 117),
// one handler for both kinds since Round 5 D3 (236: `org_requests`) ─────────
// Any signed-in, org-eligible user files a request; admins decide on the
// dashboard queue (admin-requests-server.ts). The requester is ALWAYS the
// session user (the schemas strip any client-sent ownerProfileId). ONE
// pending request per profile across BOTH kinds — `org_requests_one_pending`
// (236) is the authority, its 23505 the answer; no racy pre-check.
//
// The public shape does not change (Tom, Sep 22 2026): a row still carries
// `created_league_id` / `created_club_id` — `publicRequestRow` spells the
// kind's field from `created_org_id`. What differs by kind stays explicit:
// a league is ONE sport (required, enabled, stamped onto every division
// draft); a club is multi-sport (every division's and every stub's sport
// passes the same gate).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { placeToOrgColumns, isMissingTableError } from '@/lib/orgs/validate';
import { ClubRequestWizardSchema, LeagueRequestWizardSchema } from '@/lib/orgs/wizard-validate';
import { isSportEnabled } from '@/lib/features';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { provisionPendingOrg } from '@/lib/orgs/pending-org';
import { requireOrgCreator } from '@/lib/orgs/org-creator-gate';
import { notifyAdminsOfListingRequest } from '@/lib/orgs/listing-notify';
import { reportRouteError } from '@/lib/observability/report';
import type { OrgKind } from './org-ref';

/** The kind's public name for the org a request created. */
export const CREATED_ORG_FIELD = { league: 'created_league_id', club: 'created_club_id' } as const;

/** An `org_requests` row as the API speaks it: `created_org_id` becomes the
 *  kind's `created_<kind>_id` (what /league/start and /club/start read). */
export function publicRequestRow<T extends { created_org_id?: string | null }>(
  kind: OrgKind,
  row: T
): Omit<T, 'created_org_id'> & { created_league_id?: string | null; created_club_id?: string | null } {
  const { created_org_id, ...rest } = row;
  return { ...rest, [CREATED_ORG_FIELD[kind]]: created_org_id ?? null };
}

const LABEL: Record<OrgKind, string> = { league: 'league', club: 'club' };

type Prepared =
  | { ok: true; insert: Record<string, unknown>; siteDraft: Record<string, unknown>; listing: 'pending' | 'unlisted' }
  | { ok: false; response: NextResponse };

/** The kind's validation and its insert columns (everything but the kind and the status). */
async function prepare(request: NextRequest, kind: OrgKind, userId: string): Promise<Prepared> {
  if (kind === 'league') {
    const parsed = await parseBody(request, LeagueRequestWizardSchema);
    if (!parsed.success) return { ok: false, response: parsed.response };
    const { name, sportKey, description, place, capabilities, structure, connections, siteDraft } = parsed.data;
    if (!isSportEnabled(sportKey as SportKey)) {
      return { ok: false, response: NextResponse.json({ error: `Unknown or disabled sport: ${sportKey}` }, { status: 400 }) };
    }
    // Phase 7 C2: a league's site draft always leads with ITS sport; any extra sports pass the same gate.
    for (const key of siteDraft?.sports ?? []) {
      if (!isSportEnabled(key as SportKey)) {
        return { ok: false, response: NextResponse.json({ error: `Unknown or disabled sport: ${key}` }, { status: 400 }) };
      }
    }
    return {
      ok: true,
      insert: {
        requester_profile_id: userId,
        name,
        description: description ?? null,
        sport_key: sportKey,
        ...placeToOrgColumns(place),
        operates_competitions: capabilities?.operatesCompetitions ?? null,
        operates_teams: capabilities?.operatesTeams ?? null,
        // Server-truth stamp: a league's divisions ARE its sport — client values are untrusted (113).
        structure_draft: structure ? { ...structure, divisions: structure.divisions.map(d => ({ ...d, sportKey })) } : null,
        connections_draft: connections ?? null,
      },
      siteDraft: { ...(siteDraft ?? {}), sports: [sportKey, ...(siteDraft?.sports ?? []).filter(k => k !== sportKey)] },
      listing: siteDraft?.listing === 'unlisted' ? 'unlisted' : 'pending',
    };
  }
  const parsed = await parseBody(request, ClubRequestWizardSchema);
  if (!parsed.success) return { ok: false, response: parsed.response };
  const { name, description, place, capabilities, structure, connections, siteDraft } = parsed.data;
  // Clubs are multi-sport: every distinct division sport must be enabled (113; the schema stays registry-free).
  for (const key of new Set((structure?.divisions ?? []).map(d => d.sportKey))) {
    if (!isSportEnabled(key as SportKey)) {
      return { ok: false, response: NextResponse.json({ error: `Unknown or disabled sport: ${key}` }, { status: 400 }) };
    }
  }
  // Phase 7 C2: the sports the club plays (site_draft) — same gate.
  for (const key of siteDraft?.sports ?? []) {
    if (!isSportEnabled(key as SportKey)) {
      return { ok: false, response: NextResponse.json({ error: `Unknown or disabled sport: ${key}` }, { status: 400 }) };
    }
  }
  // Club-side stubs are LEAGUES (NOT NULL sport) — each needs an enabled sport.
  for (const stub of connections?.stubs ?? []) {
    if (!stub.sportKey || !isSportEnabled(stub.sportKey as SportKey)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: `Each new league needs a sport${stub.sportKey ? `: ${stub.sportKey} is not enabled` : ''}` },
          { status: 400 }
        ),
      };
    }
  }
  return {
    ok: true,
    insert: {
      requester_profile_id: userId,
      name,
      description: description ?? null,
      ...placeToOrgColumns(place), // byte-identical to placeToOrgColumns — step E folds them
      operates_competitions: capabilities?.operatesCompetitions ?? null,
      operates_teams: capabilities?.operatesTeams ?? null,
      structure_draft: structure ?? null,
      connections_draft: connections ?? null,
    },
    siteDraft: siteDraft ?? {},
    listing: siteDraft?.listing === 'unlisted' ? 'unlisted' : 'pending',
  };
}

/** POST — file a request (and provision the pending org behind it). */
export async function orgRequestsPOST(request: NextRequest, kind: OrgKind) {
  const user = await requireActiveWriter(request);
  // Onboarding v2 R0: a supervised athlete never mints an org owner — the guardian starts it.
  const refused = await requireOrgCreator(getSupabaseAdmin(), user.id);
  if (refused) return refused;
  const limited = await enforceRateLimit(request, kind === 'league' ? 'league-request' : 'club-request', { userId: user.id });
  if (limited) return limited;

  const prepared = await prepare(request, kind, user.id);
  if (!prepared.ok) return prepared.response;

  const supabase = getSupabaseAdmin();
  // Onboarding v2 R2 (179): "link only" files a row outside the queue.
  const { data: row, error } = await supabase
    .from('org_requests')
    .insert({ kind, ...prepared.insert, status: prepared.listing, site_draft: prepared.siteDraft })
    .select()
    .single();
  if (error || !row) {
    if (error?.code === '23505') {
      return NextResponse.json({ error: `You already have a ${LABEL[kind]} request waiting for review` }, { status: 409 });
    }
    if (isMissingTableError(error?.code)) {
      // Pre-236 database: the page exists, the table doesn't — 503 keeps that distinct from a real not-found.
      return NextResponse.json({ error: `${kind === 'league' ? 'League' : 'Club'} requests are not available yet` }, { status: 503 });
    }
    reportRouteError(`[${kind.toUpperCase()} REQUESTS] insert error:`, error);
    return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 });
  }

  // Phase 7 C4: build while waiting — the pending org, its owner row, the
  // optional home course and a draft site exist from now.
  const provisioned = await provisionPendingOrg(supabase, kind, row);
  // Onboarding v2 R1: the public default files a listing request — bell the admins.
  if (provisioned && prepared.listing === 'pending') {
    await notifyAdminsOfListingRequest(supabase, { side: kind, orgId: provisioned.orgId, orgName: row.name, requesterId: user.id });
  }
  return NextResponse.json({
    request: publicRequestRow(kind, provisioned ? { ...row, created_org_id: provisioned.orgId } : row),
    orgId: provisioned?.orgId ?? null,
  });
}

/** GET — the caller's own requests of this kind, newest first (powers the
 *  start page's pending / declined / approved states). */
export async function orgRequestsGET(request: NextRequest, kind: OrgKind) {
  const user = await requireAuth(request);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('org_requests')
    .select(
      kind === 'league'
        ? 'id, name, sport_key, description, city, region, country, status, decline_reason, decided_at, created_org_id, created_at'
        : 'id, name, description, city, region, country, status, decline_reason, decided_at, created_org_id, created_at'
    )
    .eq('kind', kind)
    .eq('requester_profile_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    if (isMissingTableError(error.code)) return NextResponse.json({ requests: [] });
    reportRouteError(`[${kind.toUpperCase()} REQUESTS] list error:`, error);
    return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });
  }
  return NextResponse.json({ requests: (data ?? []).map(r => publicRequestRow(kind, r as { created_org_id?: string | null })) });
}

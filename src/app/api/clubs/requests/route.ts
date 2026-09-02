import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { placeToClubColumns, isMissingTableError } from '@/lib/clubs/validate';
import { ClubRequestWizardSchema } from '@/lib/orgs/wizard-validate';
import { isSportEnabled } from '@/lib/features';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { provisionPendingOrg } from '@/lib/orgs/pending-org';

// ── /api/clubs/requests — self-service "Start a club" (117) ─────────────────
// Mirror of /api/leagues/requests, minus sport (clubs are multi-sport by
// decision). The requester is ALWAYS the session user; one pending request
// per user via the partial unique index (23505 → 409).

/** POST — submit a request. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'club-request', { userId: user.id });
    if (limited) return limited;

    const parsed = await parseBody(request, ClubRequestWizardSchema);
    if (!parsed.success) return parsed.response;
    const { name, description, place, capabilities, structure, connections, siteDraft } = parsed.data;

    // Clubs are multi-sport: every distinct division sport must be enabled
    // (the 113 route-gates-sport convention; the schema stays registry-free).
    for (const key of new Set((structure?.divisions ?? []).map(d => d.sportKey))) {
      if (!isSportEnabled(key as SportKey)) {
        return NextResponse.json({ error: `Unknown or disabled sport: ${key}` }, { status: 400 });
      }
    }
    // Phase 7 C2: the sports the club plays (site_draft) — same gate.
    for (const key of siteDraft?.sports ?? []) {
      if (!isSportEnabled(key as SportKey)) {
        return NextResponse.json({ error: `Unknown or disabled sport: ${key}` }, { status: 400 });
      }
    }
    // Club-side stubs are LEAGUES (NOT NULL sport) — each needs an enabled sport.
    for (const stub of connections?.stubs ?? []) {
      if (!stub.sportKey || !isSportEnabled(stub.sportKey as SportKey)) {
        return NextResponse.json(
          { error: `Each new league needs a sport${stub.sportKey ? `: ${stub.sportKey} is not enabled` : ''}` },
          { status: 400 }
        );
      }
    }

    const supabase = getSupabaseAdmin();
    const insertRow = {
      requester_profile_id: user.id,
      name,
      description: description ?? null,
      ...placeToClubColumns(place),
      operates_competitions: capabilities?.operatesCompetitions ?? null,
      operates_teams: capabilities?.operatesTeams ?? null,
      structure_draft: structure ?? null,
      connections_draft: connections ?? null,
    };
    let { data: row, error } = await supabase
      .from('club_requests')
      .insert({ ...insertRow, site_draft: siteDraft ?? {} })
      .select()
      .single();
    if (error?.code === 'PGRST204' && /site_draft/.test(error.message ?? '')) {
      // Pre-174 database: the request still lands; only the site draft is
      // dropped (logged — it is the one thing a deploy-before-migrate loses).
      console.warn('[CLUB REQUESTS] site_draft column missing — run migration 174');
      ({ data: row, error } = await supabase.from('club_requests').insert(insertRow).select().single());
    }
    if (error || !row) {
      if (error?.code === '23505') {
        return NextResponse.json(
          { error: 'You already have a club request waiting for review' },
          { status: 409 }
        );
      }
      if (isMissingTableError(error?.code)) {
        return NextResponse.json({ error: 'Club requests are not available yet' }, { status: 503 });
      }
      console.error('[CLUB REQUESTS] insert error:', error);
      return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 });
    }

    // Phase 7 C4: build while waiting — the pending club, its owner row,
    // the optional home course and a draft site exist from now.
    const provisioned = await provisionPendingOrg(supabase, 'club', row);
    return NextResponse.json({
      request: provisioned ? { ...row, created_club_id: provisioned.orgId } : row,
      orgId: provisioned?.orgId ?? null,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB REQUESTS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** GET — the caller's own requests, newest first. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('club_requests')
      .select('id, name, description, city, region, country, status, decline_reason, decided_at, created_club_id, created_at')
      .eq('requester_profile_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      if (isMissingTableError(error.code)) return NextResponse.json({ requests: [] });
      console.error('[CLUB REQUESTS] list error:', error);
      return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });
    }
    return NextResponse.json({ requests: data ?? [] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB REQUESTS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

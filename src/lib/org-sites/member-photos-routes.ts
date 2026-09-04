// ── Member round photos — the route handlers, both sides (program 12) ──────
// Program 10 M2 built "Share my round photos with this club" for clubs;
// program 12 opens the same layer to leagues (Tom, Sep 3 2026: parity).
// The policy is unchanged either side: the MEMBER opts in on their own
// follow row (a supervised member never can — minors never appear on an
// org site), only photos on their PUBLIC golf round posts are candidates,
// a MANAGER curates the picks, and the site gate re-decides every read.
// Each ROUTE calls `requireAuth` itself and hands the user in (the
// route-authz audit wants the gate visible per route file).

import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { getOrgAndRole, type OrgSide } from '@/lib/orgs/authz';
import { canGrantPhotoConsent, roundPhotoConsentFor, setRoundPhotoConsent } from '@/lib/orgs/photo-consent';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { revalidateOrgSiteForOrg } from './revalidate';
import { listMemberPhotoCandidates } from './member-photos-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

type SessionUser = User; // what requireAuth returns
const PRIVATE = { 'Cache-Control': 'private, no-store' };
const ConsentSchema = z.object({ consent: z.boolean() });

function notFound(side: OrgSide) {
  return NextResponse.json({ error: side === 'league' ? 'League not found' : 'Club not found' }, { status: 404 });
}

/** A member (any role) of the org, plus whether they are supervised. */
async function memberContext(user: SessionUser, side: OrgSide, id: string) {
  if (!UUID_RE.test(id)) return { response: notFound(side) };
  const admin = getSupabaseAdmin();
  const loaded = await getOrgAndRole(admin, side, id, user.id);
  if (loaded.status !== 'found') return { response: notFound(side) };
  if (!loaded.role) return { response: NextResponse.json({ error: 'Members only' }, { status: 403 }) };
  const { data: profile } = await admin.from('profiles').select('supervision_state').eq('id', user.id).maybeSingle();
  return { admin, supervised: profile?.supervision_state === 'supervised' };
}

/** GET /api/{side}s/[id]/photo-consent — the member's own switch. */
export async function photoConsentGET(user: SessionUser, side: OrgSide, params: Promise<{ id: string }>) {
  try {
    const { id } = await params;
    const ctx = await memberContext(user, side, id);
    if ('response' in ctx) return ctx.response;
    const consent = await roundPhotoConsentFor(ctx.admin, side, id, user.id);
    return NextResponse.json({ consent, eligible: !ctx.supervised }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(`[PHOTO CONSENT] ${side} GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/{side}s/[id]/photo-consent {consent} — self only; purges the site. */
export async function photoConsentPATCH(request: NextRequest, user: SessionUser, side: OrgSide, params: Promise<{ id: string }>) {
  try {
    const { id } = await params;
    const ctx = await memberContext(user, side, id);
    if ('response' in ctx) return ctx.response;
    const parsed = await parseBody(request, ConsentSchema);
    if (!parsed.success) return parsed.response;
    if (!canGrantPhotoConsent({ actorIsSelf: true, actorIsGuardian: false, subjectSupervised: ctx.supervised })) {
      return NextResponse.json({ error: `Round photos of a supervised athlete never go on a ${side} site` }, { status: 403 });
    }
    const result = await setRoundPhotoConsent(ctx.admin, side, id, user.id, parsed.data.consent, user.id);
    if (result === 'no_row') return NextResponse.json({ error: 'Members only' }, { status: 403 });
    if (result === 'unavailable') {
      return NextResponse.json({ error: 'Photo consent isn’t set up yet — ask your admin (migration 159)' }, { status: 400 });
    }
    if (result === 'error') return NextResponse.json({ error: 'Failed to update photo sharing' }, { status: 500 });
    await revalidateOrgSiteForOrg(ctx.admin, side, id);
    return NextResponse.json({ consent: parsed.data.consent }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(`[PHOTO CONSENT] ${side} PATCH error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** GET /api/{side}s/[id]/site/photo-candidates — the manager's browse list. */
export async function photoCandidatesGET(user: SessionUser, side: OrgSide, params: Promise<{ id: string }>) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return notFound(side);
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, side, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    const { data: site } = await admin
      .from('org_sites')
      .select('id')
      .eq(side === 'league' ? 'league_id' : 'club_id', id)
      .maybeSingle();
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    const out = await listMemberPhotoCandidates(admin, side, id, site.id as string);
    return NextResponse.json(out, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(`[MEMBER PHOTOS] ${side} candidates GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

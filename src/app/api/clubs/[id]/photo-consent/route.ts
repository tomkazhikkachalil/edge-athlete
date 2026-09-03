import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { getOrgAndRole } from '@/lib/orgs/authz';
import { canGrantPhotoConsent, roundPhotoConsentFor, setRoundPhotoConsent } from '@/lib/orgs/photo-consent';
import { revalidateOrgSiteForOrg } from '@/lib/org-sites/revalidate';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/photo-consent — "Share my round photos with this club"
// (M2, program 10). A MEMBER's own decision on their own follow row —
// self only, never a manager, never a guardian path here (a supervised
// member cannot opt in: minors never appear on a club site, per Tom).
// GET reads the switch; PATCH flips it and purges the site so a revoke
// drops the tiles within the ISR window (the streamer 404s at once).

const Schema = z.object({ consent: z.boolean() });

async function load(request: NextRequest, id: string) {
  const user = await requireAuth(request);
  if (!UUID_RE.test(id)) return { response: NextResponse.json({ error: 'Club not found' }, { status: 404 }) };
  const admin = getSupabaseAdmin();
  const loaded = await getOrgAndRole(admin, 'club', id, user.id);
  if (loaded.status !== 'found') return { response: NextResponse.json({ error: 'Club not found' }, { status: 404 }) };
  if (!loaded.role) return { response: NextResponse.json({ error: 'Members only' }, { status: 403 }) };
  const { data: profile } = await admin.from('profiles').select('supervision_state').eq('id', user.id).maybeSingle();
  const supervised = profile?.supervision_state === 'supervised';
  return { user, admin, supervised };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await load(request, id);
    if ('response' in ctx) return ctx.response;
    const consent = await roundPhotoConsentFor(ctx.admin, 'club', id, ctx.user.id);
    return NextResponse.json({ consent, eligible: !ctx.supervised }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[PHOTO CONSENT] club GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await load(request, id);
    if ('response' in ctx) return ctx.response;
    const parsed = await parseBody(request, Schema);
    if (!parsed.success) return parsed.response;
    if (!canGrantPhotoConsent({ actorIsSelf: true, actorIsGuardian: false, subjectSupervised: ctx.supervised })) {
      return NextResponse.json(
        { error: 'Round photos of a supervised athlete never go on a club site' },
        { status: 403 }
      );
    }
    const result = await setRoundPhotoConsent(ctx.admin, 'club', id, ctx.user.id, parsed.data.consent, ctx.user.id);
    if (result === 'no_row') return NextResponse.json({ error: 'Members only' }, { status: 403 });
    if (result === 'unavailable') {
      return NextResponse.json({ error: 'Photo consent isn’t set up yet — ask your admin (migration 159)' }, { status: 400 });
    }
    if (result === 'error') return NextResponse.json({ error: 'Failed to update photo sharing' }, { status: 500 });
    await revalidateOrgSiteForOrg(ctx.admin, 'club', id);
    return NextResponse.json({ consent: parsed.data.consent }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[PHOTO CONSENT] club PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

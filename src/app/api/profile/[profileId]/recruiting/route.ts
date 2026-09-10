import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerAuth, getProfileRole, getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { resolveProfileAction, type ProfileRole } from '@/lib/profile-roles';
import { canViewProfile } from '@/lib/privacy';
import { notifyGuardians } from '@/lib/guardian-notify';
import {
  RECRUITING_STATUS_LABEL,
  gradYearLabel,
  isRecruitable,
  parseRecruitingStatus,
  type RecruitingProfile,
  type RecruitingStatus,
} from '@/lib/recruiting/profile';
import { RecruitingPatchSchema, parseRecruitingProfile, recruitingPatchToUpdate } from '@/lib/recruiting/schema';

// ── /api/profile/[profileId]/recruiting (Recruiting skeleton R1) ─────────
// THE recruiting read + write. GET is optional-auth: the owner and their
// guardians read everything (canEdit); anyone else reads the card ONLY
// when the status is open/committed AND they may view the profile
// (canViewProfile — public, or an accepted fan of a private one); a closed
// profile answers { status: 'closed' } and nothing else, so the academics
// never leave the server for a closed profile. PATCH is manage_settings —
// owner + guardian, never the supervised profile itself (profile-roles.ts)
// — and bells the OTHER guardians of a supervised athlete (Round H's
// profile_change), excluding the actor. Pre-182 (42703) → supported: false
// / 409.

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const FIELDS = 'id, first_name, visibility, email, supervision_state, school, class_year, recruiting_status, recruiting_profile';

interface Row {
  id: string;
  first_name: string | null;
  visibility: string | null;
  email: string | null;
  supervision_state: string | null;
  school: string | null;
  class_year: number | null;
  recruiting_status: string | null;
  recruiting_profile: unknown;
}

export interface RecruitingRead {
  supported: boolean;
  status: RecruitingStatus;
  statusLabel: string;
  canEdit: boolean;
  /** Present only when the viewer may see the card. */
  school?: string | null;
  gradYear?: number | null;
  gradYearLabel?: string | null;
  profile?: RecruitingProfile;
  recruitable?: boolean;
  supervised?: boolean;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) return NextResponse.json({ error: 'Invalid profile ID' }, { status: 400 });
    const admin = getSupabaseAdmin();
    const { user } = await getServerAuth(request);

    const { data, error } = await admin.from('profiles').select(FIELDS).eq('id', profileId).maybeSingle();
    if (error?.code === '42703') {
      return NextResponse.json({ supported: false, status: 'closed', statusLabel: RECRUITING_STATUS_LABEL.closed, canEdit: false } satisfies RecruitingRead, { headers: NO_STORE });
    }
    if (error) {
      console.error('[recruiting] GET read error:', error);
      return NextResponse.json({ error: 'Failed to load recruiting profile' }, { status: 500 });
    }
    const row = data as unknown as Row | null;
    if (!row) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

    const status = parseRecruitingStatus(row.recruiting_status);
    const isOwner = !!user && user.id === profileId;
    const isGuardian = !!user && !isOwner && (await getProfileRole(user.id, profileId)) === 'guardian';
    const canEdit = isOwner || isGuardian;
    const closedAnswer: RecruitingRead = { supported: true, status: 'closed', statusLabel: RECRUITING_STATUS_LABEL.closed, canEdit };

    if (!canEdit) {
      if (status === 'closed') return NextResponse.json(closedAnswer, { headers: NO_STORE });
      // Private profile: only an accepted fan may read the card.
      if (row.visibility !== 'public') {
        const { canView } = await canViewProfile(profileId, user?.id ?? null);
        if (!canView) return NextResponse.json(closedAnswer, { headers: NO_STORE });
      }
    }

    const body: RecruitingRead = {
      supported: true,
      status,
      statusLabel: RECRUITING_STATUS_LABEL[status],
      canEdit,
      school: row.school,
      gradYear: row.class_year,
      gradYearLabel: gradYearLabel(row.class_year),
      profile: status === 'closed' && !canEdit ? undefined : parseRecruitingProfile(row.recruiting_profile),
      recruitable: isRecruitable({ email: row.email, visibility: row.visibility, recruiting_status: status }),
      supervised: row.supervision_state === 'supervised',
    };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (error) {
    console.error('[recruiting] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) return NextResponse.json({ error: 'Invalid profile ID' }, { status: 400 });
    // manage_settings: the owner (self — a profile_access row is not a given
    // for every account) or a guardian; never the supervised profile itself,
    // never a viewer (profile-roles.ts).
    let actor: { id: string };
    try {
      actor = await requireAuth(request);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }
    const role: ProfileRole | null = actor.id === profileId ? 'owner' : await getProfileRole(actor.id, profileId);
    if (!role || !resolveProfileAction(role, 'manage_settings')) {
      return NextResponse.json({ error: 'You do not have permission to perform this action on this profile' }, { status: 403 });
    }
    const access = { user: actor };
    const parsed = RecruitingPatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid recruiting update' }, { status: 400 });
    if (Object.keys(parsed.data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: current, error: readErr } = await admin.from('profiles').select(FIELDS).eq('id', profileId).maybeSingle();
    if (readErr?.code === '42703') {
      return NextResponse.json({ error: 'Recruiting needs a database migration first (182)' }, { status: 409 });
    }
    if (readErr || !current) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    const row = current as unknown as Row;

    const update = recruitingPatchToUpdate(parsed.data, parseRecruitingProfile(row.recruiting_profile));
    const { error: writeErr } = await admin.from('profiles').update(update).eq('id', profileId);
    if (writeErr) {
      console.error('[recruiting] PATCH write error:', writeErr);
      return NextResponse.json({ error: 'Failed to update recruiting profile' }, { status: 500 });
    }

    // A supervised athlete's recruiting is a guardian decision: every OTHER
    // guardian hears about it (the actor is excluded). Best-effort.
    const before = parseRecruitingStatus(row.recruiting_status);
    const after = update.recruiting_status ? parseRecruitingStatus(update.recruiting_status) : before;
    if (row.supervision_state === 'supervised' && (after !== before || update.school !== undefined || update.recruiting_profile !== undefined)) {
      const childName = row.first_name || 'Your athlete';
      const what = after !== before ? `Recruiting is now "${RECRUITING_STATUS_LABEL[after]}".` : 'Recruiting details changed.';
      await notifyGuardians(admin, profileId, {
        type: 'profile_change',
        title: `${childName}'s recruiting profile changed`,
        message: what,
        actionUrl: `/app/guardian/athlete/${profileId}`,
        actorId: access.user.id,
        metadata: { fields: ['recruiting'] },
      }, access.user.id);
    }

    return NextResponse.json({
      ok: true,
      status: after,
      statusLabel: RECRUITING_STATUS_LABEL[after],
      school: update.school !== undefined ? update.school : row.school,
      profile: update.recruiting_profile ?? parseRecruitingProfile(row.recruiting_profile),
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('[recruiting] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

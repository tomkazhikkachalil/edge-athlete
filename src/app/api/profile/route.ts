import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, requireProfileRole, getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { COPY } from '@/lib/copy';
import {
  IDENTITY_FIELDS,
  diffIdentityFields,
  describeIdentityFields,
} from '@/lib/profile-identity';
import { notifyGuardians } from '@/lib/guardian-notify';
import { derivedNameUpdate, mirrorDob } from '@/lib/profiles/derive-names';
import { revalidatePublicHead } from '@/lib/profiles/public-head';
import { PRIVATE_DETAIL_FIELDS, cleanPrivateDetails } from '@/lib/profiles/private-details';
import { isValidRecordedDate, measurementFromProfileEdit } from '@/lib/body-measurement';
import { reportRouteError } from '@/lib/observability/report';

// Fields stripped for any viewer who is NOT the profile owner: contact
// details plus PII the UI never shows to other users (signup birthday,
// gender, postal code, nickname) — no reason to ship them to the browser.
// recruiting_profile (182) is read through /api/profile/[id]/recruiting,
// where the recruiting gate lives — it never ships from here to a viewer.
const OWNER_ONLY_FIELDS = ['email', 'phone', 'birthday', 'gender', 'postal_code', 'nickname', 'recruiting_profile'] as const;

// Minimal subset for blocked viewers — exactly what PrivateProfileView needs.
const MINIMAL_FIELDS = [
  'id', 'full_name', 'first_name', 'middle_name', 'last_name',
  'avatar_url', 'handle', 'sport', 'school', 'visibility', 'user_type',
] as const;

// user_type values a user may set on their own account. Organization types
// (club, league) will be provisioned through a separate flow.
const SELF_SERVICE_USER_TYPES = ['athlete', 'fan'] as const;

export async function GET(request: NextRequest) {
  try {
    // Auth required — this endpoint returns non-public profile fields.
    // (Anonymous surfaces use /api/public/profile instead.)
    const user = await requireAuth(request);

    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('id');
    
    if (!profileId || !isUuid(profileId)) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Fetch profile data
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', profileId)
      .single();

    if (profileError) {
      reportRouteError('Profile error:', profileError);
      if (profileError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
      }
      return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
    }

    // 238: a departed account is no longer on Edge Athlete — its results
    // stay with the orgs and events, the profile does not.
    if ((profile as { departed_at?: string | null }).departed_at) {
      return NextResponse.json({ error: COPY.ACCOUNT.DEPARTED_PAGE, departed: true }, { status: 404 });
    }

    // season_highlights and performances used to be read here on every
    // profile load — two sequential queries the page never displayed (speed
    // round 2). The keys stay in the answer, empty, for cached clients.

    // Privacy-shape the profile server-side (the browser must never receive
    // fields the viewer isn't entitled to).
    const isOwner = user.id === profileId;
    let shapedProfile: Record<string, unknown> = profile;

    if (!isOwner) {
      const { canView } = await canViewProfile(profileId, user.id);
      if (canView) {
        shapedProfile = { ...profile };
        for (const f of OWNER_ONLY_FIELDS) delete shapedProfile[f];
      } else {
        // Blocked (private profile, not an approved fan): minimal card only
        shapedProfile = {};
        for (const f of MINIMAL_FIELDS) shapedProfile[f] = profile[f] ?? null;
        return NextResponse.json({
          profile: shapedProfile,
          badges: [],
          seasonHighlights: [],
          performances: [],
          // The page used to ask /api/privacy/check for this after the fact;
          // the answer was already here (speed round 2).
          canView: false,
        });
      }
    }

    return NextResponse.json({
      profile: shapedProfile,
      // Deprecated: athlete_badges no longer render anywhere (profile pages
      // read /api/achievements). Kept one release for cached clients.
      badges: [],
      seasonHighlights: [],
      performances: [],
      canView: true,
    });

  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    // Auth required — only the owner may update their profile.
    const user = await requireActiveWriter(request);

    const body = await request.json();
    
    // Validate required fields
    if (!body.profileData) {
      reportRouteError('Profile API: Missing required fields');
      return NextResponse.json({ error: 'Profile data is required' }, { status: 400 });
    }

    const { profileData } = body;

    // Reject spoofed userId (legacy clients send it; it must match the session)
    if (body.userId && body.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Round H ("both edit, guardian notified"): a guardian may edit their
    // managed athlete's profile by passing targetProfileId — the role
    // matrix's first manage_settings call site. Everyone else writes to
    // their own profile only.
    let userId = user.id;
    if (
      typeof body.targetProfileId === 'string' &&
      body.targetProfileId &&
      body.targetProfileId !== user.id
    ) {
      await requireProfileRole(request, body.targetProfileId, 'manage_settings');
      userId = body.targetProfileId;
    }

    // Never mass-assign identity/system fields
    delete profileData.id;
    delete profileData.email;
    delete profileData.created_at;
    delete profileData.updated_at;
    // Handle changes MUST go through /api/handles/update (reserved-name
    // check, format validation, history, rate limiting) — never this route.
    delete profileData.handle;
    delete profileData.handle_updated_at;
    delete profileData.handle_change_count;
    // Avatar changes go through /api/upload/avatar
    delete profileData.avatar_url;
    // Recruiting (182): the status, the academics and a scout's affiliation
    // have their own gated writers — never the batched profile PUT.
    delete profileData.recruiting_status;
    delete profileData.recruiting_profile;
    delete profileData.scout_affiliation;

    // user_type: self-service values only (org types provisioned separately)
    if (profileData.user_type !== undefined &&
        !SELF_SERVICE_USER_TYPES.includes(profileData.user_type)) {
      return NextResponse.json({ error: 'Invalid account type' }, { status: 400 });
    }
    
    // Clean up profileData - convert empty strings to null for optional fields
    const cleanedProfileData = { ...profileData };

    // Convert empty strings to null for date fields
    if (cleanedProfileData.dob === '') {
      cleanedProfileData.dob = null;
    }

    // ONE pre-update read: the supervised/dob_locked gate facts plus the
    // identity fields (Round H needs the old values to diff for the
    // guardian "profile changed" bell) plus what the derived names read
    // (nickname, handle) and what the Vitals timeline diffs against (the
    // stored height / weight) — all baseline columns.
    let oldRow: Record<string, unknown> | null = null;
    {
      // Dynamic select string defeats supabase-js's template-literal query
      // parser — the row shape is asserted instead.
      const { data: fetched } = await supabaseAdmin
        .from('profiles')
        .select(`dob_locked, supervision_state, nickname, handle, height_cm, weight_display, weight_unit, ${IDENTITY_FIELDS.join(', ')}`)
        .eq('id', userId)
        .maybeSingle();
      oldRow = (fetched ?? null) as Record<string, unknown> | null;
    }

    // Guardian-locked fields are never self-service on supervised profiles.
    // Safety posture (visibility, messaging, comment moderation) belongs to
    // the guardian console — a PIN-logged child flipping themselves public
    // would bypass the consent gate the guardian route enforces. DOB
    // additionally locks via dob_locked (an exit from supervision otherwise).
    // Strip, don't 403: profile PUTs are batched edits (the shipped DOB
    // precedent), and the Settings UI renders these read-only for supervised
    // users — the strip is defense against crafted requests. It applies to
    // GUARDIANS too: acting-as edits identity, never safety posture (that
    // stays on PATCH /api/guardian/athletes with its audit trail).
    // user_type is locked too: a supervised child flipping to 'fan' would
    // exit every supervised-athlete code path while keeping the custody rows.
    const SUPERVISED_LOCKED_FIELDS = [
      'visibility', 'messaging_permission', 'comment_moderation', 'dob', 'birthday',
      'user_type',
    ] as const;
    if (oldRow?.supervision_state === 'supervised') {
      for (const f of SUPERVISED_LOCKED_FIELDS) delete cleanedProfileData[f];
      // The private sign-up details (phone, postal code, gender, nickname)
      // are never offered for a supervised profile — strip, same posture.
      for (const f of PRIVATE_DETAIL_FIELDS) delete cleanedProfileData[f];
    } else if (oldRow?.dob_locked) {
      delete cleanedProfileData.dob;
      delete cleanedProfileData.birthday;
    }
    
    // Convert empty strings to null for numeric fields and log weight values
    if (cleanedProfileData.height_cm === '') {
      cleanedProfileData.height_cm = null;
    }
    if (cleanedProfileData.weight_kg === '') {
      cleanedProfileData.weight_kg = null;
    } else if (cleanedProfileData.weight_kg !== undefined) {
    }
    if (cleanedProfileData.class_year === '') {
      cleanedProfileData.class_year = null;
    }
    
    // Convert empty strings to null for optional text fields (keeps them as empty strings if that's intended)
    const optionalFields = [
      'username', 'bio', 'location', 'middle_name', 'social_twitter', 'social_instagram', 'social_facebook', 'social_tiktok',
      // Structured location (108): the picker sends '' to clear when the
      // text no longer describes a picked place.
      'place_id', 'city', 'region', 'region_code', 'country', 'country_code', 'lat', 'lng', 'location_source',
    ];
    optionalFields.forEach(field => {
      if (cleanedProfileData[field] === '') {
        cleanedProfileData[field] = null;
      }
    });
    
    // Keep weight_kg in sync whenever the display weight changes — public
    // surfaces (/u pages, /api/public/profile) read weight_kg, and without
    // this derivation they show stale/no weight after an edit.
    if (cleanedProfileData.weight_display !== undefined) {
      if (cleanedProfileData.weight_display === '' || cleanedProfileData.weight_display === null) {
        cleanedProfileData.weight_display = null;
        cleanedProfileData.weight_kg = null;
      } else {
        const disp = parseFloat(cleanedProfileData.weight_display);
        if (Number.isFinite(disp) && disp > 0) {
          const unit = cleanedProfileData.weight_unit || 'lbs';
          cleanedProfileData.weight_kg =
            unit === 'kg' ? disp
            : unit === 'stone' ? Math.round(disp * 6.35029 * 100) / 100
            : Math.round(disp * 0.453592 * 100) / 100;
        }
      }
    }


    // The private sign-up details: trimmed, '' → null, refused by name when
    // they cannot be stored (the gender CHECK, a length cap).
    const privateDetails = cleanPrivateDetails(cleanedProfileData);
    if (privateDetails.error) {
      return NextResponse.json({ error: privateDetails.error }, { status: 400 });
    }
    Object.assign(cleanedProfileData, privateDetails.update);

    // Height / weight changed in Edit Profile land on the Vitals timeline
    // too (the modal sends its local day as `measured_on`; no other caller
    // does). Appended BEFORE the profile update and removed again if that
    // fails — the body-measurement route's own rule: the chart and Current
    // Vitals never disagree. For the TARGET profile, so a guardian's edit
    // lands on the athlete's timeline.
    const measuredOn =
      typeof body.measured_on === 'string' && isValidRecordedDate(body.measured_on) ? (body.measured_on as string) : null;
    const measurement = measurementFromProfileEdit(cleanedProfileData, oldRow, userId, measuredOn);
    if (measurement.error) {
      return NextResponse.json({ error: measurement.error }, { status: 400 });
    }
    let timelineIds: string[] = [];
    if (measurement.rows.length > 0) {
      const { data: inserted, error: timelineError } = await supabaseAdmin
        .from('athlete_vitals')
        .insert(measurement.rows)
        .select('id');
      if (timelineError || !inserted) {
        reportRouteError('Profile API: vitals timeline insert error:', timelineError);
        return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
      }
      timelineIds = inserted.map(row => row.id as string);
    }

    // One value, two columns: a `dob` that survived the strip above is
    // written to `birthday` too (org eligibility reads that one).
    Object.assign(cleanedProfileData, mirrorDob(cleanedProfileData));

    // The derived names follow every name write — never the client's copy
    // of full_name (the modal used to send the LOADED one back, which is how
    // a renamed athlete kept the old name across the app).
    Object.assign(cleanedProfileData, derivedNameUpdate(cleanedProfileData, oldRow));

    // Update profile in database using admin client
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(cleanedProfileData)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      // Nothing was saved — take the timeline rows back out.
      if (timelineIds.length > 0) {
        await supabaseAdmin.from('athlete_vitals').delete().in('id', timelineIds);
      }
      reportRouteError('Profile API: Database error:', error);
      reportRouteError('Profile API: Error details:', JSON.stringify(error, null, 2));
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }

    // Round H: identity edits on a supervised profile bell the guardians —
    // the changed-field list rides the metadata (NOT safety_settings_audit;
    // 095's field CHECK admits only the three safety fields). One code path:
    // the actor is excluded, so a child's self-edit reaches all guardians and
    // a guardian's acting-as edit reaches co-guardians only. Best-effort.
    if (oldRow?.supervision_state === 'supervised') {
      const changedFields = diffIdentityFields(oldRow, cleanedProfileData);
      if (changedFields.length > 0) {
        const childName = (data?.first_name as string) || 'Your athlete';
        await notifyGuardians(supabaseAdmin, userId, {
          type: 'profile_change',
          title: `${childName}'s profile details changed`,
          message: `Updated: ${describeIdentityFields(changedFields)}.`,
          actionUrl: `/athlete/${userId}`,
          actorId: user.id,
          metadata: { fields: changedFields },
        }, user.id);
      }
    }

    // The /u/ page's <head> (name, bio, sport, visibility) is cached per handle.
    revalidatePublicHead(data?.handle as string | null | undefined);

    const response = {
      success: true,
      profile: data,
      message: 'Profile updated successfully'
    };
    return NextResponse.json(response);

  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Profile API: Unexpected error:', error);
    reportRouteError('Profile API: Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
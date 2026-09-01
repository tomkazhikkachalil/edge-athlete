// ── Registration — the shared core (phase 5 R2, migs 161+162) ───────────────
// The family-initiated path onto an org roster, and the registrar's
// workflow over it. Authority model (the settled design): the ORG-SCOPE
// MEMBERSHIP row carries the lifecycle (status + season_id, mig 161);
// `registrations` is the submission record (offering, submitted_by,
// answers, eligibility snapshot) and has NO status column — one
// authority, no drift. Both rows are written by ONE function here, in
// order, with a compensating delete (the roster-import multi-write
// precedent); they are mutated only by this module's transitions.
//
// SAFETY (unconditional — the flag is a surface switch only):
//  * A SUPERVISED athlete never self-registers on any path; a guardian
//    registers acting-for (route-vouched via requireProfileRole).
//  * MEDICAL NOTES (answers.medicalNotes) are served ONLY by
//    registrationsGET behind the manage_registration gate — never member
//    previews, never athlete-facing echoes beyond the family's own
//    submission, never any public surface.
//  * A missing registration_windows table — or no open window — reads as
//    CLOSED. Absence never opens anything.
//  * One live workflow per athlete per org: the collision matrix below
//    (invite-wins, Tom's call).

import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { revalidateOrgSiteForOrg } from '@/lib/org-sites/revalidate';
import {
  isMissingTableError,
  isWindowOpen,
  type RegistrationCreateInput,
  type RegistrationTransitionInput,
  type WindowCreateInput,
} from '@/lib/registration/validate';
import { eligibilityWarnings, type EligibilityWarning } from './eligibility';
import { getOrgAndRole, roleAllows, type OrgSide } from './authz';
import { membershipEdges, type RosterEdge } from './members';
import { canGrantPhotoConsent, setPhotoConsent } from './photo-consent';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[REGISTRATION]';

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

/** The registrar gate — requireCompetitionManager's shape on the
 *  'manage_registration' intent. */
export async function requireRegistrar(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string
): Promise<{ ok: true; org: { id: string; name: string } } | { ok: false; response: NextResponse }> {
  const loaded = await getOrgAndRole(admin, side, orgId, user.id);
  if (loaded.status === 'error') {
    console.error(`${TAG} org fetch error:`, loaded.error);
    return {
      ok: false,
      response: NextResponse.json({ error: 'Failed to load organization' }, { status: 500 }),
    };
  }
  if (loaded.status === 'not_found') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: side === 'league' ? 'League not found' : 'Club not found' },
        { status: 404 }
      ),
    };
  }
  if (!roleAllows(loaded.role, 'manage_registration')) {
    return { ok: false, response: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  }
  return { ok: true, org: { id: loaded.org.id, name: loaded.org.name } };
}

/** The collision matrix (pure — invite-wins, Tom's call). */
export function registrationCollision(
  edges: RosterEdge[],
  seasonId: string
): 'ok' | 'pending_invite' | 'already_this_season' {
  if (edges.some(e => e.seasonId === seasonId)) return 'already_this_season';
  if (edges.some(e => e.seasonId === null && e.status === 'pending')) return 'pending_invite';
  // A NULL-season 'active' row (legacy membership) coexists: the season
  // row records this season's lifecycle.
  return 'ok';
}

interface WindowRow {
  id: string;
  season_id: string;
  division_id: string | null;
  program_id: string | null;
  opens_at: string;
  closes_at: string | null;
  capacity: number | null;
}

/** The window governing one offering: offering-specific first, then the
 *  season-wide (both NULL) fallback. Null = registration closed. */
export function applicableWindow(
  windows: WindowRow[],
  offering: { divisionId?: string; programId?: string }
): WindowRow | null {
  const specific = windows.find(
    w =>
      (offering.divisionId && w.division_id === offering.divisionId) ||
      (offering.programId && w.program_id === offering.programId)
  );
  if (specific) return specific;
  return windows.find(w => w.division_id === null && w.program_id === null) ?? null;
}

async function loadSeasonForOrg(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  seasonId: string
): Promise<{ id: string; starts_on: string | null } | null> {
  const { data } = await admin
    .from('seasons')
    .select('id, starts_on')
    .eq('id', seasonId)
    .eq(orgColumn(side), orgId)
    .maybeSingle();
  return (data as { id: string; starts_on: string | null } | null) ?? null;
}

// ── The family submit ───────────────────────────────────────────────────────

export async function registrationCreatePOST(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string,
  input: RegistrationCreateInput,
  actingFor?: string
): Promise<NextResponse> {
  const target = actingFor ?? user.id;
  const guardianActing = target !== user.id;

  // Org + season + offering resolution (foreign rows 404 indistinguishably).
  const org = await getOrgAndRole(admin, side, orgId, target);
  if (org.status === 'error') {
    return NextResponse.json({ error: 'Failed to load organization' }, { status: 500 });
  }
  if (org.status === 'not_found') {
    return NextResponse.json(
      { error: side === 'league' ? 'League not found' : 'Club not found' },
      { status: 404 }
    );
  }
  const season = await loadSeasonForOrg(admin, side, orgId, input.seasonId);
  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 });

  let division: { id: string; age_band: string | null; gender_stream: string | null } | null = null;
  if (input.divisionId) {
    const { data } = await admin
      .from('divisions')
      .select('id, season_id, age_band, gender_stream')
      .eq('id', input.divisionId)
      .eq('season_id', input.seasonId)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: 'Division not found' }, { status: 404 });
    division = data as unknown as { id: string; age_band: string | null; gender_stream: string | null };
  }
  if (input.programId) {
    const { data, error } = await admin
      .from('programs')
      .select('id, season_id')
      .eq('id', input.programId)
      .eq('season_id', input.seasonId)
      .maybeSingle();
    if (error && isMissingTableError(error.code)) {
      return NextResponse.json({ error: 'Program not found' }, { status: 404 });
    }
    if (!data) return NextResponse.json({ error: 'Program not found' }, { status: 404 });
  }

  // The window gate: no table, no window, or a closed window = CLOSED.
  const { data: windowRows, error: windowsError } = await admin
    .from('registration_windows')
    .select('id, season_id, division_id, program_id, opens_at, closes_at, capacity')
    .eq(orgColumn(side), orgId)
    .eq('season_id', input.seasonId);
  if (windowsError && !isMissingTableError(windowsError.code)) {
    console.error(`${TAG} windows read error:`, windowsError);
  }
  const nowIso = new Date().toISOString();
  const window = applicableWindow((windowRows ?? []) as WindowRow[], input);
  if (!window || !isWindowOpen(window, nowIso)) {
    return NextResponse.json({ error: 'Registration is closed' }, { status: 409 });
  }
  if (window.capacity !== null) {
    const { count } = await admin
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .eq(orgColumn(side), orgId)
      .eq('season_id', input.seasonId)
      .is('withdrawn_at', null);
    if ((count ?? 0) >= window.capacity) {
      return NextResponse.json({ error: 'Registration is full' }, { status: 409 });
    }
  }

  // The supervised gate — unconditional, never flag-dependent.
  const { data: profile } = await admin
    .from('profiles')
    .select('id, supervision_state, birthday, gender')
    .eq('id', target)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
  const supervised = profile.supervision_state === 'supervised';
  if (supervised && !guardianActing) {
    return NextResponse.json(
      { error: 'A guardian registers a supervised athlete — ask them to register you' },
      { status: 403 }
    );
  }

  // Optional birthday capture (powers the eligibility check) — the actor
  // is self-or-guardian by construction here, both may set an absent DOB.
  let birthday = (profile.birthday as string | null) ?? null;
  if (!birthday && input.birthday) {
    const { error: dobError } = await admin
      .from('profiles')
      .update({ birthday: input.birthday })
      .eq('id', target)
      .is('birthday', null);
    if (!dobError) birthday = input.birthday;
  }

  // Collision matrix (invite-wins).
  const { rosterEdges, followRole, error: edgesError } = await membershipEdges(
    admin,
    { side, orgId },
    target
  );
  if (edgesError) {
    console.error(`${TAG} edges read error:`, edgesError);
    return NextResponse.json({ error: 'Failed to check membership' }, { status: 500 });
  }
  const collision = registrationCollision(rosterEdges, input.seasonId);
  if (collision === 'pending_invite') {
    return NextResponse.json(
      { error: 'You have a pending roster invite from this organization — accept or decline it first' },
      { status: 409 }
    );
  }
  if (collision === 'already_this_season') {
    return NextResponse.json({ error: 'Already registered for this season' }, { status: 409 });
  }

  // Eligibility — warn, never block; snapshotted below.
  const warnings: EligibilityWarning[] = eligibilityWarnings({
    division,
    athlete: { birthday, gender: (profile.gender as string | null) ?? null },
    seasonStartsOn: season.starts_on,
  });

  // ── The writes: follow → org-roster → registrations (compensated) ────────
  // Roster ⊆ follow: mint the follow row when absent (the roster-import
  // precedent; single-row inserts only — the homogeneous-keys rule).
  if (!followRole) {
    const { error: followError } = await admin.from('memberships').insert({
      [orgColumn(side)]: orgId,
      profile_id: target,
    });
    if (followError && followError.code !== '23505') {
      console.error(`${TAG} follow insert error:`, followError);
      return NextResponse.json({ error: 'Failed to join the organization' }, { status: 500 });
    }
  }

  const { error: rosterError } = await admin.from('memberships').insert({
    [orgColumn(side)]: orgId,
    profile_id: target,
    kind: 'roster',
    status: 'registered',
    scope_type: 'org',
    season_id: input.seasonId,
  });
  if (rosterError) {
    if (rosterError.code === '23514') {
      return NextResponse.json(
        { error: 'Registration isn’t set up yet — ask your admin (migration 161)' },
        { status: 400 }
      );
    }
    if (rosterError.code === '23505') {
      return NextResponse.json({ error: 'Already registered for this season' }, { status: 409 });
    }
    console.error(`${TAG} roster insert error:`, rosterError);
    return NextResponse.json({ error: 'Failed to register' }, { status: 500 });
  }

  const { data: registration, error: regError } = await admin
    .from('registrations')
    .insert({
      [orgColumn(side)]: orgId,
      profile_id: target,
      season_id: input.seasonId,
      division_id: input.divisionId ?? null,
      program_id: input.programId ?? null,
      submitted_by: user.id,
      answers: input.answers,
      eligibility: warnings.length ? { warnings } : null,
    })
    .select('id, season_id, division_id, program_id, created_at')
    .single();
  if (regError || !registration) {
    // Compensate: a lifecycle row without its submission record would be
    // unmanageable — remove exactly the row just minted.
    await admin
      .from('memberships')
      .delete()
      .eq(orgColumn(side), orgId)
      .eq('profile_id', target)
      .eq('kind', 'roster')
      .eq('scope_type', 'org')
      .eq('season_id', input.seasonId);
    if (regError && isMissingTableError(regError.code)) {
      return NextResponse.json(
        { error: 'Registration isn’t set up yet — ask your admin (migration 162)' },
        { status: 400 }
      );
    }
    if (regError?.code === '23505') {
      return NextResponse.json({ error: 'Already registered for this offering' }, { status: 409 });
    }
    console.error(`${TAG} registration insert error:`, regError);
    return NextResponse.json({ error: 'Failed to register' }, { status: 500 });
  }

  // Photo consent at registration (the 159 contract): written only when
  // the actor holds the authority; otherwise NULL → the guardian queue
  // asks. Best-effort — the registration already succeeded.
  let photoConsentRecorded = false;
  if (
    input.photoConsent !== undefined &&
    canGrantPhotoConsent({
      actorIsSelf: !guardianActing,
      actorIsGuardian: guardianActing,
      subjectSupervised: supervised,
    })
  ) {
    photoConsentRecorded =
      (await setPhotoConsent(admin, side, orgId, target, input.photoConsent, user.id)) === 'ok';
  }

  return NextResponse.json({
    registration,
    status: 'registered',
    warnings,
    photoConsentRecorded,
  });
}

// ── The registrar list ──────────────────────────────────────────────────────

/** Everything the registrar screen needs. THE ONLY PLACE answers (incl.
 *  medical notes) are served — behind requireRegistrar in the routes. */
export async function registrationsGET(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  seasonId: string | null
): Promise<NextResponse> {
  let query = admin
    .from('registrations')
    .select(
      'id, profile_id, season_id, division_id, program_id, submitted_by, answers, eligibility, created_at, withdrawn_at, released_at, released_reason'
    )
    .eq(orgColumn(side), orgId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (seasonId) query = query.eq('season_id', seasonId);
  const { data: rows, error } = await query;
  if (error) {
    if (isMissingTableError(error.code)) {
      return NextResponse.json({ registrations: [], available: false });
    }
    console.error(`${TAG} list error:`, error);
    return NextResponse.json({ error: 'Failed to load registrations' }, { status: 500 });
  }

  const profileIds = [...new Set((rows ?? []).map(r => r.profile_id as string))];
  const seasonIds = [...new Set((rows ?? []).map(r => r.season_id as string))];
  const [profileRes, membershipRes, divisionRes, programRes] = await Promise.all([
    profileIds.length
      ? admin
          .from('profiles')
          .select('id, first_name, last_name, full_name, birthday, supervision_state')
          .in('id', profileIds)
      : Promise.resolve({ data: [] }),
    profileIds.length
      ? admin
          .from('memberships')
          .select('profile_id, status, season_id')
          .eq(orgColumn(side), orgId)
          .eq('kind', 'roster')
          .eq('scope_type', 'org')
          .in('profile_id', profileIds)
          .in('season_id', seasonIds.length ? seasonIds : ['00000000-0000-4000-8000-000000000000'])
      : Promise.resolve({ data: [] }),
    admin.from('divisions').select('id, name').in('season_id', seasonIds.length ? seasonIds : []),
    seasonIds.length
      ? admin.from('programs').select('id, name').in('season_id', seasonIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const names = new Map(
    ((profileRes.data ?? []) as Array<Record<string, unknown>>).map(p => [
      p.id as string,
      {
        // Registrar sees personal data by charter (masterplan §5) — the
        // real name, plus what placement needs.
        displayName:
          ((p.full_name as string | null) ||
            `${(p.first_name as string | null) ?? ''} ${(p.last_name as string | null) ?? ''}`.trim()) ||
          'Athlete',
        birthday: (p.birthday as string | null) ?? null,
        supervised: p.supervision_state === 'supervised',
      },
    ])
  );
  const statusByProfileSeason = new Map(
    ((membershipRes.data ?? []) as Array<Record<string, unknown>>).map(m => [
      `${m.profile_id}:${m.season_id}`,
      m.status as string,
    ])
  );
  const divisionNames = new Map(
    ((divisionRes.data ?? []) as Array<{ id: string; name: string }>).map(d => [d.id, d.name])
  );
  const programNames = new Map(
    (('error' in programRes && programRes.error) ? [] : ((programRes.data ?? []) as Array<{ id: string; name: string }>)).map(
      p => [p.id, p.name]
    )
  );

  return NextResponse.json({
    available: true,
    registrations: (rows ?? []).map(r => ({
      id: r.id,
      profileId: r.profile_id,
      athlete: names.get(r.profile_id as string) ?? {
        displayName: 'Athlete',
        birthday: null,
        supervised: false,
      },
      seasonId: r.season_id,
      divisionId: r.division_id,
      divisionName: r.division_id ? (divisionNames.get(r.division_id as string) ?? null) : null,
      programId: r.program_id,
      programName: r.program_id ? (programNames.get(r.program_id as string) ?? null) : null,
      status: r.withdrawn_at
        ? 'withdrawn'
        : (statusByProfileSeason.get(`${r.profile_id}:${r.season_id}`) ?? 'released'),
      answers: r.answers,
      eligibility: r.eligibility,
      createdAt: r.created_at,
      releasedAt: r.released_at,
      releasedReason: r.released_reason,
    })),
  });
}

// ── Transitions ─────────────────────────────────────────────────────────────

/** evaluate | place | release (registrar) and withdraw (the family).
 *  Callers pass `registrar` = the requireRegistrar verdict for this user;
 *  withdraw ignores it and authorizes as self-or-guardian instead. */
export async function registrationTransitionPATCH(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string,
  registrationId: string,
  input: RegistrationTransitionInput,
  opts: { isRegistrar: boolean; actingFor?: string }
): Promise<NextResponse> {
  const { data: reg, error: regError } = await admin
    .from('registrations')
    .select('id, profile_id, season_id, division_id, program_id, withdrawn_at')
    .eq('id', registrationId)
    .eq(orgColumn(side), orgId)
    .maybeSingle();
  if (regError && isMissingTableError(regError.code)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!reg) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (reg.withdrawn_at) {
    return NextResponse.json({ error: 'This registration was withdrawn' }, { status: 400 });
  }

  const membershipQuery = () =>
    admin
      .from('memberships')
      .select('id, status')
      .eq(orgColumn(side), orgId)
      .eq('profile_id', reg.profile_id)
      .eq('kind', 'roster')
      .eq('scope_type', 'org')
      .eq('season_id', reg.season_id)
      .maybeSingle();

  if (input.action === 'withdraw') {
    // Family-initiated, while still registered/evaluating. The route
    // vouches acting-for; here we just require the actor to BE the family.
    const target = opts.actingFor ?? user.id;
    if (target !== reg.profile_id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    const { data: membership } = await membershipQuery();
    const status = (membership?.status as string | null) ?? null;
    if (status !== 'registered' && status !== 'evaluating') {
      return NextResponse.json(
        { error: 'Placed registrations are withdrawn by the organization' },
        { status: 400 }
      );
    }
    await admin.from('memberships').delete().eq('id', membership!.id);
    await admin
      .from('registrations')
      .update({ withdrawn_at: new Date().toISOString() })
      .eq('id', registrationId);
    return NextResponse.json({ action: 'withdrawn' });
  }

  // evaluate / place / release are registrar acts.
  if (!opts.isRegistrar) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  const { data: membership } = await membershipQuery();
  if (!membership) {
    return NextResponse.json({ error: 'No live registration for this athlete' }, { status: 404 });
  }
  const status = membership.status as string;

  if (input.action === 'evaluate') {
    if (status !== 'registered') {
      return NextResponse.json({ error: `Can’t evaluate from “${status}”` }, { status: 400 });
    }
    await admin.from('memberships').update({ status: 'evaluating' }).eq('id', membership.id);
    return NextResponse.json({ action: 'evaluating' });
  }

  if (input.action === 'place') {
    if (!input.teamId) {
      return NextResponse.json({ error: 'Pick a team to place onto' }, { status: 400 });
    }
    if (status !== 'registered' && status !== 'evaluating') {
      return NextResponse.json({ error: `Can’t place from “${status}”` }, { status: 400 });
    }
    const { data: team } = await admin
      .from('teams')
      .select('id, status')
      .eq('id', input.teamId)
      .eq(orgColumn(side), orgId)
      .maybeSingle();
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    if (team.status !== 'active') {
      return NextResponse.json({ error: 'That team is archived' }, { status: 400 });
    }
    // Two single-row writes (never a heterogeneous batch): the team-scope
    // roster row — THE attribution edge phases 2–4 read — then the flip.
    const { error: teamRowError } = await admin.from('memberships').insert({
      [orgColumn(side)]: orgId,
      profile_id: reg.profile_id,
      kind: 'roster',
      status: 'active',
      scope_type: 'team',
      scope_id: input.teamId,
      season_id: reg.season_id,
    });
    if (teamRowError && teamRowError.code !== '23505') {
      console.error(`${TAG} team row insert error:`, teamRowError);
      return NextResponse.json({ error: 'Failed to place' }, { status: 500 });
    }
    await admin.from('memberships').update({ status: 'placed' }).eq('id', membership.id);
    // Placed athletes appear on public team rosters — purge the site.
    await revalidateOrgSiteForOrg(admin, side, orgId);
    return NextResponse.json({ action: 'placed', teamId: input.teamId });
  }

  // release
  if (status !== 'registered' && status !== 'evaluating' && status !== 'placed') {
    return NextResponse.json({ error: `Can’t release from “${status}”` }, { status: 400 });
  }
  await admin.from('memberships').update({ status: 'released' }).eq('id', membership.id);
  await admin
    .from('memberships')
    .delete()
    .eq(orgColumn(side), orgId)
    .eq('profile_id', reg.profile_id)
    .eq('kind', 'roster')
    .eq('scope_type', 'team')
    .eq('season_id', reg.season_id);
  await admin
    .from('registrations')
    .update({
      released_at: new Date().toISOString(),
      released_by: user.id,
      released_reason: input.reason ?? null,
    })
    .eq('id', registrationId);
  await revalidateOrgSiteForOrg(admin, side, orgId);
  return NextResponse.json({ action: 'released' });
}

// ── Windows ─────────────────────────────────────────────────────────────────

export async function windowsGET(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<NextResponse> {
  const { data, error } = await admin
    .from('registration_windows')
    .select('id, season_id, division_id, program_id, opens_at, closes_at, capacity')
    .eq(orgColumn(side), orgId)
    .order('opens_at', { ascending: false })
    .limit(100);
  if (error) {
    if (isMissingTableError(error.code)) return NextResponse.json({ windows: [], available: false });
    console.error(`${TAG} windows list error:`, error);
    return NextResponse.json({ error: 'Failed to load windows' }, { status: 500 });
  }
  return NextResponse.json({ windows: data ?? [], available: true });
}

export async function windowCreatePOST(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  input: WindowCreateInput,
  createdBy: string
): Promise<NextResponse> {
  const season = await loadSeasonForOrg(admin, side, orgId, input.seasonId);
  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 });
  const { data: window, error } = await admin
    .from('registration_windows')
    .insert({
      [orgColumn(side)]: orgId,
      season_id: input.seasonId,
      division_id: input.divisionId ?? null,
      program_id: input.programId ?? null,
      opens_at: input.opensAt,
      closes_at: input.closesAt ?? null,
      capacity: input.capacity ?? null,
      created_by: createdBy,
    })
    .select('id, season_id, division_id, program_id, opens_at, closes_at, capacity')
    .single();
  if (error || !window) {
    if (error && isMissingTableError(error.code)) {
      return NextResponse.json(
        { error: 'Registration isn’t set up yet — ask your admin (migration 162)' },
        { status: 400 }
      );
    }
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: 'A window for that offering already exists — delete it first' },
        { status: 409 }
      );
    }
    console.error(`${TAG} window insert error:`, error);
    return NextResponse.json({ error: 'Failed to open registration' }, { status: 500 });
  }
  // The public-site Register card reads windows (R5) — purge on change.
  await revalidateOrgSiteForOrg(admin, side, orgId);
  return NextResponse.json({ window });
}

export async function windowDELETE(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  windowId: string
): Promise<NextResponse> {
  const { data: deleted, error } = await admin
    .from('registration_windows')
    .delete()
    .eq('id', windowId)
    .eq(orgColumn(side), orgId)
    .select('id');
  if (error) {
    if (isMissingTableError(error.code)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    console.error(`${TAG} window delete error:`, error);
    return NextResponse.json({ error: 'Failed to close registration' }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await revalidateOrgSiteForOrg(admin, side, orgId);
  return NextResponse.json({ action: 'deleted' });
}

// ── The viewer's registration state (the org-page banner) ───────────────────

export interface ViewerRegistration {
  seasonId: string;
  status: string;
  divisionId: string | null;
  programId: string | null;
  teamName: string | null;
}

/** What the league/club page banner needs: is ANY window open right now
 *  (the CTA), and the viewer's current-season registration if they have
 *  one. Flag-off or pre-162 reads as closed/none — surface hidden. */
export async function viewerRegistrationSummary(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  viewerId: string | null,
  flagOn: boolean
): Promise<{ windowOpen: boolean; current: ViewerRegistration | null }> {
  if (!flagOn) return { windowOpen: false, current: null };
  const nowIso = new Date().toISOString();
  const { data: windowRows, error: windowsError } = await admin
    .from('registration_windows')
    .select('id, season_id, division_id, program_id, opens_at, closes_at, capacity')
    .eq(orgColumn(side), orgId)
    .limit(100);
  const windows = windowsError ? [] : ((windowRows ?? []) as WindowRow[]);
  const windowOpen = windows.some(w => isWindowOpen(w, nowIso));
  if (!viewerId) return { windowOpen, current: null };

  const { data: seasonRows } = await admin
    .from('memberships')
    .select('status, season_id, joined_at')
    .eq(orgColumn(side), orgId)
    .eq('profile_id', viewerId)
    .eq('kind', 'roster')
    .eq('scope_type', 'org')
    .not('season_id', 'is', null)
    .order('joined_at', { ascending: false })
    .limit(1);
  const row = (seasonRows ?? [])[0] as
    | { status: string; season_id: string; joined_at: string }
    | undefined;
  if (!row) return { windowOpen, current: null };

  const { data: reg } = await admin
    .from('registrations')
    .select('division_id, program_id')
    .eq(orgColumn(side), orgId)
    .eq('profile_id', viewerId)
    .eq('season_id', row.season_id)
    .is('withdrawn_at', null)
    .limit(1)
    .maybeSingle();

  let teamName: string | null = null;
  if (row.status === 'placed') {
    const { data: teamRow } = await admin
      .from('memberships')
      .select('scope_id')
      .eq(orgColumn(side), orgId)
      .eq('profile_id', viewerId)
      .eq('kind', 'roster')
      .eq('scope_type', 'team')
      .eq('season_id', row.season_id)
      .limit(1)
      .maybeSingle();
    if (teamRow?.scope_id) {
      const { data: team } = await admin
        .from('teams')
        .select('name, display_name')
        .eq('id', teamRow.scope_id as string)
        .maybeSingle();
      teamName = ((team?.display_name as string | null) || (team?.name as string | null)) ?? null;
    }
  }

  return {
    windowOpen,
    current: {
      seasonId: row.season_id,
      status: row.status,
      divisionId: (reg?.division_id as string | null) ?? null,
      programId: (reg?.program_id as string | null) ?? null,
      teamName,
    },
  };
}

// ── Offerings — the family/public projection ────────────────────────────────

/** Viewer-independent: what can be registered for right now. Shared by
 *  the wizard (session route) and R5's public card (cached reader). NO
 *  personal data, NO answers — safe anywhere. */
export async function offeringsGET(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<NextResponse> {
  const { data: seasons, error: seasonsError } = await admin
    .from('seasons')
    .select('id, label, starts_on, ends_on')
    .eq(orgColumn(side), orgId)
    .order('starts_on', { ascending: false, nullsFirst: false })
    .limit(6);
  if (seasonsError || !seasons || seasons.length === 0) {
    return NextResponse.json({ seasons: [] });
  }
  const seasonIds = seasons.map(s => s.id as string);
  const [divisionsRes, programsRes, windowsRes] = await Promise.all([
    admin
      .from('divisions')
      .select('id, season_id, name, age_band, gender_stream, tier')
      .in('season_id', seasonIds)
      .order('name', { ascending: true })
      .limit(300),
    admin
      .from('programs')
      .select('id, season_id, name, type')
      .in('season_id', seasonIds)
      .order('name', { ascending: true })
      .limit(300),
    admin
      .from('registration_windows')
      .select('id, season_id, division_id, program_id, opens_at, closes_at, capacity')
      .eq(orgColumn(side), orgId)
      .in('season_id', seasonIds)
      .limit(200),
  ]);
  const nowIso = new Date().toISOString();
  const windows = (windowsRes.error ? [] : ((windowsRes.data ?? []) as WindowRow[]));
  const divisions = divisionsRes.error ? [] : (divisionsRes.data ?? []);
  const programs = programsRes.error ? [] : (programsRes.data ?? []);

  const openFor = (seasonId: string, offering: { divisionId?: string; programId?: string }) => {
    const w = applicableWindow(windows.filter(x => x.season_id === seasonId), offering);
    return !!w && isWindowOpen(w, nowIso);
  };

  return NextResponse.json({
    seasons: seasons.map(s => ({
      id: s.id,
      label: s.label,
      startsOn: s.starts_on,
      endsOn: s.ends_on,
      divisions: divisions
        .filter(d => d.season_id === s.id)
        .map(d => ({
          id: d.id,
          name: d.name,
          ageBand: d.age_band,
          genderStream: d.gender_stream,
          tier: d.tier,
          open: openFor(s.id as string, { divisionId: d.id as string }),
        })),
      programs: programs
        .filter(p => p.season_id === s.id)
        .map(p => ({
          id: p.id,
          name: p.name,
          type: p.type,
          open: openFor(s.id as string, { programId: p.id as string }),
        })),
    })),
  });
}

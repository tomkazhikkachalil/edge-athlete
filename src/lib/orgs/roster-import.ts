// ── Roster import (phase 1 R3) — parser + mint orchestration ────────────────
// CHARTER: sub-org membership WRITERS live in this module, not members.ts
// (its charter pins scope_type='org'). importRoster is the FIRST sub-org
// membership writer: each row mints org follow + org roster(active) +
// TEAM-scoped roster(active). Per-row BEST-EFFORT with a report (the
// wizard-replay shape); a failed row compensates its own writes.
//
// Line format: `First Last[, email]` — split on the FIRST comma (names may
// not contain commas; emails may not either, per RFC practice we accept).
// The name splits on whitespace: first token = first name, the remainder
// joined = last name (nullable — display falls back fine, handle stays
// NULL). Bad lines land in `errors`, never abort the batch.

export interface RosterImportRow {
  firstName: string;
  lastName: string | null;
  email: string | null;
}

export interface RosterImportParse {
  rows: RosterImportRow[];
  errors: Array<{ line: number; text: string; reason: string }>;
}

const LOOSE_EMAIL = /^\S+@\S+\.\S+$/;

export function parseRosterImport(text: string): RosterImportParse {
  const rows: RosterImportRow[] = [];
  const errors: RosterImportParse['errors'] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const commaAt = line.indexOf(',');
    const namePart = (commaAt === -1 ? line : line.slice(0, commaAt)).trim();
    const emailPart = commaAt === -1 ? '' : line.slice(commaAt + 1).trim();
    if (!namePart) {
      errors.push({ line: i + 1, text: raw, reason: 'Missing name' });
      return;
    }
    if (namePart.length > 120) {
      errors.push({ line: i + 1, text: raw, reason: 'Name too long' });
      return;
    }
    let email: string | null = null;
    if (emailPart) {
      if (!LOOSE_EMAIL.test(emailPart) || emailPart.length > 255) {
        errors.push({ line: i + 1, text: raw, reason: 'Invalid email' });
        return;
      }
      email = emailPart.toLowerCase();
    }
    const nameTokens = namePart.split(/\s+/);
    rows.push({
      firstName: nameTokens[0],
      lastName: nameTokens.length > 1 ? nameTokens.slice(1).join(' ') : null,
      email,
    });
  });
  return { rows, errors };
}


// ── Orchestration (PR-B) ────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { createAthleteClaimInvite } from '@/lib/athlete-claim';
import { makeStubEmail, isStubEmail, STUB_EMAIL_DOMAIN } from '@/lib/config/stubs-config';
import type { OrgSide } from './authz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface ImportReportRow {
  name: string;
  profileId: string | null;
  claimUrl: string | null;
  emailSent: boolean;
  error?: string;
}

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

/** Import a pasted roster into ONE team: per row, a stub profile (shadow
 *  auth user + create_stub_profile RPC) + THREE membership rows (org
 *  follow, org roster active, TEAM roster active — the first sub-org
 *  membership writer) + a claim invite (+ optional email). Per-row
 *  BEST-EFFORT: a failed row compensates its own writes and lands in the
 *  report; the batch never aborts. */
export async function importRoster(
  admin: Admin,
  input: {
    side: OrgSide;
    orgId: string;
    orgName: string;
    teamId: string;
    rows: RosterImportRow[];
    createdBy: string;
    appUrl: string;
  }
): Promise<{ ok: true; report: ImportReportRow[] } | { ok: false; reason: 'team_not_found' }> {
  const col = orgColumn(input.side);
  // Scope pin ONCE: the team must be this org's and active (a foreign or
  // archived team is indistinguishable from missing — structure-server
  // convention).
  const { data: team } = await admin
    .from('teams')
    .select('id, name, status')
    .eq('id', input.teamId)
    .eq(col, input.orgId)
    .maybeSingle();
  if (!team || team.status !== 'active') return { ok: false, reason: 'team_not_found' };

  const report: ImportReportRow[] = [];
  for (const row of input.rows) {
    const name = [row.firstName, row.lastName].filter(Boolean).join(' ');
    let profileId: string | null = null;
    try {
      // Shadow user two-step (the guardian-athletes recipe).
      const { data: created, error: userError } = await admin.auth.admin.createUser({
        email: `pending-${randomBytes(8).toString('hex')}@${STUB_EMAIL_DOMAIN}`,
        password: randomBytes(32).toString('base64url'),
        email_confirm: true,
      });
      if (userError || !created?.user) {
        report.push({ name, profileId: null, claimUrl: null, emailSent: false, error: 'account' });
        continue;
      }
      profileId = created.user.id;
      await admin.auth.admin.updateUserById(profileId, {
        email: makeStubEmail(profileId),
        email_confirm: true,
      });

      const { error: rpcError } = await admin.rpc('create_stub_profile', {
        p_id: profileId,
        p_email: makeStubEmail(profileId),
        p_first_name: row.firstName,
        p_last_name: row.lastName ?? '',
        p_created_by: input.createdBy,
      });
      if (rpcError) {
        console.error('[ROSTER IMPORT] stub RPC failed:', rpcError);
        await admin.auth.admin.deleteUser(profileId).catch(() => {});
        report.push({ name, profileId: null, claimUrl: null, emailSent: false, error: 'profile' });
        continue;
      }

      // THREE membership rows. PGRST102: batch inserts need HOMOGENEOUS
      // keys — every row carries the same key set with explicit values.
      const { error: memberError } = await admin.from('memberships').insert([
        { [col]: input.orgId, profile_id: profileId, kind: 'follow', role: 'member', status: 'active', scope_type: 'org', scope_id: null },
        { [col]: input.orgId, profile_id: profileId, kind: 'roster', role: 'member', status: 'active', scope_type: 'org', scope_id: null },
        { [col]: input.orgId, profile_id: profileId, kind: 'roster', role: 'member', status: 'active', scope_type: 'team', scope_id: input.teamId },
      ]);
      if (memberError) {
        console.error('[ROSTER IMPORT] membership insert failed:', memberError);
        // Compensate: the profile delete cascades access rows + invites,
        // then drop the shadow user.
        await admin.from('profiles').delete().eq('id', profileId);
        await admin.auth.admin.deleteUser(profileId).catch(() => {});
        report.push({ name, profileId: null, claimUrl: null, emailSent: false, error: 'membership' });
        continue;
      }

      const invite = await createAthleteClaimInvite(admin, {
        profileId,
        context: { side: input.side, orgId: input.orgId, teamId: input.teamId },
        invitedEmail: row.email,
        createdBy: input.createdBy,
      });
      const claimUrl = invite ? `${input.appUrl}/athlete-claim/${invite.rawToken}` : null;
      let emailSent = false;
      if (claimUrl && row.email && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const { emailService } = await import('@/lib/email-service');
        emailSent = await emailService.sendAthleteClaimInvite(
          row.email,
          name,
          input.orgName,
          team.name as string,
          claimUrl
        );
      }
      report.push({ name, profileId, claimUrl, emailSent });
    } catch (e) {
      console.error('[ROSTER IMPORT] row failed:', e);
      report.push({ name, profileId, claimUrl: null, emailSent: false, error: 'unexpected' });
    }
  }
  return { ok: true, report };
}

/** Re-mint a claim link for an UNCLAIMED stub in this org. Guards: the
 *  profile holds a roster row here, still carries the stub email, and the
 *  self row is still 'supervised'. */
export async function remintAthleteClaim(
  admin: Admin,
  input: { side: OrgSide; orgId: string; orgName: string; profileId: string; createdBy: string; appUrl: string }
): Promise<{ claimUrl: string; emailSent: boolean } | null> {
  const col = orgColumn(input.side);
  const [{ data: rosterRow }, { data: profile }, { data: selfRow }] = await Promise.all([
    admin
      .from('memberships')
      .select('id')
      .eq(col, input.orgId)
      .eq('profile_id', input.profileId)
      .eq('kind', 'roster')
      .limit(1)
      .maybeSingle(),
    admin.from('profiles').select('email').eq('id', input.profileId).maybeSingle(),
    admin
      .from('profile_access')
      .select('role')
      .eq('user_id', input.profileId)
      .eq('profile_id', input.profileId)
      .maybeSingle(),
  ]);
  if (!rosterRow || !isStubEmail(profile?.email as string) || selfRow?.role !== 'supervised') {
    return null;
  }
  // Outstanding invites die first (single live link per stub).
  await admin
    .from('athlete_claim_invites')
    .delete()
    .eq('profile_id', input.profileId)
    .is('consumed_at', null);
  const invite = await createAthleteClaimInvite(admin, {
    profileId: input.profileId,
    context: { side: input.side, orgId: input.orgId, teamId: null },
    invitedEmail: null,
    createdBy: input.createdBy,
  });
  if (!invite) return null;
  return { claimUrl: `${input.appUrl}/athlete-claim/${invite.rawToken}`, emailSent: false };
}

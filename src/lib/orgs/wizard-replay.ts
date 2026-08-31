// ── Approval replay (phase 1 round 2) — drafts become real rows ─────────────
// The shared core behind both admin request-approve routes. TWO failure
// policies, deliberately different:
//   STRUCTURE — STRICT: any failure aborts the whole approval; the caller
//   deletes the freshly-created org (145's cascades erase everything) and
//   the request row is STILL PENDING (the claim runs after), so the retry
//   is a free second click. Inputs were zod-validated at submit; failure
//   here means infra, exactly when a loud 500 is right.
//   CONNECTIONS — BEST-EFFORT: the org is created and claimed by then;
//   a partner hiccup must never force deleting a fully-built approved org.
//   Every item lands in the report the admin sees.
//
// The draft jsonb is RE-PARSED defensively — a hand-edited or legacy row
// can degrade to "nothing to replay", never crash the route.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from './authz';
import type { StructureScope } from './structure-server';
import {
  divisionCreatePOST,
  seasonCreatePOST,
  teamCreatePOST,
} from './structure-server';
import { defaultSeasonLabel } from './structure-templates';
import {
  ConnectionsDraftSchema,
  StructureDraftSchema,
  type StructureDraftInput,
} from './wizard-validate';
import { createOrgClaimInvite } from './org-claim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface StructurePlan {
  seasonLabel: string;
  seasonSportKey: string | null;
  divisions: StructureDraftInput['divisions'];
  teams: string[];
}

/** PURE: draft jsonb → the ordered replay plan, or null when there is
 *  nothing to build. League drafts re-stamp division sports AGAIN with the
 *  request sport (belt and suspenders over the POST-time stamp). */
export function planStructureReplay(
  draft: unknown,
  side: OrgSide,
  orgSportKey: string | null
): StructurePlan | null {
  const parsed = StructureDraftSchema.safeParse(draft);
  if (!parsed.success) return null;
  const { seasonLabel, divisions, teams } = parsed.data;
  if (divisions.length === 0 && teams.length === 0 && !seasonLabel) return null;
  const stamped =
    side === 'league' && orgSportKey
      ? divisions.map(d => ({ ...d, sportKey: orgSportKey }))
      : divisions;
  const sportForLabel = orgSportKey ?? stamped[0]?.sportKey ?? 'soccer';
  return {
    seasonLabel: seasonLabel ?? defaultSeasonLabel(sportForLabel),
    seasonSportKey: side === 'league' ? orgSportKey : null,
    divisions: stamped,
    teams,
  };
}

/** STRICT executor over the round-1 structure ops. Each op returns a
 *  NextResponse — status is read first and json() exactly ONCE. */
export async function replayStructure(
  admin: Admin,
  scope: StructureScope,
  plan: StructurePlan
): Promise<
  | { ok: true; counts: { divisions: number; teams: number } }
  | { ok: false; step: string; status: number }
> {
  const seasonRes = await seasonCreatePOST(admin, scope, {
    side: scope.side,
    orgId: scope.orgId,
    label: plan.seasonLabel,
    ...(plan.seasonSportKey ? { sportKey: plan.seasonSportKey } : {}),
  });
  if (seasonRes.status !== 200) return { ok: false, step: 'season', status: seasonRes.status };
  const seasonBody = (await seasonRes.json()) as { season: { id: string } };
  const seasonId = seasonBody.season.id;

  for (const division of plan.divisions) {
    const res = await divisionCreatePOST(
      admin,
      {
        seasonId,
        sportKey: division.sportKey,
        name: division.name,
        ageBand: division.ageBand,
        genderStream: division.genderStream,
        tier: division.tier,
      },
      scope
    );
    if (res.status !== 200) return { ok: false, step: `division:${division.name}`, status: res.status };
  }
  for (const team of plan.teams) {
    const res = await teamCreatePOST(admin, scope, {
      side: scope.side,
      orgId: scope.orgId,
      name: team,
    });
    if (res.status !== 200) return { ok: false, step: `team:${team}`, status: res.status };
  }
  return { ok: true, counts: { divisions: plan.divisions.length, teams: plan.teams.length } };
}

export interface ConnectionReport {
  name: string;
  result: 'invited' | 'already' | 'skipped' | 'failed';
}

export interface StubReport {
  name: string;
  orgId: string | null;
  claimUrl: string | null;
  emailSent: boolean;
}

/** BEST-EFFORT connections: pending league_clubs edges to existing orgs
 *  (+ owner bell) and ownerless STUB orgs with claim invites. The new org
 *  is on `scope.side`; connections are always the OTHER side (league_clubs
 *  is the only org↔org edge). Never throws. */
export async function replayConnections(
  admin: Admin,
  scope: StructureScope,
  orgName: string,
  draft: unknown,
  requesterProfileId: string,
  reviewerId: string,
  appUrl: string
): Promise<{ connections: ConnectionReport[]; stubs: StubReport[] }> {
  const parsed = ConnectionsDraftSchema.safeParse(draft);
  if (!parsed.success) return { connections: [], stubs: [] };
  const otherSide: OrgSide = scope.side === 'league' ? 'club' : 'league';
  const otherTable = otherSide === 'league' ? 'leagues' : 'clubs';
  const connections: ConnectionReport[] = [];
  const stubs: StubReport[] = [];

  const insertEdge = async (otherId: string): Promise<'invited' | 'already' | 'failed'> => {
    const { error } = await admin.from('league_clubs').insert({
      league_id: scope.side === 'league' ? scope.orgId : otherId,
      club_id: scope.side === 'club' ? scope.orgId : otherId,
      status: 'pending',
      initiated_by: scope.side,
      requested_by_profile_id: requesterProfileId,
      affiliation_type: 'partner_of',
    });
    if (!error) return 'invited';
    if (error.code === '23505') return 'already';
    console.error('[WIZARD REPLAY] edge insert failed:', error);
    return 'failed';
  };

  for (const entry of parsed.data.existing) {
    try {
      // Re-verify by id — the org may have been renamed or deleted since
      // the request; the stored name is never trusted for the bell.
      const { data: other } = await admin
        .from(otherTable)
        .select('id, name, owner_profile_id')
        .eq('id', entry.id)
        .maybeSingle();
      if (!other) {
        connections.push({ name: entry.name, result: 'skipped' });
        continue;
      }
      const result = await insertEdge(other.id as string);
      connections.push({ name: other.name as string, result });
      if (result === 'invited' && other.owner_profile_id) {
        const { notifyAffiliationInvite } = await import('@/lib/affiliations/notify');
        await notifyAffiliationInvite(admin, {
          recipientProfileId: other.owner_profile_id as string,
          leagueName: scope.side === 'league' ? orgName : (other.name as string),
          clubName: scope.side === 'club' ? orgName : (other.name as string),
          initiatedBy: scope.side,
          affiliationType: 'partner_of',
          actionUrl: `/${otherSide}/${other.id}`,
        });
      }
    } catch (e) {
      console.error('[WIZARD REPLAY] connection failed:', e);
      connections.push({ name: entry.name, result: 'failed' });
    }
  }

  for (const stub of parsed.data.stubs) {
    try {
      // Ownerless insert — the 001 demo-club precedent; the claim invite is
      // the path to ownership. Stub LEAGUES carry the row's required sport.
      const { data: created, error } = await admin
        .from(otherTable)
        .insert({
          name: stub.name,
          owner_profile_id: null,
          ...(otherSide === 'league' ? { sport_key: stub.sportKey ?? 'soccer' } : {}),
        })
        .select('id')
        .single();
      if (error || !created) {
        console.error('[WIZARD REPLAY] stub insert failed:', error);
        stubs.push({ name: stub.name, orgId: null, claimUrl: null, emailSent: false });
        continue;
      }
      const stubId = created.id as string;
      await insertEdge(stubId); // notify no-ops on the ownerless stub — correct
      const invite = await createOrgClaimInvite(admin, {
        side: otherSide,
        orgId: stubId,
        invitedEmail: stub.email ?? null,
        createdBy: reviewerId,
      });
      const claimUrl = invite ? `${appUrl}/org-claim/${invite.rawToken}` : null;
      let emailSent = false;
      if (claimUrl && stub.email && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const { emailService } = await import('@/lib/email-service');
        emailSent = await emailService.sendOrgClaimInvite(stub.email, stub.name, orgName, claimUrl);
      }
      stubs.push({ name: stub.name, orgId: stubId, claimUrl, emailSent });
    } catch (e) {
      console.error('[WIZARD REPLAY] stub failed:', e);
      stubs.push({ name: stub.name, orgId: null, claimUrl: null, emailSent: false });
    }
  }

  return { connections, stubs };
}

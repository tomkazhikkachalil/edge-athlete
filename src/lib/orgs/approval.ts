// ── Org approval state (phase 7 C4 — "build while waiting") ─────────────────
// A club or league now EXISTS from the moment of its request (provisioned
// by pending-org.ts) and is LIVE once an admin stamps `approved_at`
// (migration 174). Pending = `approved_at IS NULL`. This is the ONE reader
// every gate uses — the org GET (404 to outsiders), the standings twins
// (empty state), the search (filtered out), publish (409) — so a pre-174
// database (42703) degrades to "everything approved" and never darkens
// anything. The pure helpers are node-tested.

import type { SupabaseClient } from '@supabase/supabase-js';
import { SiteDraftSchema } from './wizard-validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notify.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

export type OrgSide = 'league' | 'club';

export interface ApprovalState {
  /** False when the columns are unknown (pre-174) or the org is missing. */
  known: boolean;
  pending: boolean;
  approvedAt: string | null;
  /** Clubs only (174); leagues carry sport_key elsewhere. */
  primarySport: string | null;
}

export const NOT_KNOWN: ApprovalState = { known: false, pending: false, approvedAt: null, primarySport: null };

/** PURE: the state off an org row (approved_at absent ⇒ pre-174 ⇒ live). */
export function approvalFromRow(row: Record<string, unknown> | null | undefined): ApprovalState {
  if (!row || !('approved_at' in row)) return NOT_KNOWN;
  const approvedAt = typeof row.approved_at === 'string' ? row.approved_at : null;
  return {
    known: true,
    pending: approvedAt === null,
    approvedAt,
    primarySport: typeof row.primary_sport === 'string' && row.primary_sport ? row.primary_sport : null,
  };
}

/** The live read. Any error (42703 on a pre-174 database included) → NOT_KNOWN. */
export async function readApproval(admin: Admin, side: OrgSide, orgId: string): Promise<ApprovalState> {
  const { data, error } = await admin
    .from(side === 'league' ? 'leagues' : 'clubs')
    .select(side === 'league' ? 'id, approved_at' : 'id, approved_at, primary_sport')
    .eq('id', orgId)
    .maybeSingle();
  if (error || !data) return NOT_KNOWN;
  // The dynamic select string defeats supabase-js's type parser; cast once.
  return approvalFromRow(data as unknown as Record<string, unknown>);
}

/** PURE: a decline deletes the provisioned org ONLY while it is still
 *  pending — an approved org is someone's live work, never collateral. */
export function shouldDeleteOnDecline(input: {
  createdOrgId: string | null | undefined;
  approvedAt: string | null | undefined;
}): boolean {
  return !!input.createdOrgId && (input.approvedAt === null || input.approvedAt === undefined);
}

/** PURE: the site draft's contact → the site's contact_config (the same
 *  keys set_contact writes); null when there is nothing to seed. */
export function siteDraftToContact(siteDraft: unknown): { website?: string; phone?: string } | null {
  const parsed = SiteDraftSchema.safeParse(siteDraft ?? {});
  if (!parsed.success || !parsed.data.contact) return null;
  const { website, phone } = parsed.data.contact;
  const contact = { ...(website ? { website } : {}), ...(phone ? { phone } : {}) };
  return Object.keys(contact).length > 0 ? contact : null;
}

/** PURE: who may see a PENDING org's page — its owner, its managers, and
 *  an Edge Athlete admin. Everyone else gets the same 404 as a missing org. */
export function canViewPending(input: { canManage: boolean; isAdmin: boolean }): boolean {
  return input.canManage || input.isAdmin;
}

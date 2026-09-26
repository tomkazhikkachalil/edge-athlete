// ── Authority — the vocabulary (migration 240, Sep 25 2026) ─────────────────
// Zero imports on purpose: client components (the owner's Activity log) and
// server code share it. AUTHORITY_ACTIONS is 240's CHECK list — pinned equal
// by src/lib/__tests__/authority-audit.test.ts, so a value the database would
// refuse never compiles into a writer.

export const AUTHORITY_SUBJECTS = ['org', 'sport_event'] as const;
export type AuthoritySubjectType = (typeof AUTHORITY_SUBJECTS)[number];

export const AUTHORITY_ACTOR_KINDS = ['member', 'platform', 'system'] as const;
export type AuthorityActorKind = (typeof AUTHORITY_ACTOR_KINDS)[number];

export const AUTHORITY_ACTIONS = [
  'org_created', 'owner_added', 'owner_removed', 'owner_stepped_down', 'owner_claimed',
  'manager_added', 'manager_removed', 'staff_granted', 'staff_changed', 'staff_revoked',
  'identity_changed', 'listing_changed', 'site_created', 'site_live', 'site_offline',
  'site_held', 'site_released', 'site_published', 'revision_restored', 'revision_labelled',
  'domain_added', 'domain_removed', 'news_deleted', 'news_restored', 'page_removed',
  'recovery_link_minted', 'recovery_link_redeemed',
  'co_organizer_invited', 'co_organizer_added', 'co_organizer_removed', 'host_transferred',
  'event_details_changed', 'event_cancelled', 'event_deleted',
] as const;
export type AuthorityAction = (typeof AUTHORITY_ACTIONS)[number];

export interface AuthoritySubject {
  type: AuthoritySubjectType;
  id: string;
}

export type AuthorityActor =
  | { kind: 'member'; profileId: string }
  | { kind: 'platform'; profileId: string }
  | { kind: 'system' };

/** One stored row (the table's columns). */
export interface AuthorityRow {
  subject_type: AuthoritySubjectType;
  subject_id: string;
  actor_profile_id: string | null;
  actor_kind: AuthorityActorKind;
  action: AuthorityAction;
  target_profile_id: string | null;
  ticket_id: string | null;
  detail: Record<string, unknown>;
}

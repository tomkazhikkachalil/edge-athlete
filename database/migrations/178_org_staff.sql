-- ============================================================================
-- 178: org staff — organizer accounts, section grants, staff invites, audit
-- ============================================================================
-- Tom (Sep 4 2026): the org "master account" program. Three product facts:
--
--   1. ORGANIZER ACCOUNT — `profiles.user_type = 'organizer'`: name + email +
--      password, no date of birth, no athlete fields (an adult is assumed —
--      Tom's decision; the minor gate is an ATHLETE-actor gate and stays
--      exactly where it is). Provisioned by /api/signup's organizer actor
--      branch only; never self-settable through /api/profile (the 116 clamp
--      precedent: SELF_SERVICE_USER_TYPES stays athlete|fan).
--
--   2. SECTION GRANTS — "invite individuals to manage sections … edits to
--      certain areas or sub areas, but not the overall site." Stored on the
--      ONE scoped membership table (masterplan §3.4), as `kind = 'staff'`
--      rows:
--        role = 'admin'  → every console section, org scope only (the
--                          legacy 'manager' follow-row role's equal);
--        role = 'staff'  → `sections text[]` ⊆ the nine console section keys,
--                          at org | division | team scope (145's widening),
--                          optionally pinned to a season (expires at rollover).
--      WHY a new kind rather than a second follow row: memberships_uniq
--      excludes `role`, so a second grant as 'follow' collides with the
--      person's follow row, and adding role to the key breaks
--      setMemberRole / promoteFollowToOwner (one row per profile+org).
--      Every existing reader pins kind='follow'|'roster', so staff rows are
--      invisible to them by construction; maxOrgRole ignores unknown role
--      strings, so an 'admin' row grants NOTHING until the capabilities
--      reader (round 2) teaches it. `manage_org` — identity, settings,
--      slug/domain, delete, owners/roles — stays owner|manager|admin; nine
--      ticked sections is NOT admin.
--      granted_by / granted_at / expires_at are the masterplan's grant
--      metadata (§3.4); expiry is enforced in code (expires_at <= now() rows
--      are dropped by the reader), so a stale row is inert, never a leak.
--
--   3. INVITES + AUDIT — org_staff_invites mirrors 149's org_claim_invites
--      (hashed token, single-use, atomic redeem, restore-on-failed-
--      precondition) plus the grant to mint; invited_email is NOT NULL here
--      (the redeemer's account email must match — an invite is addressed to
--      a person, unlike a stub-org handover). org_staff_audit is the
--      048/091 append-only pattern: no FKs, forbid_mutation() trigger, RLS
--      on with zero policies.
--
-- SAFETY BOUNDARY (masterplan §5, authz.ts charter 2): nothing here touches
-- profile_access, guardian tables or their readers. Staff authority never
-- implies guardian visibility; a supervised profile can never hold a staff
-- row (the redeem path checks supervision_state).
--
-- ORDER-STRICT: run BEFORE the round-1 PR deploys — the organizer signup
-- inserts user_type='organizer' (23514 pre-178 → the route answers a clear
-- "not available yet", never a half-made account). Every other reader is
-- 42703 / 42P01-safe. Re-runnable end to end.
--
-- Down-steps (documentation only, never executed):
--   DROP TABLE org_staff_audit; DROP TABLE org_staff_invites;
--   DELETE FROM memberships WHERE kind = 'staff';
--   ALTER TABLE memberships DROP CONSTRAINT memberships_staff_shape_check,
--     DROP COLUMN sections, DROP COLUMN granted_by, DROP COLUMN granted_at,
--     DROP COLUMN expires_at;  then re-ADD 140's kind/role CHECKs;
--   re-ADD 097's profiles_user_type_check and 173's notifications_type_check.

-- ── 1. profiles.user_type + 'organizer' ─────────────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_user_type_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_user_type_check
  CHECK (user_type IN ('athlete', 'club', 'league', 'fan', 'parent', 'organizer'));

-- ── 2. memberships: staff kind, admin|staff roles, grant metadata ───────────
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_kind_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_kind_check
  CHECK (kind IN ('follow', 'roster', 'staff'));

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('owner', 'manager', 'member', 'admin', 'staff'));

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS sections   text[],
  ADD COLUMN IF NOT EXISTS granted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- The shape rule. Branch 1 covers EVERY pre-178 row (kind follow|roster,
-- role owner|manager|member, sections NULL) so the ADD never fails on
-- existing data. The nine section keys are the console's ConsoleSectionKey
-- vocabulary verbatim — one vocabulary for DB, invite form, capabilities
-- and console gating.
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_staff_shape_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_staff_shape_check CHECK (
     (kind <> 'staff' AND role NOT IN ('admin', 'staff') AND sections IS NULL)
  OR (kind = 'staff' AND role = 'admin' AND scope_type = 'org' AND sections IS NULL)
  OR (kind = 'staff' AND role = 'staff'
      AND cardinality(sections) >= 1
      AND sections <@ ARRAY['website', 'roster', 'membership', 'seasons', 'teams',
                            'competitions', 'registrations', 'external', 'venues']::text[])
);

-- Capability reads: all of one profile's rows for one org.
CREATE INDEX IF NOT EXISTS idx_memberships_staff_league
  ON memberships (league_id, profile_id) WHERE kind = 'staff';
CREATE INDEX IF NOT EXISTS idx_memberships_staff_club
  ON memberships (club_id, profile_id) WHERE kind = 'staff';

-- ── 3. org_staff_invites — the grant-bearing token ──────────────────────────
CREATE TABLE IF NOT EXISTS org_staff_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  league_id     uuid REFERENCES leagues(id) ON DELETE CASCADE,
  club_id       uuid REFERENCES clubs(id)   ON DELETE CASCADE,
  invited_email text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'staff')),
  sections      text[],
  scope_type    text NOT NULL DEFAULT 'org' CHECK (scope_type IN ('org', 'division', 'team')),
  scope_id      uuid,
  season_id     uuid REFERENCES seasons(id) ON DELETE CASCADE,
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  consumed_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT org_staff_invites_one_org CHECK (num_nonnulls(league_id, club_id) = 1),
  CONSTRAINT org_staff_invites_scope   CHECK ((scope_type = 'org') = (scope_id IS NULL)),
  CONSTRAINT org_staff_invites_shape   CHECK (
       (role = 'admin' AND scope_type = 'org' AND sections IS NULL)
    OR (role = 'staff' AND cardinality(sections) >= 1
        AND sections <@ ARRAY['website', 'roster', 'membership', 'seasons', 'teams',
                              'competitions', 'registrations', 'external', 'venues']::text[])
  )
);

ALTER TABLE org_staff_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_staff_invites FROM PUBLIC, anon, authenticated;

-- Outstanding-invite listings per org (the console's pending list).
CREATE INDEX IF NOT EXISTS idx_org_staff_invites_league
  ON org_staff_invites (league_id) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_org_staff_invites_club
  ON org_staff_invites (club_id) WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- ── 4. org_staff_audit — append-only grant trail ────────────────────────────
CREATE TABLE IF NOT EXISTS org_staff_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    uuid,
  club_id      uuid,
  profile_id   uuid,
  actor_id     uuid,
  action       text NOT NULL CHECK (action IN
                 ('invited', 'accepted', 'changed', 'revoked', 'expired', 'invite_revoked')),
  role         text,
  scope_type   text,
  scope_id     uuid,
  season_id    uuid,
  old_sections text[],
  new_sections text[],
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_staff_audit_league
  ON org_staff_audit (league_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_staff_audit_club
  ON org_staff_audit (club_id, created_at DESC);

ALTER TABLE org_staff_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_staff_audit FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS org_staff_audit_immutable ON org_staff_audit;
CREATE TRIGGER org_staff_audit_immutable
  BEFORE UPDATE OR DELETE ON org_staff_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ── 5. notifications: the three staff bells ─────────────────────────────────
-- 173's list verbatim + org_staff_invite / org_staff_accepted / org_staff_revoked.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'follow_request','follow_accepted','new_follower','like','comment',
    'comment_reply','mention','tag','achievement','system_announcement',
    'club_update','team_update','new_message','group_invite','group_update',
    'guardian_invite','athlete_added',
    'event_invite','event_update','event_cancelled','event_response',
    'event_reminder',
    'post_pending_approval','post_approval_result','transfer_update',
    'consent_result',
    'comment_pending_approval','comment_approval_result',
    'follow_request_guardian','follow_update','tag_alert','profile_change',
    'calendar_alert','safety_alert',
    'league_join','league_update','league_request_result',
    'club_join','club_request_result','affiliation_invite','affiliation_update',
    'carpool_offer','carpool_update',
    'roster_invite',
    'competition_entry_pending','competition_entry_decided',
    'org_registration_received','org_registration_placed','org_registration_released',
    'contest_dispute_raised','contest_dispute_resolved',
    'golf_league_round_counted','golf_league_round_confirmed','golf_league_window_closing',
    'org_staff_invite','org_staff_accepted','org_staff_revoked'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) — every boolean must read true ──
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%organizer%'
     FROM pg_constraint WHERE conname = 'profiles_user_type_check')                     AS organizer_allowed,
  (SELECT pg_get_constraintdef(oid) LIKE '%staff%'
     FROM pg_constraint WHERE conname = 'memberships_kind_check')                        AS kind_has_staff,
  (SELECT pg_get_constraintdef(oid) LIKE '%admin%'
     FROM pg_constraint WHERE conname = 'memberships_role_check')                        AS role_has_admin,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_staff_shape_check')   AS shape_check,
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_name = 'memberships' AND column_name = 'expires_at')              AS expires_col,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'org_staff_invites') AS invites_table,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'org_staff_invites')              AS invites_rls,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'org_staff_audit_immutable')           AS audit_trigger,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'org_staff_audit')                AS audit_rls,
  (SELECT pg_get_constraintdef(oid) LIKE '%org_staff_invite%'
     FROM pg_constraint WHERE conname = 'notifications_type_check')                     AS bells_allowed,
  (SELECT count(*) FROM memberships WHERE kind = 'staff')                                AS staff_rows;   -- info

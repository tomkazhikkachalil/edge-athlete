-- ============================================================================
-- 240: authority — who can run a club, league or event, who changed it, and
--      how the Edge Athlete team gets it back (merges ALONE; additive; runs
--      on prod before any PR that widens the vocabulary deploys)
-- ============================================================================
-- Tom (Sep 25 2026): "there always needs to be two accounts to create an
-- event, tourney, club, league" — and "even if there isn't a contact, we need
-- a way to recover and for users to manage the site if something were to
-- happen or if someone is being malicious." The audit found no recovery path
-- at all: no admin power over an existing org or event, owners who can never
-- be removed (the no-coup contract), an org frozen once its last owner is
-- gone, a moderated owner keeping full authority, no way to report an org or
-- an event, and nothing recording who changed roles, the site or its state.
-- This file is the DDL for the whole round (the code lands in five PRs):
--
--   1. authority_audit — the append-only record of every authority change
--      (the org ladder, the site, the domain, deletes, recovery links,
--      co-organizers, host transfers, event changes), member / platform /
--      system actor, a ticket on every platform act. NO FOREIGN KEYS, on
--      purpose: the append-only trigger (forbid_mutation, 048) refuses the
--      UPDATE that ON DELETE SET NULL performs — an FK to profiles would
--      fail the deletion engine's profile delete, one to tickets the owner's
--      delete_ticket (056 is the history of exactly that bug; 178's
--      org_staff_audit is the precedent). Posture A: RLS on, no policies.
--   2. tickets — an org or an event can be the target of a report and of a
--      recovery request (target_type / subtype gain 'org', 'sport_event');
--      a recovery closes 'access_restored'. A recovery request is a HELP
--      ticket (reason 'recovery' — reason has no CHECK) with a target.
--   3. notifications — 'authority_notice', the bell the owners / managers /
--      organizers get when Edge Athlete support acts.
--   4. org_sites.held_at / held_ticket_id — support's hold. Without it an
--      admin "offline" lasts until a manager publishes again; the CHECK
--      org_sites_held_shape makes a held site unpublishable from ANY path.
--   5. org_claim_invites.purpose / ticket_id — a 'recovery' claim ADDS an
--      owner without the handover's "no owner yet" condition; it is bound
--      to an email and a ticket (org_claim_invites_recovery_shape).
--   6. org_site_news.deleted_at / deleted_by — news is soft-deleted, so a
--      vandal's delete can be undone for 30 days.
--
-- Every new foreign key gets its leading index (239's rule, pinned by
-- src/lib/__tests__/fk-index-coverage.test.ts). check:schema sees the table,
-- the six columns and the trigger; it cannot see CHECKs or indexes — the twin
-- (tests/diagnostics/verify-240-authority.sql) asserts those.
--
-- REVERSAL: drop the trigger and table; drop the six columns and their
-- indexes / constraints; re-ADD the four CHECKs from 222 / 223. Nothing
-- existing changes shape. Re-runnable until the ledger row lands; a second
-- run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 240) THEN
    RAISE EXCEPTION '240 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 239 THEN RAISE EXCEPTION '240 pre-flight: ledger head is %, expected 239', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = 'forbid_mutation') THEN
    RAISE EXCEPTION '240 pre-flight: public.forbid_mutation() is missing (048)';
  END IF;
END $$;

-- ── 1. authority_audit — append-only, no foreign keys ───────────────────────
CREATE TABLE IF NOT EXISTS public.authority_audit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type      text NOT NULL CONSTRAINT authority_audit_subject_type_check CHECK (subject_type IN ('org', 'sport_event')),
  subject_id        uuid NOT NULL,
  actor_profile_id  uuid,
  actor_kind        text NOT NULL CONSTRAINT authority_audit_actor_kind_check CHECK (actor_kind IN ('member', 'platform', 'system')),
  action            text NOT NULL CONSTRAINT authority_audit_action_check CHECK (action IN (
    'org_created',
    'owner_added',
    'owner_removed',
    'owner_stepped_down',
    'owner_claimed',
    'manager_added',
    'manager_removed',
    'staff_granted',
    'staff_changed',
    'staff_revoked',
    'identity_changed',
    'listing_changed',
    'site_created',
    'site_live',
    'site_offline',
    'site_held',
    'site_released',
    'site_published',
    'revision_restored',
    'revision_labelled',
    'domain_added',
    'domain_removed',
    'news_deleted',
    'news_restored',
    'page_removed',
    'recovery_link_minted',
    'recovery_link_redeemed',
    'co_organizer_invited',
    'co_organizer_added',
    'co_organizer_removed',
    'host_transferred',
    'event_details_changed',
    'event_cancelled',
    'event_deleted'
  )),
  target_profile_id uuid,
  ticket_id         uuid,
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT authority_audit_platform_ticket CHECK (actor_kind <> 'platform' OR ticket_id IS NOT NULL),
  CONSTRAINT authority_audit_actor_shape CHECK (actor_kind = 'system' OR actor_profile_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_authority_audit_subject ON public.authority_audit (subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authority_audit_target ON public.authority_audit (target_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authority_audit_actor ON public.authority_audit (actor_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authority_audit_ticket ON public.authority_audit (ticket_id);

ALTER TABLE public.authority_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.authority_audit FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS authority_audit_immutable ON public.authority_audit;
CREATE TRIGGER authority_audit_immutable
  BEFORE UPDATE OR DELETE ON public.authority_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMENT ON TABLE public.authority_audit IS 'Authority (240): the append-only record of who changed who can run a club, league or event, and what they did to it — member, platform (with the ticket) or system actor. NO foreign keys on purpose (forbid_mutation vs ON DELETE SET NULL, 056). One writer: src/lib/authority/audit-server.ts recordAuthority. Posture A.';

-- ── 2. tickets: an org or an event as the target; access_restored ──────────
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_target_type_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_target_type_check CHECK (target_type IS NULL OR target_type IN (
  'post', 'comment', 'profile', 'conversation', 'message', 'org', 'sport_event'));
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_subtype_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_subtype_check CHECK (subtype IS NULL OR subtype IN (
  'post', 'comment', 'profile', 'dm', 'incident', 'org', 'sport_event'));
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_resolution_code_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_resolution_code_check CHECK (resolution_code IS NULL OR resolution_code IN (
  'no_action', 'content_removed', 'warning', 'suspension', 'ban', 'feature_shipped', 'declined', 'access_restored'));

-- ── 3. notifications: the 223 list + authority_notice (re-ADD in full) ──────
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
    'org_staff_invite','org_staff_accepted','org_staff_revoked',
    'org_listing_request',
    'site_form_submission',
    'sport_event_invite','sport_event_request','sport_event_request_decision',
    'sport_event_live','sport_event_results',
    'sport_event_reminder',
    'sport_event_match',
    'ticket_update','ticket_critical',
    'moderation_notice',
    'authority_notice'
  ));


-- ── 4. org_sites: support's hold ────────────────────────────────────────────
ALTER TABLE public.org_sites ADD COLUMN IF NOT EXISTS held_at timestamptz;
ALTER TABLE public.org_sites ADD COLUMN IF NOT EXISTS held_ticket_id uuid;
ALTER TABLE public.org_sites DROP CONSTRAINT IF EXISTS org_sites_held_ticket_id_fkey;
ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_held_ticket_id_fkey
  FOREIGN KEY (held_ticket_id) REFERENCES public.tickets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_org_sites_held_ticket_id ON public.org_sites (held_ticket_id);
ALTER TABLE public.org_sites DROP CONSTRAINT IF EXISTS org_sites_held_shape;
ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_held_shape CHECK (held_at IS NULL OR published_at IS NULL);
COMMENT ON COLUMN public.org_sites.held_at IS 'Support hold (240): the site was taken offline by Edge Athlete support and cannot be published until support releases it (org_sites_held_shape).';

-- ── 5. org_claim_invites: the recovery claim ────────────────────────────────
ALTER TABLE public.org_claim_invites ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'handover';
ALTER TABLE public.org_claim_invites DROP CONSTRAINT IF EXISTS org_claim_invites_purpose_check;
ALTER TABLE public.org_claim_invites ADD CONSTRAINT org_claim_invites_purpose_check CHECK (purpose IN ('handover', 'recovery'));
ALTER TABLE public.org_claim_invites ADD COLUMN IF NOT EXISTS ticket_id uuid;
ALTER TABLE public.org_claim_invites DROP CONSTRAINT IF EXISTS org_claim_invites_ticket_id_fkey;
ALTER TABLE public.org_claim_invites ADD CONSTRAINT org_claim_invites_ticket_id_fkey
  FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_org_claim_invites_ticket_id ON public.org_claim_invites (ticket_id);
ALTER TABLE public.org_claim_invites DROP CONSTRAINT IF EXISTS org_claim_invites_recovery_shape;
ALTER TABLE public.org_claim_invites ADD CONSTRAINT org_claim_invites_recovery_shape
  CHECK (purpose <> 'recovery' OR (invited_email IS NOT NULL AND ticket_id IS NOT NULL));

-- ── 6. org_site_news: soft delete ───────────────────────────────────────────
ALTER TABLE public.org_site_news ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.org_site_news ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.org_site_news DROP CONSTRAINT IF EXISTS org_site_news_deleted_by_fkey;
ALTER TABLE public.org_site_news ADD CONSTRAINT org_site_news_deleted_by_fkey
  FOREIGN KEY (deleted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_org_site_news_deleted_by ON public.org_site_news (deleted_by);
CREATE INDEX IF NOT EXISTS idx_org_site_news_deleted ON public.org_site_news (site_id, deleted_at) WHERE deleted_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (240, '240_authority.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 240 APPLIED | 1 | 1 | 1 | 1 | 0 | 240
SELECT '240 APPLIED' AS result,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'authority_audit') AS audit_table_expect_1,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'authority_audit_immutable' AND NOT tgisinternal) AS immutable_trigger_expect_1,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'org_sites_held_shape') AS held_shape_expect_1,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'tickets_target_type_check' AND pg_get_constraintdef(oid) LIKE '%sport_event%') AS ticket_targets_expect_1,
       (SELECT count(*) FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace
         WHERE c.contype = 'f' AND ns.nspname = 'public'
           AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
                             AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey::int2[])) AS unindexed_fks_expect_0,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_240;

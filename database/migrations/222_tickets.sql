-- ============================================================================
-- 222: Support & Reporting program, Spec 1 — the ticket backend
--      (tickets · ticket_events · platform_admins · two bell types)
-- ============================================================================
-- Tom's Support and Reporting Game Plan (Sep 17 2026): ONE company-owned
-- ticket table for help requests, reports and suggestions — type is a field,
-- not a separate system; no email inbox as the system of record. This is the
-- program's first (and Spec 1's only) migration. It merges ALONE; every app
-- PR after it is "refused by name" until `check:schema` is OK (a read names
-- a missing table → 42P01 → { supported: false }; a write → 503).
--
--   * tickets — one row per help request / report / suggestion. `number` is
--     a bigint IDENTITY starting at 1000, rendered `EA-1000` by the app: the
--     FIRST identity column in the chain (every other table is uuid-only —
--     a human-readable number is what the user quotes in an email; the uuid
--     stays the primary key and the URL id because numbers are guessable).
--     The report columns (target_*, content_snapshot, report_count,
--     merged_into_id), the Help-Center columns (guest_email,
--     attachment_url) and the suggestion columns (suggestion_tag,
--     contact_ok) are declared NOW and written by Specs 2–4 — one shape from
--     day one, the doc's rule. `target_id` carries NO foreign key on purpose:
--     the reported content may be deleted, and the snapshot is the record.
--     attachment_url holds an `uploads` path from Spec 3 on — that PR
--     registers it in URL_SOURCE_COLUMNS (storage-sweep) in the SAME change.
--   * ticket_events — APPEND-ONLY history (the consent_records pattern):
--     every status / severity / assignee change, internal note, reply to the
--     user, user reply, merge, action, email and the anonymize stamp. The
--     app never UPDATEs or DELETEs a row. `visible_to_user` decides what
--     "My requests" shows; internal notes never leave the admin console.
--   * platform_admins — owner | moderator. The env allowlist (OWNER_EMAILS +
--     ADMIN_EMAILS) keeps meaning OWNER so nothing existing changes; a
--     moderator row admits the ticket queue and nothing else. Only an owner
--     writes this table (enforced in the API — the doc's rule).
--   * notifications_type_check: the 213 list + 'ticket_update' (the
--     submitter's bell on a visible change) + 'ticket_critical' (every
--     owner / moderator's bell on a Critical ticket; the urgent-email sweep
--     mails it within ten minutes). Same PR: src/lib/notification-registry.ts
--     gains both entries (verify fails otherwise).
--
-- Strikes are DERIVED (a closed report ticket resolved warning | suspension |
-- ban against target_profile_id) — no strikes table, by decision. Retention:
-- two years after close a ticket is ANONYMIZED by the daily cron (reporter,
-- email, description, snapshot, event bodies nulled; number, type, reason,
-- severity, resolution and timestamps kept for audit) — `anonymized_at`.
--
-- Posture A on all three tables (the 187 shape): RLS on, zero policies,
-- REVOKE from anon and authenticated — the service role is the only reader
-- and writer, and the routes authorize in app code. All three tables are
-- created EMPTY, so indexes are inline. updated_at by handle_updated_at (001).
-- Provenance: every object here is a chain CREATE — check:schema stays OK
-- with the allowlist empty.
-- ============================================================================

-- ── tickets ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number              bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) NOT NULL,
  type                text NOT NULL CONSTRAINT tickets_type_check
                        CHECK (type IN ('help', 'report', 'suggestion')),
  subtype             text CONSTRAINT tickets_subtype_check
                        CHECK (subtype IS NULL OR subtype IN ('post', 'comment', 'profile', 'dm', 'incident')),
  reason              text NOT NULL,
  severity            text NOT NULL CONSTRAINT tickets_severity_check
                        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status              text NOT NULL DEFAULT 'new' CONSTRAINT tickets_status_check
                        CHECK (status IN ('new', 'in_review', 'waiting_on_user', 'resolved', 'closed')),
  subject             text,
  description         text,
  reporter_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reporter_email      text,
  guest_email         text,
  target_type         text CONSTRAINT tickets_target_type_check
                        CHECK (target_type IS NULL OR target_type IN ('post', 'comment', 'profile', 'conversation', 'message')),
  target_id           uuid,
  target_profile_id   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  content_snapshot    jsonb,
  attachment_url      text,
  report_count        integer NOT NULL DEFAULT 1 CONSTRAINT tickets_report_count_check CHECK (report_count >= 1),
  merged_into_id      uuid REFERENCES tickets(id) ON DELETE SET NULL,
  assignee_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  resolution_code     text CONSTRAINT tickets_resolution_code_check
                        CHECK (resolution_code IS NULL OR resolution_code IN
                          ('no_action', 'content_removed', 'warning', 'suspension', 'ban', 'feature_shipped', 'declined')),
  resolution_note     text,
  suggestion_tag      text CONSTRAINT tickets_suggestion_tag_check
                        CHECK (suggestion_tag IS NULL OR suggestion_tag IN ('planned', 'maybe', 'declined')),
  contact_ok          boolean NOT NULL DEFAULT true,
  appeal_used_at      timestamptz,
  first_response_at   timestamptz,
  resolved_at         timestamptz,
  closed_at           timestamptz,
  anonymized_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT tickets_number_key UNIQUE (number),
  -- A report always names its subtype; nothing else ever does.
  CONSTRAINT tickets_subtype_shape CHECK ((type = 'report') = (subtype IS NOT NULL)),
  -- A resolution code exists only on a resolved or closed ticket.
  CONSTRAINT tickets_resolution_shape CHECK (status IN ('resolved', 'closed') OR resolution_code IS NULL)
);

-- The queue: open tickets by severity then age.
CREATE INDEX IF NOT EXISTS idx_tickets_queue
  ON tickets (status, severity, created_at);
-- My requests.
CREATE INDEX IF NOT EXISTS idx_tickets_reporter
  ON tickets (reporter_profile_id, created_at DESC) WHERE reporter_profile_id IS NOT NULL;
-- Prior tickets against a user; the derived strike count.
CREATE INDEX IF NOT EXISTS idx_tickets_target_profile
  ON tickets (target_profile_id, created_at DESC) WHERE target_profile_id IS NOT NULL;
-- Spec 2's 7-day merge on the same item.
CREATE INDEX IF NOT EXISTS idx_tickets_target_item
  ON tickets (target_type, target_id, created_at DESC) WHERE target_id IS NOT NULL;
-- The retention phase: closed, not yet anonymized.
CREATE INDEX IF NOT EXISTS idx_tickets_retention
  ON tickets (closed_at) WHERE closed_at IS NOT NULL AND anonymized_at IS NULL;

DROP TRIGGER IF EXISTS tickets_updated_at ON tickets;
CREATE TRIGGER tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tickets FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE tickets IS 'Support & Reporting (222): one row per help request, report or suggestion — type is a field. Posture A: service role only; the routes authorize in app code.';
COMMENT ON COLUMN tickets.number IS 'The human-readable ticket number (222): an identity starting at 1000, rendered EA-1000 by the app. The uuid stays the URL id.';
COMMENT ON COLUMN tickets.reason IS 'The report reason, help category or suggestion area (222) — validated per type in the app; one column so the queue filters on one field.';
COMMENT ON COLUMN tickets.reporter_email IS 'The submitter''s account email at submit time (222); NULL for a supervised reporter (the mailer routes to the guardians) and after anonymize.';
COMMENT ON COLUMN tickets.target_id IS 'The reported post / comment / profile / conversation / message (222). No FK on purpose: the content may be deleted — content_snapshot is the record.';
COMMENT ON COLUMN tickets.attachment_url IS 'An optional screenshot (Spec 3): an uploads path — registered in URL_SOURCE_COLUMNS by the PR that first writes it, or the weekly sweep deletes the file.';
COMMENT ON COLUMN tickets.report_count IS 'Reports merged into this ticket (222): duplicates on the same item within 7 days increment it instead of opening a new ticket (Spec 2).';
COMMENT ON COLUMN tickets.appeal_used_at IS 'The one appeal (222): a user reply on a resolved ticket reopens it once; stamped when used.';
COMMENT ON COLUMN tickets.anonymized_at IS 'Retention (222): two years after close the daily cron nulls the personal columns and stamps this.';

-- ── ticket_events ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  kind             text NOT NULL CONSTRAINT ticket_events_kind_check
                     CHECK (kind IN ('created', 'status_changed', 'severity_changed', 'assigned', 'note',
                                     'reply_to_user', 'user_reply', 'merged', 'action_taken', 'email_sent',
                                     'reopened', 'anonymized')),
  old_value        text,
  new_value        text,
  body             text,
  visible_to_user  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket
  ON ticket_events (ticket_id, created_at);

ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ticket_events FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE ticket_events IS 'Support & Reporting (222): a ticket''s APPEND-ONLY history — the app never updates or deletes a row. actor NULL = the system.';
COMMENT ON COLUMN ticket_events.visible_to_user IS 'Whether "My requests" shows this event (222): replies and status changes yes; internal notes never.';

-- ── platform_admins ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_admins (
  profile_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  role       text NOT NULL CONSTRAINT platform_admins_role_check CHECK (role IN ('owner', 'moderator')),
  granted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_admins FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE platform_admins IS 'Platform admin roles (222): owner | moderator. The env allowlist stays OWNER; a moderator row admits the support queue only. Written by owners only (API-enforced).';

-- ── The bell types: the 213 list + ticket_update + ticket_critical (re-ADD in full)
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
    'ticket_update','ticket_critical'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 222 APPLIED | 1 | 1 | 1 | 1 | 1 | 5 | 1
SELECT '222 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tickets') AS tickets_table_expect_1,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'number' AND is_identity = 'YES') AS number_identity_expect_1,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ticket_events') AS events_table_expect_1,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_admins') AS admins_table_expect_1,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'tickets_updated_at' AND tgrelid = 'public.tickets'::regclass) AS updated_at_trigger_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tickets' AND indexname LIKE 'idx_tickets_%') AS ticket_indexes_expect_5,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%ticket_critical%') AS bell_types_expect_1;

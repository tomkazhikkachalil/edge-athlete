-- ============================================================================
-- 179: org LISTING state — an org is live by link from creation; approval
--      gates the directory listing, never the door (Onboarding v2, R0)
-- ============================================================================
-- Phase 7 C4 made an org EXIST from the moment of its request (approved_at
-- NULL = pending) and hid everything behind admin approval: the org GET
-- 404'd, publish 409'd, standings sat empty, the join door was unreachable.
-- Tom's Sep 8 decision: "auto-approve unlisted, queue public". So the gate
-- moves. Every org works the moment it exists — console, join door, member
-- rounds, publishing (noindex) — and admin approval decides only whether it
-- is LISTED: the /clubs and /leagues directories, the sitemap, the per-site
-- robots.txt, search.
--
-- One column carries that: listing_status ∈ unlisted | pending | listed.
--   unlisted  the owner chose "link only" (or a listing was declined)
--   pending   a listing request is in the admin queue (the public default)
--   listed    approved — discoverable and indexed
-- approved_at stays as the timestamp of the listing approval; readers stop
-- gating on it (src/lib/orgs/listing.ts derives from it pre-179 only).
--
-- DEFAULT 'listed' — the 175 lesson. Every writer that does not name the
-- column (the admin create form, the wizard's stub orgs, seeds, e2e
-- fixtures) is born live AND listed; the ONE writer that means "pending" is
-- pending-org.ts, and it says so explicitly.
--
-- Also batched here (every later round is zero-DDL and tolerates a pre-179
-- database via the 42703 / PGRST204 / 23514 fallbacks):
--   • club_requests / league_requests.status gains 'unlisted' — a link-only
--     creation files a request row that is not in the queue (R2).
--   • notifications.type gains 'org_listing_request' — the admin bell (R1);
--     178's list verbatim + one (the registry parity test guards this).
--   • org_site_modules.module_key gains 'members' — the zero-admin members
--     table (R5), seeded DISABLED for existing sites (the 169 recipe).
--
-- ORDER-STRICT: run BEFORE the R0 PR merges (the app tolerates either order;
-- running first means the reader never has to derive). Re-runnable.
--
-- Down-steps (documentation only, never executed):
--   ALTER TABLE clubs DROP COLUMN listing_status; (same for leagues)
--   re-ADD the 117/116 three-value status CHECKs (delete 'unlisted' rows first)
--   re-ADD the 178 notifications type list (delete the new type's rows first)
--   re-ADD the 169 module key list (delete 'members' rows first)

-- ── listing_status on both sides ────────────────────────────────────────────
ALTER TABLE clubs   ADD COLUMN IF NOT EXISTS listing_status text NOT NULL DEFAULT 'listed';
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS listing_status text NOT NULL DEFAULT 'listed';

ALTER TABLE clubs   DROP CONSTRAINT IF EXISTS clubs_listing_status_check;
ALTER TABLE clubs   ADD CONSTRAINT clubs_listing_status_check
  CHECK (listing_status IN ('unlisted', 'pending', 'listed'));
ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_listing_status_check;
ALTER TABLE leagues ADD CONSTRAINT leagues_listing_status_check
  CHECK (listing_status IN ('unlisted', 'pending', 'listed'));

-- Backfill from today's semantics: pending = approved_at NULL. Idempotent —
-- a re-run finds nothing pending-by-timestamp that is not already pending.
UPDATE clubs   SET listing_status = 'pending' WHERE approved_at IS NULL AND listing_status = 'listed';
UPDATE leagues SET listing_status = 'pending' WHERE approved_at IS NULL AND listing_status = 'listed';

-- The directory / sitemap / search readers filter on = 'listed'; the admin
-- queue reads the rest. Partial on the minority.
CREATE INDEX IF NOT EXISTS clubs_listing_idx   ON clubs (listing_status)   WHERE listing_status <> 'listed';
CREATE INDEX IF NOT EXISTS leagues_listing_idx ON leagues (listing_status) WHERE listing_status <> 'listed';

-- ── request status: 'unlisted' (R2's link-only creation) ────────────────────
ALTER TABLE club_requests DROP CONSTRAINT IF EXISTS club_requests_status_check;
ALTER TABLE club_requests ADD CONSTRAINT club_requests_status_check
  CHECK (status IN ('pending', 'approved', 'declined', 'unlisted'));
ALTER TABLE league_requests DROP CONSTRAINT IF EXISTS league_requests_status_check;
ALTER TABLE league_requests ADD CONSTRAINT league_requests_status_check
  CHECK (status IN ('pending', 'approved', 'declined', 'unlisted'));
-- The one-pending partial unique indexes (116/117) key on status = 'pending';
-- an 'unlisted' row never collides with a later listing request.

-- ── notifications: the admin bell (R1) — 178's list verbatim + one ──────────
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
    'org_listing_request'
  ));

-- ── site modules: 'members' (R5) — 169's list + one, seeded DISABLED ────────
ALTER TABLE org_site_modules DROP CONSTRAINT IF EXISTS org_site_modules_key_check;
ALTER TABLE org_site_modules
  ADD CONSTRAINT org_site_modules_key_check CHECK (module_key IN (
    'hero','standings','schedule','teams','staff','venues','affiliations',
    'sponsors','contact','news','gallery','register',
    'courses','divisions','leaders','documents',
    'members'
  ));

INSERT INTO org_site_modules (site_id, module_key, enabled, sort_order, config)
SELECT s.id, 'members', false, 16, '{}'::jsonb
FROM org_sites s
WHERE NOT EXISTS (
  SELECT 1 FROM org_site_modules m
  WHERE m.site_id = s.id AND m.module_key = 'members'
);

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clubs' AND column_name = 'listing_status')             AS clubs_col,            -- true
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leagues' AND column_name = 'listing_status')           AS leagues_col,          -- true
  (SELECT column_default FROM information_schema.columns
    WHERE table_name = 'clubs' AND column_name = 'listing_status')             AS clubs_default,        -- 'listed'::text
  (SELECT count(*) FROM clubs   WHERE approved_at IS NULL AND listing_status <> 'pending')
                                                                              AS clubs_drift,          -- 0
  (SELECT count(*) FROM leagues WHERE approved_at IS NULL AND listing_status <> 'pending')
                                                                              AS leagues_drift,        -- 0
  (SELECT count(*) FROM clubs   WHERE listing_status = 'pending')              AS clubs_pending,        -- = pre-179 pending count
  (SELECT pg_get_constraintdef(oid) LIKE '%unlisted%' FROM pg_constraint
    WHERE conname = 'club_requests_status_check')                              AS club_req_unlisted,    -- true
  (SELECT pg_get_constraintdef(oid) LIKE '%org_listing_request%' FROM pg_constraint
    WHERE conname = 'notifications_type_check')                                AS notif_type,           -- true
  (SELECT pg_get_constraintdef(oid) LIKE '%members%' FROM pg_constraint
    WHERE conname = 'org_site_modules_key_check')                              AS module_key,           -- true
  (SELECT count(*) FROM org_sites s WHERE NOT EXISTS
    (SELECT 1 FROM org_site_modules m WHERE m.site_id = s.id AND m.module_key = 'members'))
                                                                              AS sites_missing_members; -- 0

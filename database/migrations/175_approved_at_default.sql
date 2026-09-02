-- ============================================================================
-- 175: approved_at DEFAULTS to now() — an org is live unless provisioned pending (phase 7 C4)
-- ============================================================================
-- 174 added clubs/leagues.approved_at with NO default: every org that existed
-- was backfilled, but every org inserted AFTER it without naming the column
-- — the admin "create club" form, the wizard's stub orgs (replayConnections),
-- the seeds, the e2e fixtures — was born NULL, i.e. PENDING: hidden from
-- outsiders and unable to publish. The only writer that MEANS pending is
-- pending-org.ts, and it says so explicitly (approved_at: null). So the
-- column's default becomes now(): live unless told otherwise.
--
-- ORDER-STRICT: run BEFORE #530 deploys (the gates land there). Re-runnable.
-- Also repairs any org born NULL between 174 and now that no request links
-- as pending (the wizard's stubs / admin creates) — a pending org ALWAYS
-- has a request row pointing at it.
--
-- Down-steps (documentation only, never executed):
--   ALTER TABLE clubs ALTER COLUMN approved_at DROP DEFAULT;
--   ALTER TABLE leagues ALTER COLUMN approved_at DROP DEFAULT;

ALTER TABLE clubs ALTER COLUMN approved_at SET DEFAULT now();
ALTER TABLE leagues ALTER COLUMN approved_at SET DEFAULT now();

UPDATE clubs c SET approved_at = COALESCE(c.created_at, now())
WHERE c.approved_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM club_requests r WHERE r.created_club_id = c.id AND r.status = 'pending');
UPDATE leagues l SET approved_at = COALESCE(l.created_at, now())
WHERE l.approved_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM league_requests r WHERE r.created_league_id = l.id AND r.status = 'pending');

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT column_default FROM information_schema.columns
     WHERE table_name = 'clubs' AND column_name = 'approved_at')                         AS clubs_default,    -- now()
  (SELECT column_default FROM information_schema.columns
     WHERE table_name = 'leagues' AND column_name = 'approved_at')                       AS leagues_default,  -- now()
  (SELECT count(*) FROM clubs c WHERE c.approved_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM club_requests r WHERE r.created_club_id = c.id AND r.status = 'pending'))
                                                                                         AS clubs_orphan_pending,   -- 0
  (SELECT count(*) FROM leagues l WHERE l.approved_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM league_requests r WHERE r.created_league_id = l.id AND r.status = 'pending'))
                                                                                         AS leagues_orphan_pending; -- 0

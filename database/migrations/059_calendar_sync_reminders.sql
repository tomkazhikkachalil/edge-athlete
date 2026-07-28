-- ============================================================================
-- 059 — calendar sync (feed tokens) + reminders + pg_cron trigger
-- ============================================================================
-- ⚠️ BEFORE RUNNING: find-replace  __CRON_SECRET__  with the real CRON_SECRET
-- value (Vercel env / .env.local). Do NOT commit the substituted file — run
-- it in the SQL editor and discard. A guard below refuses to run while the
-- placeholder is unsubstituted.
--
-- ⚠️ Run AFTER 058. Schema changes are safe anytime (calendar is dark
-- behind NEXT_PUBLIC_FEATURE_CALENDAR). The pg_cron section at the bottom
-- is exception-wrapped: if pg_cron/pg_net are unavailable on this project
-- it logs a WARNING and the schema part still completes — reminders then
-- fall back to the once-daily strict sweep in /api/cron/daily (same
-- endpoint logic, just coarse timing).
--
-- Reminders: per-guest reminder_minutes (presets 0/10/30/60/1440; 0 = off;
-- DEFAULT 30) + reminded_at dedup marker. The sweep endpoint
-- (/api/cron/reminders, Bearer CRON_SECRET) runs one exact query per
-- preset lead — no per-row interval SQL needed. pg_cron invokes it every
-- 10 minutes via pg_net http_get. Pre-launch the endpoint answers
-- {"skipped":"flag off"} with HTTP 200 — that is HEALTHY in the logs.
-- Feed tokens: capability URLs for Google/Outlook subscribe — sha256 hash
-- at rest (guardian_invites pattern), raw token shown once, rotate =
-- replace.
-- ============================================================================

-- Guard: refuses to run while the placeholder is unsubstituted. (Right side
-- is concatenated so a global find-replace only touches real sites.)
DO $guard$ BEGIN
  IF '__CRON_SECRET__' = '__' || 'CRON_SECRET' || '__' THEN
    RAISE EXCEPTION '059: replace __CRON_SECRET__ with the real CRON_SECRET before running';
  END IF;
END $guard$;

-- ── Subscribe-feed tokens ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
  profile_id  UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at  TIMESTAMPTZ
);

-- Service-role only: RLS on, zero policies (app-layer auth, house pattern).
ALTER TABLE calendar_feed_tokens ENABLE ROW LEVEL SECURITY;

-- ── Per-guest reminders ──────────────────────────────────────────────────────
ALTER TABLE event_guests ADD COLUMN IF NOT EXISTS reminder_minutes SMALLINT NOT NULL DEFAULT 30;
ALTER TABLE event_guests ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
ALTER TABLE event_guests DROP CONSTRAINT IF EXISTS event_guests_reminder_minutes_check;
ALTER TABLE event_guests ADD CONSTRAINT event_guests_reminder_minutes_check
  CHECK (reminder_minutes BETWEEN 0 AND 10080);
-- No new index: the sweep drives off idx_events_time (057, partial on
-- status='active') and joins guests via idx_event_guests_profile_unique.

-- ── Notification type (full-list re-ADD, 028 pattern) ────────────────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'follow_request','follow_accepted','new_follower','like','comment',
    'comment_reply','mention','tag','achievement','system_announcement',
    'club_update','team_update','new_message','group_invite','group_update',
    'guardian_invite','athlete_added',
    'event_invite','event_update','event_cancelled','event_response',
    'event_reminder'
  ));

NOTIFY pgrst, 'reload schema';

-- ── 10-minute reminder trigger (degrades to a WARNING if unavailable) ────────
DO $ext$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '059: pg_cron/pg_net unavailable (%) — reminders fall back to the once-daily sweep', SQLERRM;
END $ext$;

-- plpgsql compiles lazily, so cron.* references inside the guarded branch
-- never resolve when the extension is absent — the file always completes.
DO $job$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'calendar-reminders') THEN
      PERFORM cron.unschedule('calendar-reminders');
    END IF;
    PERFORM cron.schedule('calendar-reminders', '*/10 * * * *', $cmd$
      SELECT net.http_get(
        url := 'https://edge-athlete.vercel.app/api/cron/reminders',
        headers := jsonb_build_object('Authorization', 'Bearer __CRON_SECRET__'),
        timeout_milliseconds := 15000
      )
    $cmd$);
    RAISE NOTICE '059: calendar-reminders scheduled (*/10 * * * *)';
  ELSE
    RAISE WARNING '059: extensions missing — calendar-reminders NOT scheduled';
  END IF;
END $job$;

-- ============================================================================
-- Verification (run after; expected results in comments)
-- ============================================================================
-- 1. Feed-token table RLS on, zero policies — must return 0:
--    SELECT count(*) FROM pg_policies WHERE tablename = 'calendar_feed_tokens';
-- 2. Reminder columns exist — must return two rows:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'event_guests'
--      AND column_name IN ('reminder_minutes','reminded_at');
-- 3. The cron job is scheduled — must return one active row (*/10 * * * *):
--    SELECT jobname, schedule, active FROM cron.job
--    WHERE jobname = 'calendar-reminders';
-- 4. After ≥10 minutes, the HTTP calls are landing — recent rows, 200s
--    (body {"skipped":"flag off"} pre-launch is HEALTHY):
--    SELECT status_code, content, created FROM net._http_response
--    ORDER BY id DESC LIMIT 3;
-- 5. Job execution history (job success ≠ HTTP success — #4 is the truth):
--    SELECT status, return_message, start_time FROM cron.job_run_details
--    ORDER BY start_time DESC LIMIT 3;
-- ============================================================================

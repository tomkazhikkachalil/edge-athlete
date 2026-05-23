-- ============================================================================
-- Messaging Polish — Phase 1
-- ============================================================================
-- Adds:
--   1. messages.edited_at — sender-only updates within 15 min of created_at
--   2. message_reports — Trust & Safety reporting primitive
--
-- All additions are nullable / new tables. No existing query is affected.
-- RLS uses the project-standard wrapped `(select auth.uid())` form and the
-- existing `is_conversation_participant()` SECURITY DEFINER helper from
-- migration 012.
-- ============================================================================

-- ── 1. edited_at on messages ────────────────────────────────────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- ── 2. message_reports table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_reports (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id           UUID REFERENCES messages(id) ON DELETE SET NULL,
  reported_profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reporter_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  conversation_id      UUID REFERENCES conversations(id) ON DELETE SET NULL,
  reason               TEXT NOT NULL
                       CHECK (reason IN ('spam', 'harassment', 'hateful', 'sexual', 'violence', 'other')),
  details              TEXT,
  status               TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Useful for future admin triage UI
CREATE INDEX IF NOT EXISTS idx_message_reports_status_created
  ON message_reports (status, created_at DESC);

-- Lookup by reporter (so a user can see their own reports)
CREATE INDEX IF NOT EXISTS idx_message_reports_reporter
  ON message_reports (reporter_id);

-- Lookup by reported profile (admin queries)
CREATE INDEX IF NOT EXISTS idx_message_reports_reported_profile
  ON message_reports (reported_profile_id);

-- ── 3. RLS on message_reports ───────────────────────────────────────────────
ALTER TABLE message_reports ENABLE ROW LEVEL SECURITY;

-- INSERT: authed user must be reporter; if conversation_id is set, must be a
-- participant of that conversation (re-uses the existing helper). If
-- conversation_id is NULL the report is profile-level (e.g. reporting from a
-- non-conversation surface) and any authed user can file it.
DROP POLICY IF EXISTS "Authed users can file reports" ON message_reports;
CREATE POLICY "Authed users can file reports"
  ON message_reports FOR INSERT
  WITH CHECK (
    reporter_id = (SELECT auth.uid())
    AND (
      conversation_id IS NULL
      OR is_conversation_participant(conversation_id, (SELECT auth.uid()))
    )
  );

-- SELECT: a user can see only their own reports.
DROP POLICY IF EXISTS "Reporters can view own reports" ON message_reports;
CREATE POLICY "Reporters can view own reports"
  ON message_reports FOR SELECT
  USING (reporter_id = (SELECT auth.uid()));

-- UPDATE / DELETE: not allowed for clients. Admin triage happens via the
-- service role key from server-side admin routes (no policy needed for
-- service_role; it bypasses RLS).

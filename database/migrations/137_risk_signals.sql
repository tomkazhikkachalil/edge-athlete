-- ============================================================================
-- 137 — risk_signals (Family Console follow-on, Wave 7)
-- ============================================================================
-- Heuristic, METADATA-ONLY guardian signals (Tom's scope call, Aug 29):
-- message-volume spikes, new-contact bursts, report-filed events — surfaced
-- to guardians as "worth a look", never accusations. The standing line
-- holds absolutely: no DM transcripts, ever — the sweep reads timestamps
-- and counts, never a content column (src/lib/risk-signals.ts header
-- restates this at the code layer).
--
-- Dedup: one row per (profile, kind, window_start); the sweep anchors
-- window_start to the UTC day so a daily evaluation can never double-file
-- the same signal, and report_filed anchors to the report's own timestamp
-- so each report is its own row.
--
-- 'late_night_activity' is in the CHECK but has NO writer yet (profiles
-- carry no timezone, so local-night is currently unknowable) — the 098
-- stance: an allowed-but-unsent kind is harmless, the reverse is a 23514.
--
-- RLS on with ZERO policies = service-role only (050 stance); guardian
-- reads go through /api/guardian/queue, which scopes by requireGuardianAccount.
-- ============================================================================

CREATE TABLE IF NOT EXISTS risk_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN
                    ('new_contact_burst','message_volume_spike','report_filed','late_night_activity')),
  window_start    TIMESTAMPTZ NOT NULL,
  window_end      TIMESTAMPTZ NOT NULL,
  magnitude       JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, kind, window_start)
);

COMMENT ON TABLE risk_signals IS
  'Heuristic metadata-only guardian signals (migration 137). Never derived from message content.';

-- The queue read: unacknowledged signals per child.
CREATE INDEX IF NOT EXISTS idx_risk_signals_unacked
  ON risk_signals (profile_id, created_at DESC)
  WHERE acknowledged_at IS NULL;

ALTER TABLE risk_signals ENABLE ROW LEVEL SECURITY;

-- ── Check grid (re-runnable; SELECTs only) ──────────────────────────────────
SELECT
  (SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'risk_signals')) AS table_present,
  (SELECT COUNT(*) = 4 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'risk_signals'
      AND column_name IN ('kind','window_start','magnitude','acknowledged_at')) AS columns_present,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'risk_signals') AS rls_on,
  (SELECT COUNT(*) = 0 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'risk_signals') AS zero_policies,
  (SELECT EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_risk_signals_unacked')) AS unacked_index_present;
-- Expect: true / true / true / true / true.

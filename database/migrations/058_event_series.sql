-- ============================================================================
-- 058 — event_series: recurring events (Calendar stage 3)
-- ============================================================================
-- ⚠️ Run AFTER 057. Safe anytime: nothing reads the new table/columns until
-- the recurrence code deploys (calendar stays dark behind
-- NEXT_PUBLIC_FEATURE_CALENDAR anyway).
--
-- MATERIALIZED-OCCURRENCE model: the series row holds ONLY the recurrence
-- rule + generation bookkeeping; every occurrence is a REAL events row
-- (series_id) with its own event_guests rows. That keeps the entire v1
-- read path (range query, detail, respond, tally, deep links) unchanged —
-- per-occurrence decline IS the existing respond endpoint, and a
-- single-occurrence override is a plain PATCH + series_override flag.
-- Series-wide FIELD edits skip overridden occurrences; guest changes and
-- cancellation never skip. Cost accepted: series edits touch ≤104 rows.
--
-- Caps: one constant everywhere — at most 104 occurrences per series.
-- 'never' series materialize a rolling ~6-month window; the daily cron
-- extends them (generated_until = starts_at of the last materialized
-- occurrence; the partial index below is its scan). until_at is an
-- EXCLUSIVE instant resolved server-side (next-midnight-in-event-zone of
-- the user's chosen date) so the series row needs no timezone snapshot.
-- Recurrence-RULE editing after creation is deliberately unsupported in
-- v1 (cancel series + recreate).
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_series (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  freq            TEXT NOT NULL CHECK (freq IN ('daily','weekly','monthly','yearly')),
  interval_n      SMALLINT NOT NULL DEFAULT 1 CHECK (interval_n BETWEEN 1 AND 12),
  byweekday       SMALLINT[] CHECK (byweekday <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  ends            TEXT NOT NULL DEFAULT 'never' CHECK (ends IN ('never','until','count')),
  until_at        TIMESTAMPTZ,
  count_n         SMALLINT CHECK (count_n BETWEEN 1 AND 104),
  generated_until TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends <> 'until' OR until_at IS NOT NULL),
  CHECK (ends <> 'count' OR count_n IS NOT NULL),
  -- byweekday is a weekly-only concept (0 = Sunday, matches JS getDay()).
  CHECK (freq = 'weekly' OR byweekday IS NULL)
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS series_id UUID
  REFERENCES event_series(id) ON DELETE CASCADE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS series_override BOOLEAN NOT NULL DEFAULT false;

-- Series-scoped operations (scope edits/cancels, cron templates).
CREATE INDEX IF NOT EXISTS idx_events_series
  ON events (series_id, starts_at) WHERE series_id IS NOT NULL;
-- Cron entry point: never-ending series due for horizon extension.
CREATE INDEX IF NOT EXISTS idx_event_series_horizon
  ON event_series (generated_until) WHERE ends = 'never';

-- Shared canonical trigger fn (see 036_restore_updated_at_trigger.sql).
DROP TRIGGER IF EXISTS handle_updated_at_event_series ON event_series;
CREATE TRIGGER handle_updated_at_event_series
  BEFORE UPDATE ON event_series
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Service-role only: RLS on, zero policies (app-layer auth, 057 precedent).
ALTER TABLE event_series ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verification (run after; expected results in comments)
-- ============================================================================
-- 1. RLS on, zero policies — must return 0:
--    SELECT count(*) FROM pg_policies WHERE tablename = 'event_series';
-- 2. events gained the columns — both must return one row:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'events' AND column_name IN ('series_id','series_override');
-- 3. byweekday XOR freq — must ERROR (byweekday on a daily series):
--    INSERT INTO event_series (organizer_id, freq, byweekday, generated_until)
--    VALUES ((SELECT id FROM profiles LIMIT 1), 'daily', ARRAY[2]::smallint[], now());
-- 4. Full round-trip is exercised by the calendar recurrence E2E suite.
-- ============================================================================

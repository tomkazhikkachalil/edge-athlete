-- ============================================================================
-- 302: calendar_series_split — change a repeating event's schedule or time
--      zone FROM THIS EVENT ON, in one transaction (Nov 6 2026, the
--      improvements round PR 2; docs/specs/calendar.md). Runs on BOTH
--      staging and prod BEFORE the code deploys (the route answers 503
--      "Calendar updating" until it exists).
-- ============================================================================
-- Why a SPLIT and never a rewrite: every occurrence is a real `events` row
-- (057/058) and the daily cron re-derives future occurrences from the
-- EARLIEST row's starts_at / timezone (series-server.ts) — the series row
-- carries no anchor of its own; until_at / count_n / generated_until are
-- derived from the old zone; RSVPs, reminders, carpools, posts and contests
-- hang on occurrence rows. So "change the schedule from here" is exactly
-- what the old copy told people to do by hand — end the series before this
-- occurrence, start a new one here — done in ONE statement, the template
-- and the guests carried over, and nothing deleted (the house rule: cancel,
-- never delete — a post or a contest keeps pointing at its cancelled row).
--
-- The recurrence MATH stays in TypeScript (recurrence.ts generates the new
-- occurrences); this function only persists atomically:
--   1. the old series ends at p_from (ends='until', until_at=p_from);
--   2. every ACTIVE old occurrence at or after p_from is cancelled —
--      overridden ones included (they belonged to the old schedule);
--   3. the new series row, its occurrences, their guest rows.
-- Returns {new_series_id, first_event_id, cancelled, created}.
-- service_role only; the route has checked the organizer. Reversal: DROP
-- FUNCTION public.calendar_series_split(uuid, uuid, timestamptz, jsonb,
-- jsonb, jsonb, jsonb).
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 302) THEN
    RAISE EXCEPTION '302 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 301 THEN RAISE EXCEPTION '302 pre-flight: ledger head is %, expected 301', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'event_series' AND column_name = 'generated_until') THEN
    RAISE EXCEPTION '302 pre-flight: event_series.generated_until is missing — 058 has not run here';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'event_guests' AND column_name = 'reminder_minutes') THEN
    RAISE EXCEPTION '302 pre-flight: event_guests.reminder_minutes is missing — 059 has not run here';
  END IF;
END $$;

-- ── 1. The function ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calendar_series_split(
  p_old_series uuid,
  p_organizer uuid,
  p_from timestamptz,
  p_series jsonb,
  p_template jsonb,
  p_occurrences jsonb,
  p_guests jsonb
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_series uuid;
  v_first uuid;
  v_cancelled int := 0;
  v_created int := 0;
BEGIN
  SELECT organizer_id INTO v_owner FROM public.event_series WHERE id = p_old_series;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'calendar_series_split: series % not found', p_old_series; END IF;
  IF v_owner <> p_organizer THEN RAISE EXCEPTION 'calendar_series_split: not the organizer'; END IF;
  IF jsonb_typeof(p_occurrences) <> 'array' OR jsonb_array_length(p_occurrences) = 0 THEN
    RAISE EXCEPTION 'calendar_series_split: no occurrences';
  END IF;

  -- 1. The old series ends here.
  UPDATE public.event_series
     SET ends = 'until', until_at = p_from, updated_at = now()
   WHERE id = p_old_series;

  -- 2. Its remaining occurrences are cancelled, never deleted.
  UPDATE public.events
     SET status = 'cancelled', cancelled_at = now(), updated_at = now()
   WHERE series_id = p_old_series
     AND starts_at >= p_from
     AND status = 'active';
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  -- 3. The new series, its occurrences, their guests.
  INSERT INTO public.event_series (organizer_id, freq, interval_n, byweekday, ends, until_at, count_n, generated_until)
  VALUES (
    p_organizer,
    p_series->>'freq',
    (p_series->>'interval_n')::int,
    CASE WHEN jsonb_typeof(p_series->'byweekday') = 'array'
         THEN ARRAY(SELECT (x)::smallint FROM jsonb_array_elements_text(p_series->'byweekday') x)
         ELSE NULL END,
    p_series->>'ends',
    (p_series->>'until_at')::timestamptz,
    (p_series->>'count_n')::int,
    (p_series->>'generated_until')::timestamptz
  )
  RETURNING id INTO v_series;

  INSERT INTO public.events (
    organizer_id, title, description, location, all_day, timezone, category,
    routine_id, routine_snapshot, org_id, division_id, team_id, venue_id, facility_id,
    starts_at, ends_at, series_id
  )
  SELECT
    p_organizer,
    p_template->>'title',
    p_template->>'description',
    p_template->>'location',
    COALESCE((p_template->>'all_day')::boolean, false),
    p_template->>'timezone',
    COALESCE(p_template->>'category', 'other'),
    (p_template->>'routine_id')::uuid,
    NULLIF(p_template->'routine_snapshot', 'null'::jsonb),
    (p_template->>'org_id')::uuid,
    (p_template->>'division_id')::uuid,
    (p_template->>'team_id')::uuid,
    (p_template->>'venue_id')::uuid,
    (p_template->>'facility_id')::uuid,
    (o->>'starts_at')::timestamptz,
    (o->>'ends_at')::timestamptz,
    v_series
  FROM jsonb_array_elements(p_occurrences) o;
  GET DIAGNOSTICS v_created = ROW_COUNT;

  IF jsonb_typeof(p_guests) = 'array' AND jsonb_array_length(p_guests) > 0 THEN
    INSERT INTO public.event_guests (event_id, profile_id, invited_email, role, status, responded_at, reminder_minutes)
    SELECT e.id,
           (g->>'profile_id')::uuid,
           g->>'invited_email',
           COALESCE(g->>'role', 'guest'),
           COALESCE(g->>'status', 'invited'),
           (g->>'responded_at')::timestamptz,
           (g->>'reminder_minutes')::int
      FROM public.events e
     CROSS JOIN jsonb_array_elements(p_guests) g
     WHERE e.series_id = v_series;
  END IF;

  SELECT id INTO v_first FROM public.events WHERE series_id = v_series ORDER BY starts_at ASC LIMIT 1;

  RETURN jsonb_build_object(
    'new_series_id', v_series,
    'first_event_id', v_first,
    'cancelled', v_cancelled,
    'created', v_created
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.calendar_series_split(uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_series_split(uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.calendar_series_split(uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) IS
  'Change a repeating event''s schedule from one occurrence on (302): the old series ends at p_from (its remaining active occurrences cancelled, never deleted), a new series with the given rule, template, occurrences (generated in TS) and guest rows starts there — one transaction. PATCH /api/calendar/events/[id] with scope=following. service_role only.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (302, '302_calendar_series_split.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 302 APPLIED | 1 | 302
SELECT '302 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'calendar_series_split') AS function_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_302;

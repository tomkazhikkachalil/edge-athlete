-- ============================================================================
-- 304: the hardening pass over the improvements round (Nov 6 2026). Runs on
--      BOTH staging and prod BEFORE the code deploys (the worker's claim
--      falls back to the 261 shape until it exists; the rest is additive).
-- ============================================================================
-- Four findings of the round's security review, each fixed where it lives:
--
--   1. The `live-now` pulse topic was PUBLIC: any client holding the anon key
--      could broadcast a `pulse` event on it and make every signed-in tab
--      fetch its pulse every few seconds. Now every pulse topic is PRIVATE:
--      a SELECT policy lets a signed-in person listen to `live-now`, there is
--      still no INSERT policy, so only `pulse_send` (the triggers) can write.
--      `pulse_send` sends private regardless of its third argument (kept for
--      the 301 callers' signatures).
--   2. `calendar_series_split` locked the nothing: two crossed saves of the
--      same split (a double tap, two tabs) both passed the organizer check and
--      the second created a SECOND new series. The series row is now taken
--      FOR UPDATE and a split that cancels no occurrence raises P0004.
--   3. `search_people_for` widened on any unknown `p_direction` (the ELSE arm
--      was "either direction"). Only 'following' and 'either' are answered;
--      anything else sees nobody private.
--   4. `media_jobs_claim` took videos first and counted every running job
--      against the cap, so a tick's light-job claim never filled its pool
--      (2 beside a video, never 20). A kind-aware overload claims only the
--      kinds asked for and counts only THEIR running rows against the cap;
--      the worker claims one video (cap 3) and then drains the light jobs.
--
-- Reversal: DROP POLICY "pulse: live-now topic"; the 301/302/303 bodies of
-- pulse_send, calendar_series_split and search_people_for; DROP the 4-arg
-- media_jobs_claim.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 304) THEN
    RAISE EXCEPTION '304 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 303 THEN RAISE EXCEPTION '304 pre-flight: ledger head is %, expected 303', n; END IF;
  IF to_regprocedure('public.pulse_send(text,jsonb,boolean)') IS NULL THEN
    RAISE EXCEPTION '304 pre-flight: pulse_send (301) is missing';
  END IF;
  IF to_regprocedure('public.media_jobs_claim(int,int,int)') IS NULL THEN
    RAISE EXCEPTION '304 pre-flight: media_jobs_claim (261) is missing';
  END IF;
END $$;

-- ── 1. Every pulse topic is private ─────────────────────────────────────────
DROP POLICY IF EXISTS "pulse: live-now topic" ON realtime.messages;
CREATE POLICY "pulse: live-now topic" ON realtime.messages
  FOR SELECT TO authenticated
  USING (realtime.topic() = 'live-now' AND extension = 'broadcast');

CREATE OR REPLACE FUNCTION public.pulse_send(p_topic text, p_payload jsonb, p_private boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 304: private on every topic — the public live-now topic was spoofable.
  -- The parameter stays for the 301 callers; it no longer decides.
  PERFORM realtime.send(p_payload || jsonb_build_object('at', extract(epoch FROM now())), 'pulse', p_topic, true);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pulse_send(%): %', p_topic, SQLERRM;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pulse_send(text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.pulse_send(text, jsonb, boolean) IS
  'The pulse signal (301, private on every topic since 304): one realtime.send on the given topic, event ''pulse'', the payload plus ''at''. Swallows every error — a signal never fails a write. Called by the pulse_signal_* triggers only.';

-- ── 2. The split takes the series row and refuses to split nothing ──────────
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
  SELECT organizer_id INTO v_owner FROM public.event_series WHERE id = p_old_series FOR UPDATE; -- 304: one split at a time
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
  -- 304: the anchor is always an active row on a legitimate call (the route
  -- refuses a cancelled event), so nothing cancelled means a second, crossed
  -- save of the same split — it must not create a second new series.
  IF v_cancelled = 0 THEN
    RAISE EXCEPTION 'calendar_series_split: nothing to split' USING ERRCODE = 'P0004';
  END IF;

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

-- ── 3. The people search answers two directions and no other ────────────────
CREATE OR REPLACE FUNCTION public.search_people_for(
  p_viewer       uuid,
  p_direction    text,
  search_term    text,
  include_public boolean DEFAULT TRUE,
  max_results    int DEFAULT 20,
  require_handle boolean DEFAULT FALSE,
  exclude_id     uuid DEFAULT NULL,
  p_country_code text DEFAULT NULL,
  p_region_code  text DEFAULT NULL,
  p_near_lat     float8 DEFAULT NULL,
  p_near_lng     float8 DEFAULT NULL,
  p_radius_km    float8 DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  handle      text,
  first_name  text,
  middle_name text,
  last_name   text,
  full_name   text,
  avatar_url  text,
  location    text,
  sport       text,
  school      text,
  visibility  text,
  city        text,
  region      text,
  region_code text,
  country     text,
  country_code text,
  distance_km float8,
  match_rank  int
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT *
  FROM public.search_people(
    search_term,
    CASE
      WHEN p_direction = 'following' THEN ARRAY(
        SELECT f.following_id
        FROM public.follows f
        WHERE f.follower_id = p_viewer AND f.status = 'accepted' AND f.following_id <> p_viewer
        LIMIT 2000
      )
      WHEN p_direction = 'either' THEN ARRAY(
        SELECT CASE WHEN f.follower_id = p_viewer THEN f.following_id ELSE f.follower_id END
        FROM public.follows f
        WHERE f.status = 'accepted' AND (f.follower_id = p_viewer OR f.following_id = p_viewer)
        LIMIT 2000
      )
      ELSE NULL::uuid[] -- 304: an unknown direction sees nobody private, never everybody
    END,
    include_public,
    max_results,
    require_handle,
    exclude_id,
    p_country_code,
    p_region_code,
    p_near_lat,
    p_near_lng,
    p_radius_km
  );
$$;
REVOKE EXECUTE ON FUNCTION public.search_people_for(uuid, text, text, boolean, int, boolean, uuid, text, text, float8, float8, float8) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_people_for(uuid, text, text, boolean, int, boolean, uuid, text, text, float8, float8, float8) TO service_role;

-- ── 4. A kind-aware claim ───────────────────────────────────────────────────
-- The 261 shape with one more argument: the kinds to claim. The running count
-- that meets the cap is of THOSE kinds only — a video in flight no longer
-- stops the posters, and the posters never stop the next video.
CREATE OR REPLACE FUNCTION public.media_jobs_claim(p_n integer, p_lease_seconds integer, p_max_running integer, p_kinds text[])
RETURNS SETOF public.media_jobs
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH running AS (
    SELECT count(*) AS n FROM public.media_jobs
     WHERE status = 'running'
       AND claimed_at IS NOT NULL
       AND claimed_at > timezone('utc'::text, now()) - make_interval(secs => GREATEST(p_lease_seconds, 1))
       AND (p_kinds IS NULL OR kind = ANY(p_kinds))
  ), picked AS (
    SELECT j.id FROM public.media_jobs j
     WHERE (SELECT n FROM running) < GREATEST(p_max_running, 1)
       AND (p_kinds IS NULL OR j.kind = ANY(p_kinds))
       AND (
         (j.status IN ('queued', 'parked') AND j.run_after <= timezone('utc'::text, now()))
         OR (j.status = 'running' AND (j.claimed_at IS NULL OR j.claimed_at < timezone('utc'::text, now()) - make_interval(secs => GREATEST(p_lease_seconds, 1))))
       )
     ORDER BY CASE j.kind WHEN 'video' THEN 0 WHEN 'probe' THEN 1 WHEN 'poster' THEN 2 ELSE 3 END, j.created_at
     LIMIT GREATEST(LEAST(p_n, GREATEST(p_max_running, 1) - (SELECT n FROM running)), 0)
     FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE public.media_jobs j
     SET status = 'running',
         claimed_at = timezone('utc'::text, now()),
         attempts = j.attempts + 1
    FROM picked
   WHERE j.id = picked.id
  RETURNING j.*;
$$;
REVOKE EXECUTE ON FUNCTION public.media_jobs_claim(integer, integer, integer, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_jobs_claim(integer, integer, integer, text[]) TO service_role;
COMMENT ON FUNCTION public.media_jobs_claim(integer, integer, integer, text[]) IS
  'The 261 claim with the kinds to claim (304): only those kinds are picked and only their running rows meet the cap. NULL = every kind (the 261 behaviour). The worker claims video with cap 3, then the light kinds. service_role only.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (304, '304_harden_round.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 304 APPLIED | 2 | 1 | 304
SELECT '304 APPLIED' AS result,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages' AND policyname IN ('pulse: own user topic', 'pulse: live-now topic')) AS policies_expect_2,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'media_jobs_claim' AND p.pronargs = 4) AS claim4_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_304;

-- ============================================================================
-- 238: Departed accounts — results outlive the person. The profile row
--      survives its auth user as a name-only TOMBSTONE (merges ALONE; runs
--      on prod BEFORE the PR that names `departed_at` in a SELECT deploys)
-- ============================================================================
-- Tom's rule (Sep 24 2026): a result that is part of a game, event, round,
-- club or league OUTLIVES the person — "if someone leaves, I don't want that
-- affecting other players' stats". The chain said the opposite: `profiles.id`
-- cascaded from `auth.users` (profiles_id_fkey — the baseline's line 8965),
-- and 73 foreign keys cascade from `profiles(id)`, so the 30-day purge
-- (src/lib/account-park.ts → src/lib/account-deletion.ts) took a player out
-- of every standings table, a shared round with its creator and an event
-- with its host.
--
-- The fix keeps the ROW, not the person: when an adult with results departs,
-- the deletion engine strips every personal column, deletes the auth user and
-- stamps `departed_at`. Every foreign key keeps pointing at a real row, so no
-- result reader changes shape (the roster stub, 150, is the precedent: a
-- name-only profile the standings already render). What this file does:
--
--   1. profiles.departed_at — THE predicate (never restorable), with a
--      partial index for the few readers that list tombstones.
--   2. DROP profiles_id_fkey — the row must outlive its auth user. Every
--      deleter in the codebase removes the profile row BEFORE the auth user
--      (the engine, the e2e teardown, the staging sweep, the roster-import
--      rollback), so nothing relied on the cascade. The loser is a delete
--      from the Supabase dashboard, which now leaves an orphan: the twin's
--      orphan row counts them and docs/RUNBOOK_BACKUP.md forbids it.
--   3. athlete_performances.profile_id → nullable, ON DELETE SET NULL — the
--      analysis dataset keeps the fact and severs the person (Tom).
--   4. profiles_departed_select — a tombstone is readable through RLS (the
--      group round's creator embed runs on the user client). It holds a name
--      and nothing else by construction.
--   5. search_people gains `departed_at IS NULL`; the athlete search document
--      leaves `search_documents` when the stamp lands (its trigger now
--      watches the column). Belt and braces: a tombstone is private with no
--      handle, which every listing already refuses.
--   6. notifications_skip_departed — a BEFORE INSERT trigger drops a bell to
--      a departed recipient (a results bell over the surviving participant
--      rows would otherwise sit unread forever and feed the digest).
--
-- `search_profiles` (197) is service-role-only with no caller in src/ — left.
-- check:schema sees the column (1), the policy (4) and the functions (5, 6);
-- it cannot see a dropped FK, an FK action, a nullability or an index, so
-- the twin (tests/diagnostics/verify-238-departed-profiles.sql) asserts
-- those through pg_constraint.
--
-- REVERSAL: `ALTER TABLE profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY
-- (id) REFERENCES auth.users(id) ON DELETE CASCADE` succeeds only while no
-- tombstone exists (a departed row has no auth user); the column, policy and
-- trigger drop cleanly; athlete_performances re-tightens only when no row
-- has a NULL profile_id. Re-runnable until the ledger row lands; a second
-- run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 238) THEN
    RAISE EXCEPTION '238 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 237 THEN RAISE EXCEPTION '238 pre-flight: ledger head is %, expected 237', n; END IF;
  -- the orphan check BEFORE the FK goes: there must be none to start with
  SELECT count(*) INTO n FROM public.profiles p WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id);
  IF n > 0 THEN RAISE EXCEPTION '238 pre-flight: % profile(s) already without an auth user', n; END IF;
END $$;

-- ── 1. The stamp ────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS departed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_profiles_departed ON public.profiles (departed_at) WHERE departed_at IS NOT NULL;
COMMENT ON COLUMN public.profiles.departed_at IS 'Departed tombstone (238): the auth user is gone and every personal column is stripped; the row survives, name only, because a result tied to an org, competition, sport event or shared round outlives the person. Never restorable. Written only by src/lib/account-deletion.ts.';

-- ── 2. The row outlives its auth user ───────────────────────────────────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- ── 3. The dataset outlives the person ──────────────────────────────────────
ALTER TABLE public.athlete_performances ALTER COLUMN profile_id DROP NOT NULL;
ALTER TABLE public.athlete_performances DROP CONSTRAINT IF EXISTS athlete_performances_profile_id_fkey;
ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.athlete_performances.profile_id IS 'The athlete (194; 238: nullable, SET NULL — the fact survives the person; the deletion engine severs it explicitly for a departed profile).';

-- ── 4. A tombstone is readable by name ──────────────────────────────────────
DROP POLICY IF EXISTS profiles_departed_select ON public.profiles;
CREATE POLICY profiles_departed_select ON public.profiles FOR SELECT
  USING (departed_at IS NOT NULL);

-- ── 5. Search forgets a departed person ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_people(
  search_term    TEXT,
  visible_ids    UUID[] DEFAULT '{}',
  include_public BOOLEAN DEFAULT TRUE,
  max_results    INT DEFAULT 20,
  require_handle BOOLEAN DEFAULT FALSE,
  exclude_id     UUID DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL,
  p_region_code  TEXT DEFAULT NULL,
  p_near_lat     FLOAT8 DEFAULT NULL,
  p_near_lng     FLOAT8 DEFAULT NULL,
  p_radius_km    FLOAT8 DEFAULT NULL
)
RETURNS TABLE (
  id          UUID,
  handle      TEXT,
  first_name  TEXT,
  middle_name TEXT,
  last_name   TEXT,
  full_name   TEXT,
  avatar_url  TEXT,
  location    TEXT,
  sport       TEXT,
  school      TEXT,
  visibility  TEXT,
  city        TEXT,
  region      TEXT,
  region_code TEXT,
  country     TEXT,
  country_code TEXT,
  distance_km FLOAT8,
  match_rank  INT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  q        TEXT;
  q_c      TEXT;
  v_lo     TEXT;
  v_hi     TEXT;
  esc      TEXT;
  infix    TEXT;
  wordpre  TEXT;
  is_short BOOLEAN;
  tsq      TSQUERY;
  near     BOOLEAN := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius   FLOAT8  := COALESCE(p_radius_km, 50);
  filtered BOOLEAN := p_country_code IS NOT NULL OR p_region_code IS NOT NULL
                      OR (p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL);
  dlat     FLOAT8;
  dlng     FLOAT8;
BEGIN
  q := lower(btrim(ltrim(btrim(COALESCE(search_term, '')), '@')));
  -- An empty query is allowed ONLY as a filtered browse (Explore: "athletes
  -- in Ontario"); unfiltered it returns nothing, as in 087.
  IF q = '' AND NOT filtered THEN
    RETURN;
  END IF;

  q_c  := q COLLATE "C";
  v_lo := q_c;
  v_hi := (q || chr(1114111)) COLLATE "C";
  esc     := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  infix   := '%' || esc || '%';
  wordpre := '% ' || esc || '%';
  is_short := length(q) < 3;
  tsq  := public.search_prefix_tsquery(q);
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));

  RETURN QUERY
  SELECT
    p.id, p.handle, p.first_name, p.middle_name, p.last_name, p.full_name,
    p.avatar_url, p.location, p.sport, p.school, p.visibility,
    p.city, p.region, p.region_code, p.country, p.country_code,
    CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, p.lat, p.lng) END AS distance_km,
    (CASE
       WHEN q = ''                                                    THEN 5
       WHEN (lower(p.handle) COLLATE "C") = q_c                       THEN 0
       WHEN (lower(p.handle) COLLATE "C") >= v_lo
        AND (lower(p.handle) COLLATE "C") <  v_hi                     THEN 1
       WHEN ((lower(p.first_name) COLLATE "C") >= v_lo AND (lower(p.first_name) COLLATE "C") < v_hi)
         OR ((lower(p.last_name)  COLLATE "C") >= v_lo AND (lower(p.last_name)  COLLATE "C") < v_hi)
         OR ((lower(p.full_name)  COLLATE "C") >= v_lo AND (lower(p.full_name)  COLLATE "C") < v_hi)
                                                                      THEN 2
       WHEN lower(p.full_name)  LIKE wordpre
         OR lower(p.last_name)  LIKE wordpre
         OR lower(p.first_name) LIKE wordpre                          THEN 3
       WHEN NOT is_short AND (
            lower(p.handle)     LIKE infix OR lower(p.first_name) LIKE infix OR
            lower(p.last_name)  LIKE infix OR lower(p.full_name)  LIKE infix) THEN 4
       -- Location tier: every token of the query matches somewhere in the
       -- profile's vector (city, region, country, free-text location, or a
       -- name token mixed in: "sarah ottawa"). Always below name tiers.
       ELSE 5
     END)::INT AS match_rank
  FROM public.profiles p
  WHERE
    ((include_public AND p.visibility = 'public') OR p.id = ANY(visible_ids))
    -- 238: a departed tombstone is never a person to find
    AND p.departed_at IS NULL
    AND (NOT require_handle OR p.handle IS NOT NULL)
    AND (exclude_id IS NULL OR p.id <> exclude_id)
    AND (p_country_code IS NULL OR p.country_code = upper(p_country_code))
    AND (p_region_code IS NULL OR p.region_code = upper(p_region_code))
    AND (NOT near OR (p.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                  AND p.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
    AND (
      q = '' OR
      ((lower(p.handle)     COLLATE "C") >= v_lo AND (lower(p.handle)     COLLATE "C") < v_hi) OR
      ((lower(p.first_name) COLLATE "C") >= v_lo AND (lower(p.first_name) COLLATE "C") < v_hi) OR
      ((lower(p.last_name)  COLLATE "C") >= v_lo AND (lower(p.last_name)  COLLATE "C") < v_hi) OR
      ((lower(p.full_name)  COLLATE "C") >= v_lo AND (lower(p.full_name)  COLLATE "C") < v_hi) OR
      (NOT is_short AND (
        lower(p.handle)     LIKE infix OR
        lower(p.first_name) LIKE infix OR
        lower(p.last_name)  LIKE infix OR
        lower(p.full_name)  LIKE infix
      )) OR
      (tsq IS NOT NULL AND p.search_vector @@ tsq)
    )
  ORDER BY
    match_rank,
    CASE WHEN near AND q = '' THEN public.haversine_km(p_near_lat, p_near_lng, p.lat, p.lng) END ASC NULLS LAST,
    length(COALESCE(p.full_name, p.handle, '')),
    COALESCE(p.full_name, p.handle, ''),
    p.id
  LIMIT GREATEST(COALESCE(max_results, 20), 1);
END;
$$;

-- The athlete document: 112's body plus the departed branch. SECURITY
-- DEFINER restated — CREATE OR REPLACE resets it (114 set it by ALTER).
CREATE OR REPLACE FUNCTION public.search_doc_sync_athlete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  t text := COALESCE(NULLIF(btrim(COALESCE(NEW.full_name, '')), ''), NEW.handle);
BEGIN
  -- 238: a departed tombstone has no searchable identity
  IF t IS NULL OR NEW.departed_at IS NOT NULL THEN
    DELETE FROM search_documents sd WHERE sd.entity_type = 'athlete' AND sd.entity_id = NEW.id;
    RETURN NULL;
  END IF;
  INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
    owner_id, visibility, place_id, city, region, region_code, country, country_code,
    lat, lng, rich, recency, search_vector)
  VALUES ('athlete', NEW.id, t, NEW.handle, NULL,
    NEW.id, COALESCE(NEW.visibility, 'public'), NEW.place_id, NEW.city, NEW.region, NEW.region_code,
    NEW.country, NEW.country_code, NEW.lat, NEW.lng,
    (NEW.handle IS NOT NULL AND NEW.avatar_url IS NOT NULL),
    NEW.updated_at, COALESCE(NEW.search_vector, ''::tsvector))
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
    owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
    city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
    country = EXCLUDED.country, country_code = EXCLUDED.country_code,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
    search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_doc_sync_athlete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profiles_search_doc ON public.profiles;
CREATE TRIGGER profiles_search_doc
  AFTER INSERT OR UPDATE OF first_name, last_name, full_name, handle, location,
    city, region, region_code, country, country_code, place_id, lat, lng,
    visibility, avatar_url, search_vector, departed_at
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.search_doc_sync_athlete();

-- ── 6. No bell to a departed recipient ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notifications_skip_departed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.departed_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notifications_skip_departed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notifications_skip_departed ON public.notifications;
CREATE TRIGGER notifications_skip_departed
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_skip_departed();

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (238, '238_departed_profiles.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 238 APPLIED | 1 | 0 | 1 | 1 | 1 | 238
SELECT '238 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'departed_at') AS departed_at_column_expect_1,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'profiles_id_fkey' AND conrelid = 'public.profiles'::regclass) AS profiles_auth_fk_expect_0,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'athlete_performances_profile_id_fkey' AND contype = 'f' AND confdeltype = 'n') AS performances_set_null_expect_1,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_departed_select') AS departed_policy_expect_1,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'notifications_skip_departed' AND NOT tgisinternal) AS skip_trigger_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_238;

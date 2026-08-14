-- ============================================================================
-- Migration 087 — Instant people search: indexes, one ranked primitive, and
--                 the grant revokes 040/085/086 missed
-- ============================================================================
-- Tom, Aug 13 2026: "you have to enter the entire first name to even see
-- options." The min-length gate was only half of it. /api/search resolved
-- athletes through search_profiles(), which matches with
-- websearch_to_tsquery('english', q) — WHOLE WORDS, no prefix operator. So
-- 'Tho' could never match 'Thomas'. Worse, the common two-letter inputs
-- ('to', 'in', 'an', 'is') are English STOP WORDS and compile to an EMPTY
-- tsquery, which matches nothing at all. The route's ILIKE fallback would have
-- rescued both, but it only fires when the RPC THROWS — never when it returns
-- zero rows. handle was never in the vector either, so @handles were
-- unsearchable and every athlete result carried handle = NULL.
--
-- This migration lays the foundation for prefix-first search that is instant
-- from the FIRST keystroke, and closes a live privacy hole found on the way.
--
-- ── 1. INDEXES, AND WHY THERE ARE TWO KINDS ─────────────────────────────────
-- pg_trgm's GIN index can only serve a LIKE pattern of THREE OR MORE
-- characters — trigrams are 3-grams, so 'a%' and 'ab%' extract nothing to
-- probe with and the planner falls back to a sequential scan. A trigram index
-- alone would therefore make the 1- and 2-character case (exactly the case
-- Tom is asking for) the SLOWEST one.
--
-- So both kinds are created, and search_people below switches on length:
--   < 3 chars  -> PREFIX-only match, served by the COLLATE "C" btree indexes.
--                 Also the better answer on its own merits: typing 't' should
--                 offer people whose name STARTS with t, not everyone with a
--                 t somewhere in the middle.
--   >= 3 chars -> prefix AND substring, the latter served by trigram GIN.
--
-- ⚠️ THE SUBTLE PART — why prefixes are range bounds, not LIKE.
-- `col LIKE pattern || '%'` is only rewritten into an indexable range scan
-- when the pattern is a PLAN-TIME CONSTANT. Inside a plpgsql function the
-- pattern is a parameter, so under a generic plan that rewrite does not
-- happen and the LIKE degrades to a sequential scan — the index would exist
-- and simply never be used. So the prefix tiers below are written as explicit
-- bounds instead:  expr >= q AND expr < q || chr(1114111).
--
-- Those bounds must compare the same way the index sorts, which is why the
-- indexes and the predicates both pin COLLATE "C" (byte order). A btree under
-- the database's default collation cannot serve a range built this way.
-- U+10FFFF is the highest code point, so it is an exclusive upper bound for
-- every string starting with q.
--
-- The substring tier keeps plain LIKE: a trigram GIN extracts its probe
-- trigrams from the pattern VALUE at execution time, so it works fine with a
-- parameter. The constant-folding limitation is specific to btree prefixes.
--
-- ── 2. SECURITY — three functions anon can still execute ────────────────────
-- Found while auditing this feature. 040 revoked 12 functions by name, 085
-- five more, 086 two — none of them touched:
--
--   search_profiles   anon+authed  <- NO VISIBILITY FILTER AT ALL
--   search_posts      anon+authed
--   search_clubs      anon+authed
--
-- search_profiles is the sharp one: it returns name, avatar, location, school
-- and visibility for EVERY profile with no filter of any kind, and it is
-- reachable with the PUBLIC ANON KEY. /api/search filters the result in TS
-- afterwards, but an attacker calling the RPC directly skips the route
-- entirely — private profiles are enumerable from a browser. This is exactly
-- the class 085 was written to close, and its header already says it: "an
-- app-layer filter is NOT a substitute for an EXECUTE grant."
--
-- Revoking is safe: all three are called only via getSupabaseAdmin()
-- (service_role ignores these grants). No authenticated-client call exists.
--
-- profiles.email was also in the search vector at weight B, making profiles
-- discoverable by email through that same anon-callable function. Removed.
--
-- ── 3. PRIVACY STAYS IN THE APP LAYER, DELIBERATELY ─────────────────────────
-- search_people() takes the allowed-id set as an ARGUMENT rather than joining
-- follows itself. That is not an oversight. The repo's rule is written at
-- src/app/api/mentions/search/route.ts:9-11 — "runs on the admin client, so
-- the visibility filter here IS the privacy boundary (the RPC-visibility
-- lesson: never trust the DB layer to do it)" — and it was earned from
-- search_profiles shipping with no filter while the app was assumed to gate.
-- Each route keeps computing its own audience, exactly as it does today:
--   /api/search                  public + self
--   /api/mentions/search         public + ONE-directional accepted follows
--   /api/calendar/invite-search  public + BIDIRECTIONAL accepted follows
-- The function only RANKS and LIMITS — but that alone fixes a real bug, since
-- the LIMIT now applies AFTER the privacy filter instead of before it (today
-- private profiles consume result slots and public matches fall off the end).
--
-- KNOWN CEILING: visible_ids grows with the caller's follow count. Fine into
-- the low thousands. When one user's follow list makes the array unwieldy,
-- move the join into SQL — and treat that as the moment to re-audit the
-- privacy rule, not a mechanical refactor.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file. Expect NOTICE lines and 087 OK.
--    A WARNING means the work committed but a check did not pass — paste it
--    back rather than re-running (083's convention; MIGRATIONS.md).
--    CREATE INDEX CONCURRENTLY is deliberately NOT used: the editor runs the
--    file as ONE transaction and CONCURRENTLY cannot run inside one. At
--    current table sizes the plain build is instant.
-- ============================================================================

-- ── 1a. Extension ───────────────────────────────────────────────────────────
-- Supabase installs extensions into the `extensions` schema, but a project may
-- already carry pg_trgm in `public`. Putting BOTH on the search_path for this
-- session means `gin_trgm_ops` below resolves either way, with no assumption
-- about which one this project has.
SET search_path = public, extensions;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 1b. Prefix indexes (serve queries of ANY length, incl. 1-2 chars) ───────
-- COLLATE "C" is load-bearing: it makes the index sort by byte order, which is
-- what the >= / < range bounds in search_people compare by. See the header.
CREATE INDEX IF NOT EXISTS idx_profiles_handle_prefix
  ON public.profiles ((lower(handle) COLLATE "C"));
CREATE INDEX IF NOT EXISTS idx_profiles_first_name_prefix
  ON public.profiles ((lower(first_name) COLLATE "C"));
CREATE INDEX IF NOT EXISTS idx_profiles_last_name_prefix
  ON public.profiles ((lower(last_name) COLLATE "C"));
CREATE INDEX IF NOT EXISTS idx_profiles_full_name_prefix
  ON public.profiles ((lower(full_name) COLLATE "C"));

-- ── 1c. Trigram indexes (serve substring matching at >= 3 chars) ────────────
CREATE INDEX IF NOT EXISTS idx_profiles_handle_trgm
  ON public.profiles USING GIN (lower(handle) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_first_name_trgm
  ON public.profiles USING GIN (lower(first_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_last_name_trgm
  ON public.profiles USING GIN (lower(last_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm
  ON public.profiles USING GIN (lower(full_name) gin_trgm_ops);

-- Golf course picker (/api/golf/courses does ilike on golf_rounds.course) and
-- the club results in /api/search.
CREATE INDEX IF NOT EXISTS idx_golf_rounds_course_trgm
  ON public.golf_rounds USING GIN (lower(course) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_golf_rounds_course_prefix
  ON public.golf_rounds ((lower(course) COLLATE "C"));
CREATE INDEX IF NOT EXISTS idx_clubs_name_trgm
  ON public.clubs USING GIN (lower(name) gin_trgm_ops);

-- ============================================================================
-- 2. search_people — the one ranked people-search primitive
-- ============================================================================
-- Ranking ladder (lower is better), mirroring the weighting already proven in
-- src/lib/equipment-catalog.ts:98-106 and re-implemented as a PURE function in
-- src/lib/search/people.ts so it is unit-testable under the node-only rule:
--   0  exact handle
--   1  handle prefix
--   2  name prefix (first / last / full)
--   3  word-boundary prefix inside a name  ("kaz" -> "Tom Kazhikkachalil")
--   4  substring anywhere                  (>= 3 chars only)
--
-- Body is FULLY SCHEMA-QUALIFIED. 082/083's lesson: a pinned search_path with
-- an unqualified body breaks the function silently at call time.
DROP FUNCTION IF EXISTS public.search_people(TEXT, UUID[], BOOLEAN, INT);
DROP FUNCTION IF EXISTS public.search_people(TEXT, UUID[], BOOLEAN, INT, BOOLEAN, UUID);

CREATE FUNCTION public.search_people(
  search_term    TEXT,
  visible_ids    UUID[] DEFAULT '{}',
  include_public BOOLEAN DEFAULT TRUE,
  max_results    INT DEFAULT 20,
  -- @mention targets must be addressable, so mentions asks for handled
  -- profiles only. Both of these are predicates rather than post-filters on
  -- purpose: applied after the LIMIT they would silently return fewer rows
  -- than asked for.
  require_handle BOOLEAN DEFAULT FALSE,
  exclude_id     UUID DEFAULT NULL
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
  match_rank  INT
)
LANGUAGE plpgsql
STABLE
-- SECURITY INVOKER, not DEFINER. It is revoked from anon/authenticated below
-- and only ever called by the service-role client, but DEFINER would mean any
-- future grant slip hands out OWNER privileges. A privacy-adjacent function
-- reachable by a browser key is precisely the search_by_handle shape 085 had
-- to clean up; INVOKER makes a slip merely useless instead of dangerous.
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
BEGIN
  -- Normalise: trim, drop a leading '@' (people type handles both ways),
  -- lowercase. Mirrors normalizeQuery() in src/lib/search/people.ts.
  q := lower(btrim(ltrim(btrim(COALESCE(search_term, '')), '@')));
  IF q = '' THEN
    RETURN;
  END IF;

  -- Prefix range bounds, byte-ordered to match the COLLATE "C" indexes.
  -- U+10FFFF is the highest code point, so v_hi is an exclusive upper bound
  -- for every string beginning with q. See the header for why this is a range
  -- and not a LIKE.
  q_c  := q COLLATE "C";
  v_lo := q_c;
  v_hi := (q || chr(1114111)) COLLATE "C";

  -- Escape LIKE metacharacters for the substring tier. Backslash FIRST, or it
  -- would double-escape the escapes added after it.
  esc     := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  infix   := '%' || esc || '%';
  wordpre := '% ' || esc || '%';

  -- Under 3 characters a trigram index cannot be probed, so substring matching
  -- would force a sequential scan on the single most common query shape.
  -- Prefix-only is both index-served AND the better answer for one letter.
  is_short := length(q) < 3;

  RETURN QUERY
  SELECT
    p.id, p.handle, p.first_name, p.middle_name, p.last_name, p.full_name,
    p.avatar_url, p.location, p.sport, p.school, p.visibility,
    (CASE
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
       ELSE 4
     END)::INT AS match_rank
  FROM public.profiles p
  WHERE
    -- Privacy: resolved by the CALLER (see header section 3). Applied here so
    -- the LIMIT below lands AFTER it, not before.
    ((include_public AND p.visibility = 'public') OR p.id = ANY(visible_ids))
    AND (NOT require_handle OR p.handle IS NOT NULL)
    AND (exclude_id IS NULL OR p.id <> exclude_id)
    AND (
      ((lower(p.handle)     COLLATE "C") >= v_lo AND (lower(p.handle)     COLLATE "C") < v_hi) OR
      ((lower(p.first_name) COLLATE "C") >= v_lo AND (lower(p.first_name) COLLATE "C") < v_hi) OR
      ((lower(p.last_name)  COLLATE "C") >= v_lo AND (lower(p.last_name)  COLLATE "C") < v_hi) OR
      ((lower(p.full_name)  COLLATE "C") >= v_lo AND (lower(p.full_name)  COLLATE "C") < v_hi) OR
      (NOT is_short AND (
        lower(p.handle)     LIKE infix OR
        lower(p.first_name) LIKE infix OR
        lower(p.last_name)  LIKE infix OR
        lower(p.full_name)  LIKE infix
      ))
    )
  ORDER BY
    match_rank,
    -- Shorter names rank above longer ones at equal quality (006's convention
    -- for handles), then alphabetical so paging is stable.
    length(COALESCE(p.full_name, p.handle, '')),
    COALESCE(p.full_name, p.handle, ''),
    p.id
  LIMIT GREATEST(COALESCE(max_results, 20), 1);
END;
$$;

-- Server-only: every caller goes through getSupabaseAdmin(). Revoke BEFORE
-- granting so a re-run cannot leave a window open.
REVOKE EXECUTE ON FUNCTION public.search_people(TEXT, UUID[], BOOLEAN, INT, BOOLEAN, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_people(TEXT, UUID[], BOOLEAN, INT, BOOLEAN, UUID)
  TO service_role;

COMMENT ON FUNCTION public.search_people IS
  'Ranked people search. Privacy is the CALLER''s job: pass visible_ids/include_public. Service-role only (migration 087).';

-- ============================================================================
-- 3. Drop email from the profiles search vector
-- ============================================================================
CREATE OR REPLACE FUNCTION public.profiles_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- email deliberately REMOVED (087): it made profiles discoverable by email
  -- address through search_profiles, which anon could call.
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.first_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.last_name,  '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.full_name,  '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.location,   '')), 'C');
  RETURN NEW;
END;
$$;

-- Recompute directly rather than firing the trigger with a no-op UPDATE:
-- profiles carries handle_updated_at_profiles (001), so a blanket UPDATE would
-- bump every profile's updated_at and read as mass activity.
UPDATE public.profiles SET search_vector =
  setweight(to_tsvector('english', COALESCE(first_name, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(last_name,  '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(full_name,  '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(location,   '')), 'C');

-- ============================================================================
-- 4. Revoke the three search RPCs anon/authenticated can still execute
-- ============================================================================
-- 086's pattern: keyed on the LIVE signature, so every overload is covered.
DO $$
DECLARE
  r       RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('search_profiles', 'search_posts', 'search_clubs')
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      r.proname, r.args
    );
    v_count := v_count + 1;
    RAISE NOTICE '087 revoked: %(%)', r.proname, r.args;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION '087 FAILED: none of the three search functions exist — check names';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION — CANNOT roll back the work above (083's convention).
-- ============================================================================
DO $$
DECLARE
  r          RECORD;
  v_leftover TEXT := '';
  v_idx      INTEGER;
  v_rows     INTEGER;
BEGIN
  BEGIN
    -- 4a. No search function is reachable by a browser key any more.
    FOR r IN
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('search_profiles','search_posts','search_clubs','search_people')
        AND (has_function_privilege('anon', p.oid, 'EXECUTE')
             OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    LOOP
      v_leftover := v_leftover || r.proname || '(' || r.args || ') ';
    END LOOP;

    IF v_leftover <> '' THEN
      RAISE WARNING '087 CHECK FAILED: still executable by anon/authenticated: % — the work above is still committed', v_leftover;
    ELSE
      RAISE NOTICE '087 OK (grants) — all four search functions are service-role only';
    END IF;

    -- 4b. Every index landed.
    SELECT count(*) INTO v_idx
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'idx_profiles_handle_prefix','idx_profiles_first_name_prefix',
        'idx_profiles_last_name_prefix','idx_profiles_full_name_prefix',
        'idx_profiles_handle_trgm','idx_profiles_first_name_trgm',
        'idx_profiles_last_name_trgm','idx_profiles_full_name_trgm',
        'idx_golf_rounds_course_trgm','idx_golf_rounds_course_prefix',
        'idx_clubs_name_trgm'
      );
    IF v_idx <> 11 THEN
      RAISE WARNING '087 CHECK FAILED: expected 11 search indexes, found %', v_idx;
    ELSE
      RAISE NOTICE '087 OK (indexes) — 11/11 present';
    END IF;

    -- 4c. search_people answers a ONE-character query. include_public => the
    --     public set only, so this reads nothing a signed-out visitor cannot
    --     already see on /explore.
    SELECT count(*) INTO v_rows
    FROM public.search_people('a', '{}'::uuid[], TRUE, 5);
    RAISE NOTICE '087 OK (function) — search_people(''a'') returned % row(s)', v_rows;

    -- 4d. email is gone from the vector.
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'profiles_search_vector_update'
        AND p.prosrc LIKE '%NEW.email%'
    ) THEN
      RAISE WARNING '087 CHECK FAILED: profiles_search_vector_update still indexes email';
    ELSE
      RAISE NOTICE '087 OK (vector) — email is no longer indexed';
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '087 CHECK FAILED: % [%]', SQLERRM, SQLSTATE;
  END;
END $$;

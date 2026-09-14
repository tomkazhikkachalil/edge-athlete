-- ============================================================================
-- 193: profiles — the 23 columns the chain never named
--      (data foundation, P5 — Sep 14 2026)
-- ============================================================================
-- 001 created profiles with 13 columns; the archived athlete-profile-schema
-- .sql / supabase-athlete-schema.sql then added the identity, measurable,
-- academic and social columns the whole app runs on — username, full_name,
-- display_name, avatar_url, visibility, bio, height_cm, weight_kg, dob,
-- gpa … — and the numbered chain has indexed, constrained and read them
-- ever since without ever adding them. This file records the 23 from the
-- Sep 14 2026 dump (database/provenance/dumps/2026-09-14-live-dump.csv)
-- with their live types and defaults, plus the three constraints, the one
-- index and the two triggers (with their functions) that exist ONLY for
-- these columns and that no numbered file names. A NO-OP on production,
-- drops nothing, re-runnable; the allowlist is EMPTY after this one.
--
-- Recorded as found:
--   * weight_kg and weight_display are numeric(5,2); gpa numeric(3,2);
--     weight_unit defaults to 'lbs'; visibility to 'public'.
--   * profiles_username_key (UNIQUE) and profiles_visibility_check
--     (public | private) carry their auto-generated names;
--     check_display_name_not_empty requires a non-blank display_name.
--   * Two BEFORE triggers derive names: auto_split_full_name (split_full_name:
--     full_name → first/last when those are empty) and
--     trigger_auto_update_display_name (auto_update_display_name: first +
--     last → full_name when empty — the name is historical). The chain's
--     own profiles_search_vector / profiles_search_doc / handle_updated_at
--     triggers stay with their owners.
--   * The live profiles POLICIES are named profiles_select_policy /
--     profiles_update_policy / profiles_profile_access_select — 001's
--     "Users can view their own profile" policies were replaced by an
--     archived script; only the third is named by a numbered file. Policy
--     provenance for chain-created tables (profiles, golf_rounds) is a
--     separate pass, like function provenance — this file is columns.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS height_cm integer,
  ADD COLUMN IF NOT EXISTS weight_kg numeric(5,2),
  ADD COLUMN IF NOT EXISTS dob date,
  ADD COLUMN IF NOT EXISTS class_year integer,
  ADD COLUMN IF NOT EXISTS social_twitter text,
  ADD COLUMN IF NOT EXISTS social_instagram text,
  ADD COLUMN IF NOT EXISTS social_facebook text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS weight_unit text DEFAULT 'lbs'::text,
  ADD COLUMN IF NOT EXISTS weight_display numeric(5,2),
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS sport text,
  ADD COLUMN IF NOT EXISTS school text,
  ADD COLUMN IF NOT EXISTS coach text,
  ADD COLUMN IF NOT EXISTS graduation_year integer,
  ADD COLUMN IF NOT EXISTS gpa numeric(3,2),
  ADD COLUMN IF NOT EXISTS sat_score integer,
  ADD COLUMN IF NOT EXISTS act_score integer,
  ADD COLUMN IF NOT EXISTS visibility text DEFAULT 'public'::text,
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_username_key' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_display_name_not_empty' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT check_display_name_not_empty CHECK (((display_name IS NOT NULL) AND (length(TRIM(BOTH FROM display_name)) > 0)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_visibility_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text])));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_visibility ON public.profiles USING btree (visibility);

-- ── The two name-deriving trigger functions (grid 7, verbatim) ──────────────
CREATE OR REPLACE FUNCTION public.split_full_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Only process if full_name changed and is not null
  IF NEW.full_name IS NOT NULL AND NEW.full_name != '' THEN
    -- If first_name is empty, extract it from full_name
    IF NEW.first_name IS NULL OR NEW.first_name = '' THEN
      NEW.first_name := SPLIT_PART(TRIM(NEW.full_name), ' ', 1);
    END IF;

    -- If last_name is empty, extract it from full_name
    IF NEW.last_name IS NULL OR NEW.last_name = '' THEN
      -- Check if there are multiple words in full_name
      IF ARRAY_LENGTH(STRING_TO_ARRAY(TRIM(NEW.full_name), ' '), 1) > 1 THEN
        NEW.last_name := TRIM(SUBSTRING(
          TRIM(NEW.full_name)
          FROM POSITION(' ' IN TRIM(NEW.full_name)) + 1
        ));
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_update_display_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Auto-generate display name from first/last name if empty
  IF NEW.first_name IS NOT NULL AND NEW.last_name IS NOT NULL THEN
    IF NEW.full_name IS NULL OR NEW.full_name = '' THEN
      NEW.full_name := NEW.first_name || ' ' || NEW.last_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS auto_split_full_name ON public.profiles;
CREATE TRIGGER auto_split_full_name BEFORE INSERT OR UPDATE OF full_name ON public.profiles FOR EACH ROW EXECUTE FUNCTION split_full_name();
DROP TRIGGER IF EXISTS trigger_auto_update_display_name ON public.profiles;
CREATE TRIGGER trigger_auto_update_display_name BEFORE INSERT OR UPDATE OF first_name, middle_name, last_name, full_name, username ON public.profiles FOR EACH ROW EXECUTE FUNCTION auto_update_display_name();

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT 'profiles: the 23 columns' AS check_name, '23' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 23 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'profiles'
   AND column_name IN ('username', 'full_name', 'bio', 'height_cm', 'weight_kg', 'dob', 'class_year', 'social_twitter', 'social_instagram', 'social_facebook', 'avatar_url', 'weight_unit', 'weight_display', 'display_name', 'sport', 'school', 'coach', 'graduation_year', 'gpa', 'sat_score', 'act_score', 'visibility', 'search_vector')

UNION ALL

SELECT 'profiles: columns', '66', count(*)::text,
       CASE WHEN count(*) = 66 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles'

UNION ALL

SELECT 'profiles: the three constraints', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass
   AND conname IN ('profiles_username_key', 'profiles_visibility_check', 'check_display_name_not_empty')

UNION ALL

SELECT 'profiles: idx_profiles_visibility', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_profiles_visibility'

UNION ALL

SELECT 'profiles: name triggers', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass
   AND tgname IN ('auto_split_full_name', 'trigger_auto_update_display_name')

UNION ALL

SELECT 'profiles: triggers', '7', count(*)::text,
       CASE WHEN count(*) = 7 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal

ORDER BY 1;

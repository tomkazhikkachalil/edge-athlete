-- ============================================================================
-- 191: BASELINE — the athlete legacy set, recorded from the live database
--      (data foundation, P3 — Sep 14 2026)
-- ============================================================================
-- sports · performances · season_highlights · athlete_badges ·
-- athlete_equipment · privacy_settings · connection_suggestions were created
-- by archived scripts (database/archive/old-migrations/athlete-profile-
-- schema.sql and supabase-athlete-schema.sql, archive/loose-legacy/create-
-- equipment-table.sql, archive/failed-attempts/implement-privacy-system.sql
-- and implement-notifications-system.sql — two of them under failed-attempts/,
-- which is why the live shape and not the file is what gets recorded). Same
-- method and same guarantees as 190: the LIVE shape from the Sep 14 2026 dump
-- (database/provenance/dumps/2026-09-14-live-dump.csv), every body
-- verbatim, a NO-OP on production, drops nothing, re-runnable.
--
-- What this one RECORDS as it found it:
--   * athlete_badges is delete-only in the app (account-deletion.ts) and has
--     never held a row (reltuples -1: never analysed). Tom's decision: record
--     now, DROP in a later one-line migration once confirmed — not here.
--   * performances is the hand-typed résumé row (event, place, a 0–100
--     "athletic_score") served by /api/performances — a different grain from
--     athlete_performances (194). Recorded, not reused.
--   * athlete_equipment carries both the old date pair (acquired_date, plus
--     retired_at) and the 064 pair (acquired_on, retired_on); id defaults to
--     uuid_generate_v4() (uuid-ossp), the only table in this set that does.
--     Its equipment_insert/update/delete policies use a bare auth.uid()
--     (not the (select auth.uid()) initplan form of 127) — verbatim.
--   * privacy_settings is fed by the sync_profile_privacy trigger ON
--     PROFILES (recorded here with its function, because the target table
--     must exist first); its per-facet columns admit 'friends' | 'inherit'
--     values nothing in the app reads.
--   * sports has an INSERT policy for any signed-in user and NO update /
--     delete policy; connection_suggestions has never held a row.
--   * season_highlights.rating is bare numeric (no precision).
--   * Grants are Supabase's defaults, RLS on everywhere, every policy
--     roles=public — as live.
-- Order: the four profile-only tables first, then the ones with their own
-- trigger functions.
-- ============================================================================

-- ── Trigger functions no numbered file defines (grid 7, verbatim) ───────────
CREATE OR REPLACE FUNCTION public.update_equipment_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_connection_suggestions_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_privacy_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- When visibility changes, update or create privacy_settings
  INSERT INTO public.privacy_settings (profile_id, profile_visibility)
  VALUES (NEW.id, NEW.visibility)
  ON CONFLICT (profile_id)
  DO UPDATE SET
    profile_visibility = NEW.visibility,
    updated_at = NOW();

  RETURN NEW;
END;
$function$;

-- ── sports — live: 6 columns · 3 constraints · 2 indexes · 2 policies · 1 triggers
CREATE TABLE IF NOT EXISTS public.sports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  sport_key text NOT NULL,
  active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT sports_pkey PRIMARY KEY (id),
  CONSTRAINT sports_profile_id_sport_key_key UNIQUE (profile_id, sport_key),
  CONSTRAINT sports_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- An existing table gets every column here (no numbered file ALTERs it).
ALTER TABLE public.sports
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS profile_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS sport_key text NOT NULL,
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sports_pkey' AND conrelid = 'public.sports'::regclass) THEN
    ALTER TABLE public.sports ADD CONSTRAINT sports_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sports_profile_id_sport_key_key' AND conrelid = 'public.sports'::regclass) THEN
    ALTER TABLE public.sports ADD CONSTRAINT sports_profile_id_sport_key_key UNIQUE (profile_id, sport_key);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sports_profile_id_fkey' AND conrelid = 'public.sports'::regclass) THEN
    ALTER TABLE public.sports ADD CONSTRAINT sports_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sports_active ON public.sports USING btree (profile_id, active);

ALTER TABLE public.sports ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.sports TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sports' AND policyname = 'sports_insert_policy') THEN
    CREATE POLICY sports_insert_policy ON public.sports FOR INSERT
      WITH CHECK (( SELECT auth.uid() AS uid) IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sports' AND policyname = 'sports_select_policy') THEN
    CREATE POLICY sports_select_policy ON public.sports FOR SELECT
      USING (true);
  END IF;
END $$;

DROP TRIGGER IF EXISTS handle_updated_at_sports ON public.sports;
CREATE TRIGGER handle_updated_at_sports BEFORE UPDATE ON public.sports FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ── performances — live: 10 columns · 3 constraints · 1 indexes · 5 policies · 1 triggers
CREATE TABLE IF NOT EXISTS public.performances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  date date NOT NULL,
  event text NOT NULL,
  result_place text,
  stat_primary text,
  organization text,
  athletic_score numeric,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT performances_pkey PRIMARY KEY (id),
  CONSTRAINT performances_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT performances_athletic_score_check CHECK (((athletic_score >= (0)::numeric) AND (athletic_score <= (100)::numeric)))
);

-- An existing table gets every column here (no numbered file ALTERs it).
ALTER TABLE public.performances
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS profile_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS date date NOT NULL,
  ADD COLUMN IF NOT EXISTS event text NOT NULL,
  ADD COLUMN IF NOT EXISTS result_place text,
  ADD COLUMN IF NOT EXISTS stat_primary text,
  ADD COLUMN IF NOT EXISTS organization text,
  ADD COLUMN IF NOT EXISTS athletic_score numeric,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performances_pkey' AND conrelid = 'public.performances'::regclass) THEN
    ALTER TABLE public.performances ADD CONSTRAINT performances_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performances_profile_id_fkey' AND conrelid = 'public.performances'::regclass) THEN
    ALTER TABLE public.performances ADD CONSTRAINT performances_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performances_athletic_score_check' AND conrelid = 'public.performances'::regclass) THEN
    ALTER TABLE public.performances ADD CONSTRAINT performances_athletic_score_check CHECK (((athletic_score >= (0)::numeric) AND (athletic_score <= (100)::numeric)));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_performances_profile_id ON public.performances USING btree (profile_id);

ALTER TABLE public.performances ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.performances TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'performances' AND policyname = 'performances_delete_policy') THEN
    CREATE POLICY performances_delete_policy ON public.performances FOR DELETE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'performances' AND policyname = 'performances_insert_policy') THEN
    CREATE POLICY performances_insert_policy ON public.performances FOR INSERT
      WITH CHECK (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'performances' AND policyname = 'performances_profile_access_select') THEN
    CREATE POLICY performances_profile_access_select ON public.performances FOR SELECT
      USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'performances' AND policyname = 'performances_select_policy') THEN
    CREATE POLICY performances_select_policy ON public.performances FOR SELECT
      USING ((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
         FROM profiles
        WHERE ((profiles.id = performances.profile_id) AND ((profiles.visibility = 'public'::text) OR (EXISTS ( SELECT 1
                 FROM follows
                WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = performances.profile_id) AND (follows.status = 'accepted'::text)))))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'performances' AND policyname = 'performances_update_policy') THEN
    CREATE POLICY performances_update_policy ON public.performances FOR UPDATE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

DROP TRIGGER IF EXISTS handle_updated_at_performances ON public.performances;
CREATE TRIGGER handle_updated_at_performances BEFORE UPDATE ON public.performances FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ── season_highlights — live: 10 columns · 4 constraints · 3 indexes · 5 policies · 1 triggers
CREATE TABLE IF NOT EXISTS public.season_highlights (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  sport_key text NOT NULL,
  season text NOT NULL,
  metric_a text,
  metric_b text,
  metric_c text,
  rating numeric,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT season_highlights_pkey PRIMARY KEY (id),
  CONSTRAINT season_highlights_profile_id_sport_key_season_key UNIQUE (profile_id, sport_key, season),
  CONSTRAINT season_highlights_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT season_highlights_rating_check CHECK (((rating >= (0)::numeric) AND (rating <= (100)::numeric)))
);

-- An existing table gets every column here (no numbered file ALTERs it).
ALTER TABLE public.season_highlights
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS profile_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS sport_key text NOT NULL,
  ADD COLUMN IF NOT EXISTS season text NOT NULL,
  ADD COLUMN IF NOT EXISTS metric_a text,
  ADD COLUMN IF NOT EXISTS metric_b text,
  ADD COLUMN IF NOT EXISTS metric_c text,
  ADD COLUMN IF NOT EXISTS rating numeric,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'season_highlights_pkey' AND conrelid = 'public.season_highlights'::regclass) THEN
    ALTER TABLE public.season_highlights ADD CONSTRAINT season_highlights_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'season_highlights_profile_id_sport_key_season_key' AND conrelid = 'public.season_highlights'::regclass) THEN
    ALTER TABLE public.season_highlights ADD CONSTRAINT season_highlights_profile_id_sport_key_season_key UNIQUE (profile_id, sport_key, season);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'season_highlights_profile_id_fkey' AND conrelid = 'public.season_highlights'::regclass) THEN
    ALTER TABLE public.season_highlights ADD CONSTRAINT season_highlights_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'season_highlights_rating_check' AND conrelid = 'public.season_highlights'::regclass) THEN
    ALTER TABLE public.season_highlights ADD CONSTRAINT season_highlights_rating_check CHECK (((rating >= (0)::numeric) AND (rating <= (100)::numeric)));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_season_highlights_season ON public.season_highlights USING btree (profile_id, season);
CREATE INDEX IF NOT EXISTS idx_season_highlights_sport ON public.season_highlights USING btree (profile_id, sport_key);

ALTER TABLE public.season_highlights ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.season_highlights TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'season_highlights' AND policyname = 'season_highlights_delete_policy') THEN
    CREATE POLICY season_highlights_delete_policy ON public.season_highlights FOR DELETE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'season_highlights' AND policyname = 'season_highlights_insert_policy') THEN
    CREATE POLICY season_highlights_insert_policy ON public.season_highlights FOR INSERT
      WITH CHECK (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'season_highlights' AND policyname = 'season_highlights_profile_access_select') THEN
    CREATE POLICY season_highlights_profile_access_select ON public.season_highlights FOR SELECT
      USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'season_highlights' AND policyname = 'season_highlights_select_policy') THEN
    CREATE POLICY season_highlights_select_policy ON public.season_highlights FOR SELECT
      USING ((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
         FROM profiles
        WHERE ((profiles.id = season_highlights.profile_id) AND ((profiles.visibility = 'public'::text) OR (EXISTS ( SELECT 1
                 FROM follows
                WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = season_highlights.profile_id) AND (follows.status = 'accepted'::text)))))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'season_highlights' AND policyname = 'season_highlights_update_policy') THEN
    CREATE POLICY season_highlights_update_policy ON public.season_highlights FOR UPDATE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

DROP TRIGGER IF EXISTS handle_updated_at_season_highlights ON public.season_highlights;
CREATE TRIGGER handle_updated_at_season_highlights BEFORE UPDATE ON public.season_highlights FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ── athlete_badges — live: 8 columns · 2 constraints · 2 indexes · 4 policies · 1 triggers
CREATE TABLE IF NOT EXISTS public.athlete_badges (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  label text NOT NULL,
  icon_url text,
  color_token text DEFAULT 'primary'::text,
  "position" integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT athlete_badges_pkey PRIMARY KEY (id),
  CONSTRAINT athlete_badges_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- An existing table gets every column here (no numbered file ALTERs it).
ALTER TABLE public.athlete_badges
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS profile_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS label text NOT NULL,
  ADD COLUMN IF NOT EXISTS icon_url text,
  ADD COLUMN IF NOT EXISTS color_token text DEFAULT 'primary'::text,
  ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_badges_pkey' AND conrelid = 'public.athlete_badges'::regclass) THEN
    ALTER TABLE public.athlete_badges ADD CONSTRAINT athlete_badges_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_badges_profile_id_fkey' AND conrelid = 'public.athlete_badges'::regclass) THEN
    ALTER TABLE public.athlete_badges ADD CONSTRAINT athlete_badges_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_athlete_badges_position ON public.athlete_badges USING btree (profile_id, "position");
CREATE INDEX IF NOT EXISTS idx_athlete_badges_profile_id ON public.athlete_badges USING btree (profile_id);

ALTER TABLE public.athlete_badges ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.athlete_badges TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_badges' AND policyname = 'athlete_badges_delete_policy') THEN
    CREATE POLICY athlete_badges_delete_policy ON public.athlete_badges FOR DELETE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_badges' AND policyname = 'athlete_badges_insert_policy') THEN
    CREATE POLICY athlete_badges_insert_policy ON public.athlete_badges FOR INSERT
      WITH CHECK (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_badges' AND policyname = 'athlete_badges_select_policy') THEN
    CREATE POLICY athlete_badges_select_policy ON public.athlete_badges FOR SELECT
      USING ((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
         FROM profiles
        WHERE ((profiles.id = athlete_badges.profile_id) AND (profiles.visibility = 'public'::text)))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_badges' AND policyname = 'athlete_badges_update_policy') THEN
    CREATE POLICY athlete_badges_update_policy ON public.athlete_badges FOR UPDATE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

DROP TRIGGER IF EXISTS handle_updated_at_athlete_badges ON public.athlete_badges;
CREATE TRIGGER handle_updated_at_athlete_badges BEFORE UPDATE ON public.athlete_badges FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ── athlete_equipment — live: 18 columns · 4 constraints · 4 indexes · 6 policies · 1 triggers
CREATE TABLE IF NOT EXISTS public.athlete_equipment (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  profile_id uuid NOT NULL,
  sport_key text,
  category text NOT NULL,
  brand text NOT NULL,
  model text NOT NULL,
  image_url text,
  specs jsonb,
  status text DEFAULT 'active'::text,
  acquired_date date,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  added_at timestamp with time zone DEFAULT now(),
  retired_at timestamp with time zone,
  acquired_on date DEFAULT CURRENT_DATE,
  retired_on date,
  group_label text,
  CONSTRAINT athlete_equipment_pkey PRIMARY KEY (id),
  CONSTRAINT athlete_equipment_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT athlete_equipment_status_check CHECK ((status = ANY (ARRAY['active'::text, 'retired'::text]))),
  CONSTRAINT equipment_retired_after_acquired CHECK (((retired_on IS NULL) OR (acquired_on IS NULL) OR (retired_on >= acquired_on)))
);

-- An existing table gets the columns no numbered file adds (the chain
-- ALTERs the other 5 in 044, 064, 076).
ALTER TABLE public.athlete_equipment
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT uuid_generate_v4(),
  ADD COLUMN IF NOT EXISTS profile_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS sport_key text,
  ADD COLUMN IF NOT EXISTS category text NOT NULL,
  ADD COLUMN IF NOT EXISTS brand text NOT NULL,
  ADD COLUMN IF NOT EXISTS model text NOT NULL,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS specs jsonb,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'::text,
  ADD COLUMN IF NOT EXISTS acquired_date date,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_equipment_pkey' AND conrelid = 'public.athlete_equipment'::regclass) THEN
    ALTER TABLE public.athlete_equipment ADD CONSTRAINT athlete_equipment_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_equipment_profile_id_fkey' AND conrelid = 'public.athlete_equipment'::regclass) THEN
    ALTER TABLE public.athlete_equipment ADD CONSTRAINT athlete_equipment_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_equipment_status_check' AND conrelid = 'public.athlete_equipment'::regclass) THEN
    ALTER TABLE public.athlete_equipment ADD CONSTRAINT athlete_equipment_status_check CHECK ((status = ANY (ARRAY['active'::text, 'retired'::text])));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_retired_after_acquired' AND conrelid = 'public.athlete_equipment'::regclass) THEN
    ALTER TABLE public.athlete_equipment ADD CONSTRAINT equipment_retired_after_acquired CHECK (((retired_on IS NULL) OR (acquired_on IS NULL) OR (retired_on >= acquired_on)));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_equipment_category ON public.athlete_equipment USING btree (category);
CREATE INDEX IF NOT EXISTS idx_equipment_profile ON public.athlete_equipment USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_equipment_sport ON public.athlete_equipment USING btree (sport_key);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON public.athlete_equipment USING btree (status);

ALTER TABLE public.athlete_equipment ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.athlete_equipment TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_equipment' AND policyname = 'athlete_equipment_guardian_write') THEN
    CREATE POLICY athlete_equipment_guardian_write ON public.athlete_equipment FOR ALL
      USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
      WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_equipment' AND policyname = 'athlete_equipment_profile_access_select') THEN
    CREATE POLICY athlete_equipment_profile_access_select ON public.athlete_equipment FOR SELECT
      USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_equipment' AND policyname = 'equipment_delete_policy') THEN
    CREATE POLICY equipment_delete_policy ON public.athlete_equipment FOR DELETE
      USING (profile_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_equipment' AND policyname = 'equipment_insert_policy') THEN
    CREATE POLICY equipment_insert_policy ON public.athlete_equipment FOR INSERT
      WITH CHECK (profile_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_equipment' AND policyname = 'equipment_select_policy') THEN
    CREATE POLICY equipment_select_policy ON public.athlete_equipment FOR SELECT
      USING ((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
         FROM profiles p
        WHERE ((p.id = athlete_equipment.profile_id) AND (p.visibility = 'public'::text)))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_equipment' AND policyname = 'equipment_update_policy') THEN
    CREATE POLICY equipment_update_policy ON public.athlete_equipment FOR UPDATE
      USING (profile_id = auth.uid());
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_equipment_updated_at ON public.athlete_equipment;
CREATE TRIGGER trigger_equipment_updated_at BEFORE UPDATE ON public.athlete_equipment FOR EACH ROW EXECUTE FUNCTION update_equipment_updated_at();

-- ── privacy_settings — live: 9 columns · 8 constraints · 2 indexes · 3 policies · 0 triggers
CREATE TABLE IF NOT EXISTS public.privacy_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  profile_visibility text DEFAULT 'public'::text,
  media_visibility text DEFAULT 'inherit'::text,
  stats_visibility text DEFAULT 'inherit'::text,
  posts_visibility text DEFAULT 'inherit'::text,
  activity_visibility text DEFAULT 'inherit'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT privacy_settings_pkey PRIMARY KEY (id),
  CONSTRAINT privacy_settings_profile_id_key UNIQUE (profile_id),
  CONSTRAINT privacy_settings_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT privacy_settings_activity_visibility_check CHECK ((activity_visibility = ANY (ARRAY['public'::text, 'private'::text, 'friends'::text, 'inherit'::text]))),
  CONSTRAINT privacy_settings_media_visibility_check CHECK ((media_visibility = ANY (ARRAY['public'::text, 'private'::text, 'friends'::text, 'inherit'::text]))),
  CONSTRAINT privacy_settings_posts_visibility_check CHECK ((posts_visibility = ANY (ARRAY['public'::text, 'private'::text, 'friends'::text, 'inherit'::text]))),
  CONSTRAINT privacy_settings_profile_visibility_check CHECK ((profile_visibility = ANY (ARRAY['public'::text, 'private'::text]))),
  CONSTRAINT privacy_settings_stats_visibility_check CHECK ((stats_visibility = ANY (ARRAY['public'::text, 'private'::text, 'friends'::text, 'inherit'::text])))
);

-- An existing table gets every column here (no numbered file ALTERs it).
ALTER TABLE public.privacy_settings
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS profile_id uuid,
  ADD COLUMN IF NOT EXISTS profile_visibility text DEFAULT 'public'::text,
  ADD COLUMN IF NOT EXISTS media_visibility text DEFAULT 'inherit'::text,
  ADD COLUMN IF NOT EXISTS stats_visibility text DEFAULT 'inherit'::text,
  ADD COLUMN IF NOT EXISTS posts_visibility text DEFAULT 'inherit'::text,
  ADD COLUMN IF NOT EXISTS activity_visibility text DEFAULT 'inherit'::text,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_pkey' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_profile_id_key' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_profile_id_key UNIQUE (profile_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_profile_id_fkey' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_activity_visibility_check' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_activity_visibility_check CHECK ((activity_visibility = ANY (ARRAY['public'::text, 'private'::text, 'friends'::text, 'inherit'::text])));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_media_visibility_check' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_media_visibility_check CHECK ((media_visibility = ANY (ARRAY['public'::text, 'private'::text, 'friends'::text, 'inherit'::text])));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_posts_visibility_check' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_posts_visibility_check CHECK ((posts_visibility = ANY (ARRAY['public'::text, 'private'::text, 'friends'::text, 'inherit'::text])));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_profile_visibility_check' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_profile_visibility_check CHECK ((profile_visibility = ANY (ARRAY['public'::text, 'private'::text])));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_stats_visibility_check' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_stats_visibility_check CHECK ((stats_visibility = ANY (ARRAY['public'::text, 'private'::text, 'friends'::text, 'inherit'::text])));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_privacy_settings_profile ON public.privacy_settings USING btree (profile_id);

ALTER TABLE public.privacy_settings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.privacy_settings TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'privacy_settings' AND policyname = 'privacy_settings_insert_policy') THEN
    CREATE POLICY privacy_settings_insert_policy ON public.privacy_settings FOR INSERT
      WITH CHECK (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'privacy_settings' AND policyname = 'privacy_settings_select_policy') THEN
    CREATE POLICY privacy_settings_select_policy ON public.privacy_settings FOR SELECT
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'privacy_settings' AND policyname = 'privacy_settings_update_policy') THEN
    CREATE POLICY privacy_settings_update_policy ON public.privacy_settings FOR UPDATE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

-- ── connection_suggestions — live: 8 columns · 4 constraints · 4 indexes · 4 policies · 1 triggers
CREATE TABLE IF NOT EXISTS public.connection_suggestions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  suggested_profile_id uuid NOT NULL,
  score numeric(3,2) DEFAULT 0.5,
  reason text,
  dismissed boolean DEFAULT false,
  dismissed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT connection_suggestions_pkey PRIMARY KEY (id),
  CONSTRAINT unique_suggestion UNIQUE (profile_id, suggested_profile_id),
  CONSTRAINT connection_suggestions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT connection_suggestions_suggested_profile_id_fkey FOREIGN KEY (suggested_profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- An existing table gets every column here (no numbered file ALTERs it).
ALTER TABLE public.connection_suggestions
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS profile_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS suggested_profile_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS score numeric(3,2) DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS dismissed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dismissed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connection_suggestions_pkey' AND conrelid = 'public.connection_suggestions'::regclass) THEN
    ALTER TABLE public.connection_suggestions ADD CONSTRAINT connection_suggestions_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_suggestion' AND conrelid = 'public.connection_suggestions'::regclass) THEN
    ALTER TABLE public.connection_suggestions ADD CONSTRAINT unique_suggestion UNIQUE (profile_id, suggested_profile_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connection_suggestions_profile_id_fkey' AND conrelid = 'public.connection_suggestions'::regclass) THEN
    ALTER TABLE public.connection_suggestions ADD CONSTRAINT connection_suggestions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connection_suggestions_suggested_profile_id_fkey' AND conrelid = 'public.connection_suggestions'::regclass) THEN
    ALTER TABLE public.connection_suggestions ADD CONSTRAINT connection_suggestions_suggested_profile_id_fkey FOREIGN KEY (suggested_profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_connection_suggestions_dismissed ON public.connection_suggestions USING btree (profile_id, dismissed) WHERE (dismissed = true);
CREATE INDEX IF NOT EXISTS idx_connection_suggestions_profile ON public.connection_suggestions USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_connection_suggestions_suggested_profile_id ON public.connection_suggestions USING btree (suggested_profile_id);

ALTER TABLE public.connection_suggestions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.connection_suggestions TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'connection_suggestions' AND policyname = 'connection_suggestions_delete_policy') THEN
    CREATE POLICY connection_suggestions_delete_policy ON public.connection_suggestions FOR DELETE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'connection_suggestions' AND policyname = 'connection_suggestions_insert_policy') THEN
    CREATE POLICY connection_suggestions_insert_policy ON public.connection_suggestions FOR INSERT
      WITH CHECK (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'connection_suggestions' AND policyname = 'connection_suggestions_select_policy') THEN
    CREATE POLICY connection_suggestions_select_policy ON public.connection_suggestions FOR SELECT
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'connection_suggestions' AND policyname = 'connection_suggestions_update_policy') THEN
    CREATE POLICY connection_suggestions_update_policy ON public.connection_suggestions FOR UPDATE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_connection_suggestions_updated_at ON public.connection_suggestions;
CREATE TRIGGER trigger_connection_suggestions_updated_at BEFORE UPDATE ON public.connection_suggestions FOR EACH ROW EXECUTE FUNCTION update_connection_suggestions_updated_at();

-- The trigger that FEEDS privacy_settings lives on profiles (001): recorded
-- with the table it writes.
DROP TRIGGER IF EXISTS sync_profile_privacy ON public.profiles;
CREATE TRIGGER sync_profile_privacy AFTER INSERT OR UPDATE OF visibility ON public.profiles FOR EACH ROW EXECUTE FUNCTION sync_privacy_settings();

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
SELECT 'sports: columns' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sports'

UNION ALL

SELECT 'sports: constraints', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sports'::regclass

UNION ALL

SELECT 'sports: indexes', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sports'

UNION ALL

SELECT 'sports: policies', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sports'

UNION ALL

SELECT 'sports: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.sports'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'sports: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.sports'::regclass

UNION ALL

SELECT 'performances: columns' AS check_name, '10' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 10 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'performances'

UNION ALL

SELECT 'performances: constraints', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.performances'::regclass

UNION ALL

SELECT 'performances: indexes', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'performances'

UNION ALL

SELECT 'performances: policies', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'performances'

UNION ALL

SELECT 'performances: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.performances'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'performances: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.performances'::regclass

UNION ALL

SELECT 'season_highlights: columns' AS check_name, '10' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 10 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'season_highlights'

UNION ALL

SELECT 'season_highlights: constraints', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.season_highlights'::regclass

UNION ALL

SELECT 'season_highlights: indexes', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'season_highlights'

UNION ALL

SELECT 'season_highlights: policies', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'season_highlights'

UNION ALL

SELECT 'season_highlights: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.season_highlights'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'season_highlights: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.season_highlights'::regclass

UNION ALL

SELECT 'athlete_badges: columns' AS check_name, '8' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 8 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'athlete_badges'

UNION ALL

SELECT 'athlete_badges: constraints', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.athlete_badges'::regclass

UNION ALL

SELECT 'athlete_badges: indexes', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'athlete_badges'

UNION ALL

SELECT 'athlete_badges: policies', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_badges'

UNION ALL

SELECT 'athlete_badges: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.athlete_badges'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'athlete_badges: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.athlete_badges'::regclass

UNION ALL

SELECT 'athlete_equipment: columns' AS check_name, '18' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 18 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'athlete_equipment'

UNION ALL

SELECT 'athlete_equipment: constraints', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.athlete_equipment'::regclass

UNION ALL

SELECT 'athlete_equipment: indexes', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'athlete_equipment'

UNION ALL

SELECT 'athlete_equipment: policies', '6', count(*)::text,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_equipment'

UNION ALL

SELECT 'athlete_equipment: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.athlete_equipment'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'athlete_equipment: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.athlete_equipment'::regclass

UNION ALL

SELECT 'privacy_settings: columns' AS check_name, '9' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 9 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'privacy_settings'

UNION ALL

SELECT 'privacy_settings: constraints', '8', count(*)::text,
       CASE WHEN count(*) = 8 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.privacy_settings'::regclass

UNION ALL

SELECT 'privacy_settings: indexes', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'privacy_settings'

UNION ALL

SELECT 'privacy_settings: policies', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'privacy_settings'

UNION ALL

SELECT 'privacy_settings: triggers', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.privacy_settings'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'privacy_settings: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.privacy_settings'::regclass

UNION ALL

SELECT 'connection_suggestions: columns' AS check_name, '8' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 8 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'connection_suggestions'

UNION ALL

SELECT 'connection_suggestions: constraints', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.connection_suggestions'::regclass

UNION ALL

SELECT 'connection_suggestions: indexes', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'connection_suggestions'

UNION ALL

SELECT 'connection_suggestions: policies', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'connection_suggestions'

UNION ALL

SELECT 'connection_suggestions: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.connection_suggestions'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'connection_suggestions: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.connection_suggestions'::regclass

ORDER BY 1;

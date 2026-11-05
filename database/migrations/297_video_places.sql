-- ============================================================================
-- 297: the places a linked video can sit on, beyond an event or a contest
--      (Nov 5 2026; the Videos program, Phase 1b — Tom: "any area where you
--      can upload videos should have the YouTube integration"). Runs on BOTH
--      staging and prod BEFORE the code deploys.
-- ============================================================================
-- Three more nullable places on `videos` (296): a golf round (group_posts),
-- an activity, a workout session — each ON DELETE SET NULL (the place goes,
-- the link stays the owner's). The one-place rule widens from two columns to
-- five. Who may attach a video to a place mirrors the place's own write rule
-- (the creator or a confirmed participant; the activity's owner or guardian;
-- the workout's owner) — app code, videos-server.ts. No profile FK here, so
-- departure needs no new classification (videos rows already go with the
-- profile).
--
-- REVERSAL: ALTER TABLE public.videos DROP CONSTRAINT videos_one_place_check;
--           ALTER TABLE public.videos ADD CONSTRAINT videos_one_place_check
--             CHECK (num_nonnulls(sport_event_id, contest_id) <= 1);
--           ALTER TABLE public.videos DROP COLUMN group_post_id, DROP COLUMN activity_id,
--             DROP COLUMN workout_session_id;
-- A second run stops in the pre-flight.
-- ============================================================================

DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 297) THEN
    RAISE EXCEPTION '297 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 296 THEN RAISE EXCEPTION '297 pre-flight: ledger head is %, expected 296', n; END IF;
END $$;

ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS group_post_id uuid;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS activity_id uuid;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS workout_session_id uuid;

ALTER TABLE public.videos ADD CONSTRAINT videos_group_post_id_fkey FOREIGN KEY (group_post_id) REFERENCES public.group_posts(id) ON DELETE SET NULL;
ALTER TABLE public.videos ADD CONSTRAINT videos_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE SET NULL;
ALTER TABLE public.videos ADD CONSTRAINT videos_workout_session_id_fkey FOREIGN KEY (workout_session_id) REFERENCES public.workout_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS videos_group_post_id_idx ON public.videos (group_post_id);
CREATE INDEX IF NOT EXISTS videos_activity_id_idx ON public.videos (activity_id);
CREATE INDEX IF NOT EXISTS videos_workout_session_id_idx ON public.videos (workout_session_id);

ALTER TABLE public.videos DROP CONSTRAINT IF EXISTS videos_one_place_check;
ALTER TABLE public.videos ADD CONSTRAINT videos_one_place_check CHECK (num_nonnulls(sport_event_id, contest_id, group_post_id, activity_id, workout_session_id) <= 1);

COMMENT ON TABLE public.videos IS 'A linked long video (YouTube) owned by a profile XOR an org, optionally placed on ONE of: a sport event, a contest, a golf round (group_posts), an activity, a workout session (296, 297). The embed is rebuilt from provider_video_id. ONE writer: src/lib/videos/videos-server.ts. Posture A.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (297, '297_video_places.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 297 APPLIED | 3 | 297
SELECT '297 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'videos' AND column_name IN ('group_post_id', 'activity_id', 'workout_session_id')) AS columns_expect_3,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_297;

-- ============================================================================
-- 296: videos + video_highlights (Nov 4 2026; Tom: a full game, a tournament,
--      a long broadcast is a YouTube LINK, not an upload). Runs on BOTH
--      staging and prod BEFORE the code deploys.
-- ============================================================================
-- Why a new pair and not a post_media kind: post_media's image|video CHECK
-- is shared by four sibling tables, the media jobs and the storage sweep run
-- on every row, and ~50 files branch on 'image' | 'video'. A linked video is
-- its own thing: the provider's id (never a URL — the embed is rebuilt from
-- the id against the CSP's one host list), the owner (a profile XOR an org,
-- the events_one_scope_check precedent), an optional place (a sport event
-- XOR a contest), a title, and its markers. A highlight is a playback cue —
-- a start in milliseconds, an optional end, a label, sport metadata — never
-- an access-controlled clip.
--
-- Posture A: RLS on, ZERO policies, service role only. Authorization lives in
-- app code: the pure rule src/lib/videos/rules.ts and the ONE writer
-- src/lib/videos/videos-server.ts. Hidden rows (status = 'hidden') are the
-- owner's "Only me" / the org's "Managers only" — who sees a PUBLISHED row is
-- the account's privacy (profile visibility / follow, org visibility, event
-- visibility), never a per-video audience (Tom's posting privacy rule).
--
-- Also here: the reserved_handles seed for the new root segment /videos
-- (the 245 precedent — RESERVED_ROOT_SLUGS carries it in code).
--
-- REVERSAL: DROP TABLE public.video_highlights; DROP TABLE public.videos;
--           DELETE FROM reserved_handles WHERE handle = 'videos';
-- A second run stops in the pre-flight.
-- ============================================================================

DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 296) THEN
    RAISE EXCEPTION '296 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 295 THEN RAISE EXCEPTION '296 pre-flight: ledger head is %, expected 295', n; END IF;
END $$;

-- ── 1. videos ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'youtube' CHECK (provider IN ('youtube')),
  provider_video_id text NOT NULL CHECK (char_length(provider_video_id) BETWEEN 1 AND 64),
  profile_id uuid,
  org_id uuid,
  sport_event_id uuid,
  contest_id uuid,
  created_by_user_id uuid,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  sport_key text,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms > 0),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT videos_one_owner_check CHECK (num_nonnulls(profile_id, org_id) = 1),
  CONSTRAINT videos_one_place_check CHECK (num_nonnulls(sport_event_id, contest_id) <= 1)
);
ALTER TABLE public.videos ADD CONSTRAINT videos_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.videos ADD CONSTRAINT videos_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.videos ADD CONSTRAINT videos_sport_event_id_fkey FOREIGN KEY (sport_event_id) REFERENCES public.sport_events(id) ON DELETE SET NULL;
ALTER TABLE public.videos ADD CONSTRAINT videos_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES public.contests(id) ON DELETE SET NULL;
ALTER TABLE public.videos ADD CONSTRAINT videos_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS videos_profile_id_idx ON public.videos (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS videos_org_id_idx ON public.videos (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS videos_sport_event_id_idx ON public.videos (sport_event_id);
CREATE INDEX IF NOT EXISTS videos_contest_id_idx ON public.videos (contest_id);
CREATE INDEX IF NOT EXISTS videos_created_by_user_id_idx ON public.videos (created_by_user_id);
-- The same YouTube video once per owner (a club and a player may both link it).
CREATE UNIQUE INDEX IF NOT EXISTS videos_provider_owner_uidx ON public.videos (provider, provider_video_id, coalesce(profile_id, org_id));
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.videos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.videos TO service_role;
COMMENT ON TABLE public.videos IS 'A linked long video (YouTube) owned by a profile XOR an org, optionally placed on a sport event XOR a contest (296). The embed is rebuilt from provider_video_id. ONE writer: src/lib/videos/videos-server.ts. Posture A.';

-- ── 2. video_highlights ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL,
  start_ms integer NOT NULL CHECK (start_ms >= 0),
  end_ms integer CHECK (end_ms IS NULL OR end_ms > start_ms),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.video_highlights ADD CONSTRAINT video_highlights_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;
ALTER TABLE public.video_highlights ADD CONSTRAINT video_highlights_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS video_highlights_video_id_start_ms_idx ON public.video_highlights (video_id, start_ms);
CREATE INDEX IF NOT EXISTS video_highlights_created_by_user_id_idx ON public.video_highlights (created_by_user_id);
ALTER TABLE public.video_highlights ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_highlights FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.video_highlights TO service_role;
COMMENT ON TABLE public.video_highlights IS 'A playback cue on a linked video (296): start_ms, optional end_ms, a label, sport metadata in meta (hole, score, note). Ordered by start_ms. Never an access-controlled clip. Posture A.';

-- ── 3. The new root segment ─────────────────────────────────────────────────
INSERT INTO reserved_handles (handle, reason)
VALUES ('videos', 'Root path (vanity namespace, 296): /videos/[id], the video page')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (296, '296_videos.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 296 APPLIED | 2 | 1 | false | 296
SELECT '296 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('videos', 'video_highlights')) AS tables_expect_2,
       (SELECT count(*) FROM reserved_handles WHERE handle = 'videos') AS reserved_expect_1,
       has_table_privilege('anon', 'public.videos', 'SELECT') AS anon_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_296;

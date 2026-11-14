-- ============================================================================
-- 308: game film — "this is me": a request to be linked to the tags of a game
--      (Nov 13 2026; game film round 2, PR 4). Runs on BOTH staging and prod
--      BEFORE the code deploys.
-- ============================================================================
-- Tom's rule: most of a roster is not on Edge Athlete, so a club tags a typed
-- name or a player without an account. When the player has an account they
-- ASK to have those clips and stats on their profile, and a manager of the
-- video approves — choosing which name (or which placeholder player) they
-- are. A manager can also link a name directly. Nobody attaches someone
-- else's stats to themselves: the request does nothing until it is approved.
--
--   video_tag_claims — one row per request.
--     video_id              the game the request was made on (the link then
--                           covers every video of that owner: one decision).
--     requester_profile_id  who asks to be linked.
--     requested_by_user_id  who pressed the button (a guardian, for a child).
--     asked_name            the name they say they are under (optional).
--     status                pending | approved | declined.
--     target_name / target_profile_id   what the manager linked on approval:
--                           a typed name, or a placeholder player's profile.
--     linked_count          how many tags moved.
--
-- Posture A: RLS on, no policies, service role only — the one writer is
-- src/lib/videos/video-claims-server.ts (the tags themselves are moved by
-- videos-server.ts, the one writer of video_highlight_people). Created EMPTY,
-- so the indexes are inline. Every FK is a named ALTER with its own index
-- (fk-index-coverage). requester_profile_id CASCADEs → PROFILE_FK_POLICY
-- 'goes' (a request is the person's own; the tags it moved are the game's
-- record and stay, under 307's 'survives').
--
-- REVERSAL: DROP TABLE public.video_tag_claims;
-- A second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 308) THEN
    RAISE EXCEPTION '308 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 307 THEN RAISE EXCEPTION '308 pre-flight: ledger head is %, expected 307', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'video_highlight_people') THEN
    RAISE EXCEPTION '308 pre-flight: public.video_highlight_people is missing — 307 has not run here';
  END IF;
END $$;

-- ── 1. video_tag_claims ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_tag_claims (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL,
  requester_profile_id uuid NOT NULL,
  requested_by_user_id uuid,
  asked_name text CHECK (asked_name IS NULL OR char_length(asked_name) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  target_name text CHECK (target_name IS NULL OR char_length(target_name) BETWEEN 1 AND 80),
  target_profile_id uuid,
  linked_count integer CHECK (linked_count IS NULL OR linked_count >= 0),
  decided_by_user_id uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT video_tag_claims_one_target_check CHECK (num_nonnulls(target_name, target_profile_id) <= 1)
);
ALTER TABLE public.video_tag_claims DROP CONSTRAINT IF EXISTS video_tag_claims_pkey;
ALTER TABLE public.video_tag_claims ADD CONSTRAINT video_tag_claims_pkey PRIMARY KEY (id);
ALTER TABLE public.video_tag_claims DROP CONSTRAINT IF EXISTS video_tag_claims_video_id_fkey;
ALTER TABLE public.video_tag_claims ADD CONSTRAINT video_tag_claims_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;
ALTER TABLE public.video_tag_claims DROP CONSTRAINT IF EXISTS video_tag_claims_requester_profile_id_fkey;
ALTER TABLE public.video_tag_claims ADD CONSTRAINT video_tag_claims_requester_profile_id_fkey FOREIGN KEY (requester_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.video_tag_claims DROP CONSTRAINT IF EXISTS video_tag_claims_requested_by_user_id_fkey;
ALTER TABLE public.video_tag_claims ADD CONSTRAINT video_tag_claims_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.video_tag_claims DROP CONSTRAINT IF EXISTS video_tag_claims_target_profile_id_fkey;
ALTER TABLE public.video_tag_claims ADD CONSTRAINT video_tag_claims_target_profile_id_fkey FOREIGN KEY (target_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.video_tag_claims DROP CONSTRAINT IF EXISTS video_tag_claims_decided_by_user_id_fkey;
ALTER TABLE public.video_tag_claims ADD CONSTRAINT video_tag_claims_decided_by_user_id_fkey FOREIGN KEY (decided_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
-- One open request per person per game.
CREATE UNIQUE INDEX IF NOT EXISTS video_tag_claims_one_pending_uidx ON public.video_tag_claims (video_id, requester_profile_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS video_tag_claims_video_id_idx ON public.video_tag_claims (video_id);
CREATE INDEX IF NOT EXISTS video_tag_claims_requester_profile_id_idx ON public.video_tag_claims (requester_profile_id);
CREATE INDEX IF NOT EXISTS video_tag_claims_requested_by_user_id_idx ON public.video_tag_claims (requested_by_user_id);
CREATE INDEX IF NOT EXISTS video_tag_claims_target_profile_id_idx ON public.video_tag_claims (target_profile_id);
CREATE INDEX IF NOT EXISTS video_tag_claims_decided_by_user_id_idx ON public.video_tag_claims (decided_by_user_id);
ALTER TABLE public.video_tag_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_tag_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.video_tag_claims TO service_role;
COMMENT ON TABLE public.video_tag_claims IS 'A request to be linked to the tags of a game (308): an athlete asks, a manager of the video approves and says which typed name or placeholder player they are (docs/specs/video-games.md). Service role only; the one writer is src/lib/videos/video-claims-server.ts.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (308, '308_video_tag_claims.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 308 APPLIED | 1 | 6 | false | 308
SELECT '308 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'video_tag_claims') AS tables_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'video_tag_claims' AND indexname <> 'video_tag_claims_pkey') AS indexes_expect_6,
       has_table_privilege('anon', 'public.video_tag_claims', 'SELECT') AS anon_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_308;

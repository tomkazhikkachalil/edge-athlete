-- ============================================================================
-- 244: play — badges, rivalries, friend challenges, live cheers; the
--      performance fact table learns its shared context (additive; runs on
--      BOTH staging and prod before P2 deploys)
-- ============================================================================
-- Tom (Sep 28 2026): "something fun" — milestones + badges, share cards,
-- live cheers, rivalries, friend challenges — and "I don't want it just be
-- about golf. It's got have the building blocks and principles for every
-- other sport." So every piece reads athlete_performances (194, the ONE fact
-- table, every sport) and nothing reads a sport's own tables. This file is
-- the program's ONLY DDL (the code lands in ten PRs):
--
--   1. athlete_performances gains its shared CONTEXT:
--        context_key  'group_post:<uuid>' (a golf shared round — an event
--                     round mints one) | 'sport_event_round:<uuid>' (a
--                     stat-line event round) | 'contest:<uuid>' (an org
--                     contest line). Two athletes' rows with the same key
--                     played the same game: a rivalry is one self-join.
--        side         1 | 2 where the context has sides (a game, a match)
--        outcome      win | loss | tie where the context decides one
--      Backfilled by the app (the performance backfill door re-runs; the
--      mappers own the rule), never here.
--   2. badge_awards — one row per badge a profile has EARNED (never a
--      catalog: the catalog is code, src/lib/play/badges/catalog.ts). NOT
--      the legacy athlete_badges (191 recorded it, 199 dropped it: a
--      hand-entered badge list nothing read) — a new name for a new rule.
--      badge_key is namespaced by sport ('golf.break_80', 'all.first_win'),
--      so UNIQUE (profile_id, badge_key) holds each badge once. source_key
--      is the performance natural_key that earned it (a support removal
--      revokes by it). Posture A.
--   3. athlete_rivalry_display — the rivalries an athlete CHOSE to show on
--      their stats (Tom: "the user can choose what they want to display");
--      presence = shown. Posture A.
--   4. challenges — "beat my 78 at Eagle Creek in 30 days": a metric in the
--      sport's vocabulary, a target, a direction, a window; settled by the
--      post-write hook from a real result, expired by the daily cron.
--      version is the app-level compare-and-set. Posture A.
--   5. live_cheers — a spectator's emoji on a live round (a KEY from a fixed
--      set of six, never free text). Posture A; the daily cron purges after
--      30 days.
--   6. notifications: 'challenge' (an invite with Accept / Decline) and
--      'challenge_result'. ('achievement' exists since 003.)
--   7. notification_preferences.challenges_enabled.
--   8. reserved_handles: 'r' — /r/[postId], the public result page a share
--      card unfurls from (RESERVED_ROOT_SLUGS in the same PR).
--
-- The new tables are created EMPTY, so their indexes are inline (MIGRATIONS
-- "Large-table indexes"). athlete_performances holds hundreds of rows on
-- prod, so its one new index builds in milliseconds inside the editor's
-- transaction (239's reasoning) — at scale such an index ships CONCURRENTLY.
--
-- REVERSAL: drop the four tables; drop the three athlete_performances
-- columns (their CHECKs and index go with them); drop
-- notification_preferences.challenges_enabled; delete reserved_handles 'r';
-- re-ADD notifications_type_check from 242. Re-runnable until the ledger row
-- lands; a second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 244) THEN
    RAISE EXCEPTION '244 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 243 THEN RAISE EXCEPTION '244 pre-flight: ledger head is %, expected 243', n; END IF;
END $$;

-- ── 1. athlete_performances: the shared context ─────────────────────────────
ALTER TABLE public.athlete_performances
  ADD COLUMN IF NOT EXISTS context_key text,
  ADD COLUMN IF NOT EXISTS side        smallint,
  ADD COLUMN IF NOT EXISTS outcome     text;

ALTER TABLE public.athlete_performances DROP CONSTRAINT IF EXISTS athlete_performances_context_key_check;
ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_context_key_check
  CHECK (context_key IS NULL OR context_key ~ '^(group_post|sport_event_round|contest):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
ALTER TABLE public.athlete_performances DROP CONSTRAINT IF EXISTS athlete_performances_side_check;
ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_side_check
  CHECK (side IS NULL OR side IN (1, 2));
ALTER TABLE public.athlete_performances DROP CONSTRAINT IF EXISTS athlete_performances_outcome_check;
ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('win', 'loss', 'tie'));
-- A side or an outcome only means something inside a shared context.
ALTER TABLE public.athlete_performances DROP CONSTRAINT IF EXISTS athlete_performances_context_parts_check;
ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_context_parts_check
  CHECK (context_key IS NOT NULL OR (side IS NULL AND outcome IS NULL));

-- Who else played this game (the rivalry self-join, the per-context read).
CREATE INDEX IF NOT EXISTS idx_athlete_performances_context
  ON public.athlete_performances (context_key) WHERE context_key IS NOT NULL;

COMMENT ON COLUMN public.athlete_performances.context_key IS 'The shared game this result was played in (244): group_post:<id> | sport_event_round:<id> | contest:<id>. Set by the mappers (src/lib/performance/map.ts) only.';

-- ── 2. badge_awards ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.badge_awards (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid        NOT NULL,
  badge_key   text        NOT NULL CONSTRAINT badge_awards_badge_key_check CHECK (badge_key ~ '^[a-z0-9_]{1,40}\.[a-z0-9_]{1,60}$'),
  sport_key   text        CONSTRAINT badge_awards_sport_key_check CHECK (sport_key IS NULL OR length(sport_key) BETWEEN 1 AND 40),
  earned_on   date        NOT NULL,
  source_key  text        CONSTRAINT badge_awards_source_key_check CHECK (source_key IS NULL OR length(source_key) BETWEEN 1 AND 200),
  verified    boolean     NOT NULL DEFAULT false,
  detail      jsonb       NOT NULL DEFAULT '{}'::jsonb CONSTRAINT badge_awards_detail_check CHECK (jsonb_typeof(detail) = 'object'),
  seen_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.badge_awards DROP CONSTRAINT IF EXISTS badge_awards_uniq;
ALTER TABLE public.badge_awards ADD CONSTRAINT badge_awards_uniq UNIQUE (profile_id, badge_key);
ALTER TABLE public.badge_awards DROP CONSTRAINT IF EXISTS badge_awards_profile_id_fkey;
ALTER TABLE public.badge_awards ADD CONSTRAINT badge_awards_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
-- A support removal revokes the badges one result earned.
CREATE INDEX IF NOT EXISTS idx_badge_awards_source
  ON public.badge_awards (source_key) WHERE source_key IS NOT NULL;
ALTER TABLE public.badge_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.badge_awards FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.badge_awards IS 'Badges a profile has earned (244). ONE writer: src/lib/play/badges-server.ts. The catalog is code (src/lib/play/badges/catalog.ts). Posture A.';

-- ── 3. athlete_rivalry_display ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_rivalry_display (
  profile_id  uuid        NOT NULL,
  opponent_id uuid        NOT NULL,
  sport_key   text        NOT NULL CONSTRAINT athlete_rivalry_display_sport_key_check CHECK (length(sport_key) BETWEEN 1 AND 40),
  position    smallint    NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT athlete_rivalry_display_self_check CHECK (profile_id <> opponent_id)
);
ALTER TABLE public.athlete_rivalry_display DROP CONSTRAINT IF EXISTS athlete_rivalry_display_pkey;
ALTER TABLE public.athlete_rivalry_display ADD CONSTRAINT athlete_rivalry_display_pkey PRIMARY KEY (profile_id, opponent_id, sport_key);
ALTER TABLE public.athlete_rivalry_display DROP CONSTRAINT IF EXISTS athlete_rivalry_display_profile_id_fkey;
ALTER TABLE public.athlete_rivalry_display ADD CONSTRAINT athlete_rivalry_display_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.athlete_rivalry_display DROP CONSTRAINT IF EXISTS athlete_rivalry_display_opponent_id_fkey;
ALTER TABLE public.athlete_rivalry_display ADD CONSTRAINT athlete_rivalry_display_opponent_id_fkey FOREIGN KEY (opponent_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_athlete_rivalry_display_opponent ON public.athlete_rivalry_display (opponent_id);
ALTER TABLE public.athlete_rivalry_display ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.athlete_rivalry_display FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.athlete_rivalry_display IS 'The rivalries an athlete chose to show on their stats (244); presence = shown. ONE writer: src/lib/play/rivals-server.ts. Posture A.';

-- ── 4. challenges ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.challenges (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id uuid        NOT NULL,
  challengee_id uuid        NOT NULL,
  sport_key     text        NOT NULL CONSTRAINT challenges_sport_key_check CHECK (length(sport_key) BETWEEN 1 AND 40),
  metric        text        NOT NULL CONSTRAINT challenges_metric_check CHECK (metric ~ '^[a-z0-9_]{1,40}$'),
  direction     text        NOT NULL CONSTRAINT challenges_direction_check CHECK (direction IN ('lower', 'higher')),
  target        numeric     NOT NULL,
  course_id     uuid,
  min_holes     smallint    CONSTRAINT challenges_min_holes_check CHECK (min_holes IS NULL OR min_holes IN (9, 18)),
  source_key    text        CONSTRAINT challenges_source_key_check CHECK (source_key IS NULL OR length(source_key) BETWEEN 1 AND 200),
  message       text        CONSTRAINT challenges_message_check CHECK (message IS NULL OR char_length(message) BETWEEN 1 AND 140),
  starts_on     date        NOT NULL,
  ends_on       date        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending' CONSTRAINT challenges_status_check
                            CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'won', 'lost', 'expired')),
  responded_at  timestamptz,
  settled_at    timestamptz,
  settled_key   text,
  settled_value numeric,
  verified      boolean     NOT NULL DEFAULT false,
  version       integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT challenges_people_check CHECK (challenger_id <> challengee_id),
  CONSTRAINT challenges_window_check CHECK (ends_on >= starts_on AND ends_on <= starts_on + 90),
  -- A win names the result that won it.
  CONSTRAINT challenges_won_check CHECK (status <> 'won' OR (settled_key IS NOT NULL AND settled_at IS NOT NULL))
);
ALTER TABLE public.challenges DROP CONSTRAINT IF EXISTS challenges_challenger_id_fkey;
ALTER TABLE public.challenges ADD CONSTRAINT challenges_challenger_id_fkey FOREIGN KEY (challenger_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.challenges DROP CONSTRAINT IF EXISTS challenges_challengee_id_fkey;
ALTER TABLE public.challenges ADD CONSTRAINT challenges_challengee_id_fkey FOREIGN KEY (challengee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.challenges DROP CONSTRAINT IF EXISTS challenges_course_id_fkey;
ALTER TABLE public.challenges ADD CONSTRAINT challenges_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.golf_courses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_challenges_challengee ON public.challenges (challengee_id, status);
CREATE INDEX IF NOT EXISTS idx_challenges_challenger ON public.challenges (challenger_id, status);
CREATE INDEX IF NOT EXISTS idx_challenges_course ON public.challenges (course_id) WHERE course_id IS NOT NULL;
-- The daily expiry sweep: open challenges past their window.
CREATE INDEX IF NOT EXISTS idx_challenges_open_ends
  ON public.challenges (ends_on) WHERE status IN ('pending', 'accepted');
DROP TRIGGER IF EXISTS challenges_updated_at ON public.challenges;
CREATE TRIGGER challenges_updated_at
  BEFORE UPDATE ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.challenges FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.challenges IS 'Friend challenges (244): a metric, a target, a window; settled from athlete_performances. ONE writer: src/lib/play/challenges-server.ts. Posture A.';

-- ── 5. live_cheers ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.live_cheers (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  context_key       text        NOT NULL CONSTRAINT live_cheers_context_key_check
                                CHECK (context_key ~ '^(group_post|sport_event_round):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  profile_id        uuid        NOT NULL,
  target_profile_id uuid,
  cheer             text        NOT NULL CONSTRAINT live_cheers_cheer_check
                                CHECK (cheer IN ('fire', 'clap', 'flex', 'target', 'hands', 'wow')),
  created_at        timestamptz NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.live_cheers DROP CONSTRAINT IF EXISTS live_cheers_profile_id_fkey;
ALTER TABLE public.live_cheers ADD CONSTRAINT live_cheers_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.live_cheers DROP CONSTRAINT IF EXISTS live_cheers_target_profile_id_fkey;
ALTER TABLE public.live_cheers ADD CONSTRAINT live_cheers_target_profile_id_fkey FOREIGN KEY (target_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_live_cheers_context ON public.live_cheers (context_key, created_at);
CREATE INDEX IF NOT EXISTS idx_live_cheers_profile ON public.live_cheers (profile_id);
CREATE INDEX IF NOT EXISTS idx_live_cheers_target ON public.live_cheers (target_profile_id) WHERE target_profile_id IS NOT NULL;
-- The 30-day purge.
CREATE INDEX IF NOT EXISTS idx_live_cheers_created ON public.live_cheers (created_at);
ALTER TABLE public.live_cheers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_cheers FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.live_cheers IS 'Spectator cheers on a live round (244); a key from a fixed set of six. ONE writer: src/lib/play/cheers-server.ts. Purged after 30 days by the daily cron. Posture A.';

-- ── 6. notifications: the 242 list + challenge, challenge_result ─────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'follow_request','follow_accepted','new_follower','like','comment',
    'comment_reply','mention','tag','achievement','system_announcement',
    'club_update','team_update','new_message','group_invite','group_update',
    'guardian_invite','athlete_added',
    'event_invite','event_update','event_cancelled','event_response',
    'event_reminder',
    'post_pending_approval','post_approval_result','transfer_update',
    'consent_result',
    'comment_pending_approval','comment_approval_result',
    'follow_request_guardian','follow_update','tag_alert','profile_change',
    'calendar_alert','safety_alert',
    'league_join','league_update','league_request_result',
    'club_join','club_request_result','affiliation_invite','affiliation_update',
    'carpool_offer','carpool_update',
    'roster_invite',
    'competition_entry_pending','competition_entry_decided',
    'org_registration_received','org_registration_placed','org_registration_released',
    'contest_dispute_raised','contest_dispute_resolved',
    'golf_league_round_counted','golf_league_round_confirmed','golf_league_window_closing',
    'org_staff_invite','org_staff_accepted','org_staff_revoked',
    'org_listing_request',
    'site_form_submission',
    'sport_event_invite','sport_event_request','sport_event_request_decision',
    'sport_event_live','sport_event_results',
    'sport_event_reminder',
    'sport_event_match',
    'ticket_update','ticket_critical',
    'moderation_notice',
    'authority_notice',
    'team_roster',
    'challenge','challenge_result'
  ));

-- ── 7. notification_preferences: challenges ─────────────────────────────────
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS challenges_enabled boolean DEFAULT true;

-- ── 8. The new root segment ─────────────────────────────────────────────────
INSERT INTO reserved_handles (handle, reason)
VALUES ('r', 'Root path (vanity namespace, 244): /r/[postId], the public result page')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (244, '244_play.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 244 APPLIED | 3 | 4 | 4 | 1 | 1 | 1 | 244
SELECT '244 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'athlete_performances'
          AND column_name IN ('context_key', 'side', 'outcome')) AS performance_columns_expect_3,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
          AND table_name IN ('badge_awards', 'athlete_rivalry_display', 'challenges', 'live_cheers')) AS tables_expect_4,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relrowsecurity
           AND c.relname IN ('badge_awards', 'athlete_rivalry_display', 'challenges', 'live_cheers')) AS rls_on_expect_4,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'notifications_type_check'
          AND pg_get_constraintdef(oid) LIKE '%challenge_result%' AND pg_get_constraintdef(oid) LIKE '%team_roster%') AS notification_types_expect_1,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notification_preferences'
          AND column_name = 'challenges_enabled') AS preference_expect_1,
       (SELECT count(*) FROM reserved_handles WHERE handle = 'r') AS reserved_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_244;

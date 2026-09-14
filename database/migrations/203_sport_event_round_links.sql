-- ============================================================================
-- 203: group_posts.sport_event_round_id + posts.sport_event_round_id — a
--      round IS a live round, a post IS its feed card (Events program, phase 1)
-- ============================================================================
-- 201 gave an Event its header and its rounds. This is the join to what
-- already runs: each sport_event_round becomes ONE group_posts row when the
-- organizer goes live (src/lib/sport-events/rounds-server.ts mintRound —
-- the ONE writer), and ONE posts row is its feed card through the event's
-- whole life (minted at Open as the "announced" card, attached to the
-- group_post at go-live as the "live" card, the score-led "results" card at
-- completion — Tom: one post, three states).
--
-- The 181 shape verbatim: a nullable FK, ON DELETE SET NULL (deleting a
-- round detaches the players' round — it stays THEIR round), a partial
-- UNIQUE index (one live round per event round; one post per event round),
-- a COMMENT naming the writer. group_posts and posts are small tables:
-- inline indexes (the .indexes.sql rule is for large ones).
--
-- Reads are 42703-tolerant until this runs (the 181 stance): the scorecard
-- payload and the feed listing treat a missing column as "not an event
-- round". No red window.
-- ============================================================================

ALTER TABLE group_posts
  ADD COLUMN IF NOT EXISTS sport_event_round_id uuid REFERENCES sport_event_rounds(id) ON DELETE SET NULL;
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS sport_event_round_id uuid REFERENCES sport_event_rounds(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_group_posts_sport_event_round
  ON group_posts (sport_event_round_id) WHERE sport_event_round_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_sport_event_round
  ON posts (sport_event_round_id) WHERE sport_event_round_id IS NOT NULL;

COMMENT ON COLUMN group_posts.sport_event_round_id IS
  'The sport event round this live round IS (203). ONE writer: src/lib/sport-events/rounds-server.ts at go-live. SET NULL when the round is deleted — the players keep their round.';
COMMENT ON COLUMN posts.sport_event_round_id IS
  'The sport event round this post is the feed card of (203): minted at Open (announced), attached to the group_post at go-live (live), the score-led card at completion (results). ONE writer: rounds-server.ts.';

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
SELECT 'group_posts.sport_event_round_id' AS check_name, '1' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'group_posts' AND column_name = 'sport_event_round_id'

UNION ALL

SELECT 'posts.sport_event_round_id', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'sport_event_round_id'

UNION ALL

SELECT 'partial unique indexes', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('idx_group_posts_sport_event_round', 'idx_posts_sport_event_round')

UNION ALL

SELECT 'nothing attached yet', '0', (SELECT count(*) FROM group_posts WHERE sport_event_round_id IS NOT NULL)::text || '+' || (SELECT count(*) FROM posts WHERE sport_event_round_id IS NOT NULL)::text,
       CASE WHEN (SELECT count(*) FROM group_posts WHERE sport_event_round_id IS NOT NULL) + (SELECT count(*) FROM posts WHERE sport_event_round_id IS NOT NULL) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

ORDER BY 1;

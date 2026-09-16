-- ============================================================================
-- 216: event media (Events program, phase 4 — the third and last of the
--      phase's schema migrations; 214 = open joining + recorders, 215 = team
--      rounds)
-- ============================================================================
-- Tom (Sep 16 2026): live media — anyone who joined an event (playing or
-- following) adds photos / videos during it; a live gallery on the event
-- page; the media rides the round's results post under the existing
-- consent gates.
--
--   * sport_event_media — one row per photo / video on an EVENT, optionally
--     pinned to a round. Why not group_post_media: its INSERT policy needs a
--     confirmed participant row on the group post (a follower has none; a
--     stat-line round has no group post) and it is an RLS-on-session table —
--     the event world is posture A behind ONE gate (`media.ts mediaRight`:
--     ADD = any accepted row of any role, or an organizer, while the event
--     is not cancelled; REMOVE = the uploader or an organizer).
--   * uploaded_by = the profile the row belongs to; created_by_user_id = the
--     HUMAN author when a guardian acts (the 090 attribution). A supervised
--     uploader's media publishes at once (the shared-round carve-out,
--     extended to event media — the approvals copy names it).
--   * media_url / thumbnail_url = storage URLs (the `uploads` bucket; read
--     through the media proxy as `sport_event` entities). duration_seconds
--     for a video. caption ≤ 500.
--   * mirrored_at = stamped when the completion mirror copied the row into
--     the round's post (post_media), so a late upload re-mirrors once.
--
-- Posture A (the 187 shape): RLS on, zero policies, REVOKE from anon and
-- authenticated; the admin client behind the ONE event gate is the only
-- reader. NOTIFY pgrst so the table enters the OpenAPI inventory.
--
-- READERS: nothing selects the table until phase 4 PR 12, gated on
-- `check:schema` OK after this ran.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sport_event_media (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_event_id       uuid NOT NULL REFERENCES sport_events(id) ON DELETE CASCADE,
  sport_event_round_id uuid REFERENCES sport_event_rounds(id) ON DELETE SET NULL,
  uploaded_by          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_by_user_id   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  media_url            text NOT NULL CONSTRAINT sport_event_media_url_check CHECK (length(btrim(media_url)) BETWEEN 1 AND 2000),
  media_type           text NOT NULL CONSTRAINT sport_event_media_type_check CHECK (media_type IN ('image', 'video')),
  thumbnail_url        text,
  duration_seconds     numeric(8,2) CONSTRAINT sport_event_media_duration_check CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  caption              text CONSTRAINT sport_event_media_caption_check CHECK (caption IS NULL OR length(caption) <= 500),
  mirrored_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE sport_event_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_event_media FROM PUBLIC, anon, authenticated;

-- The reads: an event's gallery newest first; a round's rows (the mirror); an uploader's rows (the profile cascade, the remove right).
CREATE INDEX IF NOT EXISTS idx_sport_event_media_event
  ON sport_event_media (sport_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sport_event_media_round
  ON sport_event_media (sport_event_round_id);
CREATE INDEX IF NOT EXISTS idx_sport_event_media_uploader
  ON sport_event_media (uploaded_by);

COMMENT ON TABLE  sport_event_media IS 'A photo / video on an event (216): by any accepted participant (followers included) or an organizer; optionally pinned to a round; posture A behind the event gate; mirrored into the round''s post at completion (mirrored_at).';
COMMENT ON COLUMN sport_event_media.created_by_user_id IS 'The human author when a guardian acts for a supervised uploader (the 090 attribution); NULL for a self-upload.';
COMMENT ON COLUMN sport_event_media.mirrored_at IS 'Stamped when the completion mirror copied this row into the round''s post (post_media, deduped on media_url); a late upload re-mirrors once.';

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 216 APPLIED | 1 | 3
SELECT '216 APPLIED' AS result,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sport_event_media') AS table_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sport_event_media' AND indexname LIKE 'idx_sport_event_media_%') AS indexes_expect_3;

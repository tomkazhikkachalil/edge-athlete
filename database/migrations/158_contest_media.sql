-- ============================================================================
-- 158: contest_media + contest_media_tags — contest-scoped media (phase 4, R3)
-- ============================================================================
-- The masterplan's "media uploaded in a contest context inherits
-- competition, contest, teams, venue, and date automatically" — an
-- ORG-SIDE library, deliberately not posts columns: coach photos are org
-- artifacts (§8 invariant 1 — they survive the coach leaving), the
-- guardian gate requires an org-private store anyway, and a dedicated
-- table means ONE tag store (the posts.tags/post_tags dual-store trap
-- does not apply here). Shape decisions:
--   * storage_path lives in the PRIVATE uploads bucket under
--     contest-media/{contestId}/{uuid}.{ext}; bytes are served only
--     through the signed media proxy ('contest_media' entity type).
--   * published (default false) is the org's explicit gallery-curation
--     bit — born now so R5's public gallery needs no new column. It
--     grants NOTHING by itself: public rendering additionally requires
--     every tagged athlete's photo consent (mig 159).
--   * Tags: UNIQUE(media_id, profile_id) with status active|removed —
--     'removed' is a TOMBSTONE (the mirror-tags lesson): an athlete or
--     guardian who untags is never silently re-added; writers insert
--     with ON CONFLICT DO NOTHING.
--   * Posture A both tables; media CASCADE with the contest, tags
--     CASCADE with media and profile.
--
-- ORDER-STRICT: run AFTER 157. App code merged ahead of this migration
-- DEGRADES: media/tag reads answer empty, uploads answer a friendly
-- error, consoles hide the panel. Re-runnable end to end.
--
-- Down-steps (documentation only, never executed): DROP contest_media_tags;
-- DROP contest_media.

CREATE TABLE IF NOT EXISTS contest_media (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id   uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  storage_path text NOT NULL
    CONSTRAINT contest_media_path_check
    CHECK (storage_path ~ '^contest-media/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'),
  media_type   text NOT NULL DEFAULT 'image'
    CONSTRAINT contest_media_type_check CHECK (media_type IN ('image', 'video')),
  caption      text
    CONSTRAINT contest_media_caption_check CHECK (char_length(caption) <= 300),
  published    boolean NOT NULL DEFAULT false,
  uploaded_by  uuid NOT NULL REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at   timestamptz NOT NULL DEFAULT timezone('utc', now())
);

DROP TRIGGER IF EXISTS contest_media_updated_at ON contest_media;
CREATE TRIGGER contest_media_updated_at
  BEFORE UPDATE ON contest_media
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS contest_media_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id   uuid NOT NULL REFERENCES contest_media(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'active'
    CONSTRAINT contest_media_tags_status_check CHECK (status IN ('active', 'removed')),
  tagged_by  uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT contest_media_tags_uniq UNIQUE (media_id, profile_id)
);

DROP TRIGGER IF EXISTS contest_media_tags_updated_at ON contest_media_tags;
CREATE TRIGGER contest_media_tags_updated_at
  BEFORE UPDATE ON contest_media_tags
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE contest_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE contest_media_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contest_media, contest_media_tags FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_contest_media_contest
  ON contest_media (contest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contest_media_tags_profile
  ON contest_media_tags (profile_id, status);
CREATE INDEX IF NOT EXISTS idx_contest_media_tags_media
  ON contest_media_tags (media_id);

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT count(*) = 2 FROM information_schema.tables
     WHERE table_name IN ('contest_media', 'contest_media_tags'))    AS both_exist,
  (SELECT bool_and(relrowsecurity) FROM pg_class
     WHERE relname IN ('contest_media', 'contest_media_tags'))       AS rls_on_both,
  (SELECT count(*) = 1 FROM pg_constraint
     WHERE conname = 'contest_media_tags_uniq')                      AS tags_uniq,
  (SELECT pg_get_constraintdef(oid) LIKE '%removed%' FROM pg_constraint
     WHERE conname = 'contest_media_tags_status_check')              AS tombstone_status,
  (SELECT count(*) = 3 FROM pg_indexes
     WHERE indexname LIKE 'idx_contest_media%')                      AS indexes_present,
  (SELECT count(*) FROM contest_media)                               AS media_total;

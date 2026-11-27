-- ============================================================================
-- 321: posts — one attached activity and one location (Nov 26 2026).
--      Runs on BOTH staging and prod BEFORE the code deploys: the new app
--      selects and writes the columns.
-- ============================================================================
-- Tom's General post spec (Nov 26 2026): a post may ATTACH one of its
-- author's logged activities — a finished golf round, a finished workout, a
-- tracked activity (a run, a ride, …) or a game's stat line — and the feed
-- card then shows a stat plate (the headline number, the sport, the name,
-- one line of detail; a golf round also a block per hole). A post may also
-- carry ONE location.
--
-- WHAT, on public.posts (all nullable; every row written before today has
-- none):
--   attached_round_id     → golf_rounds(id)       ON DELETE SET NULL
--   attached_workout_id   → workout_sessions(id)  ON DELETE SET NULL
--   attached_activity_id  → activities(id)        ON DELETE SET NULL
--   attached_post_id      → posts(id)             ON DELETE SET NULL
--                           (a stat line IS its post: the stat line's post)
--   location_label        text, 120 characters at most (what the card shows)
--   location_place_id     → places(id)            ON DELETE SET NULL
--
-- ONE attachment per post: a CHECK refuses a row with two set
-- (num_nonnulls <= 1).
--
-- WHY FOUR COLUMNS and not a kind + id pair: a real foreign key each, so a
-- deleted source clears the reference by itself and nothing dangles.
-- WHY NOT round_id: that column means "this post IS the round's card" — it
-- pairs the post's hide with the round's (results/hide-server.ts), counts
-- the post as Stats in the profile's buckets (269) and draws the golf round
-- card. An attachment is none of those: the post stays a General post.
--
-- NOTHING IS COPIED: the plate is built from the source row on every read
-- (src/lib/posts/attachment-server.ts), so an edit shows through and a
-- source that is later hidden or deleted takes its plate away. The post's
-- place in the profile's buckets is unchanged (269 reads none of these
-- columns): a post with only an attachment is a statement.
--
-- Indexes: one per foreign key, leading on its column (the 239 rule), each
-- partial (almost every row is NULL). No grant change: a column on an
-- existing table inherits the table's grants and RLS.
--
-- PRE-FLIGHT (expect: 0 rows):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'posts'
--     AND column_name IN ('attached_round_id', 'attached_workout_id', 'attached_activity_id',
--                         'attached_post_id', 'location_label', 'location_place_id');
--
-- Idempotent. Run in the Supabase SQL editor as a single execution.
-- ============================================================================

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS attached_round_id uuid,
  ADD COLUMN IF NOT EXISTS attached_workout_id uuid,
  ADD COLUMN IF NOT EXISTS attached_activity_id uuid,
  ADD COLUMN IF NOT EXISTS attached_post_id uuid,
  ADD COLUMN IF NOT EXISTS location_label text,
  ADD COLUMN IF NOT EXISTS location_place_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_attached_round_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_attached_round_id_fkey
      FOREIGN KEY (attached_round_id) REFERENCES public.golf_rounds(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_attached_workout_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_attached_workout_id_fkey
      FOREIGN KEY (attached_workout_id) REFERENCES public.workout_sessions(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_attached_activity_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_attached_activity_id_fkey
      FOREIGN KEY (attached_activity_id) REFERENCES public.activities(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_attached_post_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_attached_post_id_fkey
      FOREIGN KEY (attached_post_id) REFERENCES public.posts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_location_place_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_location_place_id_fkey
      FOREIGN KEY (location_place_id) REFERENCES public.places(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_one_attachment_check' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_one_attachment_check
      CHECK (num_nonnulls(attached_round_id, attached_workout_id, attached_activity_id, attached_post_id) <= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_location_label_check' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_location_label_check
      CHECK (location_label IS NULL OR (char_length(location_label) BETWEEN 1 AND 120));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_attached_round_id ON public.posts USING btree (attached_round_id) WHERE (attached_round_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_attached_workout_id ON public.posts USING btree (attached_workout_id) WHERE (attached_workout_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_attached_activity_id ON public.posts USING btree (attached_activity_id) WHERE (attached_activity_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_attached_post_id ON public.posts USING btree (attached_post_id) WHERE (attached_post_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_location_place_id ON public.posts USING btree (location_place_id) WHERE (location_place_id IS NOT NULL);

COMMENT ON COLUMN public.posts.attached_round_id IS 'The golf round this post ATTACHES (321): its stat plate is read from the round. Not round_id (the round''s own card).';
COMMENT ON COLUMN public.posts.attached_workout_id IS 'The workout this post attaches (321): its stat plate is read from the session.';
COMMENT ON COLUMN public.posts.attached_activity_id IS 'The tracked activity this post attaches (321): its stat plate is read from the row.';
COMMENT ON COLUMN public.posts.attached_post_id IS 'The stat-line post this post attaches (321): its stat plate is read from that post''s stats_data.';
COMMENT ON COLUMN public.posts.location_label IS 'The post''s one location as shown on the card (321), e.g. "Ottawa, ON".';
COMMENT ON COLUMN public.posts.location_place_id IS 'The place the location was picked from (321), when it was.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (321, '321_post_attachment_location.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 321 APPLIED | 6 | 7 | 5 | 321
SELECT '321 APPLIED' AS result,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts'
      AND column_name IN ('attached_round_id', 'attached_workout_id', 'attached_activity_id', 'attached_post_id', 'location_label', 'location_place_id')) AS columns_expect_6,
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.posts'::regclass
      AND conname IN ('posts_attached_round_id_fkey', 'posts_attached_workout_id_fkey', 'posts_attached_activity_id_fkey', 'posts_attached_post_id_fkey',
                      'posts_location_place_id_fkey', 'posts_one_attachment_check', 'posts_location_label_check')) AS constraints_expect_7,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'posts'
      AND indexname IN ('idx_posts_attached_round_id', 'idx_posts_attached_workout_id', 'idx_posts_attached_activity_id', 'idx_posts_attached_post_id', 'idx_posts_location_place_id')) AS indexes_expect_5,
  (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_321;

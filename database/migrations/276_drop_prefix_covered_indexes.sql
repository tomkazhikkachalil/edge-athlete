-- 276 — drop the twelve prefix-covered indexes on the growth tables
-- (Oct 25 2026 — the production baseline answers, docs/SCALE_AUDIT.md §0b;
-- Tom: "Yes, let's do a migration").
--
-- Why: Tom's read of pg_indexes on production showed twelve indexes whose
-- key is the LEADING PREFIX of a wider index on the same table. The planner
-- never needs the narrow one (a btree on (a) answers nothing a btree on
-- (a, b) does not), but every like, follow, post, comment, message and
-- notification pays to maintain it. The Advisor's duplicate_index lint saw
-- none of them (it flags exact twins only; 271 cleared those). Zero
-- behaviour change: every read keeps an index whose leading column is the
-- one dropped, so every foreign key stays covered (fk-index-coverage.test.ts,
-- 239's rule) and every query plan has the same or a better index.
--
-- Not dropped: idx_search_documents_lat (a WHERE term of the near browse),
-- idx_posts_profile_visibility_created vs _profile_created (different second
-- columns), the partial indexes (different predicates), anything merely
-- UNUSED on production — production was wiped Sep 30 and is gated, so a zero
-- scan count there says nothing about the feature.
--
-- Deploy order: FLEXIBLE — no code change. Reversal: re-create the twelve
-- from the baseline at 275. Idempotent (DROP INDEX IF EXISTS).

-- ── follows ──────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_follows_follower;        -- ⊂ idx_follows_follower_status (follower_id, status), idx_follows_composite, the unique (follower_id, following_id)
DROP INDEX IF EXISTS public.idx_follows_following;       -- ⊂ idx_follows_following_status (following_id, status)
DROP INDEX IF EXISTS public.idx_follows_status;          -- (status) alone: every follows read names a party first; (follower_id|following_id, status) serve it
-- ── posts ────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_posts_profile_id;        -- ⊂ idx_posts_profile_created (profile_id, created_at DESC)
DROP INDEX IF EXISTS public.idx_posts_created_at;        -- ⊂ idx_posts_created_at_id_desc (created_at DESC, id DESC) — the keyset's index; 266 vs 3,900 scans on prod
-- ── post_comments / post_likes / post_media ──────────────────────────────────
DROP INDEX IF EXISTS public.idx_post_comments_post_id;   -- ⊂ idx_comments_post (post_id, created_at DESC)
DROP INDEX IF EXISTS public.idx_post_likes_profile_id;   -- ⊂ idx_post_likes_profile (profile_id, created_at DESC)
DROP INDEX IF EXISTS public.idx_post_likes_post;         -- ⊂ the unique post_likes_post_id_profile_id_key (post_id, profile_id)
DROP INDEX IF EXISTS public.idx_post_media_post_id;      -- ⊂ idx_post_media_post_display (post_id, display_order) — 271 recorded this one as "left for a later decision"
-- ── notifications / conversation_participants / golf_participant_scores ──────
DROP INDEX IF EXISTS public.idx_notifications_user_id;   -- ⊂ idx_notifications_user_created (user_id, created_at DESC)
DROP INDEX IF EXISTS public.idx_cp_conversation;         -- ⊂ the unique conversation_participants_conversation_id_profile_id_key (conversation_id, profile_id)
DROP INDEX IF EXISTS public.idx_golf_participant_scores_participant; -- a twin of the unique golf_participant_scores_participant_id_key (participant_id)

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (276, '276_drop_prefix_covered_indexes.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 276 APPLIED | 0 | 12 | 276
SELECT '276 APPLIED' AS result,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
          'idx_follows_follower','idx_follows_following','idx_follows_status','idx_posts_profile_id','idx_posts_created_at',
          'idx_post_comments_post_id','idx_post_likes_profile_id','idx_post_likes_post','idx_post_media_post_id',
          'idx_notifications_user_id','idx_cp_conversation','idx_golf_participant_scores_participant')) AS dropped_remaining_expect_0,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
          'idx_follows_follower_status','idx_follows_following_status','follows_follower_id_following_id_key','idx_posts_profile_created','idx_posts_created_at_id_desc',
          'idx_comments_post','idx_post_likes_profile','post_likes_post_id_profile_id_key','idx_post_media_post_display',
          'idx_notifications_user_created','conversation_participants_conversation_id_profile_id_key','golf_participant_scores_participant_id_key')) AS keepers_present_expect_12,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_276;

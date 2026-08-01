-- ============================================================================
-- Migration 062 — Highlight flag + the missing UPDATE policy
-- ============================================================================
-- Two things, both needed before an athlete can curate their own round media:
--
-- 1. `is_highlight` — which item leads the round: the hero at the top of the
--    Overview and the lead image on the feed card. Without it the hero is
--    guessed (video → best-scoring hole → earliest), which is a decent default
--    but not something the athlete can override.
--
-- 2. An UPDATE policy on group_post_media. THERE IS NONE TODAY — 004 created
--    SELECT, INSERT and DELETE policies and no UPDATE, so with RLS enabled
--    every UPDATE is denied. That blocks the highlight toggle AND re-assigning
--    a photo to a different hole, which is the whole "auto-tag, then let them
--    correct it" flow.
--
-- ⚠️ RUN BEFORE DEPLOYING. The scorecard SELECT embeds is_highlight → 42703
--    otherwise. Idempotent. Supabase SQL Editor; expect green "Success".
--
-- ── Pre-flight ──────────────────────────────────────────────────────────────
-- Confirms the gap this migration closes — expect NO row with cmd = 'UPDATE':
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'group_post_media';
-- ============================================================================

ALTER TABLE group_post_media
  ADD COLUMN IF NOT EXISTS is_highlight BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN group_post_media.is_highlight IS
  'Athlete-chosen lead item for the round. Multiple rows may be flagged; the picker in src/lib/media/hero.ts resolves deterministically (see the note on the unique index below).';

-- NO partial unique index on (group_post_id) WHERE is_highlight.
-- It would make "set a new hero" a two-statement operation (clear the old, set
-- the new) that races to a 23505 under concurrent taps. Duplicates are
-- tolerated instead and resolved deterministically in the pure picker, which
-- has to handle ties anyway.

CREATE INDEX IF NOT EXISTS idx_group_media_highlight
  ON group_post_media(group_post_id)
  WHERE is_highlight;

-- ── The missing UPDATE policy ───────────────────────────────────────────────
-- Mirrors media_delete_policy (004:485-493): the uploader, or the round's
-- creator. BOTH USING and WITH CHECK are required — USING alone would let an
-- UPDATE move a row into a DIFFERENT round (rewriting group_post_id), because
-- USING is evaluated against the OLD row and WITH CHECK against the NEW one.
DROP POLICY IF EXISTS media_update_policy ON group_post_media;
CREATE POLICY media_update_policy ON group_post_media
FOR UPDATE
USING (
  auth.uid() = uploaded_by
  OR EXISTS (
    SELECT 1 FROM group_posts
     WHERE group_posts.id = group_post_media.group_post_id
       AND group_posts.creator_id = auth.uid()
  )
)
WITH CHECK (
  auth.uid() = uploaded_by
  OR EXISTS (
    SELECT 1 FROM group_posts
     WHERE group_posts.id = group_post_media.group_post_id
       AND group_posts.creator_id = auth.uid()
  )
);

-- ── Verification (run after) ────────────────────────────────────────────────
-- 1. Column exists:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'group_post_media' AND column_name = 'is_highlight';  → 1 row
--
-- 2. The UPDATE policy now exists — this is the one that was missing entirely:
-- SELECT policyname, cmd, qual IS NOT NULL AS has_using,
--        with_check IS NOT NULL AS has_with_check
--   FROM pg_policies
--  WHERE tablename = 'group_post_media' AND cmd = 'UPDATE';
--    → 1 row, has_using = true, has_with_check = true
--
-- 3. Nothing was flagged by accident:
-- SELECT count(*) FROM group_post_media WHERE is_highlight;  → 0

-- ============================================================================
-- Migration 033 — Auto-confirm invited participants + feed-post link backfill
-- ============================================================================
-- Product decision (July 24): invited players are AUTO-CONFIRMED — anyone
-- invited to a shared round can score immediately. The attestation step is
-- retired (its UI was never mounted, so invitees were stuck 'pending' forever,
-- which the scores API rejected — invitees could never enter scores).
--
-- Code that ships with this: invites now insert status='confirmed'; the
-- scores API rejects only 'declined'; rosters treat everyone-but-declined as
-- playing. This migration backfills EXISTING rows to match.
--
-- Also backfills group_posts.post_id (the reverse link to the feed post) —
-- written on creation going forward, but never set historically; the resume
-- banner and an RLS clause rely on it.
--
-- Data-only (no schema change → no PostgREST 42703 risk; deploy order is not
-- critical, but run before/with the deploy so existing invitees unblock).
-- Safe/idempotent: both UPDATEs are no-ops on re-run.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ============================================================================

-- 1) Existing invitees become confirmed players
UPDATE group_post_participants
SET status = 'confirmed',
    attested_at = COALESCE(attested_at, NOW())
WHERE status IN ('pending', 'maybe');

-- 2) Backfill the never-set feed-post link
UPDATE group_posts gp
SET post_id = p.id
FROM posts p
WHERE p.group_post_id = gp.id
  AND gp.post_id IS NULL;

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT count(*) FROM group_post_participants WHERE status IN ('pending','maybe');
--   → 0
-- SELECT count(*) FROM group_posts gp JOIN posts p ON p.group_post_id = gp.id
--   WHERE gp.post_id IS NULL;
--   → 0
--
-- Diagnostic (read-only) — orphaned rounds with no feed post (invisible to
-- everyone; review manually, do NOT auto-delete):
-- SELECT gp.id, gp.title, gp.created_at FROM group_posts gp
--   LEFT JOIN posts p ON p.group_post_id = gp.id WHERE p.id IS NULL;

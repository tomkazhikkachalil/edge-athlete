-- ============================================================================
-- Migration 028 — Notification types for shared golf rounds
-- ============================================================================
-- The shared-round flow (invite → attest → enter scores → leaderboard) had
-- ZERO notification touchpoints — invitees never learned they were invited
-- unless they stumbled on the post. This extends the notifications type
-- CHECK (same pattern migration 012 used for 'new_message') with:
--   group_invite : you were added to a shared round
--   group_update : attestations, scores posted, leaderboard complete
--
-- These are inserted directly by the API routes (like new_message), not via
-- create_notification — its preference gate has no branch for them and would
-- silently drop them. Self-notification guards live in the route code.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ============================================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'follow_request',
    'follow_accepted',
    'new_follower',
    'like',
    'comment',
    'comment_reply',
    'mention',
    'tag',
    'achievement',
    'system_announcement',
    'club_update',
    'team_update',
    'new_message',
    'group_invite',
    'group_update'
  ));

-- ── Verification (run after) ────────────────────────────────────────────────
-- INSERT a test row with type='group_invite' for your own user_id (then
-- delete it) — expect success, not a CHECK violation.

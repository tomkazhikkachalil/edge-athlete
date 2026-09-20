-- ============================================================================
-- 223: Support & Reporting program, Spec 2 — moderation
--      (profiles.moderation_state · hidden posts and comments · a frozen
--       conversation · user_mutes · the moderation_notice bell)
-- ============================================================================
-- Spec 2 of Tom's Game Plan: reports filed FROM the content, the enforcement
-- the review protocol needs, and the mute the report sheet offers. This is
-- the program's second and Spec 2's ONLY migration. It merges ALONE; every
-- app PR after it is gated on `check:schema` OK (a select naming a missing
-- column 404s the whole read — the 207 lesson).
--
--   * profiles.moderation_state — active | limited | suspended | banned,
--     DEFAULT 'active' (load-bearing: no existing row changes), with
--     moderation_until (a suspension's end; an expired one reads as active)
--     and moderation_ticket_id (why). Enforced by `requireActiveWriter` on
--     THE list of content + contact write routes (docs/SUPPORT.md) and, for
--     suspended / banned, by Supabase Auth's ban_duration. Tom's rule
--     (Sep 20): a single report acts on the INTERACTION (hide, freeze); the
--     ACCOUNT is limited only on repeat incidents or by an admin.
--   * posts.status / post_comments.status widen to 'hidden' — a hidden item
--     is a STATUS, not a new column, so every reader that already says
--     status = 'published' (the RLS policy, the feed, the comments read, the
--     media RPCs, the comment count + notify triggers of 095) hides it with
--     no new code; the author still sees their own (profile_id = uid). Never
--     deleted: it is evidence. hidden_at + hidden_ticket_id record why.
--   * conversations.frozen_at + frozen_ticket_id — a Critical DM report
--     freezes the thread: neither side can send, both can read. A DISTINCT
--     state from conversation_participants.held_at (the first-contact hold,
--     131) — the hold is about a stranger's first message; the freeze is
--     about a review.
--   * user_mutes — the user-level mute the report sheet offers beside
--     Block: the muted person's posts leave the muter's feed, their comments
--     the muter's view, their notifications the muter's bell. Silent. Posture
--     A (the routes read it on the service role).
--   * notifications_type_check: the 222 list + 'moderation_notice' — the
--     reported user's bell (a warning, a suspension, a ban, an appeal's
--     outcome — in plain words, never who reported). Same PR: the registry
--     entry (verify fails otherwise).
--
-- Every existing row keeps its behaviour: the new columns default to
-- inactive states, the CHECKs only widen. Provenance: every object is a
-- chain CREATE / ALTER — check:schema stays OK with the allowlist empty.
-- ============================================================================

-- ── profiles: the enforcement state ─────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS moderation_state text NOT NULL DEFAULT 'active';
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_moderation_state_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_moderation_state_check
  CHECK (moderation_state IN ('active', 'limited', 'suspended', 'banned'));
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS moderation_until timestamptz;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS moderation_ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_moderation
  ON profiles (moderation_state) WHERE moderation_state <> 'active';

COMMENT ON COLUMN profiles.moderation_state IS 'Support & Reporting (223): active | limited (read-only on the content + contact routes) | suspended (until moderation_until; login refused) | banned. A single report never sets it — repeat incidents or an admin do.';
COMMENT ON COLUMN profiles.moderation_until IS 'When a suspension ends (223); an expired value reads as active and the daily cron lifts it.';
COMMENT ON COLUMN profiles.moderation_ticket_id IS 'The ticket behind the current state (223).';

-- ── posts / post_comments: hidden is a status ───────────────────────────────
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE posts ADD CONSTRAINT posts_status_check
  CHECK (status IN ('published', 'pending_approval', 'rejected', 'changes_requested', 'hidden'));
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL;

ALTER TABLE post_comments DROP CONSTRAINT IF EXISTS post_comments_status_check;
ALTER TABLE post_comments ADD CONSTRAINT post_comments_status_check
  CHECK (status IN ('published', 'pending_approval', 'rejected', 'changes_requested', 'hidden'));
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS hidden_ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL;

COMMENT ON COLUMN posts.hidden_at IS 'Hidden by moderation (223): status = ''hidden'' is what hides it (every published-only reader); this records when.';
COMMENT ON COLUMN posts.hidden_ticket_id IS 'The ticket that hid it (223); unhide restores published.';
COMMENT ON COLUMN post_comments.hidden_at IS 'Hidden by moderation (223): status = ''hidden'' is what hides it; this records when.';
COMMENT ON COLUMN post_comments.hidden_ticket_id IS 'The ticket that hid it (223).';

-- ── conversations: the freeze ───────────────────────────────────────────────
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS frozen_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS frozen_ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL;

COMMENT ON COLUMN conversations.frozen_at IS 'Frozen by a Critical report (223): no one sends while set; everyone still reads. Distinct from the first-contact hold (131).';
COMMENT ON COLUMN conversations.frozen_ticket_id IS 'The ticket that froze it (223).';

-- ── user_mutes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_mutes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  muter_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  muted_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT user_mutes_pair_key UNIQUE (muter_id, muted_id),
  CONSTRAINT user_mutes_not_self CHECK (muter_id <> muted_id)
);

CREATE INDEX IF NOT EXISTS idx_user_mutes_muter ON user_mutes (muter_id);

ALTER TABLE user_mutes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_mutes FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE user_mutes IS 'Support & Reporting (223): a user-level mute — the muted person''s posts, comments and notifications leave the muter''s view. Silent. Posture A: service role only.';

-- ── The bell type: the 222 list + moderation_notice (re-ADD in full) ────────
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
    'moderation_notice'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 223 APPLIED | 1 | 1 | 1 | 1 | 1 | 1
SELECT '223 APPLIED' AS result,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'profiles_moderation_state_check' AND conrelid = 'public.profiles'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%banned%') AS moderation_state_expect_1,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'posts_status_check' AND conrelid = 'public.posts'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%hidden%') AS posts_hidden_expect_1,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'post_comments_status_check' AND conrelid = 'public.post_comments'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%hidden%') AS comments_hidden_expect_1,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'frozen_at') AS frozen_column_expect_1,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_mutes') AS mutes_table_expect_1,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%moderation_notice%') AS bell_type_expect_1;

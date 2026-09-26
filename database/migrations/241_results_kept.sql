-- ============================================================================
-- 241: results are never lost — a person hides a result from their profile;
--      nothing a person does removes it from the backend (merges ALONE;
--      additive; runs on prod before PR 2 of the round deploys)
-- ============================================================================
-- Tom (Sep 26 2026): "I eventually want the information taken about the
-- athlete to be incredibly accurate, at least on the backend. The user can
-- have their profile viewed as they would like. However, any data metrics
-- recorded will go towards understanding what the athlete's athletic score
-- is." And on an OFFICIAL result (a club / league event, an org competition,
-- an org-recorded line) the opt-out hides it from the profile only; a wrong
-- tag keeps the data and support moves it to the right person, telling both.
-- The audit found ten ways a person could make a result disappear (the event
-- opt-out deleted the mirror, a round delete wiped every player's, a stat
-- post delete took its dataset row) and none knew official from casual.
-- This file is the round's DDL (the code lands in five PRs):
--
--   1. posts.status gains 'profile_hidden' (+ profile_hidden_at) — the
--      owner's "Hide from profile" on a result post. A STATUS on purpose:
--      every published-only reader (feed, profile, scout search) skips it
--      with no reader change; distinct from moderation's 'hidden' (223), so
--      an owner can never unhide what a moderator hid. The dataset row
--      (athlete_performances) is untouched.
--   2. golf_rounds.profile_hidden_at — the same for a round. The handicap,
--      the WHS engine, the leaderboards and the dataset keep reading it; the
--      profile readers skip it for anyone but its owner.
--   3. authority_audit gains five actions: result_hidden / result_unhidden
--      (an official result, by its player), result_reassigned /
--      result_corrected (support, on a ticket), official_tag_removed (an org
--      takes a person off an official result — the person is told).
--   4. tickets: the resolution code 'result_corrected'.
--
-- No new foreign keys. check:schema sees the two columns; it cannot see
-- CHECKs or indexes — the twin (tests/diagnostics/verify-241-results-kept.sql)
-- asserts those.
--
-- REVERSAL: set every 'profile_hidden' post back to 'published'; drop the two
-- columns and the index; re-ADD the three CHECKs from 223 / 240. Re-runnable
-- until the ledger row lands; a second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 241) THEN
    RAISE EXCEPTION '241 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 240 THEN RAISE EXCEPTION '241 pre-flight: ledger head is %, expected 240', n; END IF;
END $$;

-- ── 1. posts: the owner's profile hide is a status ─────────────────────────
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_status_check
  CHECK (status IN ('published', 'pending_approval', 'rejected', 'changes_requested', 'hidden', 'profile_hidden'));
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS profile_hidden_at timestamptz;
COMMENT ON COLUMN public.posts.profile_hidden_at IS 'The owner hid this result from their profile (241): status = ''profile_hidden''. The dataset row stays; unhide restores published.';

-- ── 2. golf_rounds: the same for a round ────────────────────────────────────
ALTER TABLE public.golf_rounds ADD COLUMN IF NOT EXISTS profile_hidden_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_golf_rounds_profile_hidden ON public.golf_rounds (profile_id) WHERE profile_hidden_at IS NOT NULL;
COMMENT ON COLUMN public.golf_rounds.profile_hidden_at IS 'Hidden from the owner''s profile (241). Still counts: handicap, WHS, leaderboards, the dataset.';

-- ── 3. authority_audit: the result actions (240's list + five) ──────────────
ALTER TABLE public.authority_audit DROP CONSTRAINT IF EXISTS authority_audit_action_check;
ALTER TABLE public.authority_audit ADD CONSTRAINT authority_audit_action_check CHECK (action IN (
  'org_created',
  'owner_added',
  'owner_removed',
  'owner_stepped_down',
  'owner_claimed',
  'manager_added',
  'manager_removed',
  'staff_granted',
  'staff_changed',
  'staff_revoked',
  'identity_changed',
  'listing_changed',
  'site_created',
  'site_live',
  'site_offline',
  'site_held',
  'site_released',
  'site_published',
  'revision_restored',
  'revision_labelled',
  'domain_added',
  'domain_removed',
  'news_deleted',
  'news_restored',
  'page_removed',
  'recovery_link_minted',
  'recovery_link_redeemed',
  'co_organizer_invited',
  'co_organizer_added',
  'co_organizer_removed',
  'host_transferred',
  'event_details_changed',
  'event_cancelled',
  'event_deleted',
  'result_hidden',
  'result_unhidden',
  'result_reassigned',
  'result_corrected',
  'official_tag_removed'
));

-- ── 4. tickets: result_corrected (240's list + one) ─────────────────────────
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_resolution_code_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_resolution_code_check CHECK (resolution_code IS NULL OR resolution_code IN (
  'no_action', 'content_removed', 'warning', 'suspension', 'ban', 'feature_shipped', 'declined', 'access_restored', 'result_corrected'));

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (241, '241_results_kept.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 241 APPLIED | 1 | 2 | 1 | 1 | 241
SELECT '241 APPLIED' AS result,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'posts_status_check' AND pg_get_constraintdef(oid) LIKE '%profile_hidden%') AS post_status_expect_1,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'profile_hidden_at' AND table_name IN ('posts', 'golf_rounds')) AS hidden_columns_expect_2,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'authority_audit_action_check' AND pg_get_constraintdef(oid) LIKE '%result_reassigned%') AS audit_actions_expect_1,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'tickets_resolution_code_check' AND pg_get_constraintdef(oid) LIKE '%result_corrected%') AS resolution_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_241;

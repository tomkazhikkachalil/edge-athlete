-- ============================================================================
-- 243: the newsroom — a news post gains a summary, a cover, a team or
--      division tag, "notify members" + a site banner (the Announce merge),
--      a recap source, an autosaved draft of a live post's edits, an author;
--      authority_audit learns news_published / news_notified
--      (additive; runs on BOTH staging and prod before N3 deploys)
-- ============================================================================
-- Tom (Sep 27 2026, the sports-team website program): one person runs all
-- the edits and news; Announce merges into news (a post with "Notify
-- members" and "Show as site banner until …"); a finished result offers a
-- one-click recap draft. This file is the program's ONLY DDL:
--
--   1. org_site_news gains:
--        summary        ≤ 280 chars — the card's line, the bell's message
--        cover_path     a site asset (org-media/…) — the card's picture
--                       (else the first image block, as today)
--        team_id /      the post's team OR division (never both) — it shows
--        division_id    on that team's / division's page (SET NULL: a
--                       removed team keeps its news, untagged)
--        notify_members "Notify members" — the bells go out when the post is
--                       published (now, or at its scheduled time)
--        notified_at    stamped once, by a conditional claim (at-most-once
--                       bells); CHECK ⇒ notify_members
--        banner_until   the post's title shows in the site's notice band
--                       through this day (the Announce banner, on the post)
--        source_ref     'contest:<uuid>' | 'game:<uuid>' | 'season:<uuid>' —
--                       the recap / season-wrap it was drafted from; a
--                       partial UNIQUE keeps ONE live draft per source
--        draft          jsonb — the unpublished edits of a LIVE post (an
--                       autosave must never publish half-typed text; Update
--                       promotes it). NULL when there are none.
--        created_by     the author (SET NULL: the post outlives the person)
--   2. Indexes: the team / division news read, the notify sweep (posts due
--      a bell), and a leading index on every new foreign key (239's rule).
--   3. authority_audit_action_check: 241's list + news_published,
--      news_notified (the CHECK is re-added in full — 241's precedent).
--
-- Posture unchanged (156): RLS on, no policies, service role only.
-- REVERSAL: drop the ten columns (their CHECKs and indexes go with them)
-- and re-ADD authority_audit_action_check from 241. Re-runnable until the
-- ledger row lands; a second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 243) THEN
    RAISE EXCEPTION '243 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 242 THEN RAISE EXCEPTION '243 pre-flight: ledger head is %, expected 242', n; END IF;
END $$;

-- ── 1. org_site_news: the newsroom columns ──────────────────────────────────
ALTER TABLE public.org_site_news
  ADD COLUMN IF NOT EXISTS summary        text,
  ADD COLUMN IF NOT EXISTS cover_path     text,
  ADD COLUMN IF NOT EXISTS team_id        uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS division_id    uuid REFERENCES public.divisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notify_members boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notified_at    timestamptz,
  ADD COLUMN IF NOT EXISTS banner_until   date,
  ADD COLUMN IF NOT EXISTS source_ref     text,
  ADD COLUMN IF NOT EXISTS draft          jsonb,
  ADD COLUMN IF NOT EXISTS created_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.org_site_news DROP CONSTRAINT IF EXISTS org_site_news_summary_check;
ALTER TABLE public.org_site_news ADD CONSTRAINT org_site_news_summary_check
  CHECK (summary IS NULL OR char_length(summary) BETWEEN 1 AND 280);
ALTER TABLE public.org_site_news DROP CONSTRAINT IF EXISTS org_site_news_cover_path_check;
ALTER TABLE public.org_site_news ADD CONSTRAINT org_site_news_cover_path_check
  CHECK (cover_path IS NULL OR cover_path LIKE 'org-media/%');
ALTER TABLE public.org_site_news DROP CONSTRAINT IF EXISTS org_site_news_one_tag_check;
ALTER TABLE public.org_site_news ADD CONSTRAINT org_site_news_one_tag_check
  CHECK (team_id IS NULL OR division_id IS NULL);
ALTER TABLE public.org_site_news DROP CONSTRAINT IF EXISTS org_site_news_notified_check;
ALTER TABLE public.org_site_news ADD CONSTRAINT org_site_news_notified_check
  CHECK (notified_at IS NULL OR notify_members);
ALTER TABLE public.org_site_news DROP CONSTRAINT IF EXISTS org_site_news_source_ref_check;
ALTER TABLE public.org_site_news ADD CONSTRAINT org_site_news_source_ref_check
  CHECK (source_ref IS NULL OR source_ref ~ '^(contest|game|season):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
ALTER TABLE public.org_site_news DROP CONSTRAINT IF EXISTS org_site_news_draft_check;
ALTER TABLE public.org_site_news ADD CONSTRAINT org_site_news_draft_check
  CHECK (draft IS NULL OR jsonb_typeof(draft) = 'object');

-- ── 2. Indexes ──────────────────────────────────────────────────────────────
-- One live draft per source (a second "Draft a recap" opens the first).
CREATE UNIQUE INDEX IF NOT EXISTS org_site_news_source_ref_uniq
  ON public.org_site_news (site_id, source_ref)
  WHERE source_ref IS NOT NULL AND deleted_at IS NULL;
-- A team's / a division's news, newest first.
CREATE INDEX IF NOT EXISTS idx_org_site_news_team
  ON public.org_site_news (team_id, published_at DESC) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_site_news_division
  ON public.org_site_news (division_id, published_at DESC) WHERE division_id IS NOT NULL;
-- The notify sweep: posts due their bells.
CREATE INDEX IF NOT EXISTS idx_org_site_news_notify_due
  ON public.org_site_news (published_at) WHERE notify_members AND notified_at IS NULL;
-- 239's rule: every foreign key has a leading index (the two above lead with
-- team_id / division_id; the author needs its own).
CREATE INDEX IF NOT EXISTS idx_org_site_news_created_by
  ON public.org_site_news (created_by) WHERE created_by IS NOT NULL;

-- ── 3. authority_audit: news_published, news_notified (241's list + two) ─────
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
  'official_tag_removed',
  'news_published',
  'news_notified'
));

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (243, '243_newsroom.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 243 APPLIED | 10 | 6 | 5 | 1 | 243
SELECT '243 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_site_news'
          AND column_name IN ('summary', 'cover_path', 'team_id', 'division_id', 'notify_members', 'notified_at', 'banner_until', 'source_ref', 'draft', 'created_by')) AS news_columns_expect_10,
       (SELECT count(*) FROM pg_constraint WHERE conname IN ('org_site_news_summary_check', 'org_site_news_cover_path_check', 'org_site_news_one_tag_check',
          'org_site_news_notified_check', 'org_site_news_source_ref_check', 'org_site_news_draft_check')) AS news_checks_expect_6,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('org_site_news_source_ref_uniq', 'idx_org_site_news_team',
          'idx_org_site_news_division', 'idx_org_site_news_notify_due', 'idx_org_site_news_created_by')) AS news_indexes_expect_5,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'authority_audit_action_check' AND pg_get_constraintdef(oid) LIKE '%news_notified%') AS audit_actions_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_243;

-- ============================================================================
-- 185 — Pages as compositions (Site Builder program 2, B — Sep 11 2026)
--
-- A custom page becomes a layout of the same registered widgets as the home
-- page, edited in the same editor, under the same draft → publish → revisions
-- gate. The page's truth moves into the ONE revision snapshot
-- (`snapshot.pages[pageId]`); `org_site_pages` becomes its PUBLISHED
-- PROJECTION — exactly as `org_site_modules` is of `snapshot.modules`.
--
--   layout  jsonb   the page's published SiteLayout; NULL = the legacy `body`
--                   blocks are still the truth (converted in app code, never
--                   here — the 180 rule: no SQL backfill of authored content)
--   in_nav  boolean the page shows in the site header (the "hide" switch)
--
-- Header ORDER rides `org_sites.nav_config` (`{key: 'page:<uuid>'}` entries),
-- so there is no nav_order column. Publish-vs-draft is the revision, so there
-- is no published_body column. Posture A (RLS on, zero policies, REVOKE ALL)
-- is unchanged — no grants are touched.
--
-- Re-runnable end to end. Down-steps (documentation only, never executed):
--   ALTER TABLE org_site_pages DROP COLUMN IF EXISTS layout, DROP COLUMN IF EXISTS in_nav;
-- ============================================================================

ALTER TABLE org_site_pages
  ADD COLUMN IF NOT EXISTS layout jsonb,
  ADD COLUMN IF NOT EXISTS in_nav boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN org_site_pages.layout IS 'Published SiteLayout of the page (mirrored from the revision snapshot on publish); NULL = legacy body blocks are the truth.';
COMMENT ON COLUMN org_site_pages.in_nav IS 'Whether the page is listed in the site header; a hidden page stays reachable at its address.';

-- PostgREST must see the new columns before the app selects them.
NOTIFY pgrst, 'reload schema';

-- Check grid (a SELECT, never a RAISE — the SQL editor runs this file as one
-- transaction and an exception would roll the migration back):
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'org_site_pages' AND column_name IN ('layout', 'in_nav')
 ORDER BY column_name;

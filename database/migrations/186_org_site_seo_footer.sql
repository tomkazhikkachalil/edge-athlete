-- ============================================================================
-- 186 — SEO, footer (Site Builder program 2, C — Sep 11 2026)
--
-- Two more content columns on org_sites, mirrored from the revision snapshot
-- on publish like hero_config and contact_config (the PUBLISHED PROJECTION):
--
--   seo_config     jsonb  { title?, description?, imagePath? }   — the
--                         manager's page title, meta description and social
--                         image (an org-media/{siteId}/ asset)
--   footer_config  jsonb  { text?, links?: [{label, url}], showSocials? }
--                         — the manager's footer line, links and whether the
--                         contact card's socials show; "Powered by Edge
--                         Athlete" stays on every site (a platform line)
--
-- The chosen favicon needs no column: it is a theme token (`iconPath`) in
-- theme_token_set. Posture A (RLS on, zero policies, REVOKE ALL) unchanged.
-- Every reader steps down on 42703 until this runs (the 185 pattern).
--
-- Re-runnable end to end. Down-steps (documentation only, never executed):
--   ALTER TABLE org_sites DROP COLUMN IF EXISTS seo_config, DROP COLUMN IF EXISTS footer_config;
-- ============================================================================

ALTER TABLE org_sites
  ADD COLUMN IF NOT EXISTS seo_config    jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS footer_config jsonb NOT NULL DEFAULT '{}';

COMMENT ON COLUMN org_sites.seo_config IS 'Published SEO config (title, description, imagePath) mirrored from the revision snapshot on publish.';
COMMENT ON COLUMN org_sites.footer_config IS 'Published footer config (text, links, showSocials) mirrored from the revision snapshot on publish.';

NOTIFY pgrst, 'reload schema';

-- Check grid (a SELECT, never a RAISE — one transaction in the SQL editor):
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'org_sites' AND column_name IN ('seo_config', 'footer_config')
 ORDER BY column_name;

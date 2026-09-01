-- ============================================================================
-- 156: org_site_news — the news module (phase 3.5)
-- ============================================================================
-- The masterplan's site builder names News as a MODULE plus hand-authored
-- "news posts" — explicitly distinct from `page` ("the short hand-authored
-- list only"), so posts get their own table rather than a kind column on
-- org_site_pages. Shape decisions:
--   * body reuses the ORDERED BLOCK ARRAY (the pages schema verbatim —
--     the same block editor and renderer serve both).
--   * published_at NULL = draft; SET = live AND the feed order (it can be
--     backdated; re-publish keeps the original date — app-enforced).
--     No separate visibility column: the timestamp IS the state.
--   * UNIQUE (site_id, slug); INDEX (site_id, published_at DESC) for the
--     date-ordered feed.
--   * The org_site_modules key CHECK widens to include 'news' (the
--     template_id widens-additively precedent from 155).
--   * EXISTING sites get their news module row inserted DISABLED (no
--     surprise sections); new sites seed it enabled like every module
--     (app-side MODULE_KEYS grew). Posture A, like every org-site table.
--
-- ORDER-STRICT: run AFTER 155. App code merged ahead of this migration
-- DEGRADES: news reads return empty, news creation answers a friendly
-- error, site creation retries without the news row on the old CHECK.
-- Re-runnable end to end (the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): DROP org_site_news;
-- restore the 9-key module CHECK; DELETE module rows WHERE module_key='news'.

-- ── org_site_news ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_site_news (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid NOT NULL REFERENCES org_sites(id) ON DELETE CASCADE,
  slug         text NOT NULL
    CONSTRAINT org_site_news_slug_check
    CHECK (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' AND char_length(slug) <= 80),
  title        text NOT NULL
    CONSTRAINT org_site_news_title_check CHECK (char_length(title) BETWEEN 1 AND 120),
  body         jsonb NOT NULL DEFAULT '[]',
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT org_site_news_uniq UNIQUE (site_id, slug)
);

DROP TRIGGER IF EXISTS org_site_news_updated_at ON org_site_news;
CREATE TRIGGER org_site_news_updated_at
  BEFORE UPDATE ON org_site_news
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE org_site_news ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_site_news FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_org_site_news_feed
  ON org_site_news (site_id, published_at DESC);

-- ── Widen the module key CHECK (additive; re-runnable) ──────────────────────
ALTER TABLE org_site_modules
  DROP CONSTRAINT IF EXISTS org_site_modules_key_check;
ALTER TABLE org_site_modules
  ADD CONSTRAINT org_site_modules_key_check CHECK (module_key IN (
    'hero','standings','schedule','teams','staff','venues','affiliations',
    'sponsors','contact','news'
  ));

-- ── Seed the news module row for EXISTING sites — DISABLED ──────────────────
INSERT INTO org_site_modules (site_id, module_key, enabled, sort_order, config)
SELECT s.id, 'news', false, 9, '{}'::jsonb
FROM org_sites s
WHERE NOT EXISTS (
  SELECT 1 FROM org_site_modules m
  WHERE m.site_id = s.id AND m.module_key = 'news'
);

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT count(*) > 0 FROM information_schema.tables
     WHERE table_name = 'org_site_news')                            AS news_exists,
  (SELECT relrowsecurity FROM pg_class
     WHERE relname = 'org_site_news')                               AS news_rls_on,
  (SELECT count(*) = 1 FROM pg_constraint
     WHERE conname = 'org_site_news_uniq')                          AS news_slug_uniq,
  (SELECT pg_get_constraintdef(oid) LIKE '%news%' FROM pg_constraint
     WHERE conname = 'org_site_modules_key_check')                  AS module_check_widened,
  (SELECT count(*) FROM org_site_modules WHERE module_key = 'news') AS news_rows_seeded,
  (SELECT count(*) FROM org_sites)                                  AS sites_total;

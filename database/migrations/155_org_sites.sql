-- ============================================================================
-- 155: org_sites + modules + pages — the public site product (phase 3, R1)
-- ============================================================================
-- Masterplan §3.5's three tables. Tom's phase-3 decisions (Sep 1):
--   * org_sites.subdomain IS the slug — the single namespace column
--     (shared denylist with reserved_handles; no slug columns on
--     leagues/clubs; orgs without sites need no slug). Immutable after
--     first publish in v1 (slug-change 301 history deferred —
--     handle_history is the model when it comes).
--   * Explicit create + publish gate: published_at NULL = draft = the
--     public routes 404. One site per org (partial uniques per side).
--   * ONE template v1 ('classic'); template_id CHECK widens additively.
--   * custom_domain + domain_verified_at are MODELED ONLY (masterplan
--     §2: shipped later; verification flow is a future phase).
--   * page.body is an ORDERED BLOCK ARRAY jsonb (the masterplan's own
--     recommendation — no content migration when a block builder ships).
--
-- Subdomain CHECK is a DNS LABEL ([a-z0-9-], 3–63, no edge hyphens) —
-- deliberately NOT is_valid_handle (006), which allows '.' and '_'
-- (illegal in DNS). App-layer adds: reserved_handles denylist at mint,
-- and page slugs deny the module keys so /org/{slug}/{page} never
-- shadows a module route.
--
-- Posture A (RLS on, zero policies, REVOKEd) like every org table —
-- the RECORDED §6 DEVIATION: public reads stay service-role +
-- viewer-independent app code (the spike-validated standings pattern);
-- no anon-key server path exists and phase 3 does not introduce one.
--
-- ORDER-STRICT: run AFTER 154, BEFORE merging the site-plumbing PR
-- (its POST writes these tables; GETs degrade to empty pre-155).
-- Re-runnable end to end (the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): DROP org_site_pages,
-- org_site_modules, org_sites (child-first); DELETE FROM
-- reserved_handles WHERE reason = 'org-subdomain infrastructure'.
-- ============================================================================

-- ── org_sites ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_sites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id          uuid REFERENCES leagues(id) ON DELETE CASCADE,
  club_id            uuid REFERENCES clubs(id) ON DELETE CASCADE,
  subdomain          text NOT NULL
    CONSTRAINT org_sites_subdomain_check
    CHECK (subdomain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
       AND char_length(subdomain) BETWEEN 3 AND 63),
  template_id        text NOT NULL DEFAULT 'classic'
    CONSTRAINT org_sites_template_check CHECK (template_id IN ('classic')),
  theme_token_set    jsonb NOT NULL DEFAULT '{}',
  nav_config         jsonb NOT NULL DEFAULT '[]',
  logo_path          text,
  hero_config        jsonb NOT NULL DEFAULT '{}',
  contact_config     jsonb NOT NULL DEFAULT '{}',
  custom_domain      text,
  domain_verified_at timestamptz,
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at         timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT org_sites_org_check CHECK (num_nonnulls(league_id, club_id) = 1)
);

DROP TRIGGER IF EXISTS org_sites_updated_at ON org_sites;
CREATE TRIGGER org_sites_updated_at
  BEFORE UPDATE ON org_sites
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- One site per org; one owner per subdomain (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS org_sites_league_uniq
  ON org_sites (league_id) WHERE league_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS org_sites_club_uniq
  ON org_sites (club_id) WHERE club_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS org_sites_subdomain_lower_uniq
  ON org_sites (LOWER(subdomain));

-- ── org_site_modules ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_site_modules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    uuid NOT NULL REFERENCES org_sites(id) ON DELETE CASCADE,
  module_key text NOT NULL
    CONSTRAINT org_site_modules_key_check
    CHECK (module_key IN ('hero','standings','schedule','teams','venues',
                          'staff','sponsors','contact','affiliations')),
  enabled    boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  config     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT org_site_modules_uniq UNIQUE (site_id, module_key)
);

DROP TRIGGER IF EXISTS org_site_modules_updated_at ON org_site_modules;
CREATE TRIGGER org_site_modules_updated_at
  BEFORE UPDATE ON org_site_modules
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── org_site_pages ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_site_pages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    uuid NOT NULL REFERENCES org_sites(id) ON DELETE CASCADE,
  slug       text NOT NULL
    CONSTRAINT org_site_pages_slug_check
    CHECK (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' AND char_length(slug) <= 80),
  title      text NOT NULL
    CONSTRAINT org_site_pages_title_check CHECK (char_length(title) BETWEEN 1 AND 120),
  body       jsonb NOT NULL DEFAULT '[]',
  visibility text NOT NULL DEFAULT 'draft'
    CONSTRAINT org_site_pages_visibility_check CHECK (visibility IN ('public','draft')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT org_site_pages_uniq UNIQUE (site_id, slug)
);

DROP TRIGGER IF EXISTS org_site_pages_updated_at ON org_site_pages;
CREATE TRIGGER org_site_pages_updated_at
  BEFORE UPDATE ON org_site_pages
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── RLS: posture A (the recorded §6 deviation — see header) ─────────────────
ALTER TABLE org_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_site_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_site_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_sites, org_site_modules, org_site_pages FROM PUBLIC, anon, authenticated;

-- ── Index for the module render path ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_org_site_modules_site ON org_site_modules (site_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_org_site_pages_site ON org_site_pages (site_id);

-- ── Reserved-subdomain seeds (the shared denylist gains DNS infrastructure) ──
INSERT INTO reserved_handles (handle, reason) VALUES
  ('www', 'org-subdomain infrastructure'),
  ('mail', 'org-subdomain infrastructure'),
  ('smtp', 'org-subdomain infrastructure'),
  ('api', 'org-subdomain infrastructure'),
  ('cdn', 'org-subdomain infrastructure'),
  ('status', 'org-subdomain infrastructure'),
  ('staging', 'org-subdomain infrastructure'),
  ('preview', 'org-subdomain infrastructure'),
  ('assets', 'org-subdomain infrastructure'),
  ('docs', 'org-subdomain infrastructure')
ON CONFLICT (handle) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'org_sites') AS sites_exists,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'org_site_modules') AS modules_exists,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'org_site_pages') AS pages_exists,
  (SELECT bool_and(relrowsecurity) FROM pg_class
   WHERE relname IN ('org_sites', 'org_site_modules', 'org_site_pages')) AS all_rls_on,
  NOT (has_table_privilege('anon', 'org_sites', 'SELECT')
    OR has_table_privilege('anon', 'org_site_modules', 'SELECT')
    OR has_table_privilege('anon', 'org_site_pages', 'SELECT')) AS anon_revoked,
  NOT (has_table_privilege('authenticated', 'org_sites', 'SELECT')
    OR has_table_privilege('authenticated', 'org_site_pages', 'SELECT')) AS authed_revoked,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'org_sites_org_check') LIKE '%num_nonnulls%' AS org_check_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'org_sites_subdomain_check') LIKE '%63%' AS subdomain_dns_check,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'org_sites_subdomain_lower_uniq') AS subdomain_uniq_lower,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'org_sites_league_uniq') AS one_site_per_league,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'org_sites_club_uniq') AS one_site_per_club,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'org_site_modules_key_check') LIKE '%affiliations%' AS module_keys_full,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_pages_uniq') AS page_slug_uniq,
  (SELECT count(*) >= 10 FROM reserved_handles WHERE reason = 'org-subdomain infrastructure') AS dns_reserved_seeded,
  (SELECT count(*) FROM org_sites) AS sites_info,
  (SELECT count(*) FROM org_site_pages) AS pages_info;
-- Expect: true × 14, then two info counts (0 on first run).

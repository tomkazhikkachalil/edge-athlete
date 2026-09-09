-- ============================================================================
-- 180: org_site_revisions — draft / publish / history (Site Builder, phase 2)
-- ============================================================================
-- Edits to a site go to a DRAFT revision; the live site changes only on
-- Publish. A revision is ONE jsonb snapshot of everything under the publish
-- gate (Tom, Sep 9 2026): template, theme tokens, hero, nav, contact, and
-- every module row's enabled / sort_order / config — plus, from phase 1,
-- the widget layout inside the same jsonb (`snapshot.layout`, zero DDL).
--
-- The content columns of org_sites and all of org_site_modules stay THE
-- PUBLISHED PROJECTION: publish mirrors the promoted snapshot back into
-- them, so every existing reader (the (public) layout and home, card.png,
-- favicon.svg, the in-app brand, the gallery streamer's gate, the course
-- photos, the sitemap's updated_at) reads exactly what it reads today, and
-- a drafted gallery pick never streams until it is published. logo_path
-- and the domain columns are org identity — outside the gate, untouched.
--
-- Two pointers on org_sites (ON DELETE SET NULL — deleting a revision can
-- never take a site with it):
--   draft_revision_id      NULL = no draft = nothing unpublished
--   published_revision_id  NULL = the rows were never published through a
--                          revision (every pre-180 site); the app snapshots
--                          the rows lazily on the first edit. NO SQL
--                          backfill, on purpose.
--
-- Posture A like 155 (RLS on, zero policies, REVOKEd): every read and write
-- is service-role + requireOrgManager in app code. No DEFAULT to get wrong
-- (the 175/179 lesson): the one writer (revisions-server.ts) names every
-- column it means. `published_by` and `stats` are here so phase 8's publish
-- metrics need no further DDL.
--
-- ORDER: the P2-A PR merges first (it tolerates a pre-180 database — the
-- console GET answers `supported: false`, the revisions POST answers a
-- friendly 409, sitePATCH keeps today's live writes), run this, then P2-B
-- (the gate). Re-runnable.
--
-- Down-steps (documentation only, never executed):
--   ALTER TABLE org_sites DROP COLUMN draft_revision_id, DROP COLUMN published_revision_id;
--   DROP TABLE org_site_revisions;
-- ============================================================================

CREATE TABLE IF NOT EXISTS org_site_revisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid NOT NULL REFERENCES org_sites(id) ON DELETE CASCADE,
  snapshot     jsonb NOT NULL,
  -- Optimistic-concurrency counter for the DRAFT: every write compares and
  -- bumps it (UPDATE … WHERE rev = $seen); zero rows = someone else wrote.
  rev          integer NOT NULL DEFAULT 1,
  label        text
    CONSTRAINT org_site_revisions_label_check
    CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 60),
  created_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  -- Stamped ONCE when the draft is promoted. NULL = the draft.
  -- History = published_at IS NOT NULL, newest first.
  published_at timestamptz,
  published_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- Phase 8: what changed at publish (widgets touched, keys added/removed,
  -- seconds since the draft opened) — computed by the app, never queried
  -- inside here.
  stats        jsonb NOT NULL DEFAULT '{}'
);

DROP TRIGGER IF EXISTS org_site_revisions_updated_at ON org_site_revisions;
CREATE TRIGGER org_site_revisions_updated_at
  BEFORE UPDATE ON org_site_revisions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_org_site_revisions_site_created
  ON org_site_revisions (site_id, created_at DESC);

ALTER TABLE org_sites
  ADD COLUMN IF NOT EXISTS draft_revision_id     uuid REFERENCES org_site_revisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_revision_id uuid REFERENCES org_site_revisions(id) ON DELETE SET NULL;

-- ── RLS: posture A (155) ────────────────────────────────────────────────────
ALTER TABLE org_site_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_site_revisions FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  EXISTS (SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'org_site_revisions')          AS revisions_exists,   -- true
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'org_site_revisions')   AS rls_on,             -- true
  NOT (has_table_privilege('anon', 'org_site_revisions', 'SELECT')
    OR has_table_privilege('authenticated', 'org_site_revisions', 'SELECT'))   AS revoked,            -- true
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'org_sites' AND column_name = 'draft_revision_id')     AS draft_ptr,          -- true
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'org_sites' AND column_name = 'published_revision_id') AS published_ptr,      -- true
  EXISTS (SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_org_site_revisions_site_created')                   AS list_index,         -- true
  (SELECT count(*) FROM org_site_revisions)                                    AS revisions_count;    -- 0 on first run

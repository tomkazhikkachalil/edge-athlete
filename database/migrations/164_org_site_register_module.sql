-- ============================================================================
-- 164: the register module — org_site_modules CHECK widens (phase 5, R5)
-- ============================================================================
-- The 160 recipe verbatim: the public org site gains a 'register' module
-- — a CARD, not a subpage: it renders the season's OPEN registration
-- windows (viewer-independent; a missing window or table reads closed)
-- with a static link INTO the app's /register wizard. The public segment
-- stays session-free — the card never submits anything. Existing sites
-- get their register module row inserted DISABLED (no surprise
-- sections); new sites seed it enabled like every module (app-side
-- MODULE_KEYS grew; the siteCreatePOST 23514 retry ladder strips it on
-- older databases).
--
-- ORDER-STRICT: run AFTER 163. App code merged ahead DEGRADES: site
-- creation retries its module batch without 'register' on the old CHECK;
-- the toggle answers a friendly error; the card simply never renders.
-- Re-runnable end to end (the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): restore the 11-key
-- module CHECK; DELETE module rows WHERE module_key='register'.

-- ── Widen the module key CHECK (additive; re-runnable) ──────────────────────
ALTER TABLE org_site_modules
  DROP CONSTRAINT IF EXISTS org_site_modules_key_check;
ALTER TABLE org_site_modules
  ADD CONSTRAINT org_site_modules_key_check CHECK (module_key IN (
    'hero','standings','schedule','teams','staff','venues','affiliations',
    'sponsors','contact','news','gallery','register'
  ));

-- ── Seed the register module row for EXISTING sites — DISABLED ──────────────
INSERT INTO org_site_modules (site_id, module_key, enabled, sort_order, config)
SELECT s.id, 'register', false, 11, '{}'::jsonb
FROM org_sites s
WHERE NOT EXISTS (
  SELECT 1 FROM org_site_modules m
  WHERE m.site_id = s.id AND m.module_key = 'register'
);

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%register%' FROM pg_constraint
     WHERE conname = 'org_site_modules_key_check')                     AS module_check_widened,
  (SELECT count(*) FROM org_site_modules WHERE module_key = 'register') AS register_rows_seeded,
  (SELECT count(*) = 0 FROM org_site_modules
     WHERE module_key = 'register' AND enabled)                        AS all_seeded_disabled,
  (SELECT count(*) FROM org_sites)                                     AS sites_total;

-- ============================================================================
-- 160: the gallery module — org_site_modules CHECK widens (phase 4, R5)
-- ============================================================================
-- The 156 recipe verbatim: the public org site gains a 'gallery' module
-- rendering CONSENT-GATED contest media. No new table — the data is
-- contest_media (158) + the published curation bit + photo_consent (159);
-- an item renders publicly only when the org published it AND every
-- actively tagged athlete's roster membership carries photo_consent=true
-- (Tom's chosen bar, Sep 1). Existing sites get their gallery module row
-- inserted DISABLED (no surprise sections); new sites seed it enabled
-- like every module (app-side MODULE_KEYS grew, with the pre-migration
-- 23514 retry ladder in siteCreatePOST).
--
-- ORDER-STRICT: run AFTER 159. App code merged ahead of this migration
-- DEGRADES: site creation retries its module batch without 'gallery' on
-- the old CHECK; the toggle answers a friendly error; the public route
-- 404s (module rows absent ⇒ disabled ⇒ notFound).
-- Re-runnable end to end (the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): restore the 10-key
-- module CHECK; DELETE module rows WHERE module_key='gallery'.

-- ── Widen the module key CHECK (additive; re-runnable) ──────────────────────
ALTER TABLE org_site_modules
  DROP CONSTRAINT IF EXISTS org_site_modules_key_check;
ALTER TABLE org_site_modules
  ADD CONSTRAINT org_site_modules_key_check CHECK (module_key IN (
    'hero','standings','schedule','teams','staff','venues','affiliations',
    'sponsors','contact','news','gallery'
  ));

-- ── Seed the gallery module row for EXISTING sites — DISABLED ───────────────
INSERT INTO org_site_modules (site_id, module_key, enabled, sort_order, config)
SELECT s.id, 'gallery', false, 10, '{}'::jsonb
FROM org_sites s
WHERE NOT EXISTS (
  SELECT 1 FROM org_site_modules m
  WHERE m.site_id = s.id AND m.module_key = 'gallery'
);

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%gallery%' FROM pg_constraint
     WHERE conname = 'org_site_modules_key_check')                    AS module_check_widened,
  (SELECT count(*) FROM org_site_modules WHERE module_key = 'gallery') AS gallery_rows_seeded,
  (SELECT count(*) = 0 FROM org_site_modules
     WHERE module_key = 'gallery' AND enabled)                        AS all_seeded_disabled,
  (SELECT count(*) FROM org_sites)                                    AS sites_total;

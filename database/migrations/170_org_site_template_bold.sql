-- ============================================================================
-- 170: the second site template — org_sites.template_id CHECK widens (6b B2)
-- ============================================================================
-- 155 shipped ONE template ('classic') and promised the CHECK "widens
-- additively". 'bold' is the first addition: a full-width dark band
-- header with the nav inside it, a full-bleed hero, a two-column section
-- grid, tile teams, compact density. The template is a RENDER decision
-- (src/lib/org-sites/templates.ts) — this migration only admits the id.
--
-- ORDER-STRICT: run AFTER 169, BEFORE merging the B2 PR. App code merged
-- ahead DEGRADES: set_template answers a friendly 409 on the old CHECK;
-- readers treat an unknown id as 'classic'. Re-runnable end to end.
--
-- Down-steps (documentation only, never executed): UPDATE org_sites SET
-- template_id='classic' WHERE template_id='bold'; restore the one-id CHECK.

ALTER TABLE org_sites
  DROP CONSTRAINT IF EXISTS org_sites_template_check;
ALTER TABLE org_sites
  ADD CONSTRAINT org_sites_template_check CHECK (template_id IN ('classic', 'bold'));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%bold%' FROM pg_constraint
     WHERE conname = 'org_sites_template_check')                     AS template_check_widened,
  (SELECT count(*) FROM org_sites WHERE template_id = 'classic')     AS classic_sites,
  (SELECT count(*) FROM org_sites)                                   AS sites_total;

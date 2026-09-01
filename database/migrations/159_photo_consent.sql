-- ============================================================================
-- 159: photo consent on the roster membership (phase 4, R4)
-- ============================================================================
-- The masterplan's non-negotiable guardian gate: "a minor's media
-- appearing on a public club site requires a photo consent flag captured
-- at registration on the roster membership. Absence of consent means the
-- media exists in the org's private library and never renders publicly."
-- Shape decisions:
--   * Lives on the ORG-SCOPE roster row (kind='roster', scope_type='org')
--     — consent is granted per-ORG (a parent consents to the club, not to
--     one team); team-scope rows and public readers join through it.
--   * photo_consent: NULL = never asked, false = declined, true =
--     granted. NULL and false read identically everywhere (no consent);
--     the tri-state exists so the guardian queue can ASK exactly once.
--     Absence of the column (pre-159, '42703') also reads as no consent —
--     the fail-safe direction at every layer.
--   * photo_consent_at / photo_consent_by audit the consent act (who:
--     guardian vs adult athlete — app-enforced via canGrantPhotoConsent;
--     supervised profiles are guardian-only).
--   * DELIBERATELY NOT consent_records: that table is the global COPPA
--     posting-consent state (append-only, per-profile). This is a
--     per-org, revocable, membership-scoped publication grant.
--   * Imported stubs are untouched: the import path predates these
--     columns and writes none, so every stub stays NULL — an import can
--     never become a consent bypass.
--
-- ORDER-STRICT: run AFTER 158. App code merged ahead DEGRADES: consent
-- reads treat the missing column as NULL (nothing public), the accept
-- flow drops the consent fields on 42703 and proceeds (a roster accept
-- must never break on an old database). Re-runnable end to end.
--
-- Down-steps (documentation only, never executed): ALTER TABLE
-- memberships DROP COLUMN photo_consent, photo_consent_at,
-- photo_consent_by.

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS photo_consent    boolean,
  ADD COLUMN IF NOT EXISTS photo_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS photo_consent_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT count(*) = 3 FROM information_schema.columns
     WHERE table_name = 'memberships'
       AND column_name IN ('photo_consent', 'photo_consent_at', 'photo_consent_by'))
                                                                  AS consent_columns,
  (SELECT is_nullable = 'YES' FROM information_schema.columns
     WHERE table_name = 'memberships'
       AND column_name = 'photo_consent')                         AS consent_nullable,
  (SELECT count(*) FROM memberships
     WHERE photo_consent IS NOT NULL)                             AS consents_recorded,
  (SELECT count(*) FROM memberships
     WHERE kind = 'roster' AND scope_type = 'org')                AS org_roster_rows;

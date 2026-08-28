-- ============================================================================
-- 130: in-product consent signatures — typed + drawn methods (Family Console W3)
-- ============================================================================
-- Consent capture was paper-shaped: print the statement, sign it, photograph
-- it, upload it. This migration admits the two in-product signature methods
-- the consent page now offers:
--
--   * typed_signature — the guardian types their full legal name; the client
--     renders a signature card PNG (statement header + typed name + signer
--     email + date) and uploads it as evidence like any signed form.
--   * drawn_signature — the guardian signs a canvas; same card, drawn strokes.
--
-- DELIBERATE SHAPE: no new columns. The signature card PNG travels the
-- existing evidence path (private consent-evidence bucket, admin signed-URL
-- review), so the storage-sweep and account-deletion exclusions, the admin
-- review flow, and the park/restore method forward-copy all work unchanged.
-- Manual admin review remains the verification step for every method (Tom's
-- locked decision) — a typed card carries exactly the trust of a photographed
-- paper form, and the reviewer sees both the same way.
--
-- The CHECK is 050's inline auto-named constraint; this is the house
-- full-list re-ADD (028/053/059/089/095/129 pattern). 056's append-only
-- trigger compares row jsonb and is untouched by CHECK changes.
-- ============================================================================

ALTER TABLE consent_records DROP CONSTRAINT IF EXISTS consent_records_method_check;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_method_check
  CHECK (method IN (
    'signed_form', 'card_charge', 'id_verification', 'video_call', 'email_plus',
    'typed_signature', 'drawn_signature'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid — every column must read true ─────────────────────
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'consent_records_method_check'
       AND conrelid = 'consent_records'::regclass)
    LIKE '%typed_signature%'                                        AS typed_ok,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'consent_records_method_check'
       AND conrelid = 'consent_records'::regclass)
    LIKE '%drawn_signature%'                                        AS drawn_ok,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'consent_records_method_check'
       AND conrelid = 'consent_records'::regclass)
    LIKE '%signed_form%'                                            AS legacy_kept;

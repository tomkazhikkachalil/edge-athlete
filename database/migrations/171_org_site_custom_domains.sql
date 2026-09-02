-- ============================================================================
-- 171: custom domains — claim, verify, attach, activate (phase 6b, C1)
-- ============================================================================
-- 155 modeled `custom_domain` + `domain_verified_at` and deferred the flow.
-- This is the flow's schema half. The lifecycle (domainState in
-- src/lib/org-sites/domains.ts):
--   none → pending (claimed; TXT token minted) → verified (TXT seen) →
--   attached (Vercel accepted the domain) → active (the domain answered
--   /.well-known/edge-athlete with this slug — C2's serving proof).
-- The public site never 301s to a domain that isn't ACTIVE (no dead ends).
--
-- THE ONE POSTURE-A EXCEPTION (Tom, Sep 1): org_sites has RLS with zero
-- policies and anon REVOKEd (155). The Edge middleware must map an
-- incoming Host to a slug without a service key, so two SECURITY DEFINER
-- functions are granted to anon/authenticated. They expose ONLY what the
-- domain itself publishes: (verified host → slug, active?) and (slug →
-- active host). No other org_sites column is reachable. Recorded in
-- docs/HARDENING.md §B4 invariant 10.
--
-- ORDER-STRICT: run AFTER 170, BEFORE merging the C1 PR. App code merged
-- ahead DEGRADES: the site read retries without the new columns (42703)
-- and the domain routes answer a friendly 409.
-- Re-runnable end to end (CREATE OR REPLACE; the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): DROP the six columns,
-- the unique index, the CHECK, and both functions.

-- ── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE org_sites
  ADD COLUMN IF NOT EXISTS domain_verification_token text,
  ADD COLUMN IF NOT EXISTS domain_requested_at      timestamptz,
  ADD COLUMN IF NOT EXISTS domain_vercel_state      text,
  ADD COLUMN IF NOT EXISTS domain_vercel_at         timestamptz,
  ADD COLUMN IF NOT EXISTS domain_vercel_detail     jsonb,
  ADD COLUMN IF NOT EXISTS domain_active_at         timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_domain_vercel_state_check') THEN
    ALTER TABLE org_sites ADD CONSTRAINT org_sites_domain_vercel_state_check
      CHECK (domain_vercel_state IS NULL OR domain_vercel_state IN ('pending', 'attached', 'failed', 'detached'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_custom_domain_check') THEN
    ALTER TABLE org_sites ADD CONSTRAINT org_sites_custom_domain_check
      CHECK (custom_domain IS NULL OR (
        length(custom_domain) <= 253
        AND custom_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      ));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS org_sites_custom_domain_uniq
  ON org_sites (custom_domain) WHERE custom_domain IS NOT NULL;

-- ── The bounded anon RPCs (the posture-A exception) ─────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_org_site_host(p_host text)
RETURNS TABLE (slug text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT subdomain, domain_active_at IS NOT NULL
  FROM org_sites
  WHERE custom_domain = lower(p_host)
    AND domain_verified_at IS NOT NULL
    AND published_at IS NOT NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.resolve_org_site_domain(p_slug text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT custom_domain
  FROM org_sites
  WHERE subdomain = lower(p_slug)
    AND domain_active_at IS NOT NULL
    AND published_at IS NOT NULL
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.resolve_org_site_host(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_org_site_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_org_site_host(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_org_site_domain(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT count(*) = 6 FROM information_schema.columns
     WHERE table_name = 'org_sites' AND column_name IN
       ('domain_verification_token','domain_requested_at','domain_vercel_state',
        'domain_vercel_at','domain_vercel_detail','domain_active_at'))         AS six_columns,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'org_sites_custom_domain_uniq') AS unique_index,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_custom_domain_check') AS hostname_check,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'resolve_org_site_host')          AS host_rpc,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'resolve_org_site_domain')        AS domain_rpc,
  has_function_privilege('anon', 'public.resolve_org_site_host(text)', 'EXECUTE')  AS anon_can_resolve_host,
  has_function_privilege('anon', 'public.resolve_org_site_domain(text)', 'EXECUTE') AS anon_can_resolve_domain,
  (SELECT count(*) FROM org_sites WHERE custom_domain IS NOT NULL)                AS domains_claimed;

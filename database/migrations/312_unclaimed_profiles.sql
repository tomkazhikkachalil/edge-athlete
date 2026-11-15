-- ============================================================================
-- 312: unclaimed profiles — the request to be given a placeholder's film, and
--      the club's switch to keep a placeholder's page private (Nov 16 2026;
--      Sprint 4 PR 6b). Runs on BOTH staging and prod BEFORE the code deploys
--      (without the tables no page is open and a request answers 503).
-- ============================================================================
-- Tom, Nov 15 2026: a player a club has tagged who has not claimed their
-- profile gets a public page marked "Unclaimed", and claiming is a process —
-- the person selects the profile and starts a request. Nov 16: there is no
-- account merge, so an approved request MOVES THE FILM — the placeholder's
-- tags on that organization's videos become the requester's own (the writer
-- already exists: linkTagTarget). The roster seat and any official result
-- stay with the placeholder for the club.
--
--   profile_claim_requests — one row per request.
--     profile_id            the placeholder (a roster stub).
--     requester_profile_id  who the film goes to: the person asking, or the
--                           child a guardian asks for.
--     requested_by_user_id  who pressed the button.
--     org_id                the organization that decides (it tagged the film).
--     status                pending | approved | declined.
--     linked_count          how many tags moved on approval.
--     decided_by_user_id / decided_at
--
--   unclaimed_page_private — a placeholder whose page the club keeps private
--     (many of these players are minors). One row = not open.
--     profile_id (PK), set_by_user_id, created_at.
--
-- Posture A on both: RLS on, no policies, service role only — the one writer
-- is src/lib/sport-profile/unclaimed-server.ts. Created EMPTY, so the indexes
-- are inline. Every FK is a named ALTER with its own index
-- (fk-index-coverage). The placeholder and the requester CASCADE →
-- PROFILE_FK_POLICY 'goes' (a request leaves with either person).
--
-- REVERSAL: DROP TABLE public.profile_claim_requests;
--           DROP TABLE public.unclaimed_page_private;
-- A second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 312) THEN
    RAISE EXCEPTION '312 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 311 THEN RAISE EXCEPTION '312 pre-flight: ledger head is %, expected 311', n; END IF;
END $$;

-- ── 1. profile_claim_requests ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_claim_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  requester_profile_id uuid NOT NULL,
  requested_by_user_id uuid,
  org_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  linked_count integer NOT NULL DEFAULT 0 CHECK (linked_count >= 0),
  decided_by_user_id uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT profile_claim_requests_not_self_check CHECK (profile_id <> requester_profile_id)
);
ALTER TABLE public.profile_claim_requests DROP CONSTRAINT IF EXISTS profile_claim_requests_pkey;
ALTER TABLE public.profile_claim_requests ADD CONSTRAINT profile_claim_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.profile_claim_requests DROP CONSTRAINT IF EXISTS profile_claim_requests_profile_id_fkey;
ALTER TABLE public.profile_claim_requests ADD CONSTRAINT profile_claim_requests_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.profile_claim_requests DROP CONSTRAINT IF EXISTS profile_claim_requests_requester_profile_id_fkey;
ALTER TABLE public.profile_claim_requests ADD CONSTRAINT profile_claim_requests_requester_profile_id_fkey FOREIGN KEY (requester_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.profile_claim_requests DROP CONSTRAINT IF EXISTS profile_claim_requests_requested_by_user_id_fkey;
ALTER TABLE public.profile_claim_requests ADD CONSTRAINT profile_claim_requests_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.profile_claim_requests DROP CONSTRAINT IF EXISTS profile_claim_requests_decided_by_user_id_fkey;
ALTER TABLE public.profile_claim_requests ADD CONSTRAINT profile_claim_requests_decided_by_user_id_fkey FOREIGN KEY (decided_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.profile_claim_requests DROP CONSTRAINT IF EXISTS profile_claim_requests_org_id_fkey;
ALTER TABLE public.profile_claim_requests ADD CONSTRAINT profile_claim_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
-- One open request per person per placeholder.
CREATE UNIQUE INDEX IF NOT EXISTS profile_claim_requests_open_uidx ON public.profile_claim_requests (profile_id, requester_profile_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS profile_claim_requests_profile_id_idx ON public.profile_claim_requests (profile_id, status);
CREATE INDEX IF NOT EXISTS profile_claim_requests_requester_profile_id_idx ON public.profile_claim_requests (requester_profile_id);
CREATE INDEX IF NOT EXISTS profile_claim_requests_requested_by_user_id_idx ON public.profile_claim_requests (requested_by_user_id);
CREATE INDEX IF NOT EXISTS profile_claim_requests_decided_by_user_id_idx ON public.profile_claim_requests (decided_by_user_id);
CREATE INDEX IF NOT EXISTS profile_claim_requests_org_id_idx ON public.profile_claim_requests (org_id, status);
ALTER TABLE public.profile_claim_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_claim_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.profile_claim_requests TO service_role;
COMMENT ON TABLE public.profile_claim_requests IS 'A request to be given an unclaimed placeholder''s film (312): approved by the organization that tagged it, it moves the placeholder''s tags on that organization''s videos to the requester (docs/specs/sport-profile.md). Service role only; the one writer is src/lib/sport-profile/unclaimed-server.ts.';

-- ── 2. unclaimed_page_private ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.unclaimed_page_private (
  profile_id uuid NOT NULL,
  set_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.unclaimed_page_private DROP CONSTRAINT IF EXISTS unclaimed_page_private_pkey;
ALTER TABLE public.unclaimed_page_private ADD CONSTRAINT unclaimed_page_private_pkey PRIMARY KEY (profile_id);
ALTER TABLE public.unclaimed_page_private DROP CONSTRAINT IF EXISTS unclaimed_page_private_profile_id_fkey;
ALTER TABLE public.unclaimed_page_private ADD CONSTRAINT unclaimed_page_private_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.unclaimed_page_private DROP CONSTRAINT IF EXISTS unclaimed_page_private_set_by_user_id_fkey;
ALTER TABLE public.unclaimed_page_private ADD CONSTRAINT unclaimed_page_private_set_by_user_id_fkey FOREIGN KEY (set_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS unclaimed_page_private_set_by_user_id_idx ON public.unclaimed_page_private (set_by_user_id);
ALTER TABLE public.unclaimed_page_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.unclaimed_page_private FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.unclaimed_page_private TO service_role;
COMMENT ON TABLE public.unclaimed_page_private IS 'A placeholder player whose unclaimed page the organization keeps private (312). One row = the page is not open. Service role only; the one writer is src/lib/sport-profile/unclaimed-server.ts.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (312, '312_unclaimed_profiles.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 312 APPLIED | 2 | 7 | false | false | 312
SELECT '312 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('profile_claim_requests', 'unclaimed_page_private')) AS tables_expect_2,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('profile_claim_requests', 'unclaimed_page_private') AND indexname NOT LIKE '%_pkey') AS indexes_expect_7,
       has_table_privilege('anon', 'public.profile_claim_requests', 'SELECT') AS anon_requests_expect_false,
       has_table_privilege('authenticated', 'public.unclaimed_page_private', 'SELECT') AS authed_private_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_312;

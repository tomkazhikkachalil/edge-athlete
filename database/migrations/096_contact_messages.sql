-- ============================================================================
-- Migration 096 — contact_messages: the contact form's source of truth
-- ============================================================================
-- Guardian funnel round (Aug 20 2026). The contact form hard-500'd whenever
-- the email send failed — cutting off the site's only support channel for
-- exactly the people locked out by email outages. The message now persists
-- FIRST; the email is best-effort on top (delivered flag records whether it
-- also reached the inbox).
--
-- Deploy order: STRICT — run before merging (the route inserts here).
-- Service-role only: RLS on with ZERO policies (091 pattern).

CREATE TABLE IF NOT EXISTS contact_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  email      text NOT NULL,
  message    text NOT NULL,
  delivered  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;  -- zero policies
REVOKE ALL ON TABLE public.contact_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.contact_messages TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check (run separately if pasting mangles quotes) ─────────────
-- Expect: every column true.
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'contact_messages') AS table_present,
  (SELECT relrowsecurity FROM pg_class
   WHERE oid = 'public.contact_messages'::regclass) AS rls_on,
  NOT EXISTS (SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'contact_messages') AS zero_policies;

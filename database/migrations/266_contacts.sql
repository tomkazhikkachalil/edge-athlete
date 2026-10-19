-- ============================================================================
-- 266: the contact list and the one notify-inbox setting (Oct 19 2026; the
--      flow changes program, item 1 — runs on BOTH staging and prod BEFORE
--      A1 deploys. Nothing selects the new tables until then.)
-- ============================================================================
-- Tom (Oct 19): "When someone signs up for notifications or sends an
-- inquiry, nothing happens with it right now." Every sign-up and inquiry
-- becomes a CONTACT ROW (name, email, date, source, message, whether they
-- agreed to marketing mail — and the exact words they agreed to: CASL wants
-- express consent, recorded) and a mail to ONE address that is a SETTING,
-- never a hardcoded string, so the inbox can move to a business address
-- from the admin console with no deploy.
--
-- The model:
--   contacts       one row per submission (the list keeps history; the CSV
--                  export dedupes by email). RLS on, NO policies — the 027
--                  posture: only the service role reads or writes it (it
--                  holds addresses of people who are not users).
--   app_settings   key → value, server-only. The first key is
--                  notify_inbox_email (src/lib/contacts/contacts-server.ts
--                  reads it, then CONTACT_EMAIL, then EMAIL_FROM).
-- The 027 `waitlist` rows are copied in as notify sign-ups with consent
-- FALSE (nobody was asked). `waitlist` stays — superseded, never dropped.
--
-- REVERSAL: DROP TABLE public.contacts; DROP TABLE public.app_settings;
-- (the waitlist rows are untouched). Re-runnable until the ledger row
-- lands; a second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 266) THEN
    RAISE EXCEPTION '266 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 265 THEN RAISE EXCEPTION '266 pre-flight: ledger head is %, expected 265', n; END IF;
END $$;

-- ── 1. contacts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 320),
  name text CHECK (name IS NULL OR length(name) BETWEEN 1 AND 100),
  source text NOT NULL CHECK (source IN ('notify_signup', 'inquiry')),
  message text CHECK (message IS NULL OR length(message) BETWEEN 1 AND 5000),
  marketing_consent boolean NOT NULL DEFAULT false,
  consent_text text CHECK (consent_text IS NULL OR length(consent_text) BETWEEN 1 AND 500),
  user_type text CHECK (user_type IS NULL OR user_type IN ('club', 'league', 'fan', 'guest', 'athlete')),
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 400),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service-role access only (the 027 posture).
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON public.contacts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON public.contacts (email, source, created_at DESC);
COMMENT ON TABLE public.contacts IS 'The contact list (266): one row per notification sign-up or inquiry. Server-only; src/lib/contacts/contacts-server.ts recordContact is the ONE writer.';
COMMENT ON COLUMN public.contacts.marketing_consent IS 'Express consent to marketing mail (266) — unchecked by default; consent_text holds the words agreed to.';

-- ── 2. app_settings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  value text CHECK (value IS NULL OR length(value) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_by uuid
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service-role access only.
COMMENT ON TABLE public.app_settings IS 'Server-only key → value settings (266). notify_inbox_email: where sign-ups and inquiries are mailed (falls back to CONTACT_EMAIL, then EMAIL_FROM).';

-- ── 3. Backfill: the 027 waitlist rows become notify sign-ups (consent false) ─
INSERT INTO public.contacts (email, source, user_type, marketing_consent, created_at)
SELECT lower(w.email), 'notify_signup', w.user_type, false, w.created_at
FROM public.waitlist w
WHERE NOT EXISTS (
  SELECT 1 FROM public.contacts c
  WHERE c.email = lower(w.email) AND c.source = 'notify_signup' AND c.created_at = w.created_at
);

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (266, '266_contacts.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 266 APPLIED | 2 | true | true | <waitlist count> | 266
SELECT '266 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('contacts', 'app_settings')) AS tables_expect_2,
       (SELECT relrowsecurity FROM pg_class WHERE relname = 'contacts' AND relnamespace = 'public'::regnamespace) AS contacts_rls,
       (SELECT relrowsecurity FROM pg_class WHERE relname = 'app_settings' AND relnamespace = 'public'::regnamespace) AS settings_rls,
       (SELECT count(*) FROM public.contacts WHERE source = 'notify_signup') AS backfilled_signups,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_266;

-- ============================================================================
-- 285: favourite sports in the post composer's picker (Oct 27 2026; the
--      sport picker program's only DDL; runs on BOTH staging and prod BEFORE
--      PR 2 deploys — the picker reads the column off the owner's profile row)
-- ============================================================================
-- Tom's spec: "Replace the current sport picker with a cleaner, search-first
-- flow … Remove 'General Post', remove any pre-selection, and add a
-- favourites system for quick access … Favourites are stored per user
-- account, not per device, so they follow the user across logins."
--
-- The model (one nullable column — a row without favourites is exactly what
-- it was):
--   profiles.favourite_sports  jsonb, a JSON array of registry sport keys
--     (['golf', 'rowing']); NULL = none. Owner-only: GET /api/profile strips
--     it for every viewer (OWNER_ONLY_FIELDS); the departure strip NULLs it.
--     Read ONLY through sanitizeFavouriteSports (favourite-sports.ts) — junk
--     never breaks a render. The ONE writer: favourites-server.ts
--     writeFavouriteSports, behind PATCH /api/settings/favourite-sports.
--   NOT sport_settings: a row there DECLARES the sport on the profile
--   (computeActiveSports), and pins (263) are public presentation. A
--   favourite is a private composer preference — nobody else sees it.
--
-- REVERSAL: ALTER TABLE public.profiles DROP COLUMN favourite_sports.
-- Re-runnable until the ledger row lands; a second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 285) THEN
    RAISE EXCEPTION '285 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 284 THEN RAISE EXCEPTION '285 pre-flight: ledger head is %, expected 284', n; END IF;
END $$;

-- ── 1. profiles: the favourites ─────────────────────────────────────────────
-- One ALTER per column (account-departure.test.ts reads one column per ALTER).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS favourite_sports jsonb;
COMMENT ON COLUMN public.profiles.favourite_sports IS 'The account''s favourite sports in the post composer''s picker (285): a JSON array of registry sport keys, owner-only, never a declared sport. Read through sanitizeFavouriteSports; ONE writer: favourites-server.ts writeFavouriteSports.';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (285, '285_favourite_sports.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 285 APPLIED | 1 | 285
SELECT '285 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'favourite_sports') AS col_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_285;

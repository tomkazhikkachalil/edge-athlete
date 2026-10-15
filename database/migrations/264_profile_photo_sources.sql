-- ============================================================================
-- 264: profile photos — the ORIGINAL and its crop recipe are kept (Oct 14 2026;
--      the profile quick fixes program's second and last DDL; runs on BOTH
--      staging and prod BEFORE PR 5 deploys — the photo routes write the four
--      columns and the profile readers select them)
-- ============================================================================
-- Tom's spec (fix 3, part B): "Adjust the current photo — re-crop or
-- reposition without re-uploading." His decision: keep the ORIGINAL photo
-- and the crop, so an adjustment never re-crops a crop (lossy once, never a
-- spiral).
--
-- The model (every column nullable — a profile without a kept original is
-- exactly what it was; Adjust then reopens the stored result and sends it
-- as the new original):
--   profiles.avatar_source_url  the uploaded original, bounded to 2048 px on
--                               the device, in the PRIVATE uploads bucket at
--                               profile-sources/{profileId}/avatar-{ts}.jpg,
--                               served owner-or-guardian-only through
--                               GET /api/media/profile-source/[id]?slot=avatar
--   profiles.avatar_recipe      the crop (the editor's recipe envelope — a
--                               jsonb OBJECT; parsed by parseProfilePhotoRecipe)
--   profiles.cover_source_url   the same for the cover (…/cover-{ts}.jpg,
--                               ?slot=cover)
--   profiles.cover_recipe
--   avatar_url / cover_url stay THE derived, displayed photos (untouched).
--   ONE writer per slot: the slot's POST route (photo-storage.ts
--   storeProfilePhoto); DELETE and the deletion engine clear all three.
--
-- REVERSAL: drop the two checks and the four columns (the derived photos
-- keep working; the originals in storage are swept as orphans). Re-runnable
-- until the ledger row lands; a second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 264) THEN
    RAISE EXCEPTION '264 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 263 THEN RAISE EXCEPTION '264 pre-flight: ledger head is %, expected 263', n; END IF;
END $$;

-- ── 1. profiles: the kept original + its recipe, per slot ───────────────────
-- One statement per column: the departed-account tests read the chain above
-- the baseline (src/lib/__tests__/helpers/live-schema.ts) one ADD COLUMN per
-- ALTER — a comma-chained ALTER would hide three of the four.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_source_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_recipe jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cover_source_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cover_recipe jsonb;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_avatar_recipe_object_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_recipe_object_check
  CHECK (avatar_recipe IS NULL OR jsonb_typeof(avatar_recipe) = 'object');
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_cover_recipe_object_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_cover_recipe_object_check
  CHECK (cover_recipe IS NULL OR jsonb_typeof(cover_recipe) = 'object');
COMMENT ON COLUMN public.profiles.avatar_source_url IS 'The uploaded ORIGINAL behind avatar_url (264): private uploads bucket, profile-sources/{id}/; owner-only through /api/media/profile-source. ONE writer: the avatar POST.';
COMMENT ON COLUMN public.profiles.avatar_recipe IS 'The crop recipe that made avatar_url from avatar_source_url (264); Adjust reopens the editor here.';
COMMENT ON COLUMN public.profiles.cover_source_url IS 'The uploaded ORIGINAL behind cover_url (264): private uploads bucket, profile-sources/{id}/; owner-only through /api/media/profile-source. ONE writer: the cover POST.';
COMMENT ON COLUMN public.profiles.cover_recipe IS 'The crop recipe that made cover_url from cover_source_url (264); Adjust reopens the editor here.';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (264, '264_profile_photo_sources.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 264 APPLIED | 4 | 2 | 264
SELECT '264 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('avatar_source_url', 'avatar_recipe', 'cover_source_url', 'cover_recipe')) AS cols_expect_4,
       (SELECT count(*) FROM pg_constraint WHERE conname IN ('profiles_avatar_recipe_object_check', 'profiles_cover_recipe_object_check')) AS checks_expect_2,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_264;

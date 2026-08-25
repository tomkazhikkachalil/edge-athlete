-- ============================================================================
-- 121: user media presets — saved editor "looks" (Phase 4, round E-W3)
-- ============================================================================
-- A preset is a named LOOK: the transferable color/texture half of an
-- image recipe (trio, light, color, detail, filter+strength, hsl mixer,
-- curves, grain — see src/lib/media/look.ts). Geometry, masks, retouch
-- and text never persist here by design.
--
-- `look` stays schema-less JSONB on purpose (same reasoning as
-- post_media.edit_recipe in 120): the shape evolves client-side and every
-- write is zod-validated (lookSchema) in the API route before it lands.
--
-- Access model matches the app norm: RLS ON + REVOKE ALL, all access via
-- the admin client behind /api/media/presets, which enforces ownership
-- and the per-user cap in app code. The route degrades gracefully until
-- this migration runs (missing table → GET [], POST 503) — merge order is
-- therefore NOT strict, but run this promptly so saving works.
--
-- Re-runnable.

CREATE TABLE IF NOT EXISTS user_media_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL
    CONSTRAINT user_media_presets_name_check CHECK (char_length(name) BETWEEN 1 AND 40),
  look jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

DROP TRIGGER IF EXISTS user_media_presets_updated_at ON user_media_presets;
CREATE TRIGGER user_media_presets_updated_at
  BEFORE UPDATE ON user_media_presets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE user_media_presets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_media_presets FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_user_media_presets_profile
  ON user_media_presets (profile_id, created_at DESC);

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public'
          AND tablename = 'user_media_presets') AS table_exists,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'user_media_presets') AS rls_on,
  NOT has_table_privilege('anon', 'user_media_presets', 'SELECT') AS anon_revoked,
  NOT has_table_privilege('authenticated', 'user_media_presets', 'SELECT') AS authed_revoked,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'user_media_presets_name_check') LIKE '%40%' AS name_check_ok,
  EXISTS (SELECT 1 FROM pg_trigger
          WHERE tgname = 'user_media_presets_updated_at') AS updated_at_trigger,
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'user_media_presets'
          AND indexname = 'idx_user_media_presets_profile') AS profile_index,
  (SELECT count(*) FROM user_media_presets) AS presets_info;

-- ============================================================================
-- 120: non-destructive media — untouched original + edit recipe per post_media
-- ============================================================================
-- Media round B: every edited item keeps its ORIGINAL upload (Tom's
-- keep-everything decision) and the recipe that produced the rendered file,
-- so posts can be re-edited after publish without generational quality loss
-- and future renderers can re-derive output from masters.
--
-- source_url semantics: NULL means media_url IS the original (pass-throughs
-- and pre-120 rows). Never point both columns at the same storage object —
-- the storage sweep counts references per column, and double-referencing one
-- file across two swept columns is how a rename in one column orphans it in
-- the other.
--
-- edit_recipe: the editor's serialized zod-validated recipe ({v, recipe}).
-- Server-side validation happens at write time (posts route / media PATCH);
-- the column itself stays schema-less JSONB on purpose — recipe versions
-- evolve client-side (v1 image/video today, v2 clips in round C).
--
-- THE SWEEP INVARIANT: src/lib/storage-sweep.ts URL_SOURCE_COLUMNS gains
-- 'source_url' in the SAME PR that first writes it. An unregistered URL
-- column = the sweep deletes every original 48h after upload.
--
-- ORDER-STRICT like 098/113/119: run BEFORE merging round B (the create and
-- PATCH paths write these columns). Run AFTER 119. Re-runnable.
-- ============================================================================

ALTER TABLE post_media ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE post_media ADD COLUMN IF NOT EXISTS edit_recipe JSONB;

-- Verification grid (re-runnable SELECT, per the migration-check convention):
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'post_media'
  AND column_name IN ('source_url', 'edit_recipe')
ORDER BY column_name;

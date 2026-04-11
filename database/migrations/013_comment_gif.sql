-- ============================================================================
-- Add GIF support to comments
-- ============================================================================
-- Allows comments to include a GIF URL (from Giphy).
-- No RLS changes needed — existing row policies cover the new column.
-- ============================================================================

ALTER TABLE post_comments
  ADD COLUMN IF NOT EXISTS gif_url TEXT;

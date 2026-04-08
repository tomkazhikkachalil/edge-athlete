-- ============================================================================
-- VITALS LINKED POST — Optional media post backing for vitals entries
-- ============================================================================
-- Adds an optional link from a vitals entry to a post in the posts table.
-- When an athlete logs a vital with media, a training post is created and
-- linked here. The vital remains the source of truth; the post holds media.
--
-- ON DELETE SET NULL: if the linked post is deleted, the vital entry is
-- preserved (linked_post_id becomes null).
-- ============================================================================

ALTER TABLE public.athlete_vitals
  ADD COLUMN linked_post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL;

CREATE INDEX idx_athlete_vitals_linked_post
  ON public.athlete_vitals(linked_post_id)
  WHERE linked_post_id IS NOT NULL;

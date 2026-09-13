-- ============================================================================
-- 189 — Pinned news posts (Site Builder program 3, D3 — Sep 13 2026)
--
-- Tom's decision: the pin lives ON THE POST (not on a widget instance).
-- `org_site_news.pinned_at` — NULL = not pinned; a timestamp = pinned,
-- newest pin first. The public news page always leads with the pinned
-- posts; the home's news section honours its `sort` display setting
-- (newest | pinned first | my own order). A console toggle writes it
-- through the existing news PATCH (`{ pinned: boolean }`).
--
-- Posture unchanged: org_site_news keeps its RLS / grants; the service
-- role remains the only reader and writer.
--
-- Deploy order: FLEXIBLE. Every reader steps down on 42703 (pre-189 →
-- nothing is pinned); the PATCH refuses `pinned` with a clear message
-- until the column exists (never a 500).
--
-- Re-runnable end to end. Down-steps (documentation only, never executed):
--   DROP INDEX IF EXISTS public.org_site_news_site_pinned_idx;
--   ALTER TABLE public.org_site_news DROP COLUMN IF EXISTS pinned_at;
-- ============================================================================

ALTER TABLE public.org_site_news
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

COMMENT ON COLUMN public.org_site_news.pinned_at IS
  'Program 3 D3: NULL = not pinned; set = pinned (newest pin first). Read by the public news page and the home section''s pinned-first sort.';

-- Pinned-first, newest-first within each group — the news page's order.
CREATE INDEX IF NOT EXISTS org_site_news_site_pinned_idx
  ON public.org_site_news (site_id, pinned_at DESC NULLS LAST, published_at DESC);

NOTIFY pgrst, 'reload schema';

-- Verification (paste after running):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'org_site_news' AND column_name = 'pinned_at';
--   → one row: pinned_at | timestamp with time zone | YES

-- ============================================================================
-- 224: Support & Reporting program, Spec 3 — the Help Center's articles
-- ============================================================================
-- Tom's Game Plan, Help Center: "a searchable list of short text articles,
-- grouped by topic, stored as a help_article table (title, body, topic,
-- video_url, sort order) so Tom can add articles from the admin console
-- without a code change", and "how-to videos hosted on YouTube, embedded by
-- link — no video storage in our backend". ONE table serves both: a video
-- is an article with a video_url. Spec 3's ONLY migration; merges ALONE.
--
--   * help_articles — slug (the URL), title, body (plain text, blank-line
--     paragraphs — the renderer never trusts HTML), topic from the fixed
--     list the app's types pin, video_url (a YouTube link the app validates
--     through the site builder's embed parser — never an arbitrary iframe
--     source), sort_order, published (a draft is invisible to the public
--     read), created_by / updated_by, timestamps.
--   * Posture A (RLS on, zero policies, REVOKE from anon + authenticated):
--     the PUBLIC read is a cached API route on the service role that
--     filters published = true; the admin console writes on the service
--     role behind requireAdmin (owner). Created EMPTY; indexes inline.
--
-- The tickets table already carries Spec 3's other columns (222:
-- guest_email for the signed-out form, attachment_url for the screenshot).
-- Provenance: every object here is a chain CREATE — check:schema stays OK.
-- ============================================================================

-- ── help_articles ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS help_articles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  topic       text NOT NULL CONSTRAINT help_articles_topic_check
                CHECK (topic IN ('getting_started', 'posting_media', 'events', 'organizations', 'family', 'privacy_safety', 'account', 'other')),
  video_url   text,
  sort_order  integer NOT NULL DEFAULT 100,
  published   boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT help_articles_slug_key UNIQUE (slug),
  CONSTRAINT help_articles_slug_shape CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 2 AND 80),
  CONSTRAINT help_articles_title_length CHECK (length(title) BETWEEN 1 AND 140),
  CONSTRAINT help_articles_body_length CHECK (length(body) <= 20000)
);

-- The public list: published, by topic, in the manager's order.
CREATE INDEX IF NOT EXISTS idx_help_articles_public
  ON help_articles (topic, sort_order, title) WHERE published;

DROP TRIGGER IF EXISTS help_articles_updated_at ON help_articles;
CREATE TRIGGER help_articles_updated_at
  BEFORE UPDATE ON help_articles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE help_articles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON help_articles FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE help_articles IS 'Help Center (224): short articles by topic; a video is an article with a video_url (YouTube, validated by the app). Posture A: the public read is a cached route on the service role filtering published; the owner writes from the console.';
COMMENT ON COLUMN help_articles.body IS 'Plain text (224): blank-line paragraphs, "- " bullets; the renderer never trusts HTML.';
COMMENT ON COLUMN help_articles.video_url IS 'A YouTube link (224), validated through the site builder''s embed parser — never an arbitrary iframe source.';

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 224 APPLIED | 1 | 1 | 1 | 1
SELECT '224 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'help_articles') AS table_expect_1,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'help_articles_topic_check' AND conrelid = 'public.help_articles'::regclass AND pg_get_constraintdef(oid) LIKE '%privacy_safety%') AS topic_check_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_help_articles_public' AND indexdef LIKE '%WHERE%') AS index_expect_1,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'help_articles_updated_at' AND tgrelid = 'public.help_articles'::regclass) AS trigger_expect_1;

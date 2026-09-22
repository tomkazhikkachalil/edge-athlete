-- ============================================================================
-- 229: Round 3 (the scale cliffs) — follower counts maintained by a trigger;
--      a GIN index for the notifications.metadata scans (merges ALONE)
-- ============================================================================
-- Two of the Sep 19 assessment's arithmetic cliffs, one migration:
--
--   * FOLLOWER COUNTS. /api/public/profile and /api/follow/stats ran two
--     exact COUNT(*) over `follows` per view (index scans, but a scan of
--     every accepted row per popular athlete per view — 500 rows today,
--     50k at the scale the platform is built for). `posts.likes_count`
--     already shows the house pattern: a denormalised column the write
--     path maintains. Here it is a TRIGGER, not the route: follows are
--     written by the follow route, the followers route (accept / remove),
--     the block flows and the deletion engine, and a count kept by one of
--     them drifts the moment another forgets. `follows_counts_sync` moves
--     ±1 on every insert / status change / delete of an accepted edge,
--     SECURITY DEFINER because the row it updates belongs to the OTHER
--     person (a user-scoped client could never update it under RLS),
--     `search_path = ''` and fully qualified names, the house rule.
--     NULLABLE with DEFAULT 0 — never NOT NULL on `profiles`
--     (create_managed_profile's jsonb_populate_record sends an explicit
--     NULL for every unnamed column: the 175 / 179 / 182 / 184 / 225 class;
--     `profiles-not-null-insert.test.ts` enforces it). Readers coalesce.
--     Backfilled once, here, from the live edges.
--
--   * notifications.metadata. Nine readers filter with `.contains()`
--     (`@>`) — org announcements for the public org sites (2 000-row cap
--     on every ISR rebuild), the golf-league windows, the event reminders,
--     the dedup probes — and the table had no jsonb index: each was a
--     sequential scan of the user's (or EVERYONE's, for the org readers)
--     notifications. A GIN with jsonb_path_ops serves `@>` and nothing
--     else, at a third of the size of the default opclass.
--
-- Re-runnable. Zero rows change meaning; every existing row keeps its
-- values; the counts start from the truth.
-- ============================================================================

-- ── The columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS followers_count integer DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS following_count integer DEFAULT 0;
COMMENT ON COLUMN public.profiles.followers_count IS '229: accepted follows where this profile is following_id. Maintained by follows_counts_sync; nullable (the row-type insert rule), read as coalesce(…, 0).';
COMMENT ON COLUMN public.profiles.following_count IS '229: accepted follows where this profile is follower_id. Maintained by follows_counts_sync; nullable, read as coalesce(…, 0).';

-- ── The trigger ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.follows_counts_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_live boolean := (TG_OP <> 'INSERT') AND (OLD.status = 'accepted');
  new_live boolean := (TG_OP <> 'DELETE') AND (NEW.status = 'accepted');
BEGIN
  -- Only an accepted edge counts. A row that stays accepted but changes
  -- another column is a no-op; a row that changes its endpoints (never
  -- done by the app) is handled as remove-then-add.
  IF old_live AND new_live AND OLD.follower_id = NEW.follower_id AND OLD.following_id = NEW.following_id THEN
    RETURN NULL;
  END IF;
  IF old_live THEN
    UPDATE public.profiles SET followers_count = GREATEST(0, COALESCE(followers_count, 0) - 1) WHERE id = OLD.following_id;
    UPDATE public.profiles SET following_count = GREATEST(0, COALESCE(following_count, 0) - 1) WHERE id = OLD.follower_id;
  END IF;
  IF new_live THEN
    UPDATE public.profiles SET followers_count = COALESCE(followers_count, 0) + 1 WHERE id = NEW.following_id;
    UPDATE public.profiles SET following_count = COALESCE(following_count, 0) + 1 WHERE id = NEW.follower_id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.follows_counts_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS follows_counts_sync ON public.follows;
CREATE TRIGGER follows_counts_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.follows_counts_sync();

-- ── The backfill: the counts start from the truth ───────────────────────────
UPDATE public.profiles p
   SET followers_count = COALESCE(f.followers, 0),
       following_count = COALESCE(g.following, 0)
  FROM (SELECT id FROM public.profiles) ids
  LEFT JOIN (SELECT following_id AS id, count(*) AS followers FROM public.follows WHERE status = 'accepted' GROUP BY following_id) f ON f.id = ids.id
  LEFT JOIN (SELECT follower_id AS id, count(*) AS following FROM public.follows WHERE status = 'accepted' GROUP BY follower_id) g ON g.id = ids.id
 WHERE p.id = ids.id
   AND (p.followers_count IS DISTINCT FROM COALESCE(f.followers, 0) OR p.following_count IS DISTINCT FROM COALESCE(g.following, 0));

-- ── notifications.metadata: the index the nine .contains() readers need ─────
CREATE INDEX IF NOT EXISTS idx_notifications_metadata_gin ON public.notifications USING gin (metadata jsonb_path_ops);

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (229, '229_follow_counts_and_notification_metadata_index.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 229 APPLIED | 0 | 0 | true | 229
SELECT '229 APPLIED' AS result,
       (SELECT count(*) FROM public.profiles p
         WHERE COALESCE(p.followers_count, 0) <> (SELECT count(*) FROM public.follows f WHERE f.following_id = p.id AND f.status = 'accepted')) AS followers_drift_expect_0,
       (SELECT count(*) FROM public.profiles p
         WHERE COALESCE(p.following_count, 0) <> (SELECT count(*) FROM public.follows f WHERE f.follower_id = p.id AND f.status = 'accepted')) AS following_drift_expect_0,
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_notifications_metadata_gin') AS gin_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_229;

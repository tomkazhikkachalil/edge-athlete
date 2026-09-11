-- ============================================================================
-- 188 — First-party site analytics (Site Builder program 2, E — Sep 11 2026)
--
-- Tom's decision: first-party counts, never a third party. A 1×1 GIF pixel
-- on every public org-site page (server-rendered, no script) calls
-- bump_site_hit() once per load. Two tables, both posture A (RLS on, zero
-- policies, REVOKE ALL — the service role is the only reader and writer):
--
--   org_site_stats_daily (site, day, path) → views, visitors
--   org_site_hit_marks   (site, day, visitor_hash) — the day's unique marks;
--                        the hash is HMAC(secret, day) ‖ ip ‖ ua, so it is
--                        unlinkable across days; the daily cron prunes marks
--                        older than 2 days. No cookie, no IP, no user agent
--                        is ever stored.
--
--   bump_site_hit(site, day, path, hash) — ONE round trip: insert the mark
--   (on conflict nothing → is it new?), upsert the daily row (views + 1,
--   visitors + new). SECURITY DEFINER, EXECUTE for service_role only (the
--   RPC grants rule — Supabase defaults EXECUTE to anon).
--
-- Deploy order: FLEXIBLE. The pixel route swallows a missing function or
-- table (nothing is counted until this runs — a supported state).
--
-- Re-runnable end to end. Down-steps (documentation only, never executed):
--   DROP FUNCTION IF EXISTS public.bump_site_hit(uuid, date, text, text);
--   DROP TABLE IF EXISTS org_site_hit_marks; DROP TABLE IF EXISTS org_site_stats_daily;
-- ============================================================================

CREATE TABLE IF NOT EXISTS org_site_stats_daily (
  site_id   uuid NOT NULL REFERENCES org_sites(id) ON DELETE CASCADE,
  day       date NOT NULL,
  path      text NOT NULL,
  views     integer NOT NULL DEFAULT 0,
  visitors  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, day, path)
);

CREATE TABLE IF NOT EXISTS org_site_hit_marks (
  site_id      uuid NOT NULL REFERENCES org_sites(id) ON DELETE CASCADE,
  day          date NOT NULL,
  visitor_hash text NOT NULL,
  PRIMARY KEY (site_id, day, visitor_hash)
);

CREATE INDEX IF NOT EXISTS idx_org_site_stats_daily_site_day ON org_site_stats_daily (site_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_org_site_hit_marks_day ON org_site_hit_marks (day);

ALTER TABLE org_site_stats_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_site_hit_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.org_site_stats_daily FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.org_site_hit_marks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.org_site_stats_daily TO service_role;
GRANT ALL ON TABLE public.org_site_hit_marks TO service_role;

CREATE OR REPLACE FUNCTION public.bump_site_hit(p_site uuid, p_day date, p_path text, p_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new integer := 0;
BEGIN
  IF p_hash IS NOT NULL AND p_hash <> '' THEN
    INSERT INTO org_site_hit_marks (site_id, day, visitor_hash)
    VALUES (p_site, p_day, p_hash)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN v_new := 1; END IF;
  END IF;
  INSERT INTO org_site_stats_daily (site_id, day, path, views, visitors)
  VALUES (p_site, p_day, p_path, 1, v_new)
  ON CONFLICT (site_id, day, path) DO UPDATE
    SET views = org_site_stats_daily.views + 1,
        visitors = org_site_stats_daily.visitors + EXCLUDED.visitors;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bump_site_hit(uuid, date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_site_hit(uuid, date, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Check grid (a SELECT, never a RAISE):
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('org_site_stats_daily', 'org_site_hit_marks')) AS tables,
  (SELECT count(*) FROM pg_proc WHERE proname = 'bump_site_hit') AS rpc;

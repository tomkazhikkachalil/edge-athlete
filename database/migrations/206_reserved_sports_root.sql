-- ============================================================================
-- 206: reserved_handles gains `sports` — the Sports section is a root
--      segment (Events program, phase 1)
-- ============================================================================
-- /sports/{explore,events,leaderboards} is the one route tree the Sports
-- section lives in (Sports replaces Explore in the header; /explore becomes
-- a redirect). A new root segment must be reserved in BOTH places the
-- vanity middleware and the handle validator read: RESERVED_ROOT_SLUGS in
-- src/lib/org-sites/reserved.ts (same PR; reserved.test.ts fails verify
-- otherwise) and this table (the 166 / 181 precedent). `events` (166) and
-- `event` (181) are already seeded — the event page /events/[id] needs no
-- row.
-- ============================================================================

INSERT INTO reserved_handles (handle, reason)
VALUES ('sports', 'Root path (vanity namespace, 206)')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
SELECT 'sports reserved' AS check_name, '1' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM reserved_handles WHERE handle = 'sports'

UNION ALL

SELECT 'events + event already reserved', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM reserved_handles WHERE handle IN ('events', 'event')

ORDER BY 1;

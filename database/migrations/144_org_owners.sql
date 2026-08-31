-- ============================================================================
-- 144: org owners — rows become authoritative, the column becomes a cache
-- ============================================================================
-- Step 0.8 resolves the dual-encoded owner that 113/117 shipped and
-- getOrgRole has bridged ever since: after this migration, role='owner'
-- memberships rows are the SOURCE OF TRUTH for org ownership (multiple
-- owners were already representable — 140's unique key excludes role), and
-- leagues/clubs.owner_profile_id is a maintained "primary owner" CACHE:
-- the earliest-joined owner (id tie-break), recomputed by the app on every
-- owner-set change. The cache feeds display defaults and notification
-- recipients ONLY; all authorization reads the rows.
--
-- Tom's decisions (Aug 31): owners mint co-owners; SELF-demote only (no
-- coup semantics — owners never demote each other; last owner blocked);
-- transfer = promote + step down (the two-owner window is the safe
-- direction); primary = earliest-joined owner.
--
-- Behavior change called out: a hypothetical column-only owner (column set,
-- no owner row) gains a row here → appears in member lists/counts and the
-- merged calendar. Likely ZERO such rows exist — createLeagueWithOwner and
-- the club twin have always done the two-insert-with-rollback, and 140
-- backfilled every 113/117 member row — the check grid proves it.
--
-- ORDER-STRICT: run BEFORE merging the owners PR. Safe to run early — the
-- pre-0.8 code ignores extra owner rows entirely (its column short-circuit
-- only skips the row read for the column-matched profile).
-- Run AFTER 140. Re-runnable end to end (the check grid is a SELECT).
-- ============================================================================

-- ── Forward backfill: every cached owner gets an authoritative row ──────────
-- joined_at = the org's created_at — the owner was there from the start;
-- with the earliest-joined primary rule this keeps the cache truthful.
-- DO UPDATE touches ONLY role: an existing member/manager follow row keeps
-- its real joined_at.
INSERT INTO memberships (league_id, profile_id, role, kind, joined_at)
SELECT l.id, l.owner_profile_id, 'owner', 'follow', l.created_at
FROM leagues l
WHERE l.owner_profile_id IS NOT NULL
ON CONFLICT ON CONSTRAINT memberships_uniq DO UPDATE SET role = 'owner';

INSERT INTO memberships (club_id, profile_id, role, kind, joined_at)
SELECT c.id, c.owner_profile_id, 'owner', 'follow', c.created_at
FROM clubs c
WHERE c.owner_profile_id IS NOT NULL
ON CONFLICT ON CONSTRAINT memberships_uniq DO UPDATE SET role = 'owner';

-- ── Reverse repair: owner rows with a NULL cache (expect zero rows) ─────────
UPDATE leagues l SET owner_profile_id = sub.profile_id
FROM (
  SELECT DISTINCT ON (league_id) league_id, profile_id
  FROM memberships
  WHERE role = 'owner' AND kind = 'follow' AND scope_type = 'org'
    AND league_id IS NOT NULL
  ORDER BY league_id, joined_at ASC, id ASC
) sub
WHERE l.id = sub.league_id AND l.owner_profile_id IS NULL;

UPDATE clubs c SET owner_profile_id = sub.profile_id
FROM (
  SELECT DISTINCT ON (club_id) club_id, profile_id
  FROM memberships
  WHERE role = 'owner' AND kind = 'follow' AND scope_type = 'org'
    AND club_id IS NOT NULL
  ORDER BY club_id, joined_at ASC, id ASC
) sub
WHERE c.id = sub.club_id AND c.owner_profile_id IS NULL;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  (SELECT count(*) FROM leagues l WHERE l.owner_profile_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.league_id = l.id
       AND m.profile_id = l.owner_profile_id AND m.role = 'owner'
       AND m.kind = 'follow' AND m.scope_type = 'org')) = 0 AS leagues_owners_have_rows,
  (SELECT count(*) FROM clubs c WHERE c.owner_profile_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.club_id = c.id
       AND m.profile_id = c.owner_profile_id AND m.role = 'owner'
       AND m.kind = 'follow' AND m.scope_type = 'org')) = 0 AS clubs_owners_have_rows,
  (SELECT count(*) FROM leagues l WHERE l.owner_profile_id IS NULL
     AND EXISTS (SELECT 1 FROM memberships m WHERE m.league_id = l.id
       AND m.role = 'owner' AND m.kind = 'follow')) = 0 AS leagues_no_orphan_rows,
  (SELECT count(*) FROM clubs c WHERE c.owner_profile_id IS NULL
     AND EXISTS (SELECT 1 FROM memberships m WHERE m.club_id = c.id
       AND m.role = 'owner' AND m.kind = 'follow')) = 0 AS clubs_no_orphan_rows,
  (SELECT count(*) FROM memberships WHERE role = 'owner') AS owner_rows_info,
  (SELECT count(*) FROM (
     SELECT COALESCE(league_id, club_id) AS org_id
     FROM memberships WHERE role = 'owner' AND kind = 'follow' AND scope_type = 'org'
     GROUP BY 1 HAVING count(*) > 1) multi) AS multi_owner_orgs_info;
-- Expect: true × 4, then two info counts (multi-owner orgs = 0 on first run).

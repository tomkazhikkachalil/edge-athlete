-- ============================================================================
-- 242: teams & divisions — team identity, a team's sides on sport events,
--      every team roster row carries its season, the org switches become
--      real (additive; runs on BOTH staging and prod before PR 2 deploys)
-- ============================================================================
-- Tom (Sep 26 2026): "We run teams" / "We run competitions" turn their part
-- of the product on and off (off HIDES, never deletes); team rosters are
-- managed in the console; a team has its own page, sport, colours and logo;
-- rollover may carry a roster forward, so a roster row must say WHICH season.
-- This file is the program's ONLY DDL (the code lands in eleven PRs):
--
--   1. teams gains sport_key, primary_color, secondary_color, logo_path
--      (posture inherited from 145: RLS on, no policies, revoked). The sport
--      is backfilled from the team's entered divisions when they agree, else
--      the org's sport.
--   2. sport_event_teams — one row per (event, side) naming the org team that
--      plays it. Until now a team's sides lived only inside
--      format_config.game.side_team_ids (jsonb, unindexable), and the contest
--      door's games (211) never wrote them at all. Backfilled from both.
--      Posture A (201's): RLS on, no policies, revoked.
--   3. memberships: every TEAM roster row records its season. An index for
--      the team roster read; the season-less rows (roster import) are
--      backfilled to the team's newest entered season, else the org's newest
--      season; a CHECK (NOT VALID) holds every new write to it. Rows of an
--      org with no season at all stay NULL until VALIDATE (the twin counts
--      them). memberships_uniq (233) already allows one row per player per
--      team per season, so no new unique.
--   4. The switches: organizations.operates_teams / operates_competitions
--      start gating the console, the org page and the site in PR 2. So that
--      no org loses what it shows today: teams ON wherever teams exist,
--      competitions ON wherever competitions exist or the org's sport is
--      golf (the golf console leads with competitions, and admin-created
--      golf clubs defaulted off); an org holding seasons with both off gets
--      its kind's switch.
--   5. notifications: 'team_roster' (added / moved / removed / carried).
--
-- REVERSAL: drop sport_event_teams; drop the four teams columns and their
-- CHECKs; drop memberships_team_roster_season_check and
-- idx_memberships_team_roster (the season backfill and the switch flips are
-- data — leave them); re-ADD notifications_type_check from 240. Re-runnable
-- until the ledger row lands; a second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 242) THEN
    RAISE EXCEPTION '242 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 241 THEN RAISE EXCEPTION '242 pre-flight: ledger head is %, expected 241', n; END IF;
END $$;

-- ── 1. teams: identity ──────────────────────────────────────────────────────
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS sport_key       text,
  ADD COLUMN IF NOT EXISTS primary_color   text,
  ADD COLUMN IF NOT EXISTS secondary_color text,
  ADD COLUMN IF NOT EXISTS logo_path       text;
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_sport_key_check;
ALTER TABLE public.teams ADD CONSTRAINT teams_sport_key_check
  CHECK (sport_key IS NULL OR length(sport_key) BETWEEN 1 AND 40);
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_primary_color_check;
ALTER TABLE public.teams ADD CONSTRAINT teams_primary_color_check
  CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9a-f]{6}$');
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_secondary_color_check;
ALTER TABLE public.teams ADD CONSTRAINT teams_secondary_color_check
  CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9a-f]{6}$');
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_logo_path_check;
ALTER TABLE public.teams ADD CONSTRAINT teams_logo_path_check
  CHECK (logo_path IS NULL OR logo_path ~ '^team-logos/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
COMMENT ON COLUMN public.teams.sport_key IS 'The team''s sport (242; the registry is app-side). Backfilled from its entered divisions, else the org''s sport.';
COMMENT ON COLUMN public.teams.logo_path IS 'BARE uploads path team-logos/{teamId}/{file} (242) — protected from the storage sweep by prefix.';

UPDATE public.teams t SET sport_key = s.sport_key
  FROM (SELECT te.team_id, min(d.sport_key) AS sport_key
          FROM public.team_entries te
          JOIN public.divisions d ON d.id = te.division_id
         GROUP BY te.team_id
        HAVING count(DISTINCT d.sport_key) = 1) s
 WHERE t.id = s.team_id AND t.sport_key IS NULL;
UPDATE public.teams t SET sport_key = o.sport_key
  FROM public.organizations o
 WHERE o.id = t.org_id AND t.sport_key IS NULL AND o.sport_key IS NOT NULL;

-- ── 2. sport_event_teams: a team's sides, found by index ────────────────────
CREATE TABLE IF NOT EXISTS public.sport_event_teams (
  sport_event_id uuid        NOT NULL REFERENCES public.sport_events(id) ON DELETE CASCADE,
  side           smallint    NOT NULL CONSTRAINT sport_event_teams_side_check CHECK (side IN (1, 2)),
  team_id        uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT sport_event_teams_pkey PRIMARY KEY (sport_event_id, side),
  CONSTRAINT sport_event_teams_team_uniq UNIQUE (sport_event_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_sport_event_teams_team ON public.sport_event_teams (team_id);
ALTER TABLE public.sport_event_teams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sport_event_teams FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.sport_event_teams IS 'Which org team plays each side of a sport event (242). ONE writer: sport-events/team-links-server.ts. Posture A.';

-- (a) the create route's format_config.game.side_team_ids (text compare: junk never casts)
INSERT INTO public.sport_event_teams (sport_event_id, side, team_id)
SELECT e.id, s.side, t.id
  FROM public.sport_events e
 CROSS JOIN LATERAL (VALUES (1::smallint, e.format_config #>> '{game,side_team_ids,0}'),
                            (2::smallint, e.format_config #>> '{game,side_team_ids,1}')) AS s(side, team_text)
  JOIN public.teams t ON t.id::text = s.team_text AND t.org_id = e.org_id
 WHERE jsonb_typeof(e.format_config #> '{game,side_team_ids}') = 'array'
ON CONFLICT DO NOTHING;
-- (b) the contest door's games (211): the linked contest's TEAM entries by side
INSERT INTO public.sport_event_teams (sport_event_id, side, team_id)
SELECT DISTINCT ON (r.sport_event_id, cp.side) r.sport_event_id, CASE cp.side WHEN 'home' THEN 1 ELSE 2 END::smallint, ce.team_id
  FROM public.contests c
  JOIN public.sport_event_rounds r ON r.id = c.sport_event_round_id
  JOIN public.contest_participants cp ON cp.contest_id = c.id AND cp.side IN ('home', 'away')
  JOIN public.competition_entries ce ON ce.id = cp.entry_id AND ce.team_id IS NOT NULL
 ORDER BY r.sport_event_id, cp.side, c.created_at
ON CONFLICT DO NOTHING;

-- ── 3. memberships: a team roster row records its season ────────────────────
CREATE INDEX IF NOT EXISTS idx_memberships_team_roster
  ON public.memberships (scope_id, season_id) WHERE kind = 'roster' AND scope_type = 'team';

CREATE TEMP TABLE _m242 ON COMMIT DROP AS
SELECT m.id, m.org_id, m.profile_id, m.scope_id,
       COALESCE(
         (SELECT d.season_id
            FROM public.team_entries te
            JOIN public.divisions d ON d.id = te.division_id
            JOIN public.seasons s ON s.id = d.season_id
           WHERE te.team_id = m.scope_id
           ORDER BY (s.archived_at IS NULL) DESC, s.created_at DESC
           LIMIT 1),
         (SELECT s.id FROM public.seasons s
           WHERE s.org_id = m.org_id
           ORDER BY (s.archived_at IS NULL) DESC, s.created_at DESC
           LIMIT 1)) AS target
  FROM public.memberships m
 WHERE m.kind = 'roster' AND m.scope_type = 'team' AND m.season_id IS NULL;
-- A season-less row whose seasoned twin already exists is the same fact (the unique would refuse the update).
DELETE FROM public.memberships m
 USING _m242 x
 WHERE m.id = x.id AND x.target IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.memberships y
                WHERE y.org_id = x.org_id AND y.profile_id = x.profile_id
                  AND y.kind = 'roster' AND y.scope_type = 'team'
                  AND y.scope_id = x.scope_id AND y.season_id = x.target);
UPDATE public.memberships m SET season_id = x.target
  FROM _m242 x
 WHERE m.id = x.id AND x.target IS NOT NULL;

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_team_roster_season_check;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_team_roster_season_check
  CHECK (kind <> 'roster' OR scope_type <> 'team' OR season_id IS NOT NULL) NOT VALID;

-- ── 4. The switches become real — nobody loses what they see today ──────────
UPDATE public.organizations o SET operates_teams = true
 WHERE NOT o.operates_teams
   AND (EXISTS (SELECT 1 FROM public.teams t WHERE t.org_id = o.id)
     OR EXISTS (SELECT 1 FROM public.team_entries te JOIN public.divisions d ON d.id = te.division_id WHERE d.org_id = o.id)
     OR EXISTS (SELECT 1 FROM public.memberships m WHERE m.org_id = o.id AND m.kind = 'roster' AND m.scope_type = 'team'));
UPDATE public.organizations o SET operates_competitions = true
 WHERE NOT o.operates_competitions
   AND (EXISTS (SELECT 1 FROM public.competitions c WHERE c.org_id = o.id)
     OR o.sport_key = 'golf');
UPDATE public.organizations o
   SET operates_teams = (o.kind = 'club'), operates_competitions = (o.kind = 'league')
 WHERE NOT o.operates_teams AND NOT o.operates_competitions
   AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.org_id = o.id);

-- ── 5. notifications: the 240 list + team_roster (re-ADD in full) ───────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'follow_request','follow_accepted','new_follower','like','comment',
    'comment_reply','mention','tag','achievement','system_announcement',
    'club_update','team_update','new_message','group_invite','group_update',
    'guardian_invite','athlete_added',
    'event_invite','event_update','event_cancelled','event_response',
    'event_reminder',
    'post_pending_approval','post_approval_result','transfer_update',
    'consent_result',
    'comment_pending_approval','comment_approval_result',
    'follow_request_guardian','follow_update','tag_alert','profile_change',
    'calendar_alert','safety_alert',
    'league_join','league_update','league_request_result',
    'club_join','club_request_result','affiliation_invite','affiliation_update',
    'carpool_offer','carpool_update',
    'roster_invite',
    'competition_entry_pending','competition_entry_decided',
    'org_registration_received','org_registration_placed','org_registration_released',
    'contest_dispute_raised','contest_dispute_resolved',
    'golf_league_round_counted','golf_league_round_confirmed','golf_league_window_closing',
    'org_staff_invite','org_staff_accepted','org_staff_revoked',
    'org_listing_request',
    'site_form_submission',
    'sport_event_invite','sport_event_request','sport_event_request_decision',
    'sport_event_live','sport_event_results',
    'sport_event_reminder',
    'sport_event_match',
    'ticket_update','ticket_critical',
    'moderation_notice',
    'authority_notice',
    'team_roster'
  ));

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (242, '242_teams_divisions.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 242 APPLIED | 4 | 4 | 1 | 1 | 1 | 1 | 242
SELECT '242 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'teams'
          AND column_name IN ('sport_key', 'primary_color', 'secondary_color', 'logo_path')) AS team_columns_expect_4,
       (SELECT count(*) FROM pg_constraint WHERE conname IN ('teams_sport_key_check', 'teams_primary_color_check', 'teams_secondary_color_check', 'teams_logo_path_check')) AS team_checks_expect_4,
       (SELECT count(*) FROM pg_class WHERE relname = 'sport_event_teams' AND relrowsecurity) AS link_table_rls_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_memberships_team_roster') AS roster_index_expect_1,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'memberships_team_roster_season_check') AS season_check_expect_1,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'notifications_type_check' AND pg_get_constraintdef(oid) LIKE '%team_roster%') AS notif_type_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_242;

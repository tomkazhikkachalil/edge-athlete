-- ============================================================================
-- 202: sport_event_participants + sport_event_groups + sport_event_group_members
--      — who is in an event, and who plays with whom (Events program, phase 1)
-- ============================================================================
-- The people side of 201's header. The round's OWN participants
-- (group_post_participants) are minted from these rows when the round goes
-- live; until then the event holds the roster.
--
-- sport_event_participants — one row per (event, profile):
--   * role: organizer (the creator; delete / transfer) | co_organizer
--     (everything else — Tom: in phase 1) | participant | follower (views the
--     leaderboard and the cards, never plays: playing = false by CHECK).
--   * status: invited | requested | accepted | declined | removed | withdrawn
--     | waitlisted. Invite mode: invited → accepted / declined. Request mode:
--     requested → accepted (approve) / declined (reject). An accept on a
--     full event lands waitlisted with a position; a vacancy promotes the
--     lowest position first (src/lib/sport-events/join.ts). Withdraw is the
--     participant's own exit; removed is the organizer's.
--   * playing: an organizer need not play; a follower never does.
--   * handicap_index + handicap_source: the WHS index FROZEN at accept
--     (computed — src/lib/golf/handicap-server.ts fetchHandicapComputation),
--     or the organizer's per-event override (organizer), or none. The COURSE
--     handicap is NOT stored: it is a pure function of this index and the
--     round's rating / slope / par / holes, computed at read — a stored copy
--     would drift when the organizer changes the tee before go-live.
--   * flight: phase 2 (flights split the field by handicap band); unused,
--     nullable, here so phase 2 needs no migration on this table.
--   * hide_from_profile: Tom's opt-out — a completed round's mirror
--     (golf_rounds → profile, handicap, athlete_performances) SKIPS this
--     participant. One mirror, so it hides everywhere.
--   * invited_by, accepted_at, responded_at: the trail.
--
-- sport_event_groups — per ROUND (groups change between rounds):
--   * sequence UNIQUE per round; name optional ("Group A"); tee_time
--     (timestamptz, the round's venue time zone is the organizer's concern
--     in phase 1); starting_hole 1..18 (a shotgun start).
-- sport_event_group_members:
--   * (group, position) ordered; sport_event_round_id is DENORMALISED so
--     "a participant is in ONE group per round" is a UNIQUE constraint, not
--     an app rule. The writer (rounds-server.ts) replaces a round's whole
--     grouping atomically and keeps member.round = group.round — the grid
--     asserts that invariant.
--
-- Posture A on all three (the 187 shape): RLS on, zero policies, REVOKE
-- from anon and authenticated; the service client behind
-- resolveSportEventAccess is the only reader. Created EMPTY → inline
-- indexes. Provenance: every object is a chain CREATE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sport_event_participants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_event_id    uuid NOT NULL REFERENCES sport_events(id) ON DELETE CASCADE,
  profile_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role              text NOT NULL DEFAULT 'participant' CONSTRAINT sport_event_participants_role_check CHECK (role IN ('organizer', 'co_organizer', 'participant', 'follower')),
  status            text NOT NULL DEFAULT 'invited' CONSTRAINT sport_event_participants_status_check CHECK (status IN ('invited', 'requested', 'accepted', 'declined', 'removed', 'withdrawn', 'waitlisted')),
  playing           boolean NOT NULL DEFAULT true,
  handicap_index    numeric(3,1) CONSTRAINT sport_event_participants_index_check CHECK (handicap_index IS NULL OR handicap_index BETWEEN -10.0 AND 54.0),
  handicap_source   text NOT NULL DEFAULT 'none' CONSTRAINT sport_event_participants_hcp_source_check CHECK (handicap_source IN ('computed', 'organizer', 'none')),
  flight            text,
  waitlist_position integer CONSTRAINT sport_event_participants_waitlist_pos_check CHECK (waitlist_position IS NULL OR waitlist_position >= 1),
  hide_from_profile boolean NOT NULL DEFAULT false,
  invited_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  accepted_at       timestamptz,
  responded_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at        timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT sport_event_participants_uniq           UNIQUE (sport_event_id, profile_id),
  CONSTRAINT sport_event_participants_follower_check CHECK (role <> 'follower' OR playing = false),
  CONSTRAINT sport_event_participants_hcp_check      CHECK ((handicap_source = 'none') = (handicap_index IS NULL)),
  CONSTRAINT sport_event_participants_waitlist_check CHECK ((status = 'waitlisted') = (waitlist_position IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS sport_event_groups (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_event_round_id uuid NOT NULL REFERENCES sport_event_rounds(id) ON DELETE CASCADE,
  sequence             smallint NOT NULL CONSTRAINT sport_event_groups_sequence_check CHECK (sequence >= 1),
  name                 text CONSTRAINT sport_event_groups_name_check CHECK (name IS NULL OR length(btrim(name)) BETWEEN 1 AND 60),
  tee_time             timestamptz,
  starting_hole        smallint NOT NULL DEFAULT 1 CONSTRAINT sport_event_groups_starting_hole_check CHECK (starting_hole BETWEEN 1 AND 18),
  created_at           timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at           timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT sport_event_groups_sequence_uniq UNIQUE (sport_event_round_id, sequence)
);

CREATE TABLE IF NOT EXISTS sport_event_group_members (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             uuid NOT NULL REFERENCES sport_event_groups(id) ON DELETE CASCADE,
  sport_event_round_id uuid NOT NULL REFERENCES sport_event_rounds(id) ON DELETE CASCADE,
  participant_id       uuid NOT NULL REFERENCES sport_event_participants(id) ON DELETE CASCADE,
  position             smallint NOT NULL CONSTRAINT sport_event_group_members_position_check CHECK (position >= 1),
  created_at           timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT sport_event_group_members_position_uniq UNIQUE (group_id, position),
  CONSTRAINT sport_event_group_members_round_uniq    UNIQUE (sport_event_round_id, participant_id)
);

-- Posture A.
ALTER TABLE sport_event_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_event_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_event_group_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_event_participants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON sport_event_groups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON sport_event_group_members FROM PUBLIC, anon, authenticated;

-- updated_at, the 001 function (members are insert-only rows: no trigger).
DROP TRIGGER IF EXISTS sport_event_participants_updated_at ON sport_event_participants;
CREATE TRIGGER sport_event_participants_updated_at
  BEFORE UPDATE ON sport_event_participants
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS sport_event_groups_updated_at ON sport_event_groups;
CREATE TRIGGER sport_event_groups_updated_at
  BEFORE UPDATE ON sport_event_groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- The reads: an event's roster by status, a profile's events ("mine"), a round's groups in order, a group's members in order.
CREATE INDEX IF NOT EXISTS idx_sport_event_participants_event_status
  ON sport_event_participants (sport_event_id, status);
CREATE INDEX IF NOT EXISTS idx_sport_event_participants_profile_created
  ON sport_event_participants (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sport_event_groups_round_sequence
  ON sport_event_groups (sport_event_round_id, sequence);
CREATE INDEX IF NOT EXISTS idx_sport_event_group_members_group_position
  ON sport_event_group_members (group_id, position);

COMMENT ON TABLE sport_event_participants IS 'Who is in a sport event and how (role, status, the WHS index frozen at accept, the profile opt-out). The round''s own participants are minted from the accepted + playing rows at go-live.';
COMMENT ON TABLE sport_event_groups IS 'Playing groups per round: tee time, starting hole, ordered members. Replaced atomically by rounds-server.ts.';
COMMENT ON COLUMN sport_event_group_members.sport_event_round_id IS 'Denormalised from the group so UNIQUE (round, participant) holds "one group per participant per round"; the writer keeps it equal to the group''s round.';

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
SELECT 'three tables' AS check_name, '3' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.tables WHERE table_schema = 'public'
   AND table_name IN ('sport_event_participants', 'sport_event_groups', 'sport_event_group_members')

UNION ALL

SELECT 'rls on, zero policies, all three', 'true',
       (bool_and(c.relrowsecurity) AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename LIKE 'sport_event_%'))::text,
       CASE WHEN bool_and(c.relrowsecurity) AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename LIKE 'sport_event_%') THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class c WHERE c.oid IN ('public.sport_event_participants'::regclass, 'public.sport_event_groups'::regclass, 'public.sport_event_group_members'::regclass)

UNION ALL

SELECT 'anon cannot read any', 'false',
       (has_table_privilege('anon', 'public.sport_event_participants', 'SELECT')
        OR has_table_privilege('anon', 'public.sport_event_groups', 'SELECT')
        OR has_table_privilege('anon', 'public.sport_event_group_members', 'SELECT'))::text,
       CASE WHEN has_table_privilege('anon', 'public.sport_event_participants', 'SELECT')
              OR has_table_privilege('anon', 'public.sport_event_groups', 'SELECT')
              OR has_table_privilege('anon', 'public.sport_event_group_members', 'SELECT') THEN 'CHECK FAILED' ELSE 'OK' END

UNION ALL

SELECT 'participants: one row per (event, profile)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'sport_event_participants_uniq' AND contype = 'u'

UNION ALL

SELECT 'members: one group per participant per round', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'sport_event_group_members_round_uniq' AND contype = 'u'

UNION ALL

SELECT 'members: round matches the group''s round', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM sport_event_group_members m JOIN sport_event_groups g ON g.id = m.group_id
 WHERE m.sport_event_round_id <> g.sport_event_round_id

UNION ALL

SELECT 'participants: constraints', '10', count(*)::text,
       CASE WHEN count(*) = 10 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_event_participants'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'indexes', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public'
   AND indexname IN ('idx_sport_event_participants_event_status', 'idx_sport_event_participants_profile_created', 'idx_sport_event_groups_round_sequence', 'idx_sport_event_group_members_group_position')

UNION ALL

SELECT 'updated_at triggers', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgname IN ('sport_event_participants_updated_at', 'sport_event_groups_updated_at') AND NOT tgisinternal

ORDER BY 1;

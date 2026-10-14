# Events: phases 1–4, competition formats, leftovers

> Moved verbatim from CLAUDE.md "Key Conventions" on Oct 13 2026. Convention numbers are kept because code comments and docs cite them. Read the devlog entries each convention names (`docs/devlog.md`) before changing the code it describes.

## Convention 17 — An Event is organizer intent layered over a live round (Events program, Sep 16 2026, #732–#748, migs 201–206)

**An Event is organizer intent layered over a live round (Events
program, Sep 16 2026, #732–#748, migs 201–206)** — Tom's design doc
makes Events a first-class object; the audit found the live round
(`group_posts` + its scorecard, machine, mirror and feed post) already
IS a single-day event, so the Event is a thin header: `sport_events` →
`sport_event_rounds`, each round ONE `group_posts` row minted at
go-live and linked by `group_posts.sport_event_round_id` (203, one
writer: `lifecycle-server.ts mintRound`); `sport_event_participants`
(roles organizer | co_organizer | participant | follower; the frozen
`handicap_index`; `hide_from_profile`; the waitlist), groups + members.
Naming: `sport_events` in the database, API and code; "Events" on
screen; `/events/[id]` the place (the calendar owns `events`, the
contest place owns `/event/[id]`). The rules, each pure and pinned in
`src/lib/sport-events/`: `resolveSportEventAccess` is THE ONE GATE
(public → everyone; link → the token or a participant; private → any
non-declined participant, followers included; a refusal is a 404);
`validateTransition` (draft → open | cancelled; open → live |
cancelled; live → completed — never cancelled) with `applyTransition`
compare-and-setting the status (open mints the round's POST, live
mints the ROUND, completed finalizes / mirrors / re-timestamps and
sends the results bell, cancelled deletes the announce post);
`planJoin` (seats = accepted AND playing; full → waitlisted; any
vacancy promotes lowest position first; a follower may be invited);
`computeLeaderboard` (the one computation, never stored; gross and net
over SCORED holes; T2; an off-catalog round scores against par 4);
`scoringRight` (both score routes: self and the creator on the session
client, a same-group partner or an organizer on the ADMIN client — the
gate IS the authorization; submitted admits the owner, who reopens it;
final admits organizers only; `expected_updated_at` → 409); the
results opt-out is the ONE edit in `round-mirror.ts` (a hidden result
leaves the profile, the handicap and the dataset together). One post
per round, three states (announced → live → results; hide-until-
finished relaxed for event rounds only; the golf feed freeze lifted
for the announce branch only). Live entry is `GroupScoreCard` over the
score outbox (a set of desired states per participant × hole, replayed
on reconnect; 409 = the player decides). Bells: `sport_event_invite` /
`_request` are inserted `pending` and carry Accept / Decline
(`NotificationActionRow`; the action route decides through
`applyJoin`). Navigation is phase-1-minimal: Sports replaces Explore
(`/sports/{explore,events,leaderboards}`, `/explore` redirects), the
header's Create sheet (Post | Event), the drawer a superset. A
supervised profile MAY host. Every prod probe waits for the deploy
(`e2e/helpers/deploy.ts`). `docs/EVENTS.md` is the reference; read
DEVLOG Sep 16 2026 PR 1–16 first. Phase 2 (below) took N rounds,
flights, breakdowns and the cut; parked for phase 2b: `contest_id`
stamping for org-hosted events, the calendar publication, the per-hole
version column, the five-tab bar; match play and brackets are phase 3.

## Convention 18 — A tournament is a SEQUENCE of rounds run one at a time; the event follows its rounds (Events program, phase 2, Sep 16 2026, #750–#760, mig 207 the ONLY DDL)

**A tournament is a SEQUENCE of rounds run one at a time; the event
follows its rounds (Events program, phase 2, Sep 16 2026, #750–#760,
mig 207 the ONLY DDL)** — the plan `~/.claude/plans/let-s-start-phase-
2-transient-fountain.md` carries the phase 2b spec too. The rules,
each pure and pinned in `src/lib/sport-events/`: `sport_event_rounds.
status` is the unit of organizer intent (`lifecycle.ts
validateRoundTransition`: scheduled → live | cancelled; live →
completed; one live round at a time, in sequence order; a live round is
never cancelled) and the EVENT's status is DERIVED
(`eventStatusAfterRound`: the first start takes an open event live, the
last completion — or cancellation after a played round — completes
it); `POST [id]/rounds/[rid]/transition` is the door and the
event-level live / completed are sugar (`rounds_remaining` while a
round is scheduled); the mint is per ROUND, completion finalizes /
mirrors THIS round's cards, a late joiner joins the LIVE round only,
the event's cancel is the one round-wide status write. Rounds are
APPEND-ONLY (`rounds.ts`: the 201 UNIQUE on `sequence` is not
deferrable; a delete renumbers the later rounds lowest first; the date
order keeps sequence = chronology; a round's announce post is deleted
BEFORE the row — 203 is SET NULL). The overall board is a pure FOLD
over the rounds' boards (`overall.ts computeOverallLeaderboard`: the
format's key summed over every minted round's scored holes, a missed
completed round below the full field, shared ranks through the one
ranking rule, today's thru the order-only tiebreak, `movement` vs the
standing before the current round, a flight ranks within itself,
`madeCut` from `cut.ts applyCut` — ties at the nth place all make it;
the missed-cut set is excluded from every later mint) — never stored.
The page holds ONE selected round (`tabs.ts parseRoundParam`,
`?round=overall|<id>`, never a blank panel) and a single-round event
looks exactly as in phase 1. Flights are a label on the PARTICIPANT
(one per tournament; `flights.ts planFlights` never guesses an
unindexed player). Breakdowns and the hardest holes are their own
route (`breakdown.ts`), never `?detail=1` on the polled board. The
waitlist is packed 1..n after every change (`join-server.ts
writeWaitlistOrder` the one writer), an organizer may promote now
(capacity is theirs to exceed) and a queue place is between the player
and the organizer (`view.ts visibleParticipants`). `format_config`
(207) has ONE writer, the event PATCH, and `EVENT_COLUMNS` /
`ROUND_COLUMNS` name 207's columns only after Tom confirmed it ran (a
select naming a missing column 404s the whole API). `docs/EVENTS.md`
"Phase 2" is the reference; read DEVLOG Sep 16 2026 phase 2 PR 1–12
first. Parked (phase 2b, decided): contest stamping, the calendar
overlay + .ics + reminder bell, the per-hole `version`, the five-tab
bar; also Stableford, a round reorder, the waitlist UNIQUE via an RPC,
the `FOR UPDATE` accept race; phase 3: match play, brackets.
**Phase 2b (Sep 16 2026, #763–#773, migs 209 · 210 · 211) landed the
integrations:** a score write is a PER-HOLE compare-and-set
(`golf_hole_scores.version`, `hole-writes.ts` / `hole-scores-server.ts`;
`expected_version` 0 = "I saw no score"; a 409 carries the hole's
current row; "keep mine" resends against it — never a forced
overwrite); the phone tab bar mounts once in the root layout with ONE
active rule (`nav-active.ts`) and hides where a screen owns its bottom
edge (`tab-bar.ts`); a participant's rounds are read-time calendar
items (`calendar/sport-event-overlay.ts`, never rows) with an .ics and a
day-before bell (a daily-cron step, once per round per person); an
org-hosted event COUNTS TOWARD one golf leaderboard competition
(`contests.sport_event_round_id`, ONE writer `contest-link-server.ts`,
the org's results written from the EVENT's board on completion as
`club_recorded` / `league_verified`, an opted-out player counted with
`roundRef.roundId` null, the golf-sync engine GUARDED on the link).
`docs/EVENTS.md` "Phase 2b" is the reference.

## Convention 19 — A match is a group with two sides; its status is computed, its outcome written once (Events program, phase 3, Sep 16 2026, #775–#790, migs 212 · 213)

**A match is a group with two sides; its status is computed, its
outcome written once (Events program, phase 3, Sep 16 2026, #775–#790,
migs 212 · 213)** — Tom's decisions: singles + four-ball + foursomes,
gross or net; the organizer sets EVERY draw by hand; a halved match
goes to sudden-death extra holes; a standalone match event AND a
bracketed one; a match round posts to the profile and the handicap as
played (the mirror untouched). The rules, each pure and pinned in
`src/lib/sport-events/`: `match.ts computeMatch` is THE ONE computation
(a hole counts when both sides have a counting score — own ball / the
better net ball / the captain's card; a concession wins the hole for
the other side; ties halve; "3&2" / "2 up"; all square after the last →
extra holes, the first won decides; a stored organizer / concession /
bye decision wins over the computation; strokes given by the DIFFERENCE
in playing handicaps on the stroke index — 100 · 90 per player · 50 of
the combined; a missing index → gross with `no_index`, never a guess);
the strokes stay on the cards (the outbox, the per-hole CAS), what a
card cannot carry lives on `sport_event_matches` (212: concessions,
extra holes — never `golf_hole_scores`, CHECK 1..18 — an organizer
decision, a bye; `version` the APP-level compare-and-set, every write
`WHERE id AND version`, 0 rows = 409 re-read and replay; the outcome
written ONCE at round completion, `closeMatchesOnCompletion`); no
`status` column. `format` widens to `match_gross | match_net`;
`format_config.match {sides, bracket, allowance?}` (strict, `cut` ⊕
`match`, the format part of the parse, defaults filled on the view);
`sport_event_group_members.side` (1 | 2; derived from the position for a
plain id; refused by name on a stroke event). The lifecycle's gate on a
match round is the MATCHES', never the cards': `groups_incomplete` at
start (a one-side group is a bye on a bracket only), `matches_undecided`
at completion (`override` never bypasses it; the page sends none); a
match round fields ONLY its draw (`roundFieldExclusions`); every card is
finalized as it stands; a match event never counts toward a competition
(`not_stroke_play`); the leaderboard + breakdown routes answer 409 on a
match event and the Matches tab replaces Leaderboard. Three intent
routes behind one preamble (`match-write-server.ts`: a member of the
match or an organizer, the round live): concede (a member of THAT side;
`hole: null` = the match), extra-hole (any member; `n` the next), decide
(organizers; `null` clears their own). A BRACKET is nothing new: the
rounds ARE the bracket rounds, match k of round n+1 is fed by 2k−1 and
2k of round n by group SEQUENCE ("Fill from winners" pre-fills, the
organizer edits; `BracketView` at `?round=bracket`). The e2e suite mints
FOUR QA users (pairs, brackets). The bells (213) speak in FULL names
and carry NO actor (an organizer who plays gets theirs). `docs/EVENTS.md`
"Phase 3" is the reference; read DEVLOG Sep 16 2026 phase 3 PR 1–12 and
the four follow-ups first.

## Convention 20 — An event is a live place for EVERY sport; the shape lives on the event, the mode is derived, the lines are the record (Events program, phase 4, Sep 16 2026, #792–#803, migs 214 · 215 · 216)

**An event is a live place for EVERY sport; the shape lives on the
event, the mode is derived, the lines are the record (Events program,
phase 4, Sep 16 2026, #792–#803, migs 214 · 215 · 216)** — Tom's
decisions: every enabled sport (golf keeps its cards; the stat-line
sports get LIVE per-player stats); a team event is a GAME (two ad-hoc
sides + a live score) or a SESSION, chosen at creation; the organizer
picks the recording mode (named recorders — anyone, playing or not —
and/or self-entry); joining fully open unless closed, new events
default PUBLIC and viewable signed out (a participant's EVENT stats are
public even with a private profile — the masked name, never the
profile); live media by participants and spectators. The rules, each
pure and pinned in `src/lib/sport-events/`: `recordingModeOf` DERIVES
self | recorder | both from `self_entry` + the `recorder` rows (any
accepted row; a follower with it is the non-playing recorder) — never
stored; `scoringRight` / `statEntryRight` admit a recorder for everyone
on the admin client and refuse the owner by name (`recorder_only`) when
self entry is off; the SHAPE (`round` | `game` | `session`) is one
decision at creation, golf ⇔ round both ways (215's CHECK), `format`
and `cut` / `match` are golf vocabulary refused off golf,
`format_config.game` names the sides (Home / Away; an org's teams
pre-fill later), a team round is a PLACE + a start, a game's groups
carry SENT sides (never derived); `sport_event_stat_lines` is ONE row
per fielded player per round minted at go-live (`roundMinted` = a group
post OR the lines — nothing golf-ish off golf), the vocabulary is
`STAT_SCHEMAS` through the one validator (refused by name, never
clamped), NO line status (rights come from the ROUND's status), every
write the WHOLE object under an app-level CAS (`version`, a 409
carries the current line), the game score ON the round under
`score_version`; posture-A tables emit no realtime, so the POLL is the
live feed (`useRoundStats` 5 s live) and the stat outbox is the golf
outbox's shape (one desired state per LINE); completion writes one
`stat_line` POST per played line (found by
`stats_data.sport_event_stat_line_id`, never `posts.
sport_event_round_id` — 203's UNIQUE is the round's one post), the
performance row through `fromStatLinePost` with `provenanceForLine`,
the round's post → `sport_event_results`; `sport_event_media` is
posture A behind the ONE gate (add = any accepted row or an organizer;
remove = the uploader or an organizer; the proxy's `sport_event` entity
re-runs the event gate per byte; mirrored onto the round's post once);
the live stat screen `/events/[id]/live` owns its bottom edge
(`showsTabBar` hides). `SPORT_EVENT_SPORTS` (the create list) widened
only after 215 ran. `docs/EVENTS.md` "Phase 4" is the reference; read
DEVLOG Sep 16 2026 phase 4 PR 1–12 first. Parked: `track_field` (a
meet — track 2), pools, relays, the per-photo guardian bell, realtime
as a wake-up, the venue timezone for a team round's start.

## Convention 21 — The org formats and the events meet on ONE contest through TWO doors (Competition formats program, track 2, Sep 16 2026, #806–#816, migs 218 · 219 · 220)

**The org formats and the events meet on ONE contest through TWO
doors (Competition formats program, track 2, Sep 16 2026, #806–#816,
migs 218 · 219 · 220)** — the sport PROFILE decides format × entrant
(`src/lib/sports/competition-profiles.ts`, pure data — never on
`SportAdapter`; `FORMATS_LIVE` gates creation); stages are two columns
on `contests` (218 `stage` / `slot`; slot k of stage n+1 is fed by 2k−1
and 2k of stage n — BY SLOT, never by id; a meet's session / order use
the pair); a knockout tie carries its decision IN the result
(`payload.advance` — no `decided_by` column, so `deriveContestOutcome`
stays the one ranking rule); a meet is ONE competition whose events are
contests (the mark is the result; the team score rolls up per
AFFILIATION — 219 `affiliation_team_id` — whose rows are TEAM entries
minted at recompute; one `contest_stat_lines` row per athlete per event
→ the performance row); an ad-hoc side (219: `name`, `source_ref`,
`competition_entry_members`) is the shape an org's default team shadows
later; ONE naming rule at every reader (`entryDisplayName`). The
BRIDGE: `eventShape` × `competitionAcceptsShape` is the shape table (a
stroke round → a golf leaderboard; a GAME → a fixture of named sides in
its sport; a session → nothing; a match round → a golf bracket from the
console door only); a contest mirrors a ROUND (211) or a MATCH (220),
never both; the event → competition door mints the fixture between the
event's ad-hoc sides (`source_ref sport_event_side:<event>:<side>`); the
contest → event door (`POST …/contests/[contestId]/event`) mints a
one-round game or match-play event hosted for the org with the sides
pre-filled from the entries and the link stamped through the ONE writer;
completion branches on the shape (`syncGameContest` — the live score,
the lines as the org's stat lines, the performance row STAYS the
event's `post:` origin; `syncMatchContests` — winner 1 / loser 0,
`payload.match`, the bracket advanced by slot); the hand writers refuse
a linked contest (`from_event`). `docs/EVENTS.md` "Competition formats
— the bridge" and the masterplan §3.3 table are the reference; read
DEVLOG Sep 16 2026 track 2 PR 1–11 first. Parked: pools, relays, a whole
bracketed match event linking to an org bracket in one act.

## Convention 22 — Seven leftovers, one migration (Events + formats leftovers, Sep 17 2026, #820–#831, mig 221)

**Seven leftovers, one migration (Events + formats leftovers, Sep 17
2026, #820–#831, mig 221)** — pools are a letter on the ENTRY ranked
WITHIN the pool (`src/lib/competitions/pools.ts`; `stats.pool` the
1-based index; a cross-pool game counts in neither table; the round-robin
generated PER POOL, dry-run first; "Seed from standings" crosses the top
n of each pool onto an undrawn bracket through the ONE seeds writer);
relays live in `RELAY_EVENTS`, never `TRACK_EVENTS` (a relay mark is
never a stat line); a meet session is ONE `events` row shared by its
contests (the mirror's shared-event rule: life or death only); an org's
teams pre-fill a game's sides at creation (`side-prefill-server.ts`);
Stableford in both flavours ranks by points through ONE `rankingKeys`
(the cut's line is the MIN on a descending format, `to_par` refused;
never an org competition — `points_format`); a BRACKETED match event
counts toward a golf bracket in one act — the intent on
`sport_events.competition_id` (221), each round's matches stamped onto
the bracket's slots at go-live (`slotForMatch`: stage n ↔ round n, slot k
↔ match k — the ONE place; a disagreeing draw REPORTED, never a gate); a
team round's start is read on the ROUND's zone
(`sport_event_rounds.timezone`, `calendar/time-zones.ts` the one
validator, `startTimeLine` prints the venue time beside the viewer's only
when the clocks differ; the .ics on UTC instants). `docs/EVENTS.md`
"Events + formats leftovers" is the reference; read DEVLOG Sep 17 2026
leftovers PR 1–12 first. Parked (Tom): the per-photo guardian bell,
realtime as a wake-up.

# Events and Tournaments — the reference

**Status:** phase 1 complete, phase 2 (tournaments) complete (Sep 16
2026). Plans: phase 1 `~/.claude/plans/let-s-start-the-policy-lucky-
widget.md`; phase 2 (+ the phase 2b spec) `~/.claude/plans/let-s-start-
phase-2-transient-fountain.md`. This file is the durable reference; it
grows with each PR.

## The one idea

An **Event is organizer intent layered over a live round.** A shared golf
round (`group_posts`) already is a single-day event with participants, live
per-hole scoring, realtime, a score-derived status machine and the
completion mirror into the athlete's golf history and the analysis table.
What it cannot express is the organizer's decisions — draft, open for
joining, live, completed — or more than one round. So:

- `sport_events` (201) is the **header**: host, optional club/league, sport,
  join mode, visibility, format, status, capacity.
- `sport_event_rounds` (201) are the **rounds** (phase 1 shows one; the
  table allows a tournament).
- `sport_event_participants` (202) is the **roster** with roles
  (organizer · co_organizer · participant · follower), the seven statuses,
  the WHS index frozen at accept, the profile opt-out.
- `sport_event_groups` / `_members` (202) are the **playing groups** per
  round: tee time, starting hole, ordered members.
- Each round **IS** one `group_posts` row, **minted at go-live** and linked
  by `group_posts.sport_event_round_id` (203) — one writer,
  `src/lib/sport-events/rounds-server.ts`. The round's own machine
  (`src/lib/golf/round-status.ts`) is untouched; everything golf is reused.

## Naming

`sport_events` in the database, API (`/api/sport-events/…`) and code
(`src/lib/sport-events/`); notification types `sport_event_*`. "Events" on
every screen; the page is `/events/[id]`. The calendar owns the word
`events` (table 057) and the `event_*` bell types; `/event/[contestId]` is
the org contest place.

## Decisions (Tom, Sep 16 2026)

- A private event's leaderboard is visible to participants AND followers.
- Results feed the athlete's profile automatically; the opt-out
  (`hide_from_profile`) makes the mirror skip the participant, which hides
  the round everywhere (profile, handicap, `athlete_performances`).
- Net scoring uses the player's computed index by default, frozen on the
  participant row at accept; the organizer may override per event. The
  course handicap is computed at read from the round's rating / slope / par.
- Co-organizers exist in phase 1.
- Navigation is phase-1-minimal: the header + drawer chrome stays; Sports
  replaces Explore; the Create sheet offers Post | Event; the four-item
  bottom tab bar is a later round.
- One post per round, three states: minted at Open (announced), attached to
  the live round at go-live (live), the score-led card at completion
  (results). Sport-event posts are listed in the feed from Open.
- A supervised (minor) profile may host; its posts publish immediately.

## Migrations

| # | file | what |
|---|---|---|
| 201 | `sport_events_core.sql` | the header + the rounds |
| 202 | `sport_event_people.sql` | participants, groups, members |
| 203 | `sport_event_round_links.sql` | `group_posts.sport_event_round_id`, `posts.sport_event_round_id` |
| 204 | `scorecard_status.sql` | `golf_participant_scores.status / submitted_at / finalized_by` |
| 205 | `sport_event_notifications.sql` | the `sport_event_*` notification types |
| 206 | `reserved_sports_root.sql` | `reserved_handles` gains `sports` |
| 207 | `sport_events_format_config.sql` | phase 2's ONE migration: `sport_events.format_config` jsonb (`{cut?: {after_round, top_n? \| to_par?}}`; ONE writer the event PATCH; `stableford` reserved), `sport_event_rounds.name`, the `flight` CHECK (1..20). Runs BEFORE PR 8 reads the columns (the 42703 window — which bit on Sep 16: #761 merged first, prod's event reads 42703'd until 207 ran; `check:schema` now asks the reverse question, so a merge ahead of its migration reads `CHAIN-ONLY` by name) |
| 209 | `hole_score_version.sql` | phase 2b (B3): `golf_hole_scores.version` — a per-hole compare-and-set (starts at 1, +1 by `trigger_bump_hole_score_version` only when a scored field changes); a client sends `expected_version`, the server writes WHERE `version = expected`, 0 rows = 409 with the current row. Nothing reads the column until `check:schema` says 209 ran |

Posture A on every new table (RLS on, zero policies, REVOKE from anon and
authenticated): the service client behind `resolveSportEventAccess` is the
only reader; a refusal is the same 404 as not-found.

## The library — `src/lib/sport-events/`

Pure halves (node-tested) and `*-server.ts` I/O halves, one concern each:

| pure | server | the rule |
|---|---|---|
| `access.ts` | `access-server.ts` | `resolveSportEventAccess` — THE ONE GATE. Public → everyone; link → the token, an admitting participant, or the host; private → any non-declined / non-removed participant (followers included) or an organizer. `null` = 404. |
| `lifecycle.ts` | `lifecycle-server.ts` | THE EVENT: draft → open \| cancelled; open → live \| cancelled; live → completed; named refusals; the organizer override. THE ROUND (phase 2): scheduled → live \| cancelled; live → completed — `validateRoundTransition`, `eventStatusAfterRound` (the event follows its rounds), `nextStartableRound`. `applyRoundTransition` compare-and-sets THIS round's status: live mints the ROUND (`mintRound`, idempotent) and takes an open event live; completed finalizes / mirrors / re-timestamps this round and completes the event with the last one (the results bell); cancelled deletes the announce post. `applyTransition` (the event) delegates live / completed to it; open mints the POSTS; cancelled is the one round-wide status write. `syncRoundRoster` keeps the LIVE round's roster in step. |
| `join.ts` | `join-server.ts` | `planJoin` for the ten actions; seats = accepted AND playing; full → waitlisted; a vacancy or a capacity raise promotes lowest position first; a follower may be invited. |
| `handicap.ts` | `handicap-server.ts` | the frozen index at accept (`snapshotAtAccept`; an organizer override is never overwritten); the read-time course handicap. |
| `leaderboard.ts` | `leaderboard-server.ts` | the one computation; `fetchRoundLeaderboard` reads the field, the cards and the names (`leaderboard-rows.ts`, pure) and computes on every request — nothing stored. |
| `overall.ts` | `leaderboard-server.ts fetchOverallLeaderboard` | THE TOURNAMENT'S BOARD (phase 2): a pure fold over the rounds' boards — the format's key summed over every minted round's scored holes (the live round's partial counts), a missed completed round ranks below the full field, shared ranks through `assignSharedRanks`, order-only tiebreak today's thru DESC, unscored last, net only when every played round has net, `today` = the live round's cell, `movement` vs the standing before the current round, a flight filter ranks within the flight. Never stored. |
| `opt-out.ts` | `results-server.ts` | the results opt-out: `mirrorCompletedRound` skips (and un-mirrors) a player who hid the result — the ONE edit in `round-mirror.ts`; `applyProfileOptOut` for a late flip. |
| `scoring-authz.ts` | `scoring-authz-server.ts` | `scoringRight` — the via / client matrix over the card status; `resolveScoringRight` reads the row, the round, the event role + group and the card, and BOTH score routes (`api/golf/scorecards/[id]/scores`, `api/golf/participant-scores`) pick the client from its verdict; `detectConflict` (`expected_updated_at` → 409 `{current}`); `holeRangeFor` (an event round's own start and length). |
| `cards.ts` | — | `planCardAction`: submit (owner) · finalize / reopen (organizers). |
| `rounds.ts` | `rounds-server.ts` | the round's course snapshot WITH the stroke index; `starts_on` has one writer (`writeStartsOn`). |
| `mint.ts` | — | the rows the mint writes (the announce post, the group_post, the scorecard, the participant rows) — pure, pinned. |
| `groups.ts` | — | `validateGroupsPlan`: the organizer's whole plan for a round, against the roster. |
| — | `scorecard-context.ts` | the `sport_event` block the scorecard GET carries. |
| `validate.ts` | — | request bodies: a miss is a 400 naming the field, never a clamp. |
| `view.ts` | `view-server.ts` | the GET projection: names through `publicDisplayName`, the link token only to organizers, `hide_from_profile` only to self / organizers, never an email or a supervision state. |
| `notify.ts` | — | the bells: invite (+ a guardian copy for a supervised invitee), request, decision / promotion, results (completion). |
| `actor-server.ts` | — | the acting profile (`profile_id` in a body, `?as=` on a GET) through `resolveActingProfile`. |

## The API — `/api/sport-events/…` (PR 4)

Cookie-header auth; every read and write goes through the gate; the new
tables are read and written on the admin client (posture A — the gate IS
the authorization). Rate buckets: `sport-event` (edits, 120/h per user),
`sport-event-join` (60/h per user), `sport-event-view` (240/min per IP —
the GET is anonymous-reachable for a public or link event).

| route | who | what |
|---|---|---|
| `POST /api/sport-events` | signed in (acting-as ok) | name, description, visibility, join_mode, format, capacity, club_id \| league_id (`manage_competitions`, never acting-as), `round {scheduled_on, course_id, course_name, tee, holes, starting_hole}` OR (phase 2) `rounds: [{…}]` (1..8, sequence order, dates non-decreasing — never both), `host_plays`, `publish` → the header, the rounds (each a catalog snapshot), the host's organizer row; a link token for `link` |
| `GET /api/sport-events?scope=mine\|hosting\|upcoming\|live\|past` | signed in | the viewer's events (host or a non-declined / non-removed row), ≤ 100 |
| `GET /api/sport-events/[id]?token=&as=` | optional auth → 404 | `{event, rounds (+ group_post_id), participants, groups, counts, viewer}` |
| `PATCH /api/sport-events/[id]` | canManage; draft / open — and live for `format_config` alone | the editable fields; a capacity raise promotes; `visibility: 'link'` mints a token; `format_config` (207, phase 2) validated against the round count (`parseFormatConfig`), refused `cut_already_passed` once the round the cut follows completed |
| `DELETE /api/sport-events/[id]` | the host; draft / cancelled / completed | a minted round detaches (203 SET NULL) |
| `POST /api/sport-events/[id]/link-token` | the host; `link` | rotate |
| `POST /api/sport-events/[id]/participants` | canManage; draft / open | `{profile_ids, handles}` → invites; blocked skipped silently; the supervised invite dial; `{invited, skipped: {unknown, blocked, supervised, existing}}` |
| `POST /api/sport-events/[id]/participants/request?token=` | may view; open + `request` | a join request → the organizers' bell |
| `POST /api/sport-events/[id]/participants/[pid]` `{action}` | self: accept \| decline \| withdraw; canManage: approve \| reject \| remove \| promote (phase 2: seat a waitlisted player now, capacity or not) | the plan from `planJoin`; an accept freezes the index; `{participant, promoted}`; the waitlist is re-packed 1..n after |
| `PATCH /api/sport-events/[id]/participants/[pid]` | `handicap_index` canManage (null clears + recomputes); `hide_from_profile` self; `playing` self or canManage; `flight` canManage, not after completion (phase 2); `waitlist_position` canManage on a waitlisted row — the organizer's reorder, its own writer (phase 2) | stepping out promotes the waitlist |
| `PUT /api/sport-events/[id]/flights` `{assignments: [{participant_id, flight \| null}]}` | canManage; not completed / cancelled | the whole plan in one call (phase 2): every id an accepted, playing player, none twice; a player left out keeps their flight |
| `POST` / `DELETE /api/sport-events/[id]/follow?token=` | may view | a follower row; never a seat |

| `POST /api/sport-events/[id]/transition` `{to, override?, today?}` | canManage | open · live · completed · cancelled; a 409 carries the named `reason`. Phase 2: `live` starts the next startable ROUND, `completed` completes the live round and refuses `rounds_remaining` while another round is scheduled — a single-round event behaves as in phase 1 |
| `POST /api/sport-events/[id]/rounds/[rid]/transition` `{to: live \| completed \| cancelled, override?, today?}` | canManage | the ROUND's intent (phase 2): live mints THIS round (`event_not_open` · `another_round_live` · `earlier_round_pending` · `no_players` · `round_not_minted`); completed needs THIS round's cards final or the override, mirrors this round, completes the event when no round is left (the one results bell); cancelled for a scheduled round that is not the last (`last_round`) |
| `POST /api/sport-events/[id]/rounds` | canManage; draft / open / live | add a round (phase 2): appended as `max(sequence) + 1`, its date never before the previous round's (`round_out_of_order`), at most 8 (`too_many_rounds`); an open or live event mints its announce post at once |
| `PUT /api/sport-events/[id]/rounds/[rid]` | canManage; the ROUND is `scheduled` | the round's plan; keeps the date order against its neighbours; re-snapshots the catalog; rewrites `starts_on` |
| `DELETE /api/sport-events/[id]/rounds/[rid]` | canManage; the round is `scheduled` and not the last non-cancelled one (`not_scheduled` / `last_round`) | its announce post FIRST (203 links the post with SET NULL), then the row (groups cascade), then the later rounds move up one, lowest first |
| `PUT /api/sport-events/[id]/rounds/[rid]/groups` `{groups: [{name?, tee_time?, starting_hole?, members}]}` | canManage; the ROUND is `scheduled` | the whole plan replaced (phase 2: round 2 is regrouped while round 1 is live) |

The scorecard GET (`/api/group-posts/[id]/scorecard`) answers `sport_event`
for an event's round; the feed lists an event's round from Open (one post,
three states); the abandonment sweep leaves an event's round alone.

| `POST /api/sport-events/[id]/cards/[pid]/submit` | the card's owner; live | `submitted` + `submitted_at` + `scores_confirmed` ([pid] = the round's `group_post_participants` row) |
| `POST /api/sport-events/[id]/cards/[pid]/finalize` `{reopen?}` | canManage; live | `final` + `finalized_by` (a never-scored player's row is created final); `reopen` → `in_progress` |

Scoring on an event round goes through the EXISTING score routes with one
more gate: a same-group partner or an organizer writes on the admin
client; `expected_updated_at` answers 409 on a newer card; holes outside
the round's range are refused by name.

| `GET /api/sport-events/[id]/rounds/[rid]/leaderboard?token=&flight=` | may view | computed on read; `private, max-age=5` signed in, `s-maxage=10` anonymous on a public event |
| `GET /api/sport-events/[id]/breakdown?round=all\|<rid>&participant=&token=` | may view | the breakdowns (phase 2): every minted round's cards with the five hole fields, per player per round, the tournament aggregate (`overall`, present with more than one round; its `hardest` only when the rounds share a course and range) and the hardest holes; its own route, never `?detail=1` on the polled board; the board's cache rule |
| `GET /api/sport-events/[id]/leaderboard?token=&flight=` | may view | the OVERALL board (phase 2): the minted rounds' boards folded — `{event, rounds (the headers, scheduled ones included), board: {rows, current, scoredRounds, flights, cutLine}}`; the same cache rule |

The results: on completion the round is mirrored into every player's
`golf_rounds` (the profile, the handicap, the dataset) EXCEPT players
with `hide_from_profile`; the flip is theirs alone (`PATCH …/participants/
[pid] {hide_from_profile}`), before or after completion.

## The event page — `/events/[id]` (PR 8)

The contest place's shape (`src/app/(app)/events/[id]/`): a public event is
server-rendered; everything else goes through `EventGate` with the session.
`src/components/sport-events/`: `EventPlace` (the shell — view, `?tab=`,
actions, one refetch), `EventHeader` + `EventJoinButton` (`join-state.ts`
is the one rule), `EventOverview`, `EventSchedule`, `EventPlayers` +
`InviteWindow`, `EventLeaderboard`, `EventTabs`. `src/lib/sport-events/
client.ts` is the page's fetch helper (the link token rides every call).
Re-sequenced UI: page → wizard + Create sheet → Sports nav + `/explore`
redirect, so no PR links to a page that is not there yet.

## The wizard and the Create sheet (PR 9)

`/sports/events/new` hosts `EventCreateWizard` (basics → round → format →
review; `src/lib/sport-events/wizard.ts` holds the rules). `CourseSearchField`
(`src/components/golf/`) is the composer's course search, extracted. The
header's **Create** button opens `CreateSheet` (Post | Event); the drawer
carries Create Post and Create Event.

## Navigation (PR 10)

Sports replaces Explore in the header (`/sports`, fa-medal; lit for
`/sports/*` and `/events/*`). `src/app/(app)/sports/`: `explore` (the old
Explore, `?course=` kept), `events` (`?filter=upcoming|live|past|mine`),
`leaderboards`, `events/new`. `SportsSubnav` switches the three places;
`src/lib/sports-nav.ts` is the rule. `/explore` redirects, query preserved.
The bottom tab bar is a later round.

## Notifications (PR 11)

`sport_event_invite` and `sport_event_request` are inserted `pending` and
carry Accept / Decline (`NotificationActionRow`, rule in
`src/lib/notification-actions.ts`) on the notifications page and in the
bell; `POST /api/notifications/[id]/action` decides them through the
event's gate and `applyJoin`, then stamps the bell. A decided bell reads
what you did.

## Groups (PR 12)

The organizers' **Groups** tab (`EventGroupsEditor`, operations in
`src/lib/sport-events/groups-editor.ts`) arranges the accepted, playing
participants into groups with a name, a tee time and a starting hole;
Save replaces the round's plan in one PUT. The mint orders the round's
players by it at go-live.

## The Scorecard tab (PR 13)

Once the round is minted, players and organizers get **Scorecard**
(`EventScorecardTab`, rows in `src/lib/sport-events/cards-view.ts`): a
player's own card with Submit and the door to the live round; an
organizer's Mark final / Reopen per card and Complete with the not-final
list. The scorecard payload carries `status`, `submitted_at`,
`finalized_by`.

## Live entry — the group card (PR 14)

`/live/[groupPostId]` mounts `GroupScoreCard` (`src/components/golf/`) when
the round belongs to an event and the viewer is in a playing group:
holes as rows, players as columns, a partner's column after a confirm,
the score outbox (`src/lib/golf/score-outbox.ts` + `useScoreOutbox`) that
queues offline and replays on reconnect, a 409 conflict resolved by the
player, Submit / Confirm my card. The one-player modal stays for other
rounds.

## The feed (PR 15)

One post per round, three states. `GET /api/posts` carries `sport_event`
beside a post (`src/lib/sport-events/feed.ts`); `SportPostBody`'s null
branch renders `EventAnnounceCard` for a sport-event post without scores
(the golf feed freeze is lifted for this branch only); `PostCard` shows
the event chip. Live with scores and results use the existing round cards.

## Verification — the e2e specs

Every spec drives the API with the two QA users (A hosts, B plays) and
runs against production after a merge (`npm run test:e2e:prod -- <name>`;
the global setup waits for the merged commit to be live). `@mobile`
specs run at 390 × 844 on Chromium AND WebKit.

| spec | what it proves |
|---|---|
| `sport-events-api` | create · the gate per visibility · invite → waitlist → promotion · the link token and its rotation · follow · delete |
| `sport-events-lifecycle` | open → live (the round minted, the scorecard carries the event) → withdraw while live → complete refused → override → delete detaches |
| `sport-events-scoring` | group-mate scoring · the hole range · the 409 conflict · submit / finalize / reopen · completion waits for every card |
| `sport-events-results` | the leaderboard (computed, gated) · the results mirror · the opt-out and opt back in |
| `sport-events-page` `@mobile` | accept from the players tab · publish · the stranger screen · public SSR |
| `sport-events-create` `@mobile` | the wizard's refusals · a typed course · a back nine · Publish → the place · Cancel asks · (phase 2) Add a round copies the course, the refusal names the round and the order, a two-round tournament lands on "Round 1 of 2" |
| `sports-nav` `@mobile` | the redirect · the subnav · the drawer · the events list · the leaderboards place |
| `sport-events-notifications` `@mobile` | Accept an invitation and a join request from the bell's row |
| `sport-events-groups` `@mobile` | the groups editor end to end · hidden from a player · (phase 2) round 2 grouped by standing, leaders last — B before A — and the mint honours it |
| `sport-events-scorecard` `@mobile` | submit · mark final · reopen · complete with the not-final list |
| `sport-events-group-card` `@mobile` | the group card · OFFLINE queue and reconnect · a partner's hole |
| `sport-events-feed` | the announce card and the chip, announced → live · (phase 2) a two-round tournament: the round-2 card reads "Round 2 of 2" and is not live while round 1 is, the chip names the round, the list's `rounds` summary |
| `sport-events-cut` `@mobile` (phase 2, NEEDS 207) | the strict PATCH · a named round · the standing decides the cut after round 1 (`cutLine`, B below) · `cut_already_passed` · round 2 minted without B · the header names the round · the Overview's cut line and the locked settings window · the board's cut line |
| `sport-events-waitlist` `@mobile` (phase 2) | capacity 1: B waitlisted #1 → "you're next" in the header and on the roster · B cannot reorder · a bad place refused by name · Promote now from the Players tab → the field one over the capacity · a promoted row can no longer be moved |
| `sport-events-breakdown` `@mobile` (phase 2) | the API shapes (`?round=all` with the aggregate, `?participant=` narrows, a bad round param) · a board row opens the window · All rounds = two strips + summed tiles · This round from a round's board · the hardest holes name hole 2 |
| `sport-events-flights` `@mobile` (phase 2) | the Flights window from the Players tab · the chip on the roster · the segment and `?flight=` rank within the flight · a player's own PATCH refused · an unknown field and a stranger in the plan refused by name · the API's `?flight=` |
| `sport-events-tournament-page` `@mobile` (phase 2) | the `?round=overall` deep link and the switcher · the header's round line · Start round 1 from the schedule card · groups per round while round 1 is live · the scorecard follows the live round · Complete round 1 from the header (the event stays live, "Start round 2") · add a round from the window |
| `sport-events-overall` (phase 2) | two nine-hole rounds: round 1 totals and ranks · round 2 live (today / thru, the total moves, the not-started player's standing holds) · round 2 completed with a missed round → below the full field · movement · the stranger's 404 · the flight filter |
| `sport-events-rounds` (phase 2) | test 2: the round lifecycle — in order, one at a time, regroup round 2 while round 1 is live, `rounds_remaining`, complete round 1 (one mirror, no bell), add + cancel a round while live, complete the last round (the event completes: one bell, two mirrors) · test 1: create with three rounds · the phase-1 body · both shapes / an unordered list refused by name · add (appended; earlier date refused; the announce post) · edit keeps the order · delete renumbers · the last round stays · the cap |
| `header-create`, `round-invite` | the Create sheet's two doors; the plain shared round still scores |

## Phase 2 — tournaments (Sep 16 2026, in progress)

Plan: `~/.claude/plans/let-s-start-phase-2-transient-fountain.md` (approved;
it also carries the phase 2b spec — contest stamping, calendar, the
per-hole version, the five-tab bar — decided and parked). The one idea,
extended: an Event is organizer intent over a SEQUENCE of live rounds, run
one at a time; the round's status becomes the unit of intent and the
event's status follows its rounds.

### The rounds list (PR 1)

`sequence` is the order AND the chronology: `src/lib/sport-events/rounds.ts`
keeps `scheduled_on` non-decreasing by sequence (`dateOrderRefusal`), so
rounds never reorder. The 201 UNIQUE `(sport_event_id, sequence)` is not
deferrable and PostgREST issues one statement per call, so rounds are
APPEND-ONLY (`nextSequence` = max + 1; a cancelled round keeps its slot)
and a delete renumbers only the LATER rounds, lowest first
(`renumberAfterDelete`). A round is removable while `scheduled` and never
as the last non-cancelled round (`deleteRefusal` — cancel the event
instead); its announce post is deleted before the row because 203 links
the post with SET NULL. `currentRound` is the round a screen shows by
default (live, else next scheduled, else last completed). `MAX_ROUNDS = 8`.
The e2e helper `e2e/helpers/sport-events.ts` (`openEventSession`,
`createEvent`, `inviteAndAccept`, `setGroups`, `goLive`, `scoreHoles`,
`roundBoard`, `cleanupEvent` — the last never throws) replaces the inlined
flows as specs are touched.

### The round lifecycle (PR 2)

Rounds run ONE AT A TIME (Tom). `sport_event_rounds.status` is the unit of
organizer intent; the event's status is derived: the first started round
takes an open event `live`, the last completed (or cancelled) round takes a
live event `completed` (`eventStatusAfterRound`, pinned). `POST
…/rounds/[rid]/transition` is the door; the event-level route delegates
`live` (the next startable round) and `completed` (the live round; refused
`rounds_remaining` while another is scheduled). The mint runs for THIS
round only (the phase-1 mint-every-round at go-live is gone, as is the
blanket round-status write — the event's cancel is the one round-wide
write left); completion finalizes / mirrors THIS round's cards only (the
phase-1 completion counted cards across every minted round); a late
joiner is added to the LIVE round only. A live round is never cancelled;
a completed round is neither cancelled nor deleted.

### The overall leaderboard (PR 3)

`src/lib/sport-events/overall.ts computeOverallLeaderboard(rounds, format,
{flight?})` is the tournament's board — pinned rules: the format's key
(net on a net event, else gross) summed over every MINTED round's scored
holes, so the Total moves during a live round; a player who missed a
COMPLETED round ranks below every full-field player whatever the total
(missing more ranks lower); ties share a rank ("T2") with today's thru
DESC as the order-only tiebreak; a player with no scored hole is unranked
last; net needs net in every played round (else null with the first
reason); `today` is the live round's cell; `movement` is the change from
the same fold over the rounds before the current one (null before round
2); a flight filter ranks within the flight while `flights` lists the
whole field's labels; `cutLine` / `madeCut` are null until the cut PR.
`GET /api/sport-events/[id]/leaderboard` is the door; the round route and
`FieldRow` now carry `flight`.

### The event page for N rounds (PR 4)

ONE selected round per page (`?round=overall|<id>`): `tabs.ts
parseRoundParam` answers what the tab can show — the tournament board
('overall') on the leaderboard of a multi-round event, else the current
round (live → next scheduled → last completed); the scorecard only among
minted rounds; an unknown value is the tab's default, never a blank panel.
`RoundSwitcher` (a pill strip, "Overall" first where offered, a live dot /
a check per round; hidden with one choice so a single-round event looks
as in phase 1) sits on the Leaderboard (`OverallBoard`: Pos · Mv · Player ·
R1…Rn · Today · Thru · Total · To par, Pos and Player pinned on a phone),
the Scorecard (minted rounds; "Complete round n" completes THIS round) and
the Groups (editable while THAT round is scheduled). The header's line is
`format.ts headerRoundLine` ("Round 2 of 3 · Sat, Jun 8 · course · live"
+ "Next: Round 3 · …"); its primary action is `page-rules.ts
nextOrganizerStep` (Publish → Start round n → Complete round n). The
Schedule's cards carry a status chip and the organizer's actions from
`roundActionsFor` (only what the lifecycle accepts) plus "Add a round";
`RoundEditWindow` (the house bottom sheet over `RoundFields`, the wizard's
round inputs extracted — the wizard now renders them too) adds or edits a
round with the wizard's rules (`validateRoundDraft`, `roundBodyFrom`).
The confirm copy is `confirmCopyFor`: phase 1's words on a single round,
the round named on a tournament, the last round says the results post.

### The wizard's rounds list (PR 5)

`wizard.ts WizardState.rounds: RoundDraft[]` (1..`MAX_ROUNDS`): "Add a
round" (`addWizardRound`) copies the previous round's course, tees and
holes with an empty date — 36 holes in a weekend is the common case;
`removeWizardRound` never takes the first; `validateWizardRounds` names
the round in its refusal ("Round 2: Pick the date.") and keeps the date
order ("Round 2 must not be before round 1."); the body sends phase 1's
`round` for one round and `rounds: [...]` for a tournament. The round step
renders one `RoundFields` per round; the review sums a tournament up
(`roundsSummary`) and lists each round. The format step is unchanged —
the cut and flights are event-page settings, they need the roster and the
rounds to exist.

### Flights (PR 6)

A flight is a label on the PARTICIPANT (`sport_event_participants.flight`,
202 — one per player for the whole tournament, the Golf Genius norm), so
the boards rank within it: `?flight=` on the round route and the overall
route filters the field before ranking; both payloads carry `flights`
(every label in the whole field, natural order). `src/lib/sport-events/
flights.ts planFlights` splits the INDEXED players into N near-equal
flights from the lowest index (A, B, C …; the first flights take the
extra) or into index bands; a player with no index is never guessed —
they are listed for the organizer to place by hand. `parseFlightsPlan` is
the PUT's rule; `normalizeFlight` (validate.ts) the label's (1..20
characters, trimmed, empty clears). The organizer's door is the Players
tab's **Flights** button → `FlightsWindow` (the house bottom sheet: an
input per player, "Auto-flight by index" with a count, Save = one PUT);
the roster row carries "· Flight A"; `FlightSegment` ("All · A · B") sits
above both boards and writes `?flight=`.

### Migration 207 and the cut's rules (PR 7)

The one DDL of phase 2 (above). `src/lib/sport-events/format-config.ts
parseFormatConfig(body, {roundCount})` is strict — an unknown key is a 400
naming `format_config.<path>`; the cut needs `after_round` in
1..roundCount − 1 and EXACTLY ONE of `top_n` (1..500) or `to_par`
(−20..40); `readFormatConfig` reads a stored row tolerantly (never
throws); `cutLabel` is its English. `cut.ts applyCut(rowsThroughK, rule)`
decides who plays on from the standing through round K — the top N by
rank (ties at the nth place ALL make it — shared ranks are the one
ranking rule) or everyone at or under a to-par; the unranked miss; the
line carries the cut score. `cutDecided` (the round after which it falls
is completed) and `cutEditable` (no round up to it completed) are the
gates PR 8 wires into the mint, the board and the PATCH.

### Breakdowns (PR 9)

`src/lib/sport-events/breakdown.ts playerBreakdown(holes, holeData,
range)` — front / back, par 3s / 4s / 5s (6s), eagles → double-plus,
putts, fairways (never on a par 3), greens, penalties — over the SCORED
holes within the round's range; an off-catalog round scores against par
4; reuses `calcPlayerTotals` / `holePar` / `classifyScore`.
`aggregateBreakdowns` is a tournament's "All rounds"; `eventHardestHoles`
is the average over par per hole across every card (two cards at least
— one player's blow-up is not the hole's), hardest first. The route
computes it on read (`breakdown-server.ts fetchBreakdown`). On the page
every board row is a button (the bubble language) to `BreakdownWindow`
(the house bottom sheet: a `HoleStrip` per round — OUT / IN / TOTAL in
the house ring classes — then the tiles, a tile hidden when nothing was
tracked; "This round / All rounds" on a tournament) and
`HardestHolesPanel` sits under the board (three cells, "Show all").

### Regroup by standing (PR 10)

`groups-editor.ts groupsByStanding(rows, {groupSize, order, teeTimes?})`
lays a later round's groups from the overall board: the missed-cut set
is left out; the standing is the ranked players by rank (ties keep the
board's order) with the unranked at its end; leaders_last (the PGA norm
— the leaders in the last group, the worst out first) reverses it,
leaders_first keeps it; chunks of the group size with the SHORT group
first to tee off; "Group n", hole 1, tee times spaced from the first
when given. The Groups tab offers it on a round after a completed one
(size · order · first tee time · interval); the draft is replaced (a
confirm when groups were arranged), Save is the same PUT, the mint
honours it.

### The feed and the lists for N rounds (PR 11)

`feed.ts`: the label select carries the round's `sequence` and `status`;
`applyRoundCounts` stamps `round_count` from ONE grouped read per feed
page (behind the same branch as the labels); `postEventState` reads the
ROUND's status — a round-2 post is announced while round 1 is live, final
once its round completed; `roundLabelOf` is "Round 2 of 3" on a
tournament and nothing on a single round. `EventAnnounceCard` shows it
beside the state; `PostCard`'s chip reads "From {name} · Round 2". The
events list (`GET /api/sport-events?scope=`) carries `rounds: {count,
completed, live_sequence}` per event from one grouped read; `EventCard`
adds "Round 2 of 3 live" / "Final · 3 rounds" / "n rounds"; the
Leaderboards place links a tournament to `?tab=leaderboard&round=overall`
(`leaderboardHref`).

### The waitlist (PR 12)

Positions are RE-PACKED 1..n after every change (`join.ts repackWaitlist`;
the one writer is `join-server.ts writeWaitlistOrder` — phase 1 appended
max + 1 and never re-packed, so a queue read #1, #4, #7); an organizer may
PROMOTE a waitlisted player now (`planJoin('promote')` — the field goes
one over the capacity by their choice; later accepts still waitlist) and
REORDER (`moveWaitlistTo`, the PATCH's `waitlist_position`); a waitlisted
player sees how many are ahead (`view.ts projectViewer` →
`viewer.waitlist_ahead`; the header reads "Waitlisted #3 · 2 ahead", the
roster row "You're next"); a queue place is between the player and the
organizer — `visibleParticipants` hides OTHER people's waitlisted rows from
a non-organizer, the count still rides on `counts.waitlisted`.

### The cut and the round names wired (PR 8 — after 207 ran)

`EVENT_COLUMNS` / `ROUND_COLUMNS` name 207's columns from this PR on. The
event PATCH takes `format_config` (validated against the non-cancelled
round count; allowed while live for the format alone; `cut_already_passed`
once the round it follows completed); the view carries `format_config`
(read tolerantly). The overall fold applies the cut once it is decided
(`applyCut` over the standing THROUGH round K — the missed-cut set ranks
below the line, never "missing" the rounds it was not in; `cutLine`), the
round mint EXCLUDES the missed-cut set from every later round
(`mintRound {excludeParticipantIds}` from the overall board — never
stored), and an invite past a decided cut is refused. A round's `name`
rides the create / add / edit bodies (1..40), the header line ("Round 2
of 2 · Final · …"), the switcher's pill and the schedule. The Overview
shows the cut line and, for organizers of a tournament, the **Format
settings** door (`FormatSettingsWindow`: on / after round / top N or
to-par; locked once made); the overall board draws the cut line and a
"cut" mark on the missed rows.

## Phase 2 status

Complete (Sep 16 2026): #750 and the stack #751 → #760 (12 PRs; migration
207 the only DDL — PR 8, the cut and round names wired, is the last, after
207 ran). Every PR verify-green and e2e-green locally (mobile specs on
Chromium and WebKit); each prod-probed after its merge. Phase 2b (contest
stamping, the calendar overlay + .ics + reminder bell, the per-hole
version, the five-tab bar) is DECIDED and specified in the phase 2 plan
file; phase 3 (match play, brackets) starts from the parked list.

## Phase 1 status

Complete (Sep 16 2026): #732–#748, migrations 201–206. Phase 2
(tournaments: N rounds, flights, breakdowns) and phase 3 (match play,
brackets) start from the parked list below.

## Not in phase 1 (named, parked) — where each went

N rounds in the UI, per-round / overall leaderboard tabs, flights, breakdown
views → phase 2 (above). `contest_id` stamping for org-hosted events, the
calendar publication (+ the .ics download and the reminder bell), the
per-hole version column (the `client_seq` name dropped: the outbox is a
set of desired states, nothing to sequence), the five-tab bottom bar →
phase 2b (decided, in the phase 2 plan file). Match play and brackets →
phase 3. Also parked from phase 2: Stableford (the `format` CHECK, a
reverse sort through both computations, `mint.ts game_format`, a mirror
decision), a round reorder (the 201 UNIQUE is not deferrable), the
waitlist UNIQUE via an RPC re-pack, the `FOR UPDATE` accept race, the
flight bands editor (the rule exists).

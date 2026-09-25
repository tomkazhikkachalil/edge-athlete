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
| 210 | `sport_event_reminder.sql` | phase 2b (B2): `sport_event_reminder` joins the notifications type CHECK (the 205 shape, 65 values). The daily cron's `sportEventReminders` step bells every accepted participant of a round scheduled tomorrow, once per round (deduped on the bell's metadata); the sender tolerates a pre-210 CHECK (logs and skips) |
| 211 | `contests_sport_event_round.sql` | phase 2b (B1): `contests.sport_event_round_id` (FK SET NULL) + the partial UNIQUE — an org-hosted event counts toward one of the org's golf leaderboard competitions, one contest per round, ONE writer `contest-link-server.ts`; every read is 42703-tolerant and the golf-sync engine is guarded on it |
| 212 | `sport_event_match_play.sql` | phase 3 (PR 3): `sport_events.format` widens to `match_gross \| match_net` (DROP + ADD of the one named CHECK — a 23514 window, the app names the values only after it ran); `sport_event_group_members.side` (1 \| 2, NULL on a stroke round); `sport_event_matches` (posture A, one per group — concessions, sudden-death extra holes, an organizer decision, a bye, the outcome written once at completion, `version` the app-level CAS; status computed on read, never stored). Nothing reads any of it until `check:schema` says 212 ran |
| 213 | `sport_event_match_bell.sql` | phase 3 (PR 12): `sport_event_match` joins the notifications type CHECK (the 210 list verbatim + one; 66 values) — one type, three copies by `metadata.kind` (`set` on the draw, `won` / `lost` at completion); the senders are 23514-tolerant |
| 214 | `sport_events_open_joining_recorders.sql` | phase 4 (PR 3): `join_mode` widens to `open` (DROP + ADD of the one CHECK — the app names it only after it ran); `visibility` DEFAULT `public` (no UPDATE); `sport_events.self_entry` (the recording mode is derived: self \| recorder \| both); `sport_event_participants.recorder` (a named recorder on any accepted row, a follower included). Nothing reads the columns until `check:schema` says 214 ran |

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
| `scoring-authz.ts` | `scoring-authz-server.ts` | `scoringRight` — the via / client matrix over the card status; `resolveScoringRight` reads the row, the round, the event role + group and the card, and BOTH score routes (`api/golf/scorecards/[id]/scores`, `api/golf/participant-scores`) pick the client from its verdict; conflicts are PER HOLE since phase 2b (`src/lib/golf/hole-writes.ts` + `hole-scores-server.ts`, mig 209: `scores[].expected_version` → 409 `{conflicts: [{hole_number, current}]}`); `holeRangeFor` (an event round's own start and length). |
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
| `GET /api/sport-events/[id]/ics?token=` | the view's gate (may view) | the event as an .ics (phase 2b): one all-day VEVENT per non-cancelled round on its DATE, "Round n of N" in the title, the course as the location, `Content-Disposition: attachment`; the schedule's "Add to calendar". The subscribe feed stays rows-only |
| `PUT /api/sport-events/[id]/contest` | canManage AND `requireOrgManager(manage_competitions)` on the event's org; draft / open | `{competition_id \| null}` (phase 2b, B1): a golf leaderboard of athletes on the event's own org — one contest per non-cancelled round minted (idempotent; the accepted playing players entered), the refusals named (`linkRefusal`); `null` removes the link while no result exists (`results_exist` → 409); pre-211 → 503 `needs_migration` |
| `POST /api/sport-events` (+ `competition_id`) | the org gate | phase 2b: `competition_id` (needs `club_id` / `league_id`) is refused by name BEFORE any insert (`linkRefusal`) and mints one contest per round after the rounds (best-effort); the view carries `host_org` and `counts_toward` |
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
client; a hole's `expected_version` answers 409 with the current row (209); holes outside
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
| `tab-bar` `@mobile` (phase 2b, zero DDL) | the five places at 390 · the active one on /feed, /sports, /calendar and an event page · tappable · the body clears it · hidden on the wizard, on the scorer's screen and signed out · the drawer stays the superset · absent on a large screen |
| `sport-events-calendar` `@mobile` (phase 2b, zero DDL) | the host's calendar GET carries the round as `kind: 'sport_event'` (accepted, all-day on its UTC day) · an invitee's item is dashed (`invited`) · after accepting, B jumps to June 2030 at 390, the chip is there, a tap opens `/events/[id]?tab=schedule&round=` |
| `sport-events-calendar` `@mobile` (phase 2b, zero DDL) | the host's calendar GET carries the round as `kind: 'sport_event'` (accepted, all-day on its UTC day) · an invitee's item is dashed (`invited`) · after accepting, B finds it in the agenda at 390, a tap opens `/events/[id]?tab=schedule&round=` · the .ics download: one VEVENT on the date, the schedule's link, a stranger's 404 |
| `sport-events-reminder` (phase 2b, NEEDS 210 — self-skips before) | an inserted `sport_event_reminder` bell renders on the notifications page with its copy (the sender is cron-only; its planner is unit-tested) |
| `sport-events-contest` (+ `@mobile` for the pickers; phase 2b, NEEDS 211 — self-skips before) | a QA club with a golf net league + a hockey fixture · a two-round club event · PUT contest mints one contest per round on the rounds' dates with A entered · idempotent · the golf-sync engine refuses an event round's contest · the hockey competition → 400 `not_golf_leaderboard` · B → 403 · B joins and opts out · round 1 live → the contest `in_progress` · both score · complete → `club_recorded` results from the event's board, B counted with `roundRef.roundId` null and no golf round, the live round stamped, `/api/contests/[id]` shows both · unlink → 409 `results_exist` |
| `sport-events-scoring-conflict` `@mobile` (phase 2b, NEEDS 209) | B offline scores 2, 3, 4 · A posts B's hole 3 through the API · back online 2 and 4 land, 3 asks (the false-conflict regression) · the dialog names both scores · Keep mine = a CAS at version 2 · a fresh conflict · Keep theirs yields at version 3 |
| `sport-events-waitlist` `@mobile` (phase 2) | capacity 1: B waitlisted #1 → "you're next" in the header and on the roster · B cannot reorder · a bad place refused by name · Promote now from the Players tab → the field one over the capacity · a promoted row can no longer be moved |
| `sport-events-breakdown` `@mobile` (phase 2) | the API shapes (`?round=all` with the aggregate, `?participant=` narrows, a bad round param) · a board row opens the window · All rounds = two strips + summed tiles · This round from a round's board · the hardest holes name hole 2 |
| `sport-events-flights` `@mobile` (phase 2) | the Flights window from the Players tab · the chip on the roster · the segment and `?flight=` rank within the flight · a player's own PATCH refused · an unknown field and a stranger in the plan refused by name · the API's `?flight=` |
| `sport-events-tournament-page` `@mobile` (phase 2) | the `?round=overall` deep link and the switcher · the header's round line · Start round 1 from the schedule card · groups per round while round 1 is live · the scorecard follows the live round · Complete round 1 from the header (the event stays live, "Start round 2") · add a round from the window |
| `sport-events-overall` (phase 2) | two nine-hole rounds: round 1 totals and ranks · round 2 live (today / thru, the total moves, the not-started player's standing holds) · round 2 completed with a missed round → below the full field · movement · the stranger's 404 · the flight filter |
| `sport-events-rounds` (phase 2) | test 2: the round lifecycle — in order, one at a time, regroup round 2 while round 1 is live, `rounds_remaining`, complete round 1 (one mirror, no bell), add + cancel a round while live, complete the last round (the event completes: one bell, two mirrors) · test 1: create with three rounds · the phase-1 body · both shapes / an unordered list refused by name · add (appended; earlier date refused; the announce post) · edit keeps the order · delete renumbers · the last round stays · the cap |
| `header-create`, `round-invite` | the Create sheet's two doors; the plain shared round still scores |
| `sport-events-match-api` (phase 3, NEEDS 212 — self-skips before) | test 1: the config refusals by name · the defaults-filled `match` · the allowance PATCH · sides derived and sent · `format_config_stale` · a stroke event refuses `side` · `not_stroke_play` · test 2: no draw / a one-side group → `groups_incomplete` · a match card · one match row (a second start mints none) · `matches_undecided` even with the override · 4s vs 5s → the round completes without the override, the row `holes · 1 · 5&4`, every card final, the results bell on the Matches tab · test 3: the routes — GET (the stranger 404s; the boards refuse) · concede (the wrong side 403, a stale version 409, twice 400) · extra holes (too early, unknown participant, "11 holes") · `round_not_live` after · decide / clear / a conceded match / ONE bell |
| `sport-events-match-page` `@mobile` (phase 3, NEEDS 212) | Matches replaces Leaderboard (the old deep link → overview) · the format line · "Not started" · the disabled Complete with the open list · the Decide sheet · "wins 5&4" with the winner bold · Complete → the match wording → "The event is final." |
| `sport-events-match-card` `@mobile` (phase 3, NEEDS 212) | two columns · the back link → matches · "Not started" · no Submit · holes 1–2 through the grid → "All square thru 2" · B concedes hole 3 → "1 UP thru 3", the hole reads conceded · A concedes hole 4 from the strip → "All square thru 4" · holes 5–9 halved → the extra-hole editor → "wins · 10 holes" |
| `sport-events-match-pairs` `@mobile` (phase 3, NEEDS 212 + the four QA users) | four-ball: the Side control derives 1·1·2·2, three on a side flags the group, Save; four columns; the better balls halve hole 1, C & D win hole 2 · foursomes: two columns headed by the pairs; the captains' cards count, the partner's is never read |
| `sport-events-bracket` `@mobile` (phase 3, NEEDS 212 + the four QA users) | two same-day rounds · round 1 the losers concede, completes · Fill from winners → A vs C with the sides set · the bracket view's two columns, the conceded slot with the winner bold · the organizer decides the Final · "wins the bracket" |
| `sport-events-notifications` `@mobile` (phase 3 test, NEEDS 212 + 213 — self-skips before) | B's `set` bell on the draw (a re-save adds none), rendered on the notifications page · B concedes, the round completes → B's `lost`; A — the organizer who plays — has TWO bells, `set` and `won` |
| `sport-events-feed` (phase 3 test, NEEDS 212) | the announce card names the format and the round · B concedes the match, the round completes → the results card names the winner first, "def.", "conceded"; the API carries `match` + `match_results` |

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

## Phase 2b — the integrations (Sep 16 2026)

Decided with phase 2 (Tom: five tabs; opted-out players still count for the
org; the reminder bell; core first) and built as ten PRs on three
migrations, in landing order B3 → B4 → B2 → B1 — the plan file
`~/.claude/plans/let-s-start-phase-2-transient-fountain.md` Part B is the
verified spec.

- **B3 — the per-hole compare-and-set (209, #763–#765).** `golf_hole_scores.
  version` bumped by trigger only when a scored field changes; both score
  routes take `expected_version` per hole (0 = "I saw no score") and answer
  409 `{conflicts: [{hole_number, current}]}`; the outbox (v2, the v1 box
  converted) carries it, "keep mine" resends against `current.version` — a
  real CAS, never a forced overwrite — and the conflict names both scores.
  The old card-stamp guard (defeated by the 039 totals trigger) is gone;
  penalties ride only when named (every outbox save used to null them).
- **B4 — the five-tab phone bar (#766).** Feed · Sports · Live · Calendar ·
  Profile below `lg`, one active rule shared with the header
  (`src/lib/nav-active.ts`), mounted once in the root layout,
  `--ea-tabbar-h` measured, hidden on the screens that own their bottom
  edge (`src/lib/tab-bar.ts showsTabBar`).
- **B2 — the calendar (#767–#769, 210).** A participant's upcoming and live
  rounds as read-time items (`sport-event-overlay.ts`, never rows; a tap
  opens the event on that round; an invite keeps the dashed chip), the
  .ics download (`GET [id]/ics`, one VEVENT per round), the day-before
  reminder bell (`sport_event_reminder`, a step in the daily cron, once
  per round per person, 23514-tolerant).
- **B1 — org contest stamping (#771–#773, 211).** An org-hosted event
  counts toward one of the org's golf leaderboard competitions:
  `contests.sport_event_round_id` (one contest per round, ONE writer
  `contest-link-server.ts`, `PUT [id]/contest` or `competition_id` on
  create), the org's results written from the EVENT's leaderboard on
  round completion (`club_recorded` / `league_verified`; an opted-out
  player counts with `roundRef.roundId` null), the golf-sync engine
  GUARDED on the link, the console's "From event", the Overview's
  "Hosted for" / "Counts toward" (rows it never had), the contest place's
  "Played as".

## Phase 3 — match play and brackets (Sep 16 2026)

Plan: `~/.claude/plans/let-s-start-phase-2-transient-fountain.md` (the
phase 3 rewrite). Tom's decisions: singles + four-ball + foursomes, gross
or net; the organizer sets every draw by hand; a halved match goes to
sudden-death extra holes; a standalone match event AND a bracketed one; a
match round posts to the profile and the handicap as played; the match
bells ship in this phase (213).

**The one idea, extended.** A MATCH is a group with two SIDES on a
match-format round. The strokes stay on the cards (an opponent may mark;
the outbox and the per-hole CAS apply). What a card cannot carry lives on
ONE row per match, `sport_event_matches` (212): concessions, sudden-death
extra holes, an organizer's decision, a bye — plus the outcome written
ONCE at round completion. The match status is computed on every read
(`match.ts computeMatch`), never stored while live. A BRACKET is nothing
new: the rounds ARE the bracket rounds; match k of round n+1 is fed by
matches 2k−1 and 2k of round n by group `sequence` (`bracket.ts`).

| PR | what |
|---|---|
| 1 (#775) | the round's own field: `fieldFinal(cards)`; `roundFieldExclusions` shared by the mint and the completion gate; the board's field = the minted rows |
| 2 (#776) | the pure engine `match.ts` (status, playing handicaps, concessions, extra holes, the write refusals) + `bracket.ts` |
| 3 (#777) | migration 212 |
| 4 | the vocabulary: `match_gross \| match_net`; `format_config.match {sides, bracket, allowance?}` (strict; `cut` ⊕ `match`; the format is part of the parse); `event.match` on the view (defaults filled); the groups PUT takes a `side` per member (derived from the position for a plain id; refused by name on a stroke event); `not_stroke_play` for "counts toward"; the wizard's four formats + sides + bracket; `FormatSettingsWindow` hosts the match shape |
| 5 | the lifecycle of a match round: `groups_incomplete` at start (the draw complete; a bye on a bracket only), `matches_undecided` at completion (override never bypasses it; the cards never gate a match round); a match round fields ONLY its draw (`roundFieldExclusions`; a late acceptor waits for the next draw); `match-server.ts` — `fetchRoundMatches` (computed on every read), `mintMatches` (one row per group, idempotent; a bye decided at mint), `closeMatchesOnCompletion` (the outcome written once), `writeMatch` (the one CAS writer); the card reads `game_format 'match'`; the results bell → `?tab=matches` |
| 6 | the match routes: `GET [id]/matches?round=` (computed on read; `not_match_play` on a stroke event), `POST [id]/matches/[mid]/concede` (a member of the side or an organizer; `hole: null` concedes the match), `…/extra-hole` (any member; `n` the next), `…/decide` (organizers; `null` clears their own) — one preamble (`match-write-server.ts`: the round must be live), every write a CAS on `version` (409 `conflict` = re-read and replay); the leaderboard + breakdown routes answer 409 `not_stroke_play` on a match event; `client.ts` `matches` / `concede` / `extraHole` / `decideMatch`; the pure projection `match-view.ts` |
| 7 | the Matches tab (`@mobile`): `matches` replaces `leaderboard` on a match format (`tabsFor({matchPlay})`; an old leaderboard deep link → the overview); `?round=bracket` on a bracket event (`offersBracket`); `EventMatchesTab` — rows with the engine's summary and the winner bold, refreshed while live, the organizer's Complete (disabled while a match is open; the match confirm copy, NO override) and the Decide sheet; the scorecard tab's Complete hides on a match round; `RoundSwitcher` "Bracket" pill |
| 8 | the group card's MatchStrip (`@mobile`): the scorecard GET's `sport_event.match` (the viewer's match, computed on read; `side_of_viewer`; the members' `side`); the columns are the counting cards (`matchColumns`; foursomes → the captains headed "A & B"); the strip — the engine's status line, "Concede hole n" for the viewer's side on the selected hole, "Concede the match"; a conceded hole's row says so; the extra-hole editor (a wheel per counting player, saved through the match route with its `version` — never the outbox); never "Submit my card" on a match round; the back links → `?tab=matches` |
| 9 | pairs (`@mobile`): FOUR QA users per run (`global-setup.ts`; `openEventSession` `apiC` / `apiD`; `inviteAndAcceptAs`); the groups editor's Side control (`groups-editor.ts` `setSide` / `sideInEditor` / `editorGroupsIncomplete`; the PUT body carries `{participant_id, side}` on a match format), "Match n", the incomplete flag, "Group by standing" hidden; four-ball's better ball and foursomes' captain card proven end to end |
| 10 | brackets (`@mobile`): "Fill from winners" on a bracket round after a completed match round (`drawFromWinners` → the sides set, "winner of match n" on an empty side, an odd tail a bye); `BracketView` at `?round=bracket` (`bracketColumns` — a column per round, the slots named, the winner bold, the Final's winner); same-day bracket rounds are legal |
| 11 | the feed + the docs close: the label carries the round's `name`, the event's `format` and `match`; the announce card prints "Match play · Singles · Gross" and the round's name; a COMPLETED match round's post leads with `EventMatchResultsCard` (one line per match, the winner first, "def.", the result — never the stroke totals; `feed-server.ts applyMatchResults` behind the existing round branch, one matches read per such round); CLAUDE.md convention 19; `docs/SESSION_PROMPT.md` |
| 12 | the match bells (migration 213): `set` to every member of a complete match whose match changed with the save (`match-bells.ts matchSetRecipients`; `notifyMatchSet` from the groups PUT), `won` / `lost` to each member of a decided match at completion (`notifyMatchClosed`); the action URL → the round's Matches tab; 23514-tolerant |

## Phase 4 — every sport live, open joining, recorders, media (Sep 16 2026 — #792–#803, migrations 214 · 215 · 216; ONE chain, awaiting Tom's merges + the three migrations, then the prod probes)

Plan: `~/.claude/plans/let-s-start-phase-2-transient-fountain.md` (track 1).
Tom's decisions: every enabled sport (golf keeps its cards; the stat-line
sports get LIVE per-player stats); a team event is a GAME (two ad-hoc
sides from the joiners + a live score) or a SESSION (one roster), chosen at
creation; the organizer picks the recording mode (named recorders —
anyone, playing or not — and/or self-entry); joining FULLY OPEN unless
closed — new events default public, viewable signed out, a participant's
EVENT stats public even with a private profile (the masked name + their
line, never the profile); live media by participants and spectators in a
gallery on the event page.

| PR | what |
|---|---|
| 1 | anonymous reading: `canViewSharedRound` admits a null viewer on a PUBLIC round; the scorecard GET's auth is optional; `/live/[gp]` watch mode signed out (a 401/404 → sign in with `?next=`); `joinControl` `signin` ("Log in to join"); `EventPlayerSheet` — the masked name, the role, this event's line; "View profile" only when the profile is public |
| 2 | the live bell + Live Now for events: `notifyLive` (followers, once per round, no actor) from the round's `live` transition; `GET /api/sport-events/live-now[?count=1]` (public live events for anyone, signed out included, plus the viewer's own; `live-now.ts liveEventCards`); `LiveNowStrip` event cards; `useLiveNow` merges the two counts |
| 3 | migration 214 — the phase's first DDL, alone |
| 4 | open joining (the first 214 reader): `join_mode` `open`; `planJoin('join')` (a follower converts, an invited player accepts, a removed row stays out, a full field waitlists, live offers Follow); `POST [id]/participants/join` (a block → 409, never who); `joinControl` `join`; the defaults public + open (`parseCreateBody`, `defaultJoinMode`, the wizard's `withVisibility`); "Open to everyone" |
| 5 | recorders (the second 214 reader): `recording.ts recordingModeOf` (derived from `self_entry` + the named recorders — never stored); `scoringRight` via `recorder` on the admin client (in-progress and submitted, never final) and `recorder_only` (403 by name) for the owner / a partner when `self_entry` is off; `resolveScoringRight` reads both facts; the live page's `record` mode + `GroupSwitcher` (`?group=`) + the no-confirm recorder rule on `GroupScoreCard`; `PATCH participants/[pid] {recorder}` (organizer, accepted rows), `POST participants {recorder: true}` ("Invite as recorder"); the roster chip + toggle, the overview's Recording row, the wizard's "Who enters the scores" |
| 6 | the team engine, pure (zero DDL): `SPORT_EVENT_STAT_SPORTS` + the shape vocabulary (`shapeOf`), `format_config.game` (two distinct side names; `cut` / `match` refused on a team event), `stats.ts` (the schema is the vocabulary — refused by name, never clamped; `applyIncrement`, `topLines`), `game.ts` (result / result_score from a side, `parseScoreWrite`), `stats-authz.ts` (rights from the ROUND status; the score is a recorder's / organizer's), `stat-outbox.ts` + `stat-flush.ts` (one desired state per LINE), `tabsFor({shape})` → Stats, the wizard's sport / shape / side names / team round draft. The create list stays golf until 215 ran |
| 7 | migration 215 — `sport_events.shape` (+ the two CHECKs), the round's `starts_at` / `side1_score` / `side2_score` / `period` / `score_version`, `sport_event_stat_lines` (posture A); the twin. Alone; no reader |
| 8 | team events created and run (the first 215 reader): every event sport + the `shape` in `parseCreateBody` (golf ⇔ round; `format` refused off golf), a team round = a place + `starts_at`, the columns, the view's `shape` / `game` / score, sides on a game's groups (sent, never derived), `roundMinted` = a group post OR the lines, `mintStatRound` at go-live, `syncStatLineForPlayer`, `GET rounds/[rid]/stats` (anonymous on public; polled), `PUT stats/[lid]` (whole-line CAS), `PUT score` (`score_version` CAS); the wizard's sport + kind + `GameFields` + sides, the Stats tab (read-only board), the live bell / Live Now → `?tab=stats` |
| 9 | the live stat screen `/events/[id]/live?round=` (zero DDL): `useRoundStats` (polled 5 s live / 30 s), `useStatOutbox` (one desired state per line; keep mine = a real CAS resend), `StatEntryStrip` (−/+ chips, `applyIncrement`), `ScoreControl` (`score_version` CAS per tap), `EventLiveScreen` (server-first for a public event; a stranger watches; the strip owns the bottom edge — `showsTabBar` hides), the Stats tab's door, Live Now + the live bell → the screen on a team shape |
| 10 | completion for stat rounds (zero DDL): `stat-results.ts` (one `stat_line` post per played line, found by `sport_event_stat_line_id`; the round post → `sport_event_results`; `provenanceForLine`), `mirrorStatRound` (posts → `athlete_performances` via `fromStatLinePost` + the overlay → the round post), `applyStatOptOut` behind the one opt-out, the feed label's `shape` / live score / sides, `EventResultsCard`, the results bell → `?tab=stats` |
| 11 | migration 216 — `sport_event_media` (posture A: event + optional round, the uploader + the guardian's attribution, url / type / thumbnail / duration / caption, `mirrored_at`); the twin. Alone; no reader |
| 12 | media (the first 216 reader) + the docs close: `media.ts mediaRight` (add = any accepted row or an organizer; remove = the uploader or an organizer), `parseMediaBody`, `projectMedia`; `readEventMedia` (the proxy's `sport_event` entity — `authorizeMedia` re-runs the event gate), `mirrorEventMedia` at completion (`post_media`, deduped, `mirrored_at`); `GET/POST [id]/media`, `DELETE [id]/media/[mid]`; the Gallery tab (everyone; polled 10 s while live; Capture v2 attach-first; the lightbox); CLAUDE.md convention 20; SESSION_PROMPT |

**What phase 4 settled (the rules, each pure and pinned in `src/lib/sport-events/`):**

- **Anonymous reading**: a PUBLIC event — its rounds, boards, stats, gallery and the live pages — answers a signed-out reader (`canViewSharedRound` admits a null viewer on a public round; the scorecard GET's auth is optional); a private event is the same 404 to a stranger; a name on the roster opens the in-event sheet (the masked name + this event's line), never the profile unless it is public.
- **Open joining** (214): `join_mode` `open` = one-tap Join for any signed-in person (`planJoin('join')`: capacity and the waitlist apply; a removed row stays out; a block is a 409 that never says who); NEW events default public + open (the DB default, the parsers' fallbacks, the wizard — `defaultJoinMode(visibility)`); existing events untouched.
- **Recorders** (214): two facts, a DERIVED mode — `sport_events.self_entry` + `sport_event_participants.recorder` (on ANY accepted row; a follower row with `recorder` is the non-playing recorder) → `recordingModeOf` self | recorder | both, never stored. `scoringRight` / `statEntryRight`: a recorder enters for everyone on the admin client; `self_entry: false` refuses the owner and a partner by name (`recorder_only`); organizers as always; a final golf card is organizers-only. The golf recorder's screen is `/live/[gp]` with the group switcher; the stat recorder's is `/events/[id]/live`.
- **The shape on the EVENT** (215): `round` (golf) | `game` | `session`, one decision at creation, golf ⇔ round both ways; `format` and `format_config.cut / match` are golf vocabulary (refused by name off golf); `format_config.game` names a game's two ad-hoc sides (Home / Away by default — an org's default teams pre-fill them later); a team round is a PLACE (`course_name`) + an optional `starts_at`; a GAME's groups carry sides (sent 1 | 2 or left open — never derived; any size).
- **Live stats** (215): `sport_event_stat_lines` — ONE row per fielded player per round, minted at go-live (`roundMinted` = a group post OR the lines; nothing golf-ish, no group post); the vocabulary is the sport's `STAT_SCHEMAS` through the one validator (refused by name, never clamped); a line has NO status — rights come from the ROUND's status; every write is the WHOLE object under an app-level CAS (`version`; a 409 carries the current line); the game score lives ON the round under `score_version`. Posture-A tables emit no realtime — the poll IS the live feed (5 s live / 30 s idle); the stat outbox is the golf outbox's shape (one desired state per LINE; keep mine = a real CAS resend).
- **Completion for a stat round**: one `stat_line` POST per played line (the existing shape; found by `stats_data.sport_event_stat_line_id` — never `posts.sport_event_round_id`, 203's UNIQUE), the performance row through `fromStatLinePost` (the origin IS the post) with the event's provenance (`provenanceForLine`: an org-hosted event's recorder / organizer entry is the org's, else self-reported), the round's ONE post → `sport_event_results`; the opt-out branches on the shape (`applyStatOptOut`).
- **Media** (216): `sport_event_media` is posture A behind the ONE event gate (never `group_post_media`); add = any accepted row (followers included) or an organizer; remove = the uploader or an organizer; the proxy's `sport_event` entity re-runs the event gate per byte request; the completion mirror rides the round's post once (`mirrored_at`). No tagging; org photo consent governs org galleries only.
- **Doors**: the live bell (followers, once per round, no actor) and Live Now open the board (golf), the matches (match play) or the live stat screen (a team shape); the results bell → the leaderboard / the matches / the Stats tab.

**Parked, named:** `track_field` events (a meet is its home — track 2), pools / pool play → knockout, relays, a supervised player's per-photo guardian bell, realtime broadcast as a wake-up for the stat poll, the venue-timezone class for a team round's start (the organizer's clock today), Stableford, an org-side default-team roster pre-filling an event's sides (the ad-hoc shape is built for it).


## Competition formats — the bridge (track 2, Sep 16 2026 — #806–#816, migrations 218 · 219 · 220)

Plan: `~/.claude/plans/let-s-start-phase-2-transient-fountain.md` (track 2).
The org side's four formats (fixture · leaderboard · bracket · meet) and the
event world meet on ONE contest through TWO doors. The rules, each pure and
pinned (`src/lib/sport-events/contest-link.ts`, `src/lib/competitions/`):

- **The sport profile decides format × entrant** (`src/lib/sports/competition-profiles.ts`, pure data — never `SportAdapter`): the scoring defaults read it, `FORMATS_LIVE` gates creation, the organizer names an entrant kind only when the profile offers more than one; `track_field` offers the meet with the `TRACK_EVENTS` vocabulary.
- **Stages are two columns on `contests`** (218: `stage`, `slot`; `round` stays the label): slot k of stage n+1 is fed by slots 2k−1 and 2k of stage n — BY SLOT, never by id (the same rule the events bracket runs on). A meet uses the pair too (stage = session, slot = order).
- **A bracket**: seeds (the FULL order), a generator (dry-run first; byes never contests; `results_exist` refuses a regenerate), advancement by slot after every result, NO `decided_by` column — a knockout tie carries its decision IN the result (`payload.advance`), so `deriveContestOutcome` stays the one ranking rule; the standings are the progression.
- **A meet**: ONE competition whose EVENTS are contests; a mark is the result (`score` in the event's direction, `payload {mark, unit, event_key, wind?, dq?}`); the team score is a roll-up per AFFILIATION (`competition_entries.affiliation_team_id`, snapshotted at entry from the team-scope roster, organizer-editable) whose rows are TEAM entries minted at recompute; one `contest_stat_lines` row per athlete per event → the performance row.
- **Ad-hoc sides** (219): an entry with `name`, `source_ref` and `competition_entry_members` — the shape an org's default team shadows later (`SET team_id` promotes it; the name stays the label, the members "who played"). ONE naming rule at every reader (`entryDisplayName`).
- **The shape table** (`eventShape` → stroke · match · game · session; `competitionAcceptsShape`): a stroke round counts toward a golf leaderboard of athletes (2b); a GAME toward a fixture of named sides in the same sport; a session toward nothing; a match round reaches a golf bracket from the CONSOLE side.
- **Door 1 — event → competition** (`PUT [id]/contest`, the create body's `competition_id`): a game mints ONE fixture contest per round between the event's two AD-HOC side entries (`source_ref sport_event_side:<event>:<side>`; a standing side of the same NAME is reused; members = who played, from the groups' sent sides).
- **Door 2 — contest → event** (`POST …/competitions/[id]/contests/[contestId]/event`): a two-sided fixture in a stat-line sport → a one-round GAME event; a golf bracket contest → a single MATCH-PLAY round (athletes → singles, ad-hoc pairs → four-ball; gross or net; a catalog course or off catalog). Hosted for the org by the manager (a non-playing organizer), every side member accepted and playing, ONE group with the sides SENT, published at once; `contests.sport_event_round_id` stamped through the one writer. Refusals named.
- **The links** (211 + 220): a contest mirrors a ROUND (`sport_event_round_id`, one contest per round) or a MATCH (`sport_event_match_id`, one contest per match) — never both (220's CHECK). A match's contest takes the minted match at go-live (the round link cleared); "counts toward" reads either link.
- **Completion**: `syncSportEventContest` branches on the shape — stroke → the 2b path; game → `syncGameContest` (the LIVE score as the two results, the players' event lines as the org's `contest_stat_lines` — the performance row STAYS the event's `post:` origin, never a second origin per game — the sides' members re-synced, the team-score stat vs the score reported); match → `syncMatchContests` (the winner 1, the loser 0, `payload.match`, the sides matched by the players, the bracket advanced by slot). Then the golf-sync order: status → standings → site → attachments.
- **The guards**: `resultsUpsertPOST` and `statLinesUpsertPOST` answer 409 `from_event` on a linked contest (a round's or a match's).

**Parked, named (Sep 16) → closed by the leftovers program (Sep 17, below):** pools / pool play → knockout ("Seed from standings"), relays, a whole bracketed match event linking to an org bracket in one act, an org's default-team roster pre-filling an event's sides, the meet's per-session calendar publication.


## Events + formats leftovers (Sep 17 2026 — #820–#831, migration 221)

Plan: `~/.claude/plans/let-s-start-phase-2-transient-fountain.md` (the leftovers
program). Seven of the bridge's nine leftovers, one migration (221: the format
CHECK widened to six, `sport_events.competition_id` + its partial index,
`sport_event_rounds.timezone` + its length CHECK). The rules, each pure and
pinned:

- **Pools** (`src/lib/competitions/pools.ts`): a pool is a letter on the ENTRY (`competition_entries.pool`, 151's column; `stats.pool` carries the 1-based index — `StandingRow.stats` is numeric); `computePooledFixtureStandings` ranks WITHIN the pool through `computeFixtureStandings` (a cross-pool game counts in neither table; the unpooled entries one flat table; ONE row per entry always — the prune keeps only returned rows); the round-robin is generated PER POOL (the circle method, home / away balanced by the fewer-homes rule; dry-run first; the played pairs skipped — never published, no stage / slot); "Seed from standings" copies the top n of each pool CROSSED (A1, B1, …, A2, B2, …) onto an undrawn bracket of the same org, sport and entrant kind through the one seeds writer (`writeSeeds`, extracted from `seedsPUT` which stays bracket-only). The entries PATCH dispatches by key — one intent per call.
- **Relays** (`RELAY_EVENTS` in `competition-profiles.ts` — never in `TRACK_EVENTS`, which the stat schema and the PB tiles share; pinned): a relay team is an AD-HOC entry of legs with the common team as its affiliation; a meet's entry add dispatches on the BODY's kind (`entrant_type` stays `athlete`); marks are admitted by kind (`meetEntryAdmitted`); a relay writes NO stat line and no performance row; the roll-up counts it.
- **Meet sessions on the calendar** (`calendar-mirror.ts`): ONE `events` row shared by a session's contests (`contests.event_id` a plain FK; `publishSessionToCalendar` idempotent — a mix answers `session_split`); the shared-event rule: `mirrorContestChange` applies only `sharedMirrorAction` (life or death, never a clock change), `mirrorContestDelete` deletes only when unreferenced, a new event minted into a published session ADOPTS it; the console hides the per-contest publish on a meet.
- **Default teams pre-fill a game's sides** (`format-config.ts GameConfig.side_team_ids`, set at creation only; `side-prefill-server.ts`): the rosters' accepted + playing participants (the organizer's field — never `planJoin`), ONE group per round with the sides SENT, a player on both plays home; the wizard's two team picks fill the names.
- **Stableford** (`stableford_gross` / `stableford_net` — Tom: both flavours): points on EVERY row through the net allocation (`leaderboard.ts`), ONE ranking rule `rankingKeys(format)` for both boards and the cut (points descend and share a rank, strokes ascend order-only; stroke play byte-identical), `applyCut(rows, rule, direction)` (the line is the MIN on a descending format; `to_par` refused by name — `top_n` only), `formatConfigStale` for the PATCH; the shape table refuses `points_format` (the org's leaderboards count strokes); the mirror keeps strokes; the card's `game_format: 'stableford'`; the boards' Pts · Strokes columns (a swap, never an add — the cut divider counts columns).
- **The bracket door in one act** (`contest-link.ts`, `contest-link-server.ts`): a BRACKETED match event counts toward a golf BRACKET of athletes or ad-hoc pairs (`competitionAcceptsShape('match')`; a plain match event `not_a_bracket`; a non-bracket target `not_golf_bracket`; the drawn stage count must equal the non-cancelled round count — `bracket_shape`, `bracket_not_drawn`); NOTHING minted at link time — the intent lives on `sport_events.competition_id` (221; written ONLY by this path), and at each round's go-live match k (group sequence) of round n (sequence) is stamped onto the contest at (stage n, slot k) — `slotForMatch`, the ONE place — when that contest has no result and no other match (`matchLinkPlan`: stamp · `no_slot` · `has_result` · `already_linked` · `already`; each stamp guarded on `sport_event_match_id IS NULL`, 220's UNIQUE turning a race into `already_linked`); a draw that disagrees with the org's is REPORTED (`sidesAgree`, `payload.match.draw_mismatch`, the console's badge note), never a gate; the unlink clears every stamp and the intent while no result exists; the view's `counts_toward` names the bracket before go-live and lists the stamped matches after; the console's slots say "Played as event".
- **A round's own timezone** (`calendar/time-zones.ts` the ONE validator; `format.ts formatTeeTimeIn` / `startTimeLine`): a team round's start is read on the ROUND's clock (`wizard.ts zonedStartIso` through the calendar's offset solver; `parseRoundInput` validates `timezone` by name; the snapshot writer copies it); the four surfaces print the venue's wall clock with the viewer's beside it ONLY when the zones AND the wall clocks differ (venue-time.ts's rule); the .ics is a TIMED VEVENT on UTC instants naming the venue time; the calendar overlay's item is timed in the ROUND's zone when the viewer has no tee time; the reminder appends the venue time. Nullable = the viewer's clock (today's behaviour); a zone on a golf round is parked.

**Parked, named:** the per-photo guardian bell and realtime as a wake-up for the stat poll (Tom, Sep 17); countback on a Stableford tie; a relay standings table of its own; a zone on golf rounds; `competition_id` for stroke / game events (they keep 211's contest rows).


## When a person leaves (Sep 24 2026, migration 238)

Tom's rule: a result that is part of an event OUTLIVES the person, and no
one else's results change because someone left. The deletion engine
(`src/lib/account-deletion.ts`, the rules in `src/lib/account-departure.ts`)
keeps a departing adult's `profiles` row as a name-only **tombstone**
whenever anything of theirs is tied to other people — an event
participation, a hosted event, a shared or event-minted round, a card on
someone else's round:

- **The field stays.** `sport_event_participants`, `sport_event_stat_lines`,
  the cards (`group_post_participants` → `golf_participant_scores` →
  `golf_hole_scores`) and the matches keep pointing at the same id, so the
  board, the breakdown, the overall fold and the match view are unchanged.
- **The name is the full name**, as text: `publicDisplayName` answers a
  departed row's full name and `publicHandle` nothing, so no roster card,
  board row or player sheet links to a profile that is gone.
  `ParticipantView.departed` lets the page render "Hosted by <name>" as
  plain text (`EventHeader`'s `hostDeparted`).
- **The event keeps its host.** `sport_events.host_profile_id` and the
  minted round's `creator_id` point at the tombstone; a co-organizer keeps
  running a live event. No new delete right is granted — a finished
  event's results are exactly what the rule protects.
- **Nobody is left unable to run an event:** an account cannot be deleted
  while it is the only host / accepted organizer of a draft, open or live
  event (`src/lib/account-sole-authority.ts`, a 409 from
  `/api/account/delete`). The creation-time "two accounts" rule is the
  next round.
- **Posts:** the event round's announce / results post (the
  `sport_event_round_id` feed card) stays; the person's own posts go.
- **A supervised athlete** follows the consent the guardian signed: v2 →
  erased (the event passes to a co-organizer first; a decided match keeps
  its written outcome — `match.ts`'s `written` input — so the opponent's
  win stands); v3 → a masked tombstone named "Athlete".

## Phase 3 status

Complete (Sep 16 2026): the chain #775 → #786 (migrations 212 · 213) and
the follow-ups #787–#790 from the first prod probes (the won / lost bells
speak in full names and reach an organizer who plays; two spec
expectations about masking; the pairs / bracket / routes specs get the
time prod needs). Every PR verify-green; every phase 3 spec green on prod
— the API, the feed, the Matches tab, the match card, pairs, the bracket,
the bells — on Chromium AND WebKit at 390. Parked: an org-side bracket
(the masterplan's own program), a match event counting toward a
competition (`not_stroke_play`), Stableford.

## Phase 2b status

Complete (Sep 16 2026): #763–#773, migrations 209 · 210 · 211. Every PR
verify-green; the e2e specs self-skip before their migration; each
prod-probed after its merge. Parked: Stableford, a round reorder, the
waitlist UNIQUE via an RPC, the `FOR UPDATE` accept race; phase 3 (match
play, brackets) starts from the parked list.

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

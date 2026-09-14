# Events and Tournaments — the reference

**Status:** phase 1 in progress (Sep 16 2026). Plan:
`~/.claude/plans/let-s-start-the-policy-lucky-widget.md` (the approved
16-PR sequence). This file is the durable reference; it grows with each PR.

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

Posture A on every new table (RLS on, zero policies, REVOKE from anon and
authenticated): the service client behind `resolveSportEventAccess` is the
only reader; a refusal is the same 404 as not-found.

## The library — `src/lib/sport-events/`

Pure halves (node-tested) and `*-server.ts` I/O halves, one concern each:

| pure | server | the rule |
|---|---|---|
| `access.ts` | `access-server.ts` | `resolveSportEventAccess` — THE ONE GATE. Public → everyone; link → the token, an admitting participant, or the host; private → any non-declined / non-removed participant (followers included) or an organizer. `null` = 404. |
| `lifecycle.ts` | `lifecycle-server.ts` | draft → open \| cancelled; open → live \| cancelled; live → completed; named refusals; the organizer override. `applyTransition` compare-and-sets the status; open mints the POST, live mints the ROUND (`mintRound`, idempotent), completed finalizes / mirrors / re-timestamps, cancelled deletes the announce post. `syncRoundRoster` keeps a minted round's roster in step after go-live. |
| `join.ts` | `join-server.ts` | `planJoin` for the ten actions; seats = accepted AND playing; full → waitlisted; a vacancy or a capacity raise promotes lowest position first; a follower may be invited. |
| `handicap.ts` | `handicap-server.ts` | the frozen index at accept (`snapshotAtAccept`; an organizer override is never overwritten); the read-time course handicap. |
| `leaderboard.ts` | `leaderboard-server.ts` | the one computation; `fetchRoundLeaderboard` reads the field, the cards and the names (`leaderboard-rows.ts`, pure) and computes on every request — nothing stored. |
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
| `POST /api/sport-events` | signed in (acting-as ok) | name, description, visibility, join_mode, format, capacity, club_id \| league_id (`manage_competitions`, never acting-as), `round {scheduled_on, course_id, course_name, tee, holes, starting_hole}`, `host_plays`, `publish` → the header, round 1 (catalog snapshot), the host's organizer row; a link token for `link` |
| `GET /api/sport-events?scope=mine\|hosting\|upcoming\|live\|past` | signed in | the viewer's events (host or a non-declined / non-removed row), ≤ 100 |
| `GET /api/sport-events/[id]?token=&as=` | optional auth → 404 | `{event, rounds (+ group_post_id), participants, groups, counts, viewer}` |
| `PATCH /api/sport-events/[id]` | canManage; draft / open | the editable fields; a capacity raise promotes; `visibility: 'link'` mints a token |
| `DELETE /api/sport-events/[id]` | the host; draft / cancelled / completed | a minted round detaches (203 SET NULL) |
| `POST /api/sport-events/[id]/link-token` | the host; `link` | rotate |
| `POST /api/sport-events/[id]/participants` | canManage; draft / open | `{profile_ids, handles}` → invites; blocked skipped silently; the supervised invite dial; `{invited, skipped: {unknown, blocked, supervised, existing}}` |
| `POST /api/sport-events/[id]/participants/request?token=` | may view; open + `request` | a join request → the organizers' bell |
| `POST /api/sport-events/[id]/participants/[pid]` `{action}` | self: accept \| decline \| withdraw; canManage: approve \| reject \| remove | the plan from `planJoin`; an accept freezes the index; `{participant, promoted}` |
| `PATCH /api/sport-events/[id]/participants/[pid]` | `handicap_index` canManage (null clears + recomputes); `hide_from_profile` self; `playing` self or canManage | stepping out promotes the waitlist |
| `POST` / `DELETE /api/sport-events/[id]/follow?token=` | may view | a follower row; never a seat |

| `POST /api/sport-events/[id]/transition` `{to, override?, today?}` | canManage | open · live · completed · cancelled; a 409 carries the named `reason` |
| `PUT /api/sport-events/[id]/rounds/[rid]` | canManage; draft / open | the round's plan; re-snapshots the catalog; rewrites `starts_on` |
| `PUT /api/sport-events/[id]/rounds/[rid]/groups` `{groups: [{name?, tee_time?, starting_hole?, members}]}` | canManage; draft / open | the whole plan replaced |

The scorecard GET (`/api/group-posts/[id]/scorecard`) answers `sport_event`
for an event's round; the feed lists an event's round from Open (one post,
three states); the abandonment sweep leaves an event's round alone.

| `POST /api/sport-events/[id]/cards/[pid]/submit` | the card's owner; live | `submitted` + `submitted_at` + `scores_confirmed` ([pid] = the round's `group_post_participants` row) |
| `POST /api/sport-events/[id]/cards/[pid]/finalize` `{reopen?}` | canManage; live | `final` + `finalized_by` (a never-scored player's row is created final); `reopen` → `in_progress` |

Scoring on an event round goes through the EXISTING score routes with one
more gate: a same-group partner or an organizer writes on the admin
client; `expected_updated_at` answers 409 on a newer card; holes outside
the round's range are refused by name.

| `GET /api/sport-events/[id]/rounds/[rid]/leaderboard?token=` | may view | computed on read; `private, max-age=5` signed in, `s-maxage=10` anonymous on a public event |

The results: on completion the round is mirrored into every player's
`golf_rounds` (the profile, the handicap, the dataset) EXCEPT players
with `hide_from_profile`; the flip is theirs alone (`PATCH …/participants/
[pid] {hide_from_profile}`), before or after completion.

## Not in phase 1 (named, parked)

N rounds in the UI, per-round / overall leaderboard tabs, flights (the column
exists), breakdown views, `contest_id` stamping for org-hosted events, the
calendar publication, a per-hole `client_seq` version column, the bottom
tab bar, match play and brackets.

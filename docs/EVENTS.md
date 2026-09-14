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
| 203 | (next) | `group_posts.sport_event_round_id`, `posts.sport_event_round_id` |
| 204 | (next) | `golf_participant_scores.status / submitted_at / finalized_by` |
| 205 | (next) | the `sport_event_*` notification types |
| 206 | (next) | `reserved_handles` gains `sports` |

Posture A on every new table (RLS on, zero policies, REVOKE from anon and
authenticated): the service client behind `resolveSportEventAccess` is the
only reader; a refusal is the same 404 as not-found.

## Not in phase 1 (named, parked)

N rounds in the UI, per-round / overall leaderboard tabs, flights (the column
exists), breakdown views, `contest_id` stamping for org-hosted events, the
calendar publication, a per-hole `client_seq` version column, the bottom
tab bar, match play and brackets.

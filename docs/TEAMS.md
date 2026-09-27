# Teams & divisions

The reference for the teams & divisions program (Sep 26–27 2026, PRs #940–#954,
migration 242). DEVLOG Sep 26–27 has the round-by-round record.

## Tom's decisions

- **The switches are real.** "We run teams" (`organizations.operates_teams`) and
  "We run competitions" (`operates_competitions`) each turn their part of the
  product on and off — console sections, the in-app org page's tiles, the public
  site's widgets and pages. **Off hides; it never deletes.** Owners and managers
  change them in the console's "What you run" card.
- **Team rosters** hold existing members: a manager adds, moves and removes them.
- **Every team has a page** (in the app and on the site); **every division too**.
- **A coach** (a staff grant on a team or a division) gets a focused console, and
  their grant runs their team's roster, identity and calendar.
- **Rollover** carries a roster forward only when the manager says so, team by
  team; carried players are told, and so are a minor's guardians.
- **A team has an identity**: sport, two colours, a logo, a rename. Its pages wear
  its colours and fall back to the club's.

## The data (migration 242 — the program's only DDL)

| Thing | Where | Rule |
|---|---|---|
| Team identity | `teams.sport_key`, `primary_color`, `secondary_color` (`#rrggbb`), `logo_path` (`team-logos/{teamId}/{file}`) | CHECKs in 242; the logo prefix is in the storage sweep's `PROTECTED_PREFIXES` |
| A team's event sides | `sport_event_teams (sport_event_id, side 1\|2, team_id)` | one writer: `sport-events/team-links-server.ts linkEventTeams` (the event create route + the contest → event door) |
| A team roster spot | `memberships` kind `roster`, scope `team`, `scope_id` = the team, **`season_id` required** | `memberships_team_roster_season_check` (NOT VALID: legacy rows of season-less orgs stay null) |
| The switches | `organizations.operates_teams / operates_competitions` | 242 backfilled them ON wherever the org already used them; golf clubs default to competitions on (`create.ts capabilityDefaultsFor`) |
| The roster bell | notification type `team_roster` | `metadata.team_roster` ∈ added · moved · removed · carried |

## The one-place rules (each pure and unit-tested)

| Rule | File |
|---|---|
| What a switch gates (every console section and widget classified once) | `src/lib/orgs/switches.ts` |
| A current roster row (live season or legacy null; active / placed) | `src/lib/teams/roster.ts isCurrentTeamRow` |
| Who may go on a team (a member already on the org roster) | `roster.ts planTeamAdd` |
| Which season a new spot belongs to | `roster.ts pickRosterSeason` |
| What a rollover carries | `roster.ts planCarry` |
| A team's look (its colours, readable; else the club's; else the app's) | `src/lib/teams/brand.ts teamLook` |
| A team's schedule: calendar + contests + games, each once; "W 3–2" from its side | `src/lib/teams/schedule.ts mergeTeamSchedule` |
| A division's schedule, home-first "Comets 2–3 Blazers" | `schedule.ts divisionSchedule` |
| Where the console opens (full / scoped / none) | `src/lib/orgs/authz.ts consoleLanding` |
| Who may schedule a team's or division's events | `authz.ts scheduleScopeAllows` → `calendar/scope-authz-server.ts canScheduleForScope` |

## The writers and readers

- **One roster writer:** `src/lib/teams/roster-server.ts` — `addToTeam`,
  `moveBetweenTeams`, `removeFromTeam`, `endCurrentTeamSpots`. Sanctioned twins
  that write the same rows: the CSV import (`orgs/roster-import.ts`, the season
  from `resolveTeamSeason`), registration placement (its own season), and the
  rollover carry (`orgs/rollover-server.ts`).
- **One roster reader:** `currentTeamRosterRows` / `currentTeamRosterProfileIds` /
  `currentTeamRowsForProfiles` / `keepCurrent`. Event sides, stat attribution,
  meet affiliation, the calendar audience, the team-event bells and the public
  team page read the CURRENT season through it. **Deliberately any season:** the
  contest place and the teammate album (a past game stays the player's).
- **Schedules:** `src/lib/teams/schedule-server.ts fetchTeamSchedule` (modes
  `public` / `member`; another org's competition counts under that org's own
  gates) and `readTeamRecords`; `src/lib/teams/division-server.ts
  fetchDivisionView`. Contest outcomes resolve in one place, `resolveOutcomes`.

## The surfaces

| Surface | Route | Gate |
|---|---|---|
| Console: What you run | `/app/org/{side}/{id}` (`SettingsSection`) | owners, managers, admins |
| Console: team rows — Edit, Roster, Import roster | `TeamsSection` → `TeamIdentityForm`, `TeamRosterPanel` | `manage_teams` at the team's scope |
| Console: division rows — View, Edit | `DivisionEditForm` | `manage_structure` at the division's scope |
| Console: the coach's focused view | `ScopedConsole` (+ `ScopedEventForm`) | `consoleLanding` = scoped |
| Console: Roll forward — carry per team | `RolloverCarryPicker` | `manage_structure` |
| Org page: Teams tile + window | `?window=teams` (`OrgTeams.tsx`) | the teams switch; a private org's teams are for members |
| In-app team page | `/{club,league}/[id]/teams/[teamId]` (`?tab=roster\|schedule\|results\|standings`) | the org's rules; "Manage team" for `manage_teams` |
| In-app division page | `/{club,league}/[id]/divisions/[divisionId]` | the org's rules; "Edit division" for `manage_structure` |
| Public team page | `/org/[slug]/teams/[teamId]` + vanity twin | the Teams module (and switch) |
| Public division page | `/org/[slug]/divisions/[divisionId]` + vanity twin (in both sitemaps) | the Divisions module (and either switch) |

APIs (one handler module each, `src/lib/orgs/routes/`, with league + club shims):
`team-roster.ts` (`…/teams/[teamId]/roster` GET/POST/PATCH/DELETE), `team-logo.ts`
(`…/teams/[teamId]/logo`), `teams.ts` (`…/teams`, `…/teams/[teamId]`,
`…/divisions/[divisionId]` — `private, no-store`), the team PATCH
(`…/structure/teams`) and the division PATCH (`…/structure/divisions`). The team
logo streams anonymously from `/api/media/team-logo/[teamId]`.

## Refusals, by name

- Team roster: 400 `not_member` · `needs_org_roster` · `no_season`, 409
  `already_on_team`, 404 `not_on_team`.
- Team / division edit: 409 on a taken name; 400 on a bad colour or a disabled
  sport; a foreign row is 404.
- Calendar: a team or division event refuses anyone who neither runs nor
  schedules it; an org-level event stays owner / manager.

## Minors

A minor reaches a team only through the org roster — the guardian-approved offer
(convention 10). No team spot is ever pending, and no team add skips a guardian.
Every roster bell to a supervised athlete copies their guardians, naming the child.

## Parked

- The console's Seasons section as its own component (it shares state with the
  rollover, the structure import and competitions).
- The calendar's full event form for coaches (the coach's door is the console).

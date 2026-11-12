# Game film — tagged highlights, stats from tags, the spoiler-free view

The record of the program is in `docs/devlog.md` (Nov 12 2026, "Sprint 3"). It builds on `videos.md` (Convention 57: a full game is a YouTube video from the owner's connected channel).

## Convention 60 — Every stat of a tagged game comes from its tags (Sprint 3, Nov 12 2026)

**Tom's brief:** clubs, leagues and sports creators post full games on YouTube; Edge Athlete is the tool they tag them with. A highlight is pinned to an exact moment, tagged with an event type and the athletes involved; **every stat comes directly from the tags — no separate stat entry, so everything stays in sync**; viewers get a spoiler-free view where the stats unlock as the video plays; the game ends in a recap; an athlete's clips and stats appear on their profile without the athlete doing anything.

**Tom's decisions (Nov 12):** every sport, not two or three — baselines from the box scores the broadcasters print (ESPN, theScore, TSN, Sportsnet); anyone the tagger may view can be tagged, or a typed name for someone not here yet; no approval — a tag shows at once, the athlete (or a guardian) is told and can remove it.

**Three rules that follow (the assistant's calls, Tom's to overrule):**
1. A highlight stays a marker with a start and an end — never a cut file (Convention 57). "Clip" = play that range.
2. Stats are **computed from the tags on every read, never stored**, and never written into official contest results.
3. A game says whether it is **fully tagged** (`coverage: full` — the score, the box score and the reveal are shown) or **highlights only** (clips and counts; no score is claimed). A final score built from ten highlights would be wrong.

### The sheets (`src/lib/videos/game-sheets.ts`, zero imports)

One declarative sheet per sport — all 17 the registry knows, the two that are off included: the periods, the event types, the roles each takes, what one person in a role gains (`stats`, in the sport's own **stat-schema keys** wherever one exists; anything else is declared in `extra` with a label), what moves the board (`score`: points to the tag's side or the other one), team-only numbers (`team`), the box-score columns and the team rows. The first role of an event is **primary**: its stats count for the side even when nobody is named, so a team total is right before every player is tagged; any other role counts only for a named person.

| Family | Sports | What is tagged | What the recap shows |
| --- | --- | --- | --- |
| team | basketball, soccer, ice hockey, volleyball, baseball (football and tennis defined, off) | see below | score by period, box score, team stats, the scoring summary in order |
| combat | MMA, boxing, wrestling, BJJ | knockdowns, takedowns, submission attempts, the positions and points the sport scores, the finish | the result and method, the events by round, points where the sport has them |
| race | swimming, running, cycling, rowing, track & field | a race / event start (its label names it), splits, finishes with a time, field attempts with a mark | results per event, fastest or best first |
| golf | golf | a hole finished with its strokes, shot markers | the scorecard by hole |

**The team baselines.**
- **Basketball** (quarters, OT) — 2-pointer / 3-pointer / free throw made or missed, offensive / defensive rebound, assist (a role on a made basket), steal, block, turnover, foul. Box: PTS REB AST STL BLK FG 3PT FT TO PF.
- **Soccer** (halves, ET) — goal (+ assist), penalty scored / missed, own goal (scores for the OTHER side), shot on / off target, save, tackle, corner and offside (team-only), foul, yellow, red, substitution. Box: G A SH SOT SV TKL FC YC RC.
- **Ice hockey** (periods, OT) — goal, power-play / short-handed / empty-net goal (up to TWO assists; the beaten goalie is the other side's, never primary), shot on goal, save, hit, blocked shot, face-off won, penalty with its minutes (default 2). Box: G A SOG HIT BLK PIM SV GA.
- **Volleyball** (sets to 25, the fifth to 15, by two; the board is SETS, each period the set's points) — kill (+ setter's assist), ace, block (up to three blockers), point on an opponent's error, attack error and service error (the OPPONENT's point), an attack kept in play, dig. Box: K E TA A SA SE DIG BLK.
- **Baseball** (innings) — run scored (+ who batted it in), home run (a hit, an at-bat, a run and an RBI), single / double / triple, walk, stolen base, strikeout (the batter's, and the pitcher's on the other side), out in play, fielding error. Box: AB R H RBI HR BB SO SB K.

### The engine (`src/lib/videos/game-derive.ts`, pure)

`deriveGame(sheet, tags, uptoMs?)` → the score (points, or sets won), the points per period, one line per person per side (a profile, or a typed name), the team totals, the scoring summary with the running score, the combat result (the first finish), the race results, the golf holes. A tag without an event is a plain highlight: a clip, never a stat. `revealAt(sheet, tags, playheadMs)` is the same shape cut at a playhead — the spoiler-free view. `nextHighWater` is the furthest point watched: it only moves forward (skipping ahead reveals up to there; skipping back hides nothing). `tagsForPerson` is the athlete drill-down (by event type, by period, the scoring plays).

**Pinned by** `src/lib/videos/__tests__/game-sheets.test.ts` (one sheet per registry sport; every stat key is a schema key or a declared extra; every column reads a key some tag makes; the baselines) and `game-derive.test.ts` (a made three is three points, a field goal and a three; an own goal scores for the other side; two assists at most; sets at 25 / 15 by two; the reveal; the drill-down).

### The game on the video (PR 2, migration 307)

A video becomes a **game** when it has a `video_games` row: `sport_key` (the sheet that reads its tags — a sport without a sheet is refused), `played_on`, two sides (a typed name and optionally a `team_id`; a race and a golf round have none — `gameHasSides`), `coverage` and `stats_hidden` (the spoiler-free default, on). The rights are the VIDEO's: whoever may see the video reads the game (`GET /api/videos/[id]` carries it as `game`; `GET /api/videos/[id]/game`), a manager of the video writes it (`PUT` — the whole game every time, so two saves never cross; `DELETE` — the video is a plain video again and its highlights stay). The one writer is `src/lib/videos/video-games-server.ts`; the rules are `game-rules.ts` (`parseGameBody`, `parseGameDay` — a real day, at most a year ahead; `gameShowsScore` — a score is claimed only when coverage is `full` AND the sport keeps a board). A deployment where 307 has not run answers "no game" on a read and 503 on a write, never a 500. On the page: `GameDetailsCard` (the manager's "Add game details" door, the form, "Remove game details" with a confirm that names what is lost; a viewer reads one line). **307 also makes the columns and the table the next PR writes:** `video_highlights.event_key / period / side / value` and `video_highlight_people` (a profile XOR a typed name, the role, `active | removed`) — `survives` in `PROFILE_FK_POLICY`: who was in a tag is the game's record and outlives the person, as a contest's stat line does.

**Pinned by** `game-rules.test.ts`, `migration-307.test.ts`, `e2e/video-game.spec.ts` (`@mobile`).

### Tagging (PR 3, zero DDL — the columns and the table are 307's)

**A tag is a highlight that says what happened and who was in it.** The highlight body gains five optional fields beside its time and label — `event_key`, `period`, `side`, `value`, `people: [{ profile_id | name, role, side? }]`. None sent = the plain marker it always was; on a PATCH, none sent = the tag is left alone, any sent = the tag is replaced **whole** (never half an event).

- **The shape** is `tag-rules.ts` (pure; its one import is the sheets): a person is a profile XOR a typed name (trimmed, single-spaced, 80 at most), has a role, appears once per role, twelve people at most.
- **The sheet decides** (`checkTag`): an event needs the video to be a game and must be the sport's; on a two-sided sport an event needs its side (whose point is it?); a value only where the event takes one, inside its range (a default stands in — a 2-minute minor); each role is the event's, no more than it allows (two assists in hockey). Anyone can also be **`in_clip`**: the clip is theirs, no stat is — allowed on any highlight, game or not.
- **Who may be named** (`taggablePeople`, the photo-tag rule): only profiles the tagger can SEE (`canViewProfile` → 403 otherwise); a block in either direction is silently left out; a typed name is always allowed; yourself always.
- **The one writer** stays `videos-server.ts`: `prepareTag` (sheet + people) → `addHighlight` / `updateHighlight` write the columns and `writeTagPeople` makes the tag's people exactly the list sent. A row someone **removed** of themselves stays removed — a manager's save never tags them back in. A tag whose people cannot be written is taken back whole.
- **Reading** (`listHighlights(admin, videoId, viewer)`): each highlight carries `people` (active only). A manager reads every name; anyone else reads a linked athlete's name only where they may see that profile — otherwise the person is still COUNTED, as "Player" with no link, so a game's numbers are the same for everyone and a private profile is never named to a stranger. The read cap is 2,000 (a fully tagged game has a tag per scoring play).
- **A clip reveals at its END** (`revealMs`): "This moment" on a game makes a clip from 8 s before to 4 s after (`clipAround`), and the lead-in to a basket must not show the basket.
- **The screen:** in the highlight form on a game — "What happened" (the sheet's events, grouped), whose, the period, a value where one belongs, people by role (search, or "Use “…” as a name"), Start / End ±5 s, "End here"; a tagged event names itself when no name is typed. A row shows the event's chip, the side and the people. `TagTimeline` puts every highlight on one line under the player (managers; a viewer gets it with the unlock in PR 4).

**Pinned by** `tag-rules.test.ts` (15), the `revealMs` case in `game-derive.test.ts`, the purity chain in `migration-296.test.ts`, `e2e/video-tagging.spec.ts`.

### What comes next (the sprint's later PRs, each extends this file)

Picking a real team for a side (and its roster first in the people picker) and the game fields inside the Full game flow; the spoiler-free view and "Show full stats"; the recap; the athlete drill-down; the athlete's profile (clips under Videos, the game's line under Stats, the notification, removal).

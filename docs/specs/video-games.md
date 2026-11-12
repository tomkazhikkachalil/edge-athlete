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

### The spoiler-free view (PR 4, zero DDL)

**A viewer sees only what the video has played past.** `game-view.ts` (pure): `revealMode(game, canManage, unlocked)` is `all` for a manager, an unlocked viewer, a game with `stats_hidden` off, and a video that is not a game; otherwise `progressive`. In progressive mode `visibleHighlights` keeps only the highlights whose clip has ENDED before the furthest point watched (`revealMs`), and `GameStatsPanel` derives the game from the same cut — so the board, the box scores, the team rows, the scoring summary and the highlight list all fill in together, and the timeline (every mark is a spoiler) is not drawn at all.

- **The furthest point watched only moves forward** (`advanceWatch` → `nextHighWater`): skipping ahead reveals up to there, skipping back hides nothing. It and the unlock are kept on the DEVICE per video (`ea:game-watch:v1:<video id>` — nothing personal; cleared with site data), written with the resume position every few seconds.
- **"Show full stats"** asks first — it names what it shows and that it spoils the game — and stays unlocked on that device. After it the tag marks are on the timeline to jump to.
- **Hidden means not drawn.** The page's payload still carries the highlights (the video page is one read); nothing of an unrevealed tag is rendered — not its label, not its people, not a count per player. The only thing said is how many tagged plays are still ahead.
- **What is shown** follows the game: a board only when `gameShowsScore` (coverage `full` and the sheet keeps one); "Highlights only" says so and claims no score; a combat result line; race results; a golf scorecard. Box-score rows are people with at least one stat; a masked athlete keeps one stand-in name across the game ("Player 2").
- **Without the IFrame API** (blocked) the playhead is unknown, so nothing unlocks by watching — "Show full stats" is the way in.

**Pinned by** `game-view.test.ts` (7), `e2e/video-spoiler-free.spec.ts` (a real viewer, the real player: nothing → the first basket once its clip has played → everything after the confirm → still unlocked after a reload; the manager sees all; spoilers off shows all).

### The recap (PR 5, zero DDL)

**The page a club or a creator shares after the game is a VIEW of the video page: `/videos/<id>?view=recap`** (`recapPath`; the server page reads the param — `videoPageView` — and hands it to the screen, so no search-params hook). `GameRecap`: who played, the sport, the day, "Watch the game", "Share the recap" (the device's share sheet, else the link copied); then the same `GameStatsPanel` — the final score with the score by period, the box scores, the team stats, the scoring summary in order; then **Top highlights** (`topHighlights`: the plays that moved the board or ended it, then the highlights the tagger named, in time order, six at most — when there are more scoring plays than fit, the named ones lead; a recap is never a second list of every tag).

- **The recap IS the spoiler,** so it obeys the same reveal: a viewer who has not watched sees 0–0, a sentence, and "Show full stats" (the same confirm, the same unlock on the device). A manager, an unlocked viewer and a game with spoilers off read it at once.
- **The doors lead back to the video:** "Watch the game", any top highlight, any scoring-summary row (the video opens at that moment). The video is hidden under the recap, not unmounted — coming back keeps the player where it was.
- **Who can open the link** is the video's own rule (the owner's privacy or the org's visibility); a video that is not a game simply shows the video.

**Pinned by** the recap cases in `game-view.test.ts`, `e2e/video-recap.spec.ts` (375 px).

### The athlete drill-down (PR 6, zero DDL)

**From the game, any athlete opens.** A name in a box score is a button; it opens `AthleteClips` under the panel (one athlete at a time, on the video page and in the recap alike): their line for the game (the sheet's columns they have a number in) beside their clips, and the clips narrowed by chips — **Scoring plays** (every tag of theirs that moved the board, an assist on a teammate's basket included), **a period** (when theirs span more than one), **a kind of play** (when they have more than one). A clip plays the video there; **"Play these"** walks exactly the clips on screen (`playlistOf` / `nextInPlaylist`, the same engine as "Play highlights"). The rule is `tagsForPerson` (pure, `game-derive.ts`).

- **Someone with no stat line** — "also in the clip", or on a plain highlight — is listed under **Also in clips** with their count and opens the same way (no line, just the clips).
- **The spoiler-free cut holds:** the drill-down is handed only the tags the viewer may already see, so a viewer who has not watched is offered nobody; as the video plays, the athletes and their clips arrive with their stats.
- A typed name and a linked athlete are one person each (`personKey`); a masked athlete ("Player 2") opens under that stand-in.

**Pinned by** the drill-down cases in `game-derive.test.ts`, `e2e/video-athlete-clips.spec.ts` (375 px).

### On the athlete's profile (PR 7, zero DDL)

**The athlete does nothing.** When someone tags a linked athlete in a game:

- **They are told once per game** (`notifyNewlyTagged`): a `tag` notification the first time they appear in that video — never per tag, never to the tagger, never again after they removed themselves — with the link to the video. A supervised athlete's guardians get a `tag_alert` (the photo-tag rule). Best-effort: a notification that fails never fails the tag. Both types were already in the table's check (259): no DDL.
- **"Tagged in" on the profile's Videos tab** (`TaggedGames`, on `/athlete`, `/athlete/[id]` and `/u/[username]` alike — the one tab component): each game with its link back ("Watch the full game"), who posted it, the day, how many clips the athlete is in, and their **line for the game** in the sport's box-score columns. `GET /api/videos/tagged?profileId=` — who may ask is the profile's privacy; which games answer is each video's own rule (`readVideoForViewer` per video, so a hidden or private video is not listed); the line is derived from the tags on the read (`listTaggedGames` stores nothing).
- **The profile is not the spoiler:** on a game whose stats are hidden, the line is held back (`stats_hidden: true`, "the stats show as you watch") from everyone but the athlete, their guardian and the game's managers.
- **Removal is the tagged person's** (`DELETE /api/videos/[id]/tags[?profileId=][&highlightId=]`): all their tags in a video, or one highlight's; a guardian for a supervised athlete (`resolveActingProfile`). No right over the video is needed — it is their own name — and a video they are not tagged in answers `removed: 0`. The rows become `removed` (never deleted): the stat drops (reads count `active`), the game leaves their profile, and **a manager's later save cannot tag them back in**. Doors: "Remove me" on the profile card, "Remove my tags" on the video page — each with a confirm that names what is lost.

**Not built (said, not assumed):** the line under the profile's **Stats** tab (it lives on the Tagged-in card for now — the Stats tab reads the one performance table, and writing video-derived stats there is the merge-with-official-records decision this sprint left out); linking a typed name to a profile after the fact; undoing a removal.

**Pinned by** `tagged-profile.test.ts`, `e2e/video-tagged-profile.spec.ts` (375 px).

### Open after the sprint (decisions and work that were named, not built)

- **Video-derived stats and the official record.** A tagged game's numbers show on the game, the recap and the athlete's Tagged-in card; they are NOT written to `contest_stat_lines` / `athlete_performances`, so they are not under the profile's Stats tab. Merging them needs a rule for when a video's tags and a league's official line disagree — Tom's decision.
- **Hidden is not withheld.** The spoiler-free view does not DRAW unrevealed tags; the page's one read still carries them. Holding them on the server costs a request per reveal.
- **A typed name stays a name:** no step links it to a profile once that person joins. **A removal has no undo.**
- **The game fields inside the Full game flow** (they are on the video page), **a real team for a side** with its roster first in the people picker, **football and tennis** (their sheets exist; the sports are off).
- **The baselines** were written from the broadcasters' box-score conventions as known, not checked against each site; a sport's event list is one edit in `game-sheets.ts`, pinned by `game-sheets.test.ts`.
- **Name masking** (a linked athlete a viewer may not see → "Player 2") has no browser spec: it needs a private profile the tagger can see (a follow) that the QA users do not have.

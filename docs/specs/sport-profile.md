# The athlete's sport profile (Sprint 4, Nov 2026 — Convention 61)

Tom's brief: the athlete's page is a bundle of connected views per sport, "the way NBA.com, NHL.com, NFL.com and fantasy breakdowns do it" — pick a sport, then drill **Career → Season → Game → Play**, and "every number you see is a door to the plays and clips behind it". Stats and media are one thing seen two ways: a tag on a video made the stat, so the clip is already attached to the number. All of it comes from the tags of Sprint 3 (`video-games.md`); the athlete does nothing.

## Convention 61 — a number is the sum of counted games, and a door to its clips

- **Nothing is stored.** The sport profile is read from the same three sources as the Stats tab — official lines, film, the athlete's own posts — and judged by the same rule (`src/lib/performance/same-game.ts`: official line > a club's or league's verified film > the athlete's own post; one game counted once). **The numbers are the Stats tab's numbers**, key for key (`e2e/sport-profile-api.spec.ts`).
- **The season is the sport's season** (`seasonKey` in `src/lib/performance/rollups.ts`: hockey from September, basketball from October, volleyball from August, the calendar year otherwise — "2025-26"). A game with no date is in the career and in no season (`undated`).
- **The four levels** (`src/lib/sport-profile/rules.ts`, pure, no imports):
  1. *Career* — `careerOf`, and one row per season (`seasonsOf`), newest first. Only the sport's stat fields are summed (a sheet's `extra` keys never reach a total).
  2. *Season* — the totals, the splits and the game log (`gamesOfSeason`). **Splits:** by opponent (`splitByOpponent`, whatever the spelling) and by period (`splitByPeriod`, only what the film's tags say — an official line or a post has no periods, so those rows need not add up). **There is no home / away split:** a tagged game has side 1 and side 2, not home and away.
  3. *Game* — one `ProfileGame`: the athlete's line, by period, its clips, the link to the full game. A game counted from its **official line** opens the film that is the same game (`filmOfGame`).
  4. *Play* — `reelOf`: the clips, **oldest game first and in game order** — a reel plays the season the way it happened, across videos. Always media.
- **The clips behind a number** are the tags that put that stat on the athlete's line: `statTagsForPerson` in `src/lib/videos/game-derive.ts` (the holder rule is `deriveGame`'s — the first people named in a role hold it). A plain marker, or a role somebody else holds, is behind no number. `clipCounts` says how many clips each stat has at a scope — a number with none is not a door.
- **Which film is behind a number** (`filmBehind`): verified film that is counted, or that is the same game as a counted one. **Recreational film is behind no number** (Tom, Nov 15 2026: shown, marked, never counted); it appears in the game log, marked, and in the Clips browser (`scope=all`).

## The reads

- **`readAthleteFilm`** (`src/lib/sport-profile/sport-profile-server.ts`) is set-based: the athlete's tag rows, then the games, the videos, those tags and the people on them — each **one query** (ids in chunks of 150), never a read per video. It reads only the tags the athlete is on (their line needs no other; the other people on those tags are read because they decide who holds a role). Who may open a video is the video's own rule (`videoFactsFor` → `viewRight` / `manageRight`), asked **once per owner**. Caps: 6,000 tag rows, 300 videos.
- **`readSportProfile`** puts the three sources together and returns every game judged. `sportProfilePayload` is levels 1–3 without the clips themselves.
- **Routes** (both `private, no-store`):
  - `GET /api/profile/[profileId]/sport-profile?sport=…[&spoilers=show]` → `{ supported, columns, period, career, seasons[], games[], held, can_edit }`. `supported: false` for a sport with no stat sheet (golf keeps its own tables).
  - `GET /api/profile/[profileId]/sport-clips?sport=…[&season=][&game=][&stat=][&event=][&period=][&scope=all][&spoilers=show][&cursor=][&limit=]` → `{ clips[], next, total }`; sixty a page.
- **Measured on staging, Nov 15 2026** (p50 of five warm reads, a laptop through the local server; each game 30 tags, the athlete on 6):

  | film games | Stats tab totals (`stat-lines`) | Tagged in (`tagged`) | **sport-profile** | sport-clips |
  | ---: | ---: | ---: | ---: | ---: |
  | 10 | 1,387 ms | 1,267 ms | **953 ms** | 957 ms |
  | 40 | 2,321 ms | 1,689 ms (first 24 only) | **1,046 ms** | 1,062 ms |

  The read does not grow with the number of games; the totals agreed in both runs.

## Who sees what

- **The gate** is `sportProfileViewer`: the athlete or their guardian; a viewer the profile's privacy lets in (`canViewProfile`); a stranger only on a public, present profile. **A block in either direction closes it** — the same 404, never a reason. The same check now closes `GET /api/videos/tagged`. (Not changed here: `canViewProfile` itself does not look at blocks, so the Stats tab's older routes still answer a blocked viewer of a public profile — a decision for its own round.)
- **A spoiler-free game** (`stats_hidden`) **counts in every total** — a season total is not a play-by-play — but its own line, its periods and its clips stay on the server (`cutHeld`) until the viewer asks (`spoilers=show`), unless the viewer is the athlete, their guardian or a manager of the video. Such a game is never listed under its opponent in a split (one row would be its line). `held` says how many counted games the viewer has not opened.
- **Names:** only the athlete's own line is read, so nobody else is named.

## The page (PR 3, Nov 15 2026)

- **Two routes, one component.** `/athlete/[id]/sport/[sport]` (a signed-in viewer; the athlete's own id stays here — the same page for everyone) and `/u/[username]/sport/[sport]` (by handle, from the public bundle; a private profile hands a signed-in viewer to the id route, which knows whether they follow). Both are thin shells over `src/components/sport-profile/SportProfile.tsx`. They are their own routes on purpose: they are measured apart from the profile page and add nothing to it, and there is **no shared `layout.tsx`** (it would weigh on the profile).
- **The sport is picked at the top** (`data-sport-switcher`): the athlete's sports with a stats door, in their own order (`switcherSports`); the whole page is that sport. A link naming a sport the athlete does not have opens the first in their order (`landingSport` — Tom's decision 4). The header says the sport's own facts (position, team — the skill card's `entered` chips).
- **The level is the address** (`src/lib/sport-profile/view.ts`, pure): no query is the career, `?season=2025-26` a season (`&game=` and `&stat=` are the next levels). Each step down is a `Link` — a history entry — so **Back walks up a level**, and every level can be sent to someone. A malformed part is dropped, never an error.
- **Career** (`CareerView`): the sport's tiles over the counted games, one row per season, the career line under it; a season is the door. **Season** (`SeasonView`): tiles, totals, by opponent, by period (only when the film says more than one), and the game log — every row a game, saying what it is (Official · Game film · Posted), whether it is recreational or not counted and why, with the link to the game. A spoiler-free game's row says so; "Show the results" is the viewer's choice.
- **One table** (`StatTable`): the repo's idiom, a horizontal scroller with the first column pinned on a phone. The levels are `next/dynamic` chunks.
- **The door in:** the Stats tab's sport layer (`data-sport-profile-door`), for a sport with a stat sheet.

## The game and the play (PR 4, Nov 15 2026)

- **Every number is a door.** A stat cell with clips behind it is a link (`data-stat-door`): at the career it opens that stat's reel for the whole career (`?stat=goals`), on a season row or the season's totals that season's (`?season=…&stat=goals`), on a game row that game's (`…&game=…&stat=goals`). A number with no clip behind it — an official line with no film, a posted game — is plain text. The counts come with the payload (`career.clips`, `seasons[].clips`, `games[].statClips`); a split row is not a door.
- **The reel sits above the level it was opened from** (`StatReel`) — "every goal that season as a clip reel, in order, without leaving the page" — and Close returns to the level's own address.
- **The game** (`GameView`, `…&game=<key>`): the athlete's line with each number a door, the line by period, **their clips from that game**, and the way out — "Watch the full game", "Game recap", and the official result when the game is one. A game counted from its **official line** shows that line's numbers and plays **the film of the same game** (`games[].film`), and says so. A game with no film says there are no clips.
- **One player, across videos** (`ClipReel`): a clip in the same video seeks; a clip in another video remounts the player on that video at the clip's start (the player is keyed by the video). With YouTube's API the reel steps on its own at each clip's end (`reelPlaylist` + `reelStep` — an open clip plays 20 s; a playhead before the clip's start is the player still arriving); in the plain frame, Next is the step. Previous / Next, the list (tap any clip), and "Clip n of N · the game · the date" are always there.
- **A moment has an address:** `/videos/[id]?tag=<highlight id>` (`tagPath`, `videoPageTag` in `game-view.ts`) opens the video at that moment, once. Every clip in a reel links to it ("Open this moment in the game"). A moment the viewer has not been sent — an unwatched play of a spoiler-free game — is not there, and the video opens as it always does.
- A clip is called by the sheet's event and the tagger's own label, once when they say the same thing.

## Media on its own — the Clips browser (PR 5, Nov 15 2026)

- **Stats and Clips are two tabs of the one page** (`data-sport-tabs`): the numbers (each a door to its clips), or the clips without going through the numbers (`?view=clips`).
- **What it lists:** every clip of the athlete in every film game the viewer may watch — **recreational film included, marked** — oldest game first (`scope=all` on the sport-clips route). A spoiler-free game gives none until the viewer has asked.
- **Filters are the address:** season, game, play type (`?view=clips&season=…&game=…&event=…`). The play types are the sport's sheet events (a plain marker is not a play type). The filters are held in the component and mirrored to the address, so two changes in a row each start from the last one made (the overlapping-saves rule — found by the spec: the second change was built from an address the first had not reached).
- **Every clip links back** (`data-clip-origin`): to its game's level on the Stats side, to each stat it made (that game, that stat), and to its moment on the game's own page.

## Hide — the athlete's own page (PR 6a, Nov 15 2026; migration 311)

Tom, Nov 15 2026: an athlete can hide a game or a single clip from their page; **the stat still counts**. "Remove me" (the tag is removed and the stat drops for everyone) stays, on the game's own page, as the stronger door.

- **`profile_film_hidden`** (311; posture A, service role only): `profile_id`, `video_id`, `highlight_id` (NULL = the whole game), `created_by_user_id`. A game is hidden once, a clip once (two partial unique indexes). The profile, the video and the clip all CASCADE; `profile_id` is `goes` in `PROFILE_FK_POLICY` and is deleted with the account.
- **One writer** (`src/lib/sport-profile/film-hide-server.ts`): `POST /api/profile/[profileId]/film-hidden {video_id, highlight_id?, hidden}` — the athlete or their guardian (`resolveActingProfile`), and only something the athlete is actually tagged in (anything else is a 404, never a row). Hiding twice is hiding once.
- **What a visitor gets** (`forViewer` in `rules.ts`): a hidden **game** keeps only what a total needs — its row is not sent, it has no clips, no periods, it is never under its opponent in a split, and it is no film to open from an official line; a hidden **clip** is gone from every reel, the Clips browser and the door counts. **Every total is unchanged.** The athlete and their guardian are sent everything, marked (`games[].hidden`, a clip's `hidden`).
- **On the page:** the game level has "Hide this game from my page" / "Show this game on my page" with what it does said in words; the reel has the same for the playing clip; the game log marks a hidden row for the athlete. No toast — the result is on the screen.
- It is about the athlete's page only: the club's video, its box score and the other players are untouched. An official result is not hidden by this (that is the results rule, Convention 27).

## "These are two different games" in the game log (PR 7a, Nov 15 2026)

- The same-game rule joins two games of one date; the athlete — or a guardian — may say they are two (309, `video-games.md`). The sport profile's game log now carries that control: a row not counted **because of the date alone** (`games[].canSplit`) offers "These are two different games"; a row the athlete split (`games[].splitFrom`) says "Counted as its own game" with Undo. A pair tied by a contest is never offered. It is the Stats tab's own writer (`POST /api/sports/stat-lines/distinct`) and its own client helper, so the two surfaces stay one fact.

## The Stats tab's per-sport breakdown is retired into this (Nov 15 2026)

One home per fact: a sport's full breakdown — career and seasons, the totals, the official lines, the game log, the film — is the sport profile. On the Stats tab a sport's layer keeps its **card** (the short, verified intro) and the **door** ("Full breakdown: career, seasons, games and clips", `data-sport-profile-door`); the expandable breakdown and the per-sport "From game film" list are gone from it.

- **Which sports** (`hasSportProfile`): at the time, every sport with a stat sheet except track and field and golf. Both have since joined (golf — its own payload, phase 3; track — each event is a best, phase 4): the rule is now "golf, or any sport with a stat sheet", and `TrackBreakdown` and `StatLineBreakdown` are deleted. "From game film" stays on the Sports tab's All layer.
- **What was carried over first**, so nothing is lost: an official line says its rung in the game log ("Official · League verified"); a disputed result carries the **Unconfirmed** mark and says it is not counted until resolved; a posted game shows its own result; a row that is not counted **links to the game that took its place** (the official result's page, or the film's game level here); "How verification works →" sits over a log with an official line; and the **trend and the bests** — the rollups' own reader (`SeasonRollups mode="extras"`, from `athlete_performances`): the career bests, the trend of the headline number and how many events are club-recorded or better on the career, the season's bests on a season.
- The game log has no 25-row cap and no calendar-year select: a season is the sport's season.

## Unclaimed — a tagged player who has not claimed their profile (PR 6b, Nov 15 2026; migration 312)

Tom, Nov 15 2026: such a player gets "a public page, marked unclaimed", and "authentication needs to be a process where they select the profile and start the request". Nov 16: there is no account merge in this codebase, so an approved request **moves the film**.

- **Who is unclaimed** (`src/lib/sport-profile/unclaimed.ts`, pure): a roster placeholder — an account on the reserved stub domain (`@stubs.invalid ⇔ unclaimed`, `stubs-config.ts`) that is still here. A supervised minor is claimed.
- **What is open:** the placeholder's **sport profile only** — the film stats and clips, from videos the viewer may open — to any **signed-in** visitor, under a **short name** ("Sam K.", `unclaimedName`; many of these players are minors). The profile itself stays private: no posts, no follow, no messages, no search listing. `/athlete/[id]` of an open placeholder goes to `/athlete/[id]/sport/<sport>`; the sports are the ones it has film in. A block still closes it.
- **In a game's tags** an open placeholder is named by that short name and linked (`readTagPeople` → `openUnclaimedNames`) — the box score's player panel has "Open their profile", which is how a player finds the page. Kept private, it is "Player N" with no link, as before.
- **The club's switch** (`unclaimed_page_private`, one row = not open): the organization that tagged the player can keep the page private — then only its video managers reach it, and nobody can ask for it. A database without 312 opens nothing.
- **The request** (`profile_claim_requests`; `POST /api/profile/[profileId]/claim-request[?for=<child>]`): "This is me — request this profile", or "This is <my child>" for an athlete the viewer is a guardian of (`resolveActingProfile`). One open request per person per placeholder; asking again is the same request. The **deciding organization** is the one with the most of the player's tagged games; its video managers (`manage_video`) are told once — never a manager who has blocked, or is blocked by, the person asking.
- **The answer** (`PATCH …/claim-request/[requestId] {action}`), on the placeholder's page, by that organization's video managers only (anyone else gets a 404 — never that a request exists): **approve** moves the placeholder's tags on that organization's videos to the requester, through the writer that already links a placeholder on a video (`linkTagTarget` — the person is told once; they are never tagged back into something they removed themselves from); **decline** tells them. An answered request is a 409.
- **What does not move:** the placeholder itself, its roster seat, and any official result entered for it stay with the organization. The page says so before the person asks, and the approval says so to the manager. A person with no account still claims the old way — the organization's claim link, which makes the placeholder their account.
- **Readers and the one writer:** `unclaimed-open-server.ts` (the small reads, with no import of the video modules — `videos-server.ts` reads through it), `unclaimed-server.ts` (`readUnclaimed`, `requestProfileClaim`, `decideProfileClaim`, `setUnclaimedListed`); `GET / PATCH /api/profile/[profileId]/unclaimed`.

## Follow-ups (Nov 15 2026)

- **A block closes a profile.** `canViewProfile` (`src/lib/privacy.ts`) refuses a signed-in viewer with a block in either direction, on the two paths that would let them in (a public profile, an accepted follow) — it reads as a profile they cannot view, never as "blocked". A guardian's access row is not a viewer's and is not closed by it. The Stats tab's two older routes gate inline (`/api/sports/stat-lines`, `/api/performance/rollups`): they refuse too, as a private profile. One predicate, `blockedEitherWay` in `src/lib/blocks.ts`. (The signed-out view of a public profile cannot know who is looking; that is unchanged.)
- **A race does not add up** (`sportSums` in `src/lib/sport-profile/has-profile.ts`): a sport with two sides sums (goals, points, takedowns); swimming, running, cycling and rowing do not — their numbers are times and marks. Their sport profile counts the races per season, shows each race's own numbers in the game log and the bests, and **never a total** (`sums: false` in the payload).
- **The sport strip opens the sport profile.** On the profile's own sport strip (all three routes) a sport WITH a sport profile opens it in one tap; golf and track open the Stats tab's layer as before. The skill card says which (`sportProfile`, set on the server by `hasSportProfile`), so a profile route needs no stat sheet to know and its first load is unchanged.
- **The switcher offers only sports that have a sport profile** (`switcherSports`); a link naming one that does not (golf) opens the first that does. The header shows what the athlete says about themselves in the sport — the card's headline when it is self-entered (a level), then the rest.

## The Sports tab (Nov 15 2026 — the "one wave" program, phase 1)

Tom: the profile's tabs stay seven, and **Stats is renamed Sports** — "one card per sport, a tap opens that sport's profile". The tab's id and address stay `stats` (`?tab=stats`): links and specs hold; only the name people read changed (`ProfileMediaTabs`, and the section on `/u/`).

- **The tab is the sport cards** (`SportSkillCards` with its `door`): a card of a sport WITH a sport profile is a link to it (`data-sport-profile-door`); golf and track — until their profiles land — open the layer they still keep on the tab (`data-sport-layer-door`), and that layer has the way back, "← All sports" (`data-sports-all`). **The chip row is gone.** `?tab=stats&sport=<a sport with a profile>` opens the cards (`parseStatsSport`).
- Under the cards, as before: the athlete's own challenges, "From game film" across sports, and the grid of posts with data.
- **Head-to-head (rivals)** for a sport with a profile moved to that profile's Career view; golf and track keep it on their layer.
- A card's own line now reads "+N self-posted games in the sport's profile".

## Each column by its own rule ("one wave", phase 4 — Nov 2026)

A race sport's profile used to show only how many were raced ("a sum of times means nothing" — `sportSums`). That hid numbers that DO carry up a level. Now each column has its own rule (`columnRule`, by the field's own key, so a new race sheet needs no rule of its own):

| The field | Carried up as | Examples |
| --- | --- | --- |
| a game with two sides (`sportSums`) | a **sum**, every column | goals, points — unchanged |
| `time_*`, `pace_*` | the **best** (lowest) | 100 m, pace per km |
| `max_*` | the **highest** | max heart rate |
| `avg_*` | the **average** of the games that recorded it | average heart rate, power |
| anything else in a race | a **sum** | distance, moving time, elevation, calories |

- `aggregateOf` folds the counted games; for a best it also names **the game it was set in** (`bestIn` — the first to reach the number), and the cell is the door to that game. A best set in a game whose row this viewer is not sent opens nothing.
- The column says how it reads (`format`, by key): a race time (`11.85`, `4:05.30`), a clock (`4:40`, `1:13:20`), a number. A header's tooltip says "— best" or "— average".
- Career and season tables show the columns for every sport; a race sport's season block is "Season totals and bests". The splits by opponent and period stay a game-with-sides thing.
- **Found on the way:** the rollups' bests chose the direction per SPORT, so a runner's "best pace" was their slowest. The direction is now the field's (`time_*` / `pace_*` are best low in any sport).
- **Track and field has a sport profile (PR 2).** Each event's column is a best, so the engine above IS its personal-best table: Career — one row a season with each event's season best, the foot row the personal bests; a cell opens the race it was set in. Season — "Season totals and bests" and the race log (an official meet line says its rung). **The event is a pivot** (`BestHistory`, `?stat=time_100m`): a best column's heading opens every race of that event, newest first, with the ones that were a best at the time marked (`progressionOf`); a row is the door to its race. The same pivot works for a pace in running, cycling, swimming and rowing. The Sports tab keeps a layer only for a sport with no stat sheet.
- Pinned by `rules.test.ts`, `view.test.ts`, `rollups.test.ts`, `has-profile.test.ts`, `e2e/sport-profile-race.spec.ts`.

## More doors on the sport pages ("one wave", phase 5 — Nov 2026)

Tom ticked four ideas and left the cut to the plan: "fundamentals for now, simple, drill down where it makes sense". Built: the three that are doors. **Not built: comparing two seasons side by side** (not a fundamental; a decision to revisit, not an oversight).

- **An opponent opens the games against them.** In a season's "By opponent" table the name is a link: `?season=2026&opponent=QA%20Owls` narrows the game log to those games ("Games against QA Owls", "All games" to clear). The name in the address is cleaned (one line, 60 characters) and only ever compared to the games' own opponents the way the split groups them (`sameOpponent`: case and spacing aside).
- **A period opens its clips.** In "By period" the period is a link: `?season=2026&period=2` plays that period's clips of the season as one reel (the clips route's own `period` filter).
- **A best opens its game.** "Season bests" / "Career bests" rows link to the counted game with that value on that date — when it is on the page; otherwise the row is text.
- **A headline tile opens its clips.** A tile made of ONE stat (the payload names it, `stat`) with clips behind it is the door to that stat's reel.
- **Kinds of play under a stat.** A stat's reel shows chips for the sheet events among its clips (twos, threes, free throws; a goal, a penalty goal) when there is more than one kind; a chip is `&event=<key>` — the clips route's own filter.
- Pinned by `view.test.ts`, `rules.test.ts`, `has-profile.test.ts`, `e2e/sport-profile.spec.ts` (opponent, period, tile).

## Golf's sport profile ("one wave", phase 3 — Nov 2026)

Golf does not fit the stat-line payload — its numbers are scores against par, not sums — so it has its own rules and payload, with the same levels and the same promise. **Career → Season → Round → Hole.**

**The rules and the reads.**

- **Rules** (`src/lib/sport-profile/golf-rules.ts`, pure): a season is the **calendar year** of the round's date; a round is **scored** when complete with a gross score; **to par per 18** puts 9- and 18-hole rounds on one scale; the scoring average and "best 18" read 18-hole rounds only (a best 9 is its own number); fairways are asked on par 4s and 5s, and a hole with no answer is not an attempt; putts scale to 18 over the holes that recorded them. Score kinds: eagle or better, birdie, par, bogey, double or worse. By par: the average over par on 3s, 4s and 5s. By course: the name matched without case or outer spaces.
- **A hidden round counts and is never shown (241, the results-kept rule):** the totals are folded over every round; the list and the holes a non-owner receives never hold a round its owner hid, and a best set in one has no door (`roundId: null`). The athlete and a guardian see it, marked.
- **Reads:** `GET /api/profile/[profileId]/sport-profile?sport=golf` → `kind: 'golf'`: the handicap estimate and its history (`fetchHandicapComputation`), `career`, `seasons` (each with its courses), `rounds` (listed, newest first, no holes). `&holes=<year>` → that season's holes by round (`kind: 'golf-holes'`). The sport profile's own gate (`sportProfileViewer`: a block closes it), `private, no-store`. Set-based: rounds in pages of 1,000, holes in batches of 55 rounds.
- My call: "official or not" is asked per round at the Round level (PR 3) — `resolveResultOrigin` reads one result at a time, and a list of hundreds must not.
- **The screens** (`GolfProfile`, one lazy chunk on the sport profile's page): **Career** — tiles (handicap estimate, rounds, scoring average, to par, fairways, greens, putts), one row a year with a total, the trends the Sports tab's golf layer used to show (`GolfBreakdown`, for an anonymous viewer too) and the rivals; "Best 18" opens that round. **Season** (`?season=2026`) — tiles, the score kinds (a count opens its holes: `&stat=birdie`), by par, by course (a course filters the round log), the round log. **Round** (`&game=round:<id>`) — score, front and back nine, the scorecard, the athlete's "Edit this round". **Hole** (`&hole=7`) — its numbers, previous and next. A total-only round says it has no hole scores; a round the viewer may not open says it is not available.
- **`hasSportProfile('golf')` is true:** golf's card on the Sports tab and the profile's sport strip open this page; `?tab=stats&sport=golf` (old links, a challenge's notification) opens the cards. The golf layer on the Sports tab is gone; nothing it showed was dropped.
- **A hole's photos and clips** (the media of a SHARED round, `group_post_media` by `segment_number`): on the hole's page, on the round (a camera count on the scorecard row, and the round's grid with the door to each hole), and on golf's **Clips tab** (`?view=clips`, a season narrows it; each tile's caption is the door to its hole). `&holes=<year>` carries the season's media; `&media=all` is the Clips tab's read. **Who is shown them is the round's own rule** (`mayViewRoundMedia`: a public round, its creator, a participant — the media proxy's `authorizeGroup`): someone the round is closed to is not even told a photo exists; the addresses are the proxy's (`type: 'group'`), which asks again for the bytes. A failed media read costs the media, never the scorecards.
- **Official:** a round played in an organization's event says so on its page and in the round log. `resolveResultOrigin` is asked for the season's shared rounds only (five in flight), never for the career's list; an answer the rule could not read is not shown as official.
- My call: the owner's trends page (four charts) and rounds list (search, filters) stay — the profile links to them ("Open full trends", "Edit this round"); redirecting them would drop things the profile does not have.
- Pinned by `golf-profile-rules.test.ts`, `view.test.ts`, `e2e/golf-profile-api.spec.ts`, `e2e/golf-profile.spec.ts`.

## Wording that does not assume a team game (Nov 16 2026)

A sport without two sides (`sportSums` false: track, running, cycling, swimming, rowing) reads in its own words. Each is one rule, used at every site:

- **"vs" only where there are sides** — `gameTitle(sides, opponent, fallback)` (`view.ts`). A race's "opponent" is its meet or its place: "Spring Open", never "vs Spring Open". Also on the post's stat card, the feed's summary line, the calendar and the sport's log page.
- **A stat's name without the entry form's seconds** — `statTitle(label, format)`: "100m time (s)" → "100m time", "Pace (s /km)" → "Pace /km"; a plain number keeps its unit ("Distance (km)").
- **A best reads as its column does** — the bests list formats through `statCell` ("24.10", "4:40"), never the raw number.
- **The sport's own noun** — `nounOf(sport)` (`has-profile.ts`): "Race log", "Races", "4 counted races"; a sport with sides keeps "game".
- **No trend through different measures** — a stat sheet whose hero number is a different event per entry says `heroVaries` (track); `computeRollups` then returns no trend. An event's own history is its progression.
- **Not recorded is a dash** — in a column that is a best or an average, zero means not recorded and shows "–"; a tile with nothing to say is not drawn. A real zero in a total stays.
- **An average of a reading is over the entries that carry it** — `recordedOnly` on a tile (heart rate): a run without a reading is not a run at 0. A per-game average still counts every game.
- **Rivals sits below the numbers**, and on a sport without sides the empty invitation is not drawn.
- **Golf's handicap is shown once** — Career's first tile; the Trends block no longer repeats it.
- Pinned by `view.test.ts`, `rollups.test.ts`, `stat-schemas-round4.test.ts`, `e2e/sport-profile-race.spec.ts`.

**Pinned by** `src/lib/sport-profile/__tests__/rules.test.ts`, `view.test.ts`, `e2e/sport-profile.spec.ts` (375 px, both routes), `e2e/sport-profile-split.spec.ts`, `e2e/sport-profile-unclaimed.spec.ts`, `unclaimed.test.ts`, `e2e/video-placeholder.spec.ts` (the short name, and "Player 1" when kept private), `src/lib/videos/__tests__/game-derive.test.ts` ("the tags behind a stat"), `e2e/sport-profile-api.spec.ts`.

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

## Decided, not yet built (Tom, Nov 15 2026 — the later PRs of the sprint)

- **Hide.** The athlete (or a guardian) can hide a game or a single clip from their page: it leaves the lists and the reels for visitors, **the stat still counts**; "Remove me" stays as the stronger door.
- **Unclaimed.** A tagged player who has not claimed their profile gets a public page marked *Unclaimed*; claiming is a request the person starts from that page.
- **The default sport** is the athlete's own order — pins, then the primary (`orderProfileSports`).
- The pages: `/athlete/[id]/sport/[sport]` and `/u/[username]/sport/[sport]`, the drill state in the URL; the cross-video reel player; `/videos/[id]?tag=`; the Clips browser; the Stats tab's per-sport breakdown becomes a door into this.

**Pinned by** `src/lib/sport-profile/__tests__/rules.test.ts`, `src/lib/videos/__tests__/game-derive.test.ts` ("the tags behind a stat"), `e2e/sport-profile-api.spec.ts`.

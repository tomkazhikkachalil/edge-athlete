# Play: badges, share cards, rivalries, cheers and challenges

The Play program (Sep 28–29 2026, #991–#1000, migration 244 is its only DDL).

Tom asked for "something fun", and set one rule: *"I don't want it just be about golf. It's got to have the building blocks and principles for every other sport."* This doc is the reference: the principles, then each piece's rules and where they live.

## The principles

1. **Everything reads the ONE fact table.** Badges, rivalries and challenge settlement read `athlete_performances` (194), never a sport's own tables.
   - The one sport-specific fold happens **in the golf mapper**: a round's holes become `metrics.birdies` / `eagles` / `aces`. Readers never see holes.
2. **A sport joins by DATA, not code.**
   - A stat-line sport gets milestone badges from `StatFieldDef.milestones` in `stat-schemas.ts`.
   - Its challenge metrics are its schema fields (with `LOWER_IS_BETTER` for the few where less wins).
   - Its share card is its schema's `heroStat` + `supportKeys`.
   - Adding a sport stays the "2 edits" recipe, and it inherits all five features.
3. **One post-write hook.** `upsertPerformances` calls `src/lib/play/after-write.ts afterPerformanceWrite` after every successful upsert. That hook awards badges and settles challenges.
   - Every writer in every sport reaches it: a round, a stat line, an event mirror, an org line, a league overlay.
   - The backfill passes `after: 'silent'`: history earns badges and settles challenges with no bells.
   - Never throws; awaited.
4. **A shared game is a column.** `athlete_performances.context_key` names the game, with one canonical key per game so nothing counts twice:
   - `group_post:<id>` for a golf shared round (an event round mints one);
   - `sport_event_round:<id>` for a stat event round;
   - `contest:<id>` for an org contest line.

   `side` (1|2) and `outcome` (win|loss|tie) apply where the context decides one. The **mappers** own the key; golf never sends side / outcome, because `stampMatchOutcomes` writes a match's once at completion and a round edit must not blank it.
5. **Results-kept rules hold** (conventions 25 and 27).
   - A hidden result keeps its badge and still counts in rivalries.
   - A support correction re-decides badges (`rescanBadges`).
   - A departed opponent shows the full name with no link.
   - Every person-name on a public surface passes `publicDisplayName`.
6. **Every result counts; a verified one is marked.** "Verified" means the row's provenance is in `OFFICIAL_PROVENANCE` (club_recorded and above). Badges, challenge wins, rivalry counts and share cards all carry the mark.

## Badges

- **The catalog** is `src/lib/play/badges/catalog.ts` (pure data).
  - Per FEATURE sport: first result, 10 / 25 / 50 / 100 results, first win (not for golf or track), "On the record" (first verified result).
  - Golf's pack: break 100/90/80/70 and "Red number" (18 holes only), first birdie, birdie barrage, eagle, hole-in-one, handicap under 20/10/5/scratch (from a non-provisional index only).
  - Generated stat-line milestones.
  - Across sports: two sports, three sports.
  - **A key, once shipped, is forever** (it's stored). Rename the label, never the key.
- **Earning:** `evaluate.ts` is pure and returns NEW awards only. `badges-server.ts` is the one writer:
  - `badge_awards` with `UNIQUE (profile_id, badge_key)`, inserted ON CONFLICT DO NOTHING;
  - one `achievement` bell per write (respects `achievements_enabled`), with guardian copies.
  - The table is **not** the legacy `athlete_badges`, which 199 dropped.
- **Showing:** `GET /api/profile/[id]/badges` uses the Achievements tab's gate and never returns the source key. `EarnedBadges` has two variants:
  - `full` on the Achievements tab, with the owner's "Up next";
  - `compact` on `/u/`.

  Each badge's detail opens in `LargerWindow`. The celebration is the bell's existing realtime row → `celebratePR()` + a toast (a guardian's copy gets the toast only).

## Share cards

- **`/r/[postId]`** is viewer-independent (the service role; the session is never read).
  - A published, public golf round or stat line of a **public** profile (`isPublicProfile`) renders for everyone.
  - A real post without a public card redirects to the in-app link.
  - Anything else is a 404.
  - The root segment `r` is reserved in both places.
- **`/r/[postId]/card.png`** is 1200×630. It uses the org card's recipe (`next/og` only in a `card.png` route, `s-maxage=3600`) and 404s without a public card.
- **One projection,** `share-card.ts`, feeds the page, the metadata and the image. Zeros are left off, because an untracked stat is not a brag.
- The Share button on a public result post hands out `/r/<id>`.

## Rivalries

- **The read:** `rivals-server.ts` is one self-join on `context_key`, folded per opponent by `versus.ts foldHeadToHead`:
  - same side → the together record;
  - both rows have an outcome → A's outcome;
  - a golf round with no outcome → lower gross wins, over the same number of holes only;
  - anything else → played, no result.
- **Tom's rule: the athlete chooses what shows,** in the Stats area under the sport. `GET/PUT /api/profile/[id]/rivals`:
  - The athlete (or a guardian) sees every rival, with Show / Hide. None is shown by default.
  - Others see only the shown ones, plus their OWN record from their side.
  - A stranger to a private profile sees nothing.
- **Who may choose:** the athlete themself (unless supervised) or a guardian. **No profile holds a self `owner` access row**, so `requireProfileRole` alone refuses the athlete. The followers route's rule applies instead.

## Live cheers

- **The feature:** six keys, never text and never a name (**anonymous by design**, so no contact surface), on a live `group_post:` or `sport_event_round:` round.
- **`/api/live/cheers`:** the context's own gate re-runs on every read and write (`canViewSharedRound` / `readSportEventAccess`), and a refusal is a 404.
  - Reading works for anyone who may watch.
  - Cheering needs a session and a live round.
  - The `cheer` bucket applies. Like a like, it isn't on the write-gate list.
- **"Live" follows the event round.** An event's golf group post stays `pending` until its first score. A casual round is live while pending or active and not gone quiet. `last_score_activity_at` is derived from the newest card write; it is **not a column**.
- **The client:** `useCheers` polls every 10 s while visible. The floats are portaled to `<body>` at `z-[70]`, above the score-entry sheet.
- The daily cron purges cheers after 30 days.

## Friend challenges

- **The terms** (`challenges.ts`): the sport's vocabulary, where `lower` means *beat* (strictly under) and `higher` means *reach* (at or over).
  - A golf score defaults to 18 holes; a 9 never answers it.
  - Windows run 1–90 days.
  - Status: pending → accepted | declined | cancelled | expired; accepted → won | lost | cancelled.
- **`challenges-server.ts`** is the one writer.
  - Mutual follows only. Never across a block or a mute in either direction, and **the refusal never says which rule failed**.
  - It honours `challenges_enabled`, with 10 open at most per challenger.
  - It runs behind the write gate (THE list is 18 routes) and a daily `challenge` bucket.
- **Answering:** Accept / Decline from the bell (`challenge` is in `ACTIONABLE_TYPES`) or from the Stats panel, compare-and-set on `version`.
  - An accept settles at once when a result already in the window answers it.
  - Settling otherwise happens in the post-write hook.
- **The daily cron** expires unanswered challenges and marks accepted ones lost.
- Guardians get a copy of every challenge bell.
- **The UI:**
  - ⚡ on your own result (prefilled; "at <course>" is resolved on the server from your own round);
  - `ChallengeComposer` is its own dialog at `z-[65]`. `LargerWindow` is read-only and sits at z-50, *under* `PostDetailModal`;
  - `ChallengesPanel` in your own sport layer, plus "Your challenges" across sports in the All view, so a challengee with no results in that sport still gets the bell's link;
  - `?challenge=` deep link.

## Parked (decided)

- **Org contest lines' side / outcome.** A fixture's score lands after its lines, so an outcome written with the lines would be wrong. Rivalries count those games as played, with no result, until the contest sync stamps them.
- **Re-stamping match rounds completed before P2.** The backfill replays mappers, not matches.
- **Targeted cheers in the UI.** The API takes a player target; the bar cheers the round.
- **A contest-page share card,** and a badge share card.
- **`/feed?post=` re-rendering its modal on the first data pass,** which can drop a composer opened in the first instant. The fix belongs to the feed modal.

## Tests

- **Unit:** `src/lib/play/__tests__/` and `src/lib/performance/__tests__/` (context, hole counts, match outcomes).
- **e2e:** `e2e/play-{badges,share-card,rivals,cheers,challenges}.spec.ts`, 20 tests across desktop, mobile and webkit-mobile. Each uses fresh QA users, so nothing leaks between specs.

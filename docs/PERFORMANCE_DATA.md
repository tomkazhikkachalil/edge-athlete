# Performance data — the common shape

**Status:** migration 194 (`athlete_performances`) written Sep 13 2026 (data
foundation, F3). The writers (F4), the backfill (F5) and the first reader,
the scout search (F6), follow in their own PRs. Existing readers (the golf
stats hub, the profile tiles, the standings) keep their own tables; this
table is a projection none of them depends on yet.

## Why

Tom's stated vision is a multi-sport ANALYSIS / RECRUITING dataset. The
platform held two performance shapes that could not be queried together:

| Sport | Where the numbers lived | Provenance | Natural key |
| --- | --- | --- | --- |
| Golf | `golf_rounds` + `golf_holes` (+ the league's `contest_results` overlay) | the 152 ladder on the result only | convention (profile, date, course) |
| Every stat-line sport | `posts.stats_data` JSONB | none ('tracked' inferred at render) | none |
| Org-entered lines | `contest_stat_lines` | stored | (contest, profile) |

A recruiter's question ("who has verified results since March") needed three
queries, three shapes and no shared provenance. `athlete_performances` is ONE
table with one row per event per athlete.

## The shape (migration 194)

| Column | Meaning |
| --- | --- |
| `profile_id` | the athlete; nullable and `ON DELETE SET NULL` since 238 — when the person leaves, the fact stays and the link is severed (Tom, Sep 24 2026) |
| `sport_key` | the registry key |
| `occurred_on` | the event's day (`date`) |
| `source` | HOW the fact entered: `post` · `live_round` · `org_entry` · `import` |
| `source_table` / `source_id` | the origin row (`posts` · `golf_rounds` · `contest_stat_lines`) |
| `natural_key` | `post:<id>` · `golf_round:<id>` · `contest_stat_line:<id>` — UNIQUE |
| `contest_id` | the contest, when the fact belongs to one (SET NULL) |
| `provenance` | the 152 five-rung ladder, DEFAULT `self_reported` |
| `dispute_status` | `none` · `disputed` · `resolved` |
| `entered_by` | who wrote it, for an org entry (SET NULL) |
| `metrics` | NUMERIC-ONLY `{key: number}` in the sport's stat-schema vocabulary |
| `context` | non-numeric facts: `{opponent, result, result_score}` or `{course_id, course, tee}` |
| `headline` | the sport's ONE number (stat line: `schema.heroStat`; golf: gross) |

Golf metrics are normalised: `gross`, `to_par` (gross − par), `holes`,
`putts?`, `fir_pct?`, `gir_pct?`, `differential?` — the differential ONLY
when the round carries a course rating and a slope, by `handicap.ts`'s
exact formula, never estimated.

Indexes: `(sport_key, occurred_on DESC)`, `(profile_id, sport_key,
occurred_on DESC)`, `(sport_key, headline) WHERE headline IS NOT NULL`,
`(source_table, source_id)`, GIN `(metrics jsonb_path_ops)`. Posture A: RLS
on, zero policies, REVOKEd — service-role only, app-layer authz.

## The invariants

1. **One fact per event.** A golf league result is an OVERLAY on the round's
   row (`contest_id`, `provenance`, `dispute_status`, `entered_by`) — never
   a second row. `golfOverlayFromResult` reads the round from the result's
   `payload.roundRef.roundId`.
2. **`natural_key` is the origin row id**, never (contest, profile): a
   stub-profile claim re-points `profile_id` and would orphan a composite
   key. Every write is an idempotent upsert on it.
3. **The writer never blocks or fails the user's write.** `write-server.ts`
   never throws: a missing table (pre-194: `42P01` / `PGRST205`) answers
   `{skipped: 'missing_table'}`; any other error is a `console.warn`
   (`[performance] …`) and `{ok: false}`. Every hook AWAITS it (serverless
   kills fire-and-forget) AFTER the origin write succeeded.
4. **Uniform batches.** A PostgREST upsert takes a batch's columns from its
   rows' keys, so a row written WITHOUT the overlay keys must never share a
   batch with one that has them (`groupUniformRows` splits them). That,
   with `provenance DEFAULT 'self_reported'`, is what lets a round edit's
   re-upsert leave an existing overlay untouched.
5. **A lost fact is a deleted row.** Every mapper answers `null` when the
   origin holds no fact (no gross, no finite stat, a pending post, a sport
   without a schema); the writer then deletes the key. Rows live and die
   with their origin: post delete, round delete, line delete. A person
   LEAVING is not a lost fact (238): the deletion engine sets
   `profile_id` to NULL and the row stays in the dataset, anonymous.
6. **The dataset stores nothing the schema does not define** (the posts
   route's 400 — F2) and nothing fabricated. A legacy line the backfill
   meets that fails the schema is skipped and counted, never repaired.

## Provenance semantics

The stored rung is what the WRITER could assert: `self_reported` for an
athlete's own post or solo round; the golf sync's `self_reported` until the
manager confirms (`league_verified`); a console entry's `club_recorded` /
`league_verified` by authority; `imported` from a file. `sanctioned` is
DERIVED at read from the live sanctioning edges (`orgs/sanction-reads.ts`)
— the org graph mutates, so a stored rung is a floor, never a ceiling. A
`disputed` row stays on the table and leaves the headline reads
(`provenanceAtOrAbove` + the dispute filter in the reader).

## What is NOT stored

Media, captions, hole-by-hole scores, visibility (derived at read from the
post's status and the profile's visibility), derived indexes (the handicap
index is a rolling computation over rounds — `handicap-server.ts` — never a
per-event fact), and any number the sport's schema does not define.

## Sources and hook sites (F4)

| Origin | Hook | Writer call |
| --- | --- | --- |
| stat-line post create / guardian approval | `posts/route.ts`, the approval flip | `upsertPerformances([fromStatLinePost(post)])` |
| post delete | `delete-post-server.ts deletePostCascade` | `deletePerformancesByKeys([naturalKey.post(id)])` |
| solo golf round (after `calculate_round_stats`) | `post-write.ts createGolfRoundEntities` | `syncGolfRoundPerformance(admin, roundId)` |
| round PATCH (after recalc) / DELETE | `api/golf/rounds/[roundId]` | sync / delete by key |
| live / shared round mirror | `round-mirror.ts mirrorCompletedRound` | sync per participant round |
| round cascade delete | `round-delete-server.ts` | `deletePerformancesBySource('golf_rounds', ids)` |
| golf league sync | `golf-league-server.ts` after the results upsert | `syncGolfRoundPerformance(admin, roundId, overlay)` |
| manager confirm | `confirmGolfContest` | the overlay re-applied as `league_verified` |
| org stat line PUT / DELETE | `stat-lines-server.ts` | `upsertPerformances([fromContestStatLine(...)])` / delete by key |

Account deletion (departed accounts, migration 238): the engine
(`src/lib/account-deletion.ts`) sets `athlete_performances.profile_id` to
NULL for everyone who leaves — a tombstone, a masked minor and a full
erase alike (the FK is `SET NULL`) — so the dataset keeps every fact and
names no one. Readers that group by athlete skip a NULL `profile_id` (the
scout search does, `recruiting/search-server.ts`).

## Backfill (F5)

`POST /api/admin/performance-backfill` projects the rows that predate the
F4 hooks. Admin-only (`requireAdmin`, the storage sweep's shape),
**dry-run by default** — writing needs an explicit `{ "dryRun": false }`.

Body `{ source, cursor?, dryRun? }`; one source per call:
`golf_rounds` · `posts` · `contest_stat_lines` · `contest_results`.
Keyset-paged on `(created_at, id)` (never OFFSET), 500 rows a page, at
most 10 pages a request; the answer is
`{ dryRun, source, scanned, mapped, skipped: {reason: n}, upserted,
truncated, nextCursor }` — continue with `nextCursor` while `truncated`.
Idempotent by `natural_key`, so a re-run costs nothing. A dry run never
touches the target table (it works pre-194); a live run pre-194 answers
409.

**Run order** (the overlays must win): `golf_rounds` → `posts` →
`contest_stat_lines` → `contest_results` LAST. Dry each source first and
read the `skipped` reasons (`no_gross`, `pending_approval`,
`not_a_stat_line`, `failed_schema` — a legacy line the schema refuses is
counted, never repaired — `no_sport`, `no_round_ref`, `round_missing`),
then run it live. The pure half (`backfill.ts`: the opaque cursor, the
keyset filter, the page maths) is unit-tested; `backfill-server.ts` is the
I/O.

## The first reader (F6)

`GET /api/scout/search` gains `since` (YYYY-MM-DD), `minProvenance` (a
stored rung; this rung and above on the ONE ladder — `rungsAtOrAbove`,
where `imported` sits above `self_reported`) and `minHeadline` (the
sport's one number at or better, by `HEADLINE_DIRECTION`). They apply only
WITH a sport. One bounded pass over the table (2,000 rows, newest first,
disputed rows out) yields the profile ids; a `post`-sourced row counts only
while its post is public and published (the table stores no visibility);
the profiles query narrows to those ids and `isRecruitable` is re-applied.
A missing table answers `performanceFilters: false` and the filters are
ignored. The form exposes "Active since" and "Verified only"
(`minProvenance=club_recorded`); `minHeadline` stays API-only until a
per-sport label exists.

## The second reader — career and season rollups (Round 3, Sep 22 2026)

`GET /api/performance/rollups?profileId&sport` is the ATHLETE-facing read:
`src/lib/performance/rollups.ts` (pure) folds one profile × sport into the
SPORT's seasons (`seasonKey`: hockey / basketball / volleyball run autumn
to spring — `SEASON_START_MONTH`; the rest the calendar year), computes
the schema's `profileTiles` per season and for the career (count / sum /
avg / min, the stat-line route's computations), bests per metric with the
date in the sport's direction, provenance counts per season, and the hero
number over the last ten events for a trend. `rollups-server.ts` reads
newest first, disputed rows out, capped at 2 000 (`truncated` says when);
a non-owner's view re-checks every `post`-origin row against the post's
visibility in ≤ 200-id chunks (the first reader's rule). The owner is the
athlete OR their guardian (since Sep 26 2026, the skill-cards rule). The gate is the
stat-lines route's (owner ‖ public ‖ accepted follower); the answer is
`private, max-age=60` — viewer-dependent, never a shared cache.
`SeasonRollups.tsx` renders it at the top of the stat-line Stats tab. The
old card (`stat-line.ts buildStatsCard`) still reads the last 100 posts of
ONE source (`stat-line-posts.ts fetchStatLinePosts`): public ones for a
stranger, every one on the OWNER's view (self or guardian — the
privately cached `/api/profile/[id]/skill-cards` and the guardian roster
pass `includePrivate`; the CDN-cached `/u/` payload never does). Retiring
it for the rollups is the next step once the Stats tab has shown the
rollups for a while.

## Results are never lost (migration 241, Sep 26 2026)

Tom: *"I eventually want the information taken about the athlete to be incredibly accurate, at least on the backend. The user can have their profile viewed as they would like. However, any data metrics recorded will go towards understanding what the athlete's athletic score is."*

- **A person hides; nobody but support removes.** "Delete" on a golf round, a stat line, an event post or a scored shared round is a HIDE (`src/lib/results/hide-server.ts setResultHidden`, the one writer): `golf_rounds.profile_hidden_at`, or `posts.status = 'profile_hidden'`. It never touches this table, the handicap or the leaderboards. Ordinary posts (photos, notions, vitals) still delete. The event opt-out (`hide_from_profile`) is the same profile hide.
- **Items vs metrics.** A hidden round leaves the round LISTS and its page for other viewers (the owner sees it, marked). Every AGGREGATE (handicap, stats, trends, skill cards, rollups over golf rows) and every row here keep counting it. Settings → Privacy lists what is hidden, with Show again (`/api/results/visibility`).
- **Official results** (`src/lib/results/official.ts isOfficialOrigin`: a club / league host, an org competition, a linked contest, or provenance `club_recorded` and up; `origin-server.ts resolveResultOrigin` walks every link and fails CLOSED): their player cannot untag, re-tag or rewrite them (409, `OFFICIAL_RESULT_REFUSAL`), only hide them. An org taking a person off one (a stat-line delete, a media untag, an entry removal) bells that person and logs `official_tag_removed`.
- **Corrections are support's** (`src/lib/results/correction-server.ts`, on a ticket, owner-only): move a result WHOLE to the right person (this table's `profile_id` moves with the mirror and the stat post; the org's contest drops the wrong person and re-syncs); correct a card or a line (before and after in the authority log; `entered_by` kept, so the rung stays); remove a mistaken result (the only removal of a played result).
- **The delete allowlist** (`src/lib/__tests__/results-hide.test.ts`): only named writers may `.delete()` a `golf_rounds` or `athlete_performances` row — account erasure, an unplayed round, a failed round's rollback, support's removal, this table's own writer. A new deleting path fails the gate.

## Files

- `database/migrations/194_athlete_performances.sql` — the table + check grid
- `src/lib/performance/types.ts` — the row shape, `naturalKey`, `HEADLINE_DIRECTION`
- `src/lib/performance/map.ts` — the pure mappers + `groupUniformRows`
- `src/lib/performance/write-server.ts` — the one writer
- `src/lib/performance/backfill.ts` / `backfill-server.ts` — the backfill's pure half and its I/O
- `src/lib/performance/rollups.ts` / `rollups-server.ts` — the second reader (Round 3)
- `src/app/api/admin/performance-backfill/route.ts` — the admin door
- `src/lib/performance/__tests__/map.test.ts`, `backfill.test.ts` — the pinned invariants

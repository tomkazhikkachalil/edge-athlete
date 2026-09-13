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
| `profile_id` | the athlete (CASCADE — their data dies with them) |
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
   with their origin: post delete, round delete, line delete, and the
   profile cascade.
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

Account deletion is covered by the profile cascade.

## Backfill (F5) and the first reader (F6)

`POST /api/admin/performance-backfill` (admin, dry-run by default, keyset
pages, idempotent by `natural_key`) runs per source in this order:
`golf_rounds` → `posts` → `contest_stat_lines` → `contest_results` last so
the overlays win. The scout search gains `since`, `minProvenance` and
`minHeadline` over this table; `HEADLINE_DIRECTION` (golf and track are
lower-is-better) decides the order.

## Files

- `database/migrations/194_athlete_performances.sql` — the table + check grid
- `src/lib/performance/types.ts` — the row shape, `naturalKey`, `HEADLINE_DIRECTION`
- `src/lib/performance/map.ts` — the pure mappers + `groupUniformRows`
- `src/lib/performance/write-server.ts` — the one writer
- `src/lib/performance/__tests__/map.test.ts` — the pinned invariants

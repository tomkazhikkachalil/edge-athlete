# Database Migrations — canonical guide

## The one source of truth

**`database/migrations/`** holds the numbered migrations — the directory listing
is the source of truth for the current range. They are the canonical schema
history and are applied **in order** via the Supabase SQL editor (this project
does not use the Supabase CLI migration runner).

There is **no automated migration tracking**, and **`DEVLOG.md` is the authoritative
record of what has actually been run** — each migration's DEVLOG entry states when it
was applied and how it was verified live. The table below stops at `030` and has not
been maintained since; treat it as history, not as a checklist. It is left capped
rather than half-filled because a partial list presented as complete is worse than no
list — read the migration file's own header (every one carries pre-flight and
verification queries) and confirm against the live schema.

## Writing a migration: verification must not be able to roll it back

**The Supabase SQL editor runs a whole script as ONE transaction.** A
verification block that ends in `RAISE EXCEPTION` therefore discards every
change above it. Migration `082` learned this the hard way: it repinned two
functions, called one to prove the repin worked, the call raised — and
Postgres rolled the `ALTER`s back with it. A live probe afterwards showed both
functions still failing with the *original* error, i.e. **nothing had been
applied at all**.

So when someone reports "I ran it and got an error", the default assumption is
**nothing was applied**, not "applied but the check failed". Re-probe before
concluding anything.

Write verification so a failed check reports without aborting:

```sql
DO $$
BEGIN
  BEGIN
    -- the check
    RAISE NOTICE '0NN OK — ...';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '0NN CHECK FAILED: % [%] — the repair above is still committed',
      SQLERRM, SQLSTATE;
  END;
END $$;
```

`RAISE EXCEPTION` is still right for a **pre-flight guard** — something that
should genuinely abort the migration before it changes anything (wrong schema
version, missing prerequisite). It is wrong for a post-change check.
`083` is the worked example of both halves.

## Applied migrations (this table stops at 030 — see the note above)

`001`–`030` have all been run in production and verified. Notable ones:

| # | What |
|---|---|
| 020 | Schema cleanup — `activity_mode` replaces `golf_mode` |
| 022 | `get_profile_media_counts` fix after 020 |
| 023 | Drop `posts.golf_mode` |
| 024 | `get_unread_message_count` RPC (was never defined) |
| 025 | Fix `notify_profile_tagged` (tagging was broken in prod) |
| 026 | Unread count floored at `joined_at` |
| 027 | `waitlist` table |
| 028 | Notification types: `group_invite`, `group_update` |
| 029 | `profiles.onboarded_at` (onboarding gate) |
| 030 | `notification_preferences.last_digest_at` (email digest) |

## Most recent (verified live)

| # | What | Verified |
|---|---|---|
| 061 | `group_post_media.segment_number` / `segment_kind` / `duration_seconds` — media attaches to a sport-agnostic segment (hole/inning/quarter/set/lap). Backfilled from `hole_number`, which was dual-written until migration 076 dropped the column (run + verified Aug 10, 2026; the media routes still ACCEPT `hole_number` as a request-body alias for old clients). **No CHECK on `segment_number`** — bounds live per-sport in `src/lib/sports/segment-schemas.ts`, because a DB ceiling would need a migration per sport and would reject extra innings. | Aug 1, 2026 — columns present, backfill complete and faithful across all tagged rows |
| 062 | `group_post_media.is_highlight` + **`media_update_policy`** — the UPDATE policy the table never had (004 created SELECT/INSERT/DELETE only, so with RLS on, every UPDATE was denied and media could not be reassigned). Both `USING` and `WITH CHECK`, or an UPDATE could move a row into another round. | Aug 1, 2026 — column present; policy exercised live: owner reassigns, logged-in stranger 403, anonymous 401 |
| 063 | Public-round SELECT policies for `group_post_participants` (branch 035 dropped), `golf_participant_scores` and `golf_hole_scores` (never had one) via a new `can_view_group_post()` SECURITY DEFINER helper — non-participant viewers of a public live round saw media but zero players/scores, and realtime score events were RLS-filtered to nothing. Also re-asserts the 038/031 realtime publication (still no verified-run record). Order-independent with the code deploy; the scorecard REST route now enforces access app-layer (`round-access.ts`), so this migration is specifically what makes REALTIME reach viewers. | Aug 3, 2026 — behaviorally verified live with a disposable stranger account: direct PostgREST reads of participants/scores/hole-scores return rows for a public round and zero for a private one, and a realtime `golf_participant_scores` UPDATE event reached the stranger's subscription in seconds (publication + subscriber RLS both proven) |

## Workflow for a new migration

1. Add `NNN_short_name.sql` to `database/migrations/` with a header block:
   what/why, a **pre-flight** query section, and an **order-of-operations** note
   if code must ship before or after it — and, from 227 on, **the ledger
   footer** before the result row (a unit test refuses a file without it):
   ```sql
   INSERT INTO public.schema_migrations (number, name) VALUES (NNN, 'NNN_short_name.sql') ON CONFLICT (number) DO NOTHING;
   ```
2. Run it in the Supabase SQL editor (the file records itself in the ledger).
3. Verify against the live DB (the established pattern: query via PostgREST with
   the service-role key; for DDL that drops columns, scan `pg_proc` for function
   bodies referencing the dropped object — Postgres does **not** block
   `DROP COLUMN` on function bodies, they break at runtime; see migration 022's
   lesson).
4. Record it in `DEVLOG.md`.

SQL conventions (ported from the retired `docs/MIGRATION_GUIDE.md`, which
otherwise contradicted this file): write idempotent SQL (`IF NOT EXISTS`,
`DROP ... IF EXISTS` before `CREATE` for functions); never modify an existing
migration file — add a new number; use `(select auth.uid())` (not bare
`auth.uid()`) in RLS policies for performance; SECURITY DEFINER functions set
`search_path = ''` and fully qualify table names. **Every foreign key ships
with an index whose leading columns are its columns** (migration 239, Sep 25
2026): without one, deleting the referenced row makes the RI trigger scan the
whole child table. `src/lib/__tests__/fk-index-coverage.test.ts` fails the
gate on an FK added without it; `database/tests/diagnostics/verify-239-fk-
indexes.sql` is the same rule against a live database.

## Provenance — every live table and column is named by a numbered file

**The rule (data foundation, Sep 2026).** Every table and column that exists
in the live database is defined by a numbered migration in this directory,
or is listed in `database/provenance/allowlist.json` with the file it came
from and the migration that will record it. `npm run check:schema` proves
it: it pulls PostgREST's OpenAPI definitions with the service key (LOCAL
only — never `verify`, never CI), parses this directory for what the chain
OWNS (`scripts/schema-inventory-core.mjs`: a `CREATE TABLE` owns a table and
its inline columns; `ALTER TABLE … ADD COLUMN` owns a column; an ALTER on a
table the chain never created does NOT own the table; a mention in a policy
or an index is not ownership), and exits non-zero on drift or on a stale
allowlist entry. The allowlist only ever shrinks.

**Why.** Thirteen live tables — the social core (posts, post_comments,
post_likes, post_media, comment_likes, follows) and the athlete legacy set
(athlete_equipment, sports, performances, season_highlights,
athlete_badges, privacy_settings, connection_suggestions) — were created by
archived scripts, some under `archive/failed-attempts/`; the chain has been
ALTERing them for a year. `golf_rounds`' six condition columns (two of them
feed the WHS handicap) live only in `database/features/golf/`; `profiles`
was created by 001 with a subset of its columns; `post_media.width/height/
duration` exist nowhere in the repo. A schema with no single source of
truth is corrosive for an analysis / recruiting dataset.

**The method — live truth, never the archive.** `database/provenance/
live-dump.sql` is ONE read-only `pg_catalog` statement whose single result
carries eight tagged grids (columns with precision, constraints, indexes,
RLS + grants, policy bodies, triggers and their functions, row counts) —
one statement because the SQL editor shows only the LAST statement's
result; pasted in, exported (the results panel's CSV download — a 552-row
"Copy as Markdown" paste freezes a terminal; markdown is fine for a small
grid), committed verbatim under `database/provenance/dumps/`
(`2026-09-14-live-dump.csv` is the one the baselines cite). The baseline
migrations **190 social core · 191 athlete legacy · 192 golf conditions ·
193 profile measurables** (Sep 14 2026) were written FROM it: `CREATE TABLE
IF NOT EXISTS` with the live shape, `ADD COLUMN IF NOT EXISTS` per column
no numbered file adds, constraints and policies behind a `pg_constraint` /
`pg_policies` lookup with their bodies verbatim, `CREATE INDEX IF NOT
EXISTS` by the live indexdef, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`,
and `CREATE OR REPLACE` ONLY for the trigger functions no numbered file
defines (the ones a file does define stay with their owner) — a NO-OP on
production, each ending in a SELECT-only check grid that reads the same
before and after, with a re-runnable twin under `tests/diagnostics/
verify-19N-baseline.sql`. The allowlist has been EMPTY since 193. A
baseline never "improves" live behaviour; what it finds odd (two count
triggers on post_likes / post_comments, bare `auth.uid()` in three
equipment policies, a 'followers' visibility value, the absent
`idx_golf_rounds_round_type`) it RECORDS in its header for a later
migration to decide.

**Policies and functions — the catalog facets (provenance round, Sep 15
2026).** PostgREST's OpenAPI cannot see RLS policies or function bodies, so
migration **195** adds `public.provenance_inventory()` — a zero-arg,
`STABLE`, `SECURITY INVOKER`, SERVICE-ROLE-ONLY RPC that reads `pg_catalog`
and returns one jsonb: `rls` per public table, every public `pg_policies`
row (roles, cmd, qual, with_check), every public non-extension function
(identity args, returns, language, secdef, config, `md5(prosrc)`, a
whitespace-normalised md5, `pg_get_functiondef`, acl, owner) and every
non-internal trigger (informational). `npm run check:schema` POSTs it with
the service key (no owner paste, ever) and `scripts/schema-inventory-
catalog.mjs` reads the chain with an OFFSET-PRESERVING mask (comments and
literal interiors blanked, dollar tags kept, so a function body is sliced
from the raw text exactly as Postgres stores it — a `--` inside a body is
body), recursing into `DO $$` blocks (the guarded CREATE POLICYs) and
`EXECUTE $tag$` strings (014); `EXECUTE format(…)` is a DYNAMIC SITE,
resolved through the enclosing block's `proname = '…'` literals (every
dynamic DROP / ALTER FUNCTION in the chain) and left honestly unresolved
for 052's array-driven policy loops. The rules: a live POLICY must be named
by a numbered file whose LAST statement for it is a CREATE with the same
cmd, roles and permissiveness, and every policy the chain still claims must
exist live (a stale claim = an archived script dropped or renamed it —
recorded by the baseline as `DROP POLICY IF EXISTS`); a live FUNCTION must
be defined by a numbered file whose last definition (matched by name +
normalised argument types — two real overloads exist) has the SAME BODY
(md5 of the exact dollar-quoted text vs `md5(prosrc)`), the same SECURITY
DEFINER flag and the same `search_path`; a body that differs only in
whitespace is informational (a paste artefact, not drift). Policy BODIES
are recorded verbatim by the baseline and never compared statically
(`pg_get_expr` reformats). Extension-owned functions (`show_limit`,
`show_trgm`, `unaccent` live in public) are excluded via `pg_depend`;
`storage.objects` policies are out of scope (a Supabase-managed schema).
Flags: `--catalog <json>` (a saved RPC response), `--save-catalog`
(writes `database/provenance/dumps/<date>-catalog.json`, the evidence a
baseline cites), `--facet tables|policies|functions`. Before 195 has run
the RPC answers PGRST202 and the two facets are skipped with a notice.
`verify-195-rpc.sql` re-asserts the RPC's presence and its grants.

**Triggers and grants — two more catalog facets (hygiene sweep, Sep 16
2026).** The same RPC carries every non-internal trigger and every
function's `proacl`, so `check:schema` now also requires: every live
TRIGGER to be named by a numbered file whose last statement for (table,
name) is a CREATE with the same normalised tuple — timing, sorted events
(+ `UPDATE OF` columns), level, function + arguments, WHEN (lowercased,
`::text` casts and doubled parens stripped — 190's pg_dump spelling and
008's hand-written one are the same trigger), constraint / deferrable —
and every live function's EXECUTE GRANTEES to equal the set the chain
SIMULATES: Supabase's default {PUBLIC, anon, authenticated, service_role}
on a fresh CREATE (never on CREATE OR REPLACE over a function the chain
already created or already GRANTed / REVOKEd — the archive-created,
040-locked, 190-re-declared notify_* case), minus every REVOKE, plus every
GRANT, literal or dynamic (`proname` literals, `FOREACH … IN ARRAY
ARRAY['…']` lists, `%I()` naming the zero-arg key). The parser also reads
the four triggers 003 / 014 create inside `EXECUTE '…'` strings. SECURITY
DEFINER functions executable by an API role are an ADVISORY, not drift:
RLS helpers evaluate as the invoking role and must stay executable, and
trigger functions need no EXECUTE to fire. The first run over the Sep 14
catalog found ONE unowned trigger (`group_posts.trigger_group_posts_updated_at`,
from `archive/loose-legacy/add-shared-golf-rounds.sql`) and no grant drift
— migration 198 records it.

**Cleaned in 199 (hygiene sweep, Sep 16 2026).** What the baselines
recorded as redundant is gone: the archived policy sets on three golf
tables (14 policies, every one byte-identical to or implied by the chain's
set — except the creator branch of the participant-scores UPDATE policy,
FOLDED into the chain-owned `golf_scores_update_policy` first, because the
SECURITY INVOKER totals trigger needs it), the two duplicate count
triggers, the duplicate group_posts `updated_at` trigger 198 had just
recorded, both `mark_all_notifications_read` overloads (no caller; one
never worked), and the `athlete_badges` table (never a row; the app
stopped naming it in the PR before). It also REVOKEd API-role EXECUTE on
the four SECURITY DEFINER trigger functions still carrying it — never on
an RLS helper. Every drop's proof is in 199's header; totals after:
107 tables · 172 policies · 105 functions · 97 triggers. **200** then fixed
the bug that analysis surfaced: `hole_scores_update_policy` now carries the
creator branch its INSERT and DELETE siblings always had (a creator
re-submitting a player's scores hit 42501 on the upsert).

**Owned since 196 / 197 (provenance round, Sep 15 2026).** The first live
run of the catalog facets found 56 live policies no numbered file created,
29 policies the chain still claimed that production had lost, 5 functions
no file defined, 8 function bodies that differed from the chain's last
definition (none whitespace-only) and 9 `search_path` drifts — all of it
from archived scripts. **196 `baseline_policies`** recorded the 56
verbatim (052's loop products literal for the first time; three golf
tables' redundant policy sets as found) and dropped the 29 stale claims;
**197 `baseline_functions`** re-declared the 13 functions exactly as
`pg_get_functiondef` prints them, with their live EXECUTE grants, and
pinned the one config-only drift — both NO-OPS, each with an md5 / count
grid and a `verify-19N-baseline.sql` twin. `check:schema` is OK on every
facet with the allowlist still EMPTY. Two chain claims sit on a table 001
created that is not live (`athlete_clubs`) — table provenance's business,
not a policy stale claim. Informational only, by design: whitespace-only
body differences (a paste artefact), chain-only functions (a dynamic drop
explains each), the RPC's `triggers` array (a triggers facet is parked, as
is treating grants as gating).

**Loose files that never reached production** (absent from the live
schema; reference only): `features/golf/setup-shared-golf-scorecards.sql`,
`archive/loose-legacy/add-shared-golf-rounds.sql`.

**Large-table indexes.** The editor runs a file as one transaction and
`CREATE INDEX CONCURRENTLY` cannot run inside one. A migration that adds an
index to a table with real volume ships as TWO files: `NNN_name.sql` (the
transactional part) and `NNN_name.indexes.sql` (each statement
`CREATE INDEX CONCURRENTLY IF NOT EXISTS …`, pasted and run separately,
verified by its grid). A table created empty in the same migration may
index itself inline.

## "NNN ran" is a command, not a grid (Sep 16 2026)

`npm run check:schema` asks the schema question BOTH ways: every live
table and column must be owned by the chain (or documented), AND every
table and column the chain owns must be live — a `CHAIN-ONLY` line names
the migration that has not run. That is the ONLY accepted proof that a
migration ran. Why: on Sep 16 2026 #761 (which selects 207's columns on
every event read) was merged before 207 had run; the forward-only check
stayed green, prod's Events API answered 42703 on every read, and the
diagnostics twin's nine-row grid was pasted four times as "207 ran".
Two conventions follow, applied from 207 on:

- **A migration ends in ONE result row**, never a grid:
  `SELECT 'NNN APPLIED' AS result, <count>_expect_<n>, …` — what the
  editor shows cannot be mistaken for anything else.
- **The diagnostics twin (`tests/diagnostics/verify-NNN-*.sql`) is the
  grid**, its first row `'0 file' | '<its own filename>'`, and it must
  RUN before the migration (read a new column through
  `to_jsonb(row) -> 'col'`, never by name) so a missing column is a
  `CHECK FAILED` row, not a 42703 error.

208 (`notification_preferences_tag_column`) is the reverse question's
first finding: 008's `tag_notifications_enabled` never landed (live has
`tags_enabled`; nothing reads the 008 name) — a no-op DROP that retires
the claim. Phase 2b's migrations shift to 209–211; phase 3 (match play and
brackets) is 212 (the format vocabulary, `side`, `sport_event_matches`) and
213 (the match bell). Events phase 4 (every sport live, open joining, recorders,
media) is 214 (open joining + recorders), 215 (team rounds + live stat lines) and
216 (event media).

## The ledger — which files have run HERE (migration 226, Sep 21 2026)

`check:schema`'s reverse question sees tables, columns, policies,
functions, triggers and grants — not an index, a CHECK, a default, a
backfill or a seed row, so a migration made only of those could be skipped
unseen; and a second environment (staging, Round 2 of the Sep 19
assessment) had no way to say "I am at 224". `public.schema_migrations`
(`number`, `name`, `applied_at`, `applied_by`; service-role only) is the
answer:

- **From 227 on every migration ends with the one-line footer above** —
  the file records itself; the SQL editor stays the runner; nobody types a
  number. 226 seeded 001–225 as `backfill-226` (the true dates are in
  `DEVLOG.md`, never recorded in the database). The chain has **no 217**
  (skipped, unrecorded — 226's header); `migration-ledger.test.ts` pins
  the numbering as contiguous with that one gap.
- **`npm run check:schema` compares the ledger to the chain** — `NOT RUN
  here` names the files to run, top to bottom; `LEDGER-ONLY` is a row with
  no file in the repo. A wrong head fails the command like any drift.
  Before 226 has run the facet is skipped with a notice.
- **`npm run migrate:mark <n>`** (and `-- --unmark`) is the correction path
  only: a file that ran before its footer existed, or a row removed by
  hand. It never runs the migration.

"NNN ran" therefore has two proofs from 226 on: the reverse question
(the objects are live) AND the ledger (the file is recorded). Both must
agree; the diagnostics twin stays the grid for the human eye.

## To build an environment (Round 2, Sep 21 2026) — the chain does NOT replay

**Never run 001..N on a blank project.** `node scripts/chain-replay-scan.mjs`
proves it: `posts`, `post_media`, `follows` and `athlete_equipment` are
altered or referenced from 002–044 but created only by the Sep 14 baselines
190–191 (which recorded pre-chain tables verbatim), and 003 `RAISE
EXCEPTION`s if `follows` is missing — the replay stops at 002. The chain is
HISTORY (what changed, why, in order); it is not a build script.

A new environment is built from the LIVE schema instead:

1. **Generate** (from a machine with prod's service key):
   `npm run build:baseline` calls `public.schema_dump()` (migration 227,
   service-role only — extensions, enum types, sequences, every table
   with its columns, constraints, indexes, views, functions, triggers
   incl. `auth.users`', policies incl. `storage.objects`', grants for the
   three API roles, storage buckets, the realtime publication, the
   reference rows, the ledger head), saves the jsonb under
   `database/provenance/dumps/<date>-schema.json` and writes
   **`database/baseline/000_rebuild.sql`** in dependency order, every
   statement guarded. It then re-parses that file against PostgREST's
   live inventory: a table or column the generator dropped fails the
   build. Commit the regenerated file with the migration that changed
   the schema (or after a batch — the file's header names the ledger
   head it embodies).
2. **Run** `000_rebuild.sql` WHOLE in the new project's SQL editor. It
   ends in one result row (`000 REBUILT | tables | functions | policies |
   head`) and seeds the ledger with every chain file up to that head as
   `rebuild-000`.
3. **Prove it:** point `.env.local` at the new project; `npm run
   check:schema` must report 0 drift on every facet AND `Ledger OK`. That
   is the only proof the environment is built — never the result row.
4. **By hand, after:** the pg_cron jobs (not in the file — `cron.job` is not
   readable by the service role; 059 and 135 are the two
   — they need the NEW app URL and `CRON_SECRET`; staging has NONE by
   decision: previews have no stable URL); storage
   OBJECTS and the golf catalog (28k courses — data, not schema; copy
   with a one-off script when the environment needs it); auth users.
5. **From then on** the environment moves with the chain: run each new
   `NNN_*.sql` as it merges (the ledger records it), and `check:schema`
   against that environment stays the proof.

**The runner for a non-production project** is `node scripts/staging-sql.mjs
<file | -e "sql">`: Supabase's management API with a personal access token
(`SUPABASE_ACCESS_TOKEN` + `STAGING_PROJECT_REF` in `.env.staging`,
gitignored). It refuses the prod ref. Production's runner stays the SQL
editor. **Proven Sep 21 2026** on the staging project: one run, ~5 s,
re-runnable, `check:schema` clean, `schema_dump()` identical to prod's.

`scripts/rebuild-baseline-core.mjs` is pure and pinned by
`rebuild-baseline.test.ts` (the order, the column forms, the guards, the
parser reading it back); `scripts/chain-replay-scan.mjs` is the read-only
report of why this section exists.

## Views (migration 235, Sep 23 2026) — the chain's first

`leagues` and `clubs` are `security_invoker` VIEWS over `organizations` since 235
(Round 5 D). What that means for the tooling:

- **Grants on a new view are NOT clean.** Supabase's default privileges hand
  every new relation ALL to anon, authenticated AND service_role — a view needs
  its own `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` then the
  GRANT it deserves (235: `SELECT, UPDATE, DELETE TO service_role`, no INSERT).
  The owner (`postgres`) always shows every privilege in
  `information_schema.role_table_grants`; a grant assertion counts API roles.
- **The baseline carries the option separately:** `schema_dump()` v3 (234)
  records `reloptions`, and `rebuild-baseline-core.mjs emitViews` appends
  `ALTER VIEW public.x SET (security_invoker = true);` after the
  `CREATE OR REPLACE VIEW` — re-runnable, survives a body change.
- **The provenance parser** owns a view like a table (`CREATE OR REPLACE VIEW`)
  and captures ONE ident per `DROP TABLE` — never a comma list.
- **An auto-updatable view** (single table, plain columns, an alias allowed —
  `UPDATE clubs SET primary_sport` maps to `sport_key`) runs the base table's
  BEFORE triggers; not projecting `kind` is what keeps an UPDATE from moving a
  row across kinds, so no CHECK OPTION.

## ⚠️ Everything else is historical — do NOT run it

These directories are **reference only**. Running any script in them against a
live database is how prod breakage happens (an archived trigger script already
broke tagging once — see migration 025):

- `database/archive/` — superseded migrations and hot-fix scripts
- `database/archive/loose-legacy/` — stray SQL consolidated here from old
  `database-migrations/`, `supabase/migrations/`, and the repo root
- `database/features/` — feature-development SQL, folded into the numbered
  migrations
- `database/fixes/` — one-off fix scripts, folded into the numbered migrations

If you need something from these, port it into a new numbered migration rather
than running the file directly.

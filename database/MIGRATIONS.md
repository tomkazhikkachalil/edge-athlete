# Database Migrations — canonical guide

## The one source of truth

**`database/migrations/`** holds the numbered migrations — the directory listing
is the source of truth for the current range. They are the canonical schema
history and are applied **in order** via the Supabase SQL editor (this project
does not use the Supabase CLI migration runner).

There is **no automated migration tracking**, and **`docs/devlog.md` is the authoritative
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
   **Table grants (Supabase, from Oct 30 2026 — every migration ≥ 270):** Supabase no
   longer grants the Data API roles on a NEW table in `public` automatically.
   A table created without its grants answers `permission denied for table X`
   to supabase-js / PostgREST / GraphQL — for the server too. So **every
   `CREATE TABLE public.X` ships its grants in the SAME file**, one of two
   postures (`src/lib/__tests__/migration-grants.test.ts` fails the gate on a
   file ≥ 270 that creates a table without them):
   ```sql
   -- Posture A — the server's table: RLS on, ZERO policies, service_role only
   -- (the app reaches it through supabaseAdmin; anon / authenticated never do).
   ALTER TABLE public.x ENABLE ROW LEVEL SECURITY;
   REVOKE ALL ON TABLE public.x FROM PUBLIC, anon, authenticated;
   GRANT ALL ON TABLE public.x TO service_role;

   -- A policy table — anon / authenticated read or write it THROUGH its
   -- policies (the policies are the security layer; the grant only opens the
   -- door the policies then guard). Grant exactly what the policies allow.
   ALTER TABLE public.y ENABLE ROW LEVEL SECURITY;
   GRANT SELECT ON TABLE public.y TO anon;
   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.y TO authenticated;
   GRANT ALL ON TABLE public.y TO service_role;
   -- a serial / identity column: GRANT USAGE, SELECT ON SEQUENCE public.y_id_seq TO authenticated, service_role;
   ```
   A `REVOKE … FROM anon, authenticated` with no `GRANT … TO service_role` after
   it (71 older tables were written that way, when the automatic grant still
   covered the server) is the shape the test refuses by name: after Oct 30 that
   table would be unreachable. Existing tables keep their grants; the baseline
   (`database/baseline/000_rebuild.sql`) emits every table's grants explicitly
   (`emitTableGrants`, from `schema_dump()`'s `has_table_privilege` reads since
   228), so a rebuild is complete. `npm run check:schema` also runs
   `scripts/check-table-grants.mjs`: a live table with no service_role
   privilege is an error; a zero-policy table still holding anon / authenticated
   privileges is listed (hygiene, see `docs/HARDENING.md` B7).
2. Run it in the Supabase SQL editor (the file records itself in the ledger).
3. Verify against the live DB (the established pattern: query via PostgREST with
   the service-role key; for DDL that drops columns, scan `pg_proc` for function
   bodies referencing the dropped object — Postgres does **not** block
   `DROP COLUMN` on function bodies, they break at runtime; see migration 022's
   lesson).
4. Record it in `docs/devlog.md`.

SQL conventions (ported from the retired `docs/MIGRATION_GUIDE.md`, which
otherwise contradicted this file): write idempotent SQL (`IF NOT EXISTS`,
`DROP ... IF EXISTS` before `CREATE` for functions); never modify an existing
migration file — add a new number; use `(select auth.uid())` (not bare
`auth.uid()`) in RLS policies for performance; SECURITY DEFINER functions set
`search_path = ''` and fully qualify table names. **One permissive policy per
(table, command)** (migration 271, Oct 25 2026): supplementary access — a
guardian, a viewer role, a tombstone rule — is an `OR` arm INSIDE that
policy, never a second policy; Postgres evaluates every permissive policy for
the command on every row (the Performance Advisor's
`multiple_permissive_policies`), and a `FOR ALL` policy overlaps all four.
**Every foreign key ships
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
  `docs/devlog.md`, never recorded in the database). The chain has **no 217**
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
   readable by the service role; EIGHT by Oct 2026 — calendar-reminders,
   urgent-emails, push-sweep, golf-map-sweep, media-jobs,
   platform-health-sample, platform-rollup call `net.http_*`, cron-history-prune
   does not — they need the NEW app URL and `CRON_SECRET`; staging has NONE by
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

## An append-only audit table carries NO foreign keys (migration 240, Sep 25 2026)

`authority_audit` (like `org_staff_audit`, 178) is append-only: its trigger runs `forbid_mutation()` on UPDATE and DELETE. An FK with `ON DELETE SET NULL` is an UPDATE of the audit row, so the trigger REFUSES it — an FK to `profiles` would fail the deletion engine's profile delete (the 056 lesson), and an FK to `tickets` would fail `delete_ticket`. So an append-only table names people and tickets by bare uuid, and `authority-audit.test.ts` pins that its CREATE TABLE has no `REFERENCES`. The FKs 240 DOES add (`org_sites.held_ticket_id`, `org_claim_invites.ticket_id`, `org_site_news.deleted_by`) each have their leading index — the 239 coverage test holds every FK to it. A CHECK that forbids the NULL an FK's SET NULL would write (`org_claim_invites_recovery_shape`: a recovery token needs its ticket) makes the parent's delete fail too: the app deletes the children first (`deleteTicket`).

## RLS helpers live in `private`; the Security Advisor's accepted items (migrations 257–258, Oct 9 2026)

- **A SECURITY DEFINER function that an RLS policy calls goes in the `private`
  schema, never `public`.** `public` is exposed by the Data API, so every such
  helper there is callable at `/rest/v1/rpc/…` (the Advisor's lints 0028 /
  0029). `private` is not exposed; `anon`, `authenticated` and `service_role`
  have USAGE on it, the EXECUTE grants are the function's own, and policies
  reach the function by OID. 257 moved the eight existing helpers
  (`can_view_group_post`, `participant_group_post`, `hole_score_group_post`,
  `is_group_post_creator / _organizer / _participant`, `has_profile_access`,
  `is_conversation_participant`). A function BODY that calls one names it
  `private.<helper>` (257 re-declared `update_user_handle` for exactly that).
- **A trigger function needs no EXECUTE grant** — firing a trigger does not
  check the caller's EXECUTE; revoke it from PUBLIC / anon / authenticated.
- **`pg_trgm` and `unaccent` live in `extensions`.** A function that uses
  them sets `search_path = public, extensions` (as `search_normalize` does).
- **`schema_dump()` (258) exports `private` too** — the schemas with the API
  roles' USAGE and each function's schema — so `000_rebuild.sql` creates the
  schema and its helpers before the policies that call them.
- **`pg_net` lives in `extensions` (migration 272, Oct 25 2026 — this
  supersedes the Oct 9 acceptance).** It is non-relocatable, so the move is
  Supabase's documented `drop extension pg_net; create extension pg_net with
  schema extensions;` in ONE transaction. Nothing depended on the extension
  record: the pg_cron jobs that call `net.http_*` are SQL strings in
  `cron.job.command` (their `CRON_SECRET` inside them), not functions, so
  they survive the drop untouched; what is lost is the request queue and
  the response log — fire-and-forget pings to our own cron routes, which
  re-fire within minutes. The extension is owned by `supabase_admin` on both
  databases (Supabase's extension manager escalates trusted extensions) and
  the same manager runs the DROP / CREATE for `postgres` — staging proved it.
  The leaked-password protection is a dashboard toggle (Authentication →
  Attack Protection; Pro plan), not SQL.

## One permissive policy per (table, command); no duplicate indexes (migration 271, Oct 25 2026)

The Performance Advisor listed `multiple_permissive_policies` on 17 tables
(once per role, because every policy is `TO public`) and `duplicate_index` on
6. Both lints name real per-row work: Postgres evaluates EVERY permissive
policy for a command on EVERY row and ORs them, and a duplicate index is
written twice on every insert. 271 removes both without changing who sees or
writes what — the OR of each table's policies per command is the same before
and after.

- **The 052 arms are folded in.** 052 added the guardian feature's RLS as
  ADDITIVE policies (`<t>_guardian_write` FOR ALL, `<t>_profile_access_select`
  FOR SELECT) beside each table's own four, because the live base bodies were
  not known then. 190/191/196 wrote every base body out verbatim, so 271
  recreates the base policies with the arm as an `OR` term — owner arm first,
  so the common case short-circuits before `private.has_profile_access` runs —
  and drops the two 052 policies on posts, golf_rounds, athlete_achievements,
  athlete_equipment, workout_sessions / _exercises / _sets; the SELECT arm
  alone on golf_holes and post_media (inside the parent `EXISTS`),
  performances, season_highlights and profiles (238's `profiles_departed_select`
  tombstone arm folded into `profiles_select_policy` too).
- **athlete_vitals** has no owner UPDATE / DELETE policy (010; the routes
  write through `supabaseAdmin`), so its guardian `FOR ALL` could not fold
  into anything — it became two NARROW policies, `athlete_vitals_guardian_update`
  and `athlete_vitals_guardian_delete`, each the only policy for its command.
- **The byte-identical second sets are dropped:** `group_post_media_{select,
  insert,delete}_policy` (an archive script; `media_*` from 004 → 126 stays),
  `sport_settings_{select,insert,update,delete}_policy` (196, from an archive;
  076's "Users can … their own sport settings" stays), `"Users see own
  blocks"` (a SELECT twin of the FOR ALL `"Users manage own blocks"`).
- **One twin of each duplicate index is dropped**, the chain-owned name kept:
  `idx_group_post_media_group`, `idx_group_post_media_uploader`,
  `idx_group_post_participants_profile`, `idx_comments_post_created`,
  `idx_post_likes_post_id`, `idx_post_media_post_order`. Every FK stays covered
  (`fk-index-coverage.test.ts`). Not taken: `idx_post_media_post_id` is a
  leading-column prefix of the kept `(post_id, display_order)` index.
- **Pre-flight / proof — the lint in SQL** (31 rows before, 0 after):
  `SELECT tablename, c, count(*) FROM pg_policies, unnest(CASE cmd WHEN 'ALL'
  THEN ARRAY['SELECT','INSERT','UPDATE','DELETE'] ELSE ARRAY[cmd] END) c WHERE
  schemaname = 'public' AND permissive = 'PERMISSIVE' GROUP BY 1, 2 HAVING
  count(*) > 1`. Expected result row on both databases:
  `271 APPLIED | 0 | 0 | 0 | 145 | 271` (173 policies − 30 + 2). Staging ran it
  Oct 25 2026 with exactly that row; `check:schema` OK, head 271.
- **`schema-inventory-catalog.test.ts`** pins the fold: `posts_select_policy`
  created in 271 with the `has_profile_access` arm AND the `status =
  'published'` arm; `posts_guardian_write`, `golf_rounds_profile_access_select`,
  `group_post_media_select_policy`, `sport_settings_select_policy` and
  `"Users see own blocks"` dropped in 271; the two vitals policies created.
- A migration that only drops and recreates policies and drops indexes ships
  **no GRANTs** (the Oct 30 rule is about `CREATE TABLE`). The baseline is
  regenerated AFTER 271 runs on production (`npm run build:baseline`), as a
  separate PR.

## pg_net out of `public` (migration 272, Oct 25 2026)

The Security Advisor's `extension_in_public` for `pg_net` — accepted on Oct 9
(257) because "a drop + create pauses the cron jobs" — closed. Re-examined:
the pause is one transaction; the seven `net.http_*` jobs are text rows in
`cron.job` (059/135 → 246, 248, 255, 262, 268), never extension dependents, and
their `Bearer` secret is inside the command text; no function body calls
`net.*`; nothing grants on `net`. 272 therefore runs the documented move
(`create schema if not exists extensions; drop extension pg_net; create
extension pg_net with schema extensions;`) with guards (ledger ≥ 271; not
installed → NOTICE + skip; already in `extensions` → NOTICE + skip; any other
schema → refuse), a NOTICE of the queued requests about to be dropped, and a
post-check that `net.http_post(text,jsonb,jsonb,jsonb,integer)` /
`net.http_get(text,jsonb,jsonb,integer)` resolve, `postgres` keeps USAGE on
`net`, and every job still carries its secret. The extension's owner is
`supabase_admin` on both databases (the extension manager), and the SQL
editor's `postgres` still drops and creates it — staging proved it Oct 25:
`272 APPLIED | extensions | 0 | true | 0 | 272`. Expected on production:
`272 APPLIED | extensions | 0 | true | 7 | 272`; then within ~5 minutes
`platform_cron_runs()` shows fresh successful runs. If none arrive,
`SELECT net.worker_restart();` restarts pg_net's background worker. The
baseline regenerated after the prod run emits `pg_net WITH SCHEMA extensions`
by itself (the generator copies the live namespace). `check:schema` has no
extensions facet; the ledger row is the proof it ran.

## The live-round subscription is filtered to the round (migration 273, Oct 25 2026 — scale fix 1)

`useSharedRound` subscribed to `golf_participant_scores` table-wide; Realtime
delivers a change once PER SUBSCRIBER, so every score written anywhere reached
every spectator and live feed card (the fan-out probe on staging: 10 watchers
of round A received all 200 of round B's events). The hook now filters to the
roster (`participant_id=in.(…)`, ≤ 100 values — Supabase's cap) and listens to
the round's `group_post_participants` rows for a late joiner, which **273
publishes** (`ALTER PUBLICATION supabase_realtime ADD TABLE
public.group_post_participants`, guarded). After: 0 of round B's events reach
round A's watchers; round A's own 200 still do. Expected row on both:
`273 APPLIED | 5 | true | 273`. **A listener on an UNPUBLISHED table fails
its whole channel** (proven on staging Oct 25: with the table out of the
publication, one shared channel delivered no scores at all — the production
probe after #1299 caught it before 273 had run there). The hook therefore
keeps the roster listener on its OWN channel (`shared-round-roster:{id}`,
the follow-up PR): unpublished, only the joiner path waits for the poll; the
scores never do. Run 273 anyway — it is what makes the joiner path live.
`scripts/realtime-fanout-probe.mjs --mode unfiltered|filtered` is the
before/after (staging only).

## Search ranks on stored columns, same order (migration 274, Oct 25 2026 — scale fix 2)

`search_all` computed its ranking columns per MATCHED row — `search_normalize`
×2–3, `to_tsvector` ×2, and a tsquery PARSE per query token in
`search_token_hits` / `search_token_rank` — before the window kept 20 per
type: 0.15 ms a row, 478 ms for a common prefix at 2,471 documents, content-
bound. 274 adds `search_documents.title_norm` + `title_vector` (one BEFORE
INSERT OR UPDATE trigger, `search_documents_title_sync`, SECURITY DEFINER, no
API EXECUTE; the four sync functions are untouched; the backfill is an UPDATE
per entity_type that fires it) and REPLACES `search_all` (same signature,
RETURNS, SECURITY INVOKER, `search_path = public, extensions`, grants and
COMMENT restated) to read the columns and parse the token tsqueries once per
call. No index (neither column is a WHERE term). **Order unchanged by
construction and by proof:** the same nine queries' ordered lists before and
after are identical (`database/provenance/explain/2026-10-25/search-results-
{before,after}-274.json`); plans after: prefix 478 → 27 ms, two letters
355 → 26 ms, rare term 16.5 → 17 ms, athletes-only 78 → 13 ms. Check grid:
`database/tests/diagnostics/verify-274-search.sql`. Expected row on both:
`274 APPLIED | 2 | 0 | 1 | true | 274`.

## The cheer totals in one grouped query (migration 275, Oct 25 2026 — scale fix 5)

`readCheerFeed` ran SIX `count: 'exact'` head requests per poll (one per cheer
key — PostgREST cannot GROUP BY) plus the gate's two reads and the recent
read: nine statements every 10 s per watcher of a live round. 275 adds
`live_cheer_totals(p_context_key text) RETURNS TABLE (cheer text, n bigint)`
— `LANGUAGE sql STABLE SECURITY INVOKER`, `search_path = public`, EXECUTE for
service_role only (the API roles are revoked; `/api/live/cheers` is the one
door and gates the context first) — one pass over `idx_live_cheers_context`,
grouped by key. Rows still never leave the database (the 5,000-row cap trap
of Sep 29 2026). No table change, no grants to add. Staging EXPLAIN on 5,000
synthetic cheers of one round (rolled back): one per-key count 1.1 ms / 78
buffers → ×6 ≈ 6.6 ms + six round trips; the grouped function 2.1 ms / 115
buffers, one round trip. Expected row on both: `275 APPLIED | 1 | false | 275`.

## Drop the twelve prefix-covered indexes (migration 276, Oct 25 2026 — the production baseline answers)

Tom's read of `pg_indexes` on production (SCALE_AUDIT §0b "The answers")
showed twelve indexes on the growth tables whose key is the leading prefix of
a wider index on the same table — a write per like / follow / post / comment /
message / notification for no read the planner would choose. The Advisor's
`duplicate_index` lint flags exact twins only (271 cleared those). 276 drops:
`follows` `idx_follows_follower`, `idx_follows_following`, `idx_follows_status`;
`posts` `idx_posts_profile_id`, `idx_posts_created_at`; `post_comments`
`idx_post_comments_post_id`; `post_likes` `idx_post_likes_profile_id`,
`idx_post_likes_post`; `post_media` `idx_post_media_post_id` (271's "later
decision"); `notifications` `idx_notifications_user_id`;
`conversation_participants` `idx_cp_conversation`; `golf_participant_scores`
`idx_golf_participant_scores_participant`. Every FK stays covered by a
leading-column index (`fk-index-coverage.test.ts`); no `follows` query filters
by status alone (a source scan, 0 chains). Proof on staging: the eleven hot
read shapes each plan on the kept index
(`database/provenance/explain/2026-10-25/plans-after-276.md`). Nothing merely
UNUSED on production was dropped — production was wiped Sep 30 and is gated,
so a zero scan count says nothing about a feature. Expected row on both:
`276 APPLIED | 0 | 12 | 276`.

## search_all ranks a bounded candidate set (migration 279, Oct 26 2026 — hole 2b)

At 53,051 documents `search_all('se')` cost 500 ms after 274 — every
document matched and 50,044 rows went through the per-row ranking columns.
279 REPLACES `search_all` (same signature, RETURNS, INVOKER, search_path,
grants, COMMENT restated): after the cheap tier is known, a LATERAL top-N
keeps at most 1,000 rows per entity_type by tier, (distance), rich, recency,
and `name_hits` / `score` are computed for those only; the final ORDER BY is
unchanged. Trade-off recorded in docs/SEARCH.md (a row past the first thousand
of its type can be left out). Proof: `database/tests/diagnostics/verify-279-
search.sql` — 274's body as a temp function beside 279's, ten lists identical
at one instant on the 53k staging; plans 557 → 247 ms (prefix), 500 → 325 ms
(two letters), athletes-only ~50 ms; the rare-term floor (~180 ms) is the
substring arm's scan, not the ranking. Expected row on both: `279 APPLIED |
1 | true | 279`.
## The counter triggers add or subtract one; a nightly recount is the accuracy rule (migration 277, Oct 26 2026 — counters part b)

015 / 095 / 252 recounted the whole set on every like, comment and comment
like (`SET likes_count = (SELECT count(*) …)` in the write's own statement).
277 REPLACES the four trigger bodies — same names, same triggers, SECURITY
DEFINER + `search_path ''` kept — with ±1 (status-aware for comments the way
229 is for follows: only a published comment counts, a status change moves
the count by one; `GREATEST(…, 0)` on every decrement), adds
`counters_recount()` (SECURITY INVOKER, service_role EXECUTE only; corrects
every row whose stored count differs from a direct count, returns how many
per target), runs it once (the reconciliation) and the daily cron runs it
every night (`src/lib/counters/recount-server.ts`). Staging walk
(`database/tests/diagnostics/verify-277-counters.sql`): like / unlike, a held
comment, approved, a comment like / unlike, rejected, deleted — eight steps,
every count exact. Expected row on both: `277 APPLIED | <fixed> | <fixed> |
<fixed> | 5 | 277` (staging: 0 | 0 | 0 — nothing had drifted).

## The elevation-due index matches the RPC's order (migration 278, Oct 26 2026)

`golf_map_sweep_elevation_due` orders by `hole_elevation_at NULLS FIRST, id`;
255's partial index was `(hole_elevation_at)` default ASC NULLS LAST, so the
planner could not walk it in that order and read the whole partial index per
call (production: 146 M tuples over 9,234 calls). 278 rebuilds it as
`(hole_elevation_at ASC NULLS FIRST, id) WHERE hole_geometry IS NOT NULL AND
external_source <> 'qa-e2e'` (the RPC body is unchanged) and adds
`idx_golf_courses_elevation_done (id) WHERE hole_elevation IS NOT NULL` for
the progress read's per-tick count. Staging has no catalog, so the proof is
20,000 synthetic courses in one rolled-back transaction: before — a scan of
the whole set and a sort, 546 buffers, 10.5 ms; after — an index scan that
stops at the LIMIT, 50 buffers, 0.14 ms. Plain CREATE INDEX inline (255's
reasoning). Expected row on both: `278 APPLIED | true | true | 278`.

## The public profile is one bundle (migration 280, Oct 26 2026 — trip-count program PR 1)

`GET /api/public/profile` — the origin behind the CDN-cached `/u/[username]`
page — made fifteen database trips (docs/SCALE_AUDIT.md §7). 280 adds
`public_profile_bundle(p_handle text) RETURNS jsonb` (`LANGUAGE sql STABLE
SECURITY INVOKER`, `search_path = public`, EXECUTE for service_role only): the
profile row (+ `vitals_privacy`), the three counts with the route's exact
predicates (published only; the statements anti-join; 269's training
exclusion), the 24 most recent public published posts with their media,
repost originals with the owner's names and visibility, 12 achievements,
the sport_settings rows, the posted sport keys (`get_profile_post_sport_keys`'
semantics), the golf round count, public stat-line posts per sport (≤ 200,
newest first), and the raw membership rows with their orgs. Raw rows only —
every rule stays in TypeScript, and the response is byte-identical
(`scripts/route-capture.mjs` before/after). An unknown handle returns
`{"profile": null}`; a private one `{"profile": {id, visibility}}`. Deploy
order: MIGRATION FIRST (the route answers 503 `Profile service updating`,
no-store, until it exists). Expected row on both: `280 APPLIED | 1 | true | 280`.

## The feed's viewer side is one call (migration 281, Oct 27 2026 — trip-count program PR 2)

`GET /api/posts` — the signed-in feed — made eight database trips a page
(docs/SCALE_AUDIT.md §7); six of them only decided what the viewer may see
and what they already did. 281 adds two `LANGUAGE sql STABLE SECURITY
INVOKER` functions (`search_path = public`, EXECUTE for service_role only):
`hidden_authors_for(p_viewer uuid) RETURNS uuid[]` — muted ∪ blocked ∪
blockers, each arm capped at 2,000 exactly as `hiddenAuthorsFor`
(`src/lib/mutes.ts`) read them — and `feed_viewer_side(p_viewer uuid,
p_author_ids uuid[], p_post_ids uuid[]) RETURNS jsonb` — `{ hidden,
following, saved, liked }`: the hidden authors, the viewer's ACCEPTED follows
among the page's authors, the viewer's saves and likes among the page's
posts, every array present (`'[]'` when empty). Raw ids only — the posts page
stays the route's PostgREST select and every rule stays in TypeScript (the
privacy filter, the own-post arm, the quoted-post gate, the per-post
`saved_posts` / `likes` arrays); the response is byte-identical
(`scripts/route-capture.mjs` before/after). `hiddenAuthorsFor` itself calls
`hidden_authors_for` for every caller (the notifications page, the single
post, comments) and keeps its three reads only for a database that answers
PGRST202. Deploy order: MIGRATION FIRST (pure additions; the feed answers 503
`Feed service updating`, no-store, until `feed_viewer_side` exists).
Reversal: DROP both. Expected row on both: `281 APPLIED | 2 | true | 281`.

## The like toggle is one call (migration 282, Oct 27 2026 — trip-count program PR 3)

`POST /api/posts/like` made seven database trips a tap (docs/SCALE_AUDIT.md
§7); five of them were the gate's post read, a conditional follow read, the
existing-like read, the insert or delete, and the `likes_count` read-back.
282 adds `post_like_toggle(p_viewer uuid, p_post_id uuid) RETURNS jsonb`
(`LANGUAGE plpgsql VOLATILE SECURITY INVOKER`, `search_path = public`,
EXECUTE for service_role only — 256's writer style): the route's gate
verbatim (the owner, or a public post by a public owner, or an accepted
follower; anything else `{"outcome":"not_found"}`), then remove-or-insert the
viewer's like (`unliked` / `liked` / `already_liked` for a concurrent insert
that won), then the trigger-written column read in the same transaction —
`{"outcome", "likes_count"}`. 277's ±1 trigger and 190's `notify_post_like`
fire on the row as they did for the route's own write; the function writes
no counter and no bell. The route maps the outcome onto the unchanged wire
shape (`scripts/route-capture.mjs --post` before/after). Deploy order:
MIGRATION FIRST (a pure addition; the route answers 503 `Like service
updating`, no-store, until it exists). Reversal: DROP FUNCTION. Expected row
on both: `282 APPLIED | 1 | true | 282`.

## Search's decoration rides the search call (migration 283, Oct 27 2026 — trip-count program PR 4)

`GET /api/search` made seven database trips for `q=seed` (docs/SCALE_AUDIT.md
§7): the per-IP limiter, the session check, `search_all`, then the
decoration — the athletes' `profiles` rows, the `posts` rows with their
`profile` and `post_media` embeds, the authors' visibility and the viewer's
accepted follows among the private authors (courses, clubs and leagues one
read each more when they match). 283 adds `search_all_decorated(…search_all's
ten parameters…, p_viewer, p_post_sport, p_post_from, p_post_to,
p_post_limit) RETURNS json` (`LANGUAGE sql STABLE SECURITY INVOKER`,
`search_path = public, extensions`, EXECUTE for service_role only): it CALLS
`search_all` (274/279, untouched — one overload, the facets route and the
recruiting search keep their function) and the same statement returns `{
rows, athletes, courses, posts, clubs, leagues, author_visibility,
followed_private }` — the ranked rows in order, the raw display rows for
every ranked id with exactly the route's columns in the route's order
(courses = `CATALOG_ROW_COLUMNS`, orgs with `listing_status` / `approved_at`
riding along), the posts read verbatim (published, on the feed, the optional
sport / date window, newest first, LIMIT the quota), the authors of THOSE
posts with their visibility, and the viewer's `accepted` follows among the
private ones. `json`, not jsonb: `json_build_object` keeps PostgREST's key
order, so the response is byte-identical (`scripts/route-capture.mjs`
before/after over 24 records). Every rule stays in the route (rank order,
the facet filters, the quotas, the course mapping, `filterListedRows`, the
author-privacy filter, the media proxy). Deploy order: MIGRATION FIRST (a
pure addition; the route answers 503 `Search service updating`, no-store,
until it exists). Reversal: DROP FUNCTION. Expected row on both: `283
APPLIED | 1 | true | 283`.

## The notifications page is one call (migration 284, Oct 27 2026 — trip-count program PR 5)

`GET /api/notifications` made six database trips a page before 281 and four
after it (docs/SCALE_AUDIT.md §7): the session check, the page read with its
actor embed, `hidden_authors_for`, and a HEAD count of the unread rows. 284
adds `notifications_bell_page(p_viewer uuid, p_limit int, p_cursor
timestamptz, p_unread_only boolean, p_type text) RETURNS json` (`LANGUAGE
sql STABLE SECURITY INVOKER`, `search_path = public`, EXECUTE for
service_role only): the route's page read verbatim — the viewer's rows, the
optional unread / type filters, the keyset `created_at < cursor`, newest
first, LIMIT limit + 1 — with the actor embed rendered as PostgREST renders
an embed (jsonb inside a json row), the hidden actors (281's
`hidden_authors_for`) and the unread count (the badge's predicate). Raw rows
and ids: the route still drops a hidden actor's rows, slices the page,
derives `has_more` and `next_cursor` from the raw count and shapes the
envelope — byte-identical (`scripts/route-capture.mjs` before/after). Deploy
order: MIGRATION FIRST (a pure addition; the route answers 503
`Notifications service updating`, no-store, until it exists). Reversal: DROP
FUNCTION. Expected row on both: `284 APPLIED | 1 | true | 284`.

## Favourite sports in the picker (migration 285, Oct 27 2026 — sport picker program PR 1)

Tom's spec: the post composer's Sport step becomes search-first — no
"General Post", no pre-selection, Favourites under the search, All Sports
alphabetical — and "favourites are stored per user account, not per device,
so they follow the user across logins". 285 adds ONE nullable column,
`profiles.favourite_sports jsonb`: a JSON array of registry sport keys
(`['golf', 'rowing']`), NULL = none, the house shape for an account
preference (`theme_prefs` 069, `equipment_prefs` 065). It is owner-only
(`OWNER_ONLY_FIELDS` strips it from `GET /api/profile` for every viewer) and
the departure strip NULLs it (`DEPARTED_NULL_COLUMNS`). The app reads it only
through `sanitizeFavouriteSports` (`src/lib/sports/favourite-sports.ts`:
unknown keys and duplicates dropped, the array sorted) and writes it through
ONE writer, `favourites-server.ts writeFavouriteSports`, behind `PATCH
/api/settings/favourite-sports` (the whole list, `requireAuth`, the
`favourite-sports` bucket). NOT `sport_settings`: a row there declares the
sport on the profile (`computeActiveSports`), and pins (263) are public
presentation — a favourite is a private composer preference. Deploy order:
MIGRATION FIRST on both databases (PR 2's picker reads the column off the
owner's profile row; before the column the picker simply has no stars to
persist and a save answers 500 → rollback). Reversal: `ALTER TABLE
public.profiles DROP COLUMN favourite_sports`. Expected row on both: `285
APPLIED | 1 | 285`.

## One limiter trip per write (migration 286, Oct 28 2026 — the leftovers program PR 1)

Every authenticated write paid two `rate_limit_hit` round trips —
`requireAuth`'s inline `write-general` (shadow) and the route's own bucket
(docs/SCALE_AUDIT.md §7: the like toggle's "4" was auth, limiter, limiter,
the toggle). 286 adds `rate_limit_hit_many(p_keys text[], p_max integer[],
p_window_seconds integer[]) RETURNS TABLE(key, allowed, retry_after_seconds)`
(`LANGUAGE plpgsql SECURITY INVOKER`, `search_path = public`, EXECUTE for
service_role only): it walks the keys in order through 094's
`rate_limit_hit` itself — the same atomic fixed-window upsert, the same 1 %
GC, no punishment extension — one row per key, so a bucket behaves exactly
as it does alone. The caller: `requireAuth(request, { limit: '<bucket>' })`
(and `requireActiveWriter`) sends `['write-general', bucket]` in ONE call
and memoises each verdict for the request; the route's existing
`enforceRateLimit(request, bucket)` then returns the memo and spends
nothing. The 429 body, `Retry-After`, the shadow would-block record and the
fail-open rule are unchanged (`src/lib/__tests__/rate-limit-one-hit.test.ts`
proves each with a mocked RPC). Deploy order: MIGRATION FIRST (a pure
addition; a route ahead of it fails OPEN once per request, as the limiter
always has). Reversal: DROP FUNCTION — `rate_limit_hit` stays for every
single-key caller. Expected row on both: `286 APPLIED | 1 | true | 286`.

## A like follows the read gate, minus blocks (migration 287, Oct 28 2026 — the leftovers program PR 2)

282's like gate let anyone who could see the author like a post that was a
draft, hidden by a moderator, by a departed account, or across a block
(the trip-count PR 3 finding; Tom's decision Oct 28: "same as reading,
minus blocks"). 287 adds `post_like_allowed(p_viewer uuid, p_post_id uuid)
RETURNS boolean` (`LANGUAGE sql STABLE SECURITY INVOKER`, `search_path =
public`, EXECUTE for service_role only): the owner or a guardian (a
`profile_access` row on the owner) always; otherwise the post is PUBLISHED
(`COALESCE(status, 'published')`), the owner has not departed, and (post
public AND owner public) or an ACCEPTED follow of the owner; and, for anyone
but the owner, no `user_blocks` row in either direction — `canReadPost`
(`src/lib/posts/read-gate.ts`) plus the block arm. Mutes never refuse a like.
`post_like_toggle` is re-declared to call it (the toggle — remove-or-insert,
the trigger-written count — unchanged); a refusal is still `not_found` → the
route's 404, so ids cannot be probed. The route is untouched. Deploy order:
MIGRATION FIRST (CREATE OR REPLACE). Reversal: re-run 282's toggle and DROP
`post_like_allowed`. Expected row on both: `287 APPLIED | 2 | true | 287`.

## The comment like gets a gate, in one call (migration 288, Oct 28 2026 — the leftovers program PR 3)

`POST /api/comments/like` had NO visibility gate (the authz allowlist's
"post visibility checked" was not true): anyone signed in could like a
comment on a draft, a hidden post, a private stranger's post or across a
block, in four round trips. 288 adds `comment_like_toggle(p_viewer uuid,
p_comment_id uuid) RETURNS jsonb` (`LANGUAGE plpgsql VOLATILE SECURITY
INVOKER`, `search_path = public`, EXECUTE for service_role only): the
comment must be published and its parent post must pass
`post_like_allowed` (287 — the read gate minus blocks), then
remove-or-insert on `comment_likes` (277's ±1 triggers and 190's
`notify_comment_like` fire as they did for the route's own write), then
the trigger-written `post_comments.likes_count` read in the same
transaction. The route maps `liked` / `already_liked` → `{ isLiked: true,
likes_count }`, `unliked` → `{ isLiked: false, … }`, `not_found` → 404
`Comment not found` (a missing comment used to be a 500 from the FK), and
moves to `requireAuth(request, { limit: 'like' })` — write-general
coverage, one limiter round trip (286). Deploy order: MIGRATION FIRST (a
pure addition; the route answers 503 `Like service updating`, no-store,
until it exists). Reversal: DROP FUNCTION. Expected row on both: `288
APPLIED | 1 | true | 288`.

## Search hides blocked people and muted authors' posts (migration 289, Oct 28 2026 — the leftovers program PR 4)

Search applied no block or mute filter (the trip-count PR 4 finding; Tom's
decision Oct 28: "blocks both ways + muted authors' posts"). 289
re-declares `search_all_decorated` (283) with the same body plus two keys:
`blocked` — the viewer's `user_blocks` arms both ways, as ids — and
`hidden` — `hidden_authors_for(viewer)` (281: muted ∪ blocked ∪ blockers);
both `[]` for the anonymous viewer. The route applies them: an athlete in
`blocked` leaves the list BEFORE the quota slice (a blocked person never
consumes a slot); a post whose author is in `hidden` leaves the posts (the
feed's rule). A muted person is still found as a person; clubs, leagues and
courses are untouched. The wrapper defaults the keys (`?? []`), so a
database still on 283 answers as before. Deploy order: MIGRATION FIRST
(either order is safe; first keeps the rule exact from the first request).
Reversal: re-run 283. Expected row on both: `289 APPLIED | 1 | true | 289`.

## Search lever 4b: trigram indexes serve the substring arm (migration 290, Oct 28 2026 — the leftovers program PR 6)

After 279 the floor of `search_all` was the substring arm's full scan —
five `ILIKE '%q%'` columns over every document (a rare term ~180 ms at 53k
documents). `pg_trgm` is installed (`extensions`) but `search_documents` had
no trigram index. 290 adds two GIN trigram indexes (`title`, `subtitle`) and
re-declares `search_all` (274/279's body verbatim, same signature, one
overload) with ONE change: the substring arm is title / subtitle at THREE
or more characters — the length a trigram index serves (087's note); city,
region and country are already tokens in `search_vector`, and a
two-character query keeps the prefix tsquery path. Trade-off, by design: a
mid-word substring of a city / region / country and a two-character
mid-word title substring leave the substring arm (`verify-290-search.sql`
runs 279 and 290 side by side; the nine capture lists identical). Measured
on staging (53k documents, warm): rare term 180 → 14 ms, `ott` 206 → 75,
`kan` 197 → 65; the common-prefix cases (`seed`, `se`) unchanged at
~250 ms — they are the ranking's cost, not the arm's. Plain CREATE INDEX
inline (255 / 278's reasoning). No code change. Reversal: re-run 279's body
and DROP the two indexes. Expected row on both: `290 APPLIED | 2 | 1 | true
| 290`.

## Where a round's conditions came from (migration 291, Oct 29 2026 — weather at the course PR 2)

Tom: *"it needs to be stamped with the golf round, only make this as an
option for a live round."* PR 1 fills the Conditions step from Open-Meteo at
the course and the values ride the existing columns
(`golf_scorecard_data.weather_conditions / temperature / wind_speed` at Go
Live). What the record could not say is whether the person typed them or the
forecast did. 291 adds two nullable columns to `golf_scorecard_data` AND
`golf_rounds`: `conditions_source` (`manual` | `forecast`, CHECK; NULL = unknown,
read as manual) and `conditions_at` (the forecast's observation time, NULL for
manual). Written ONLY from the round create payload (`shared-round-submit.ts`
→ `POST /api/group-posts`, the two words or null) and copied to the finished
round by `mirrorCompletedRound` — which, with this PR, also copies
`weather_conditions / temperature / wind_speed` into `golf_rounds.weather /
temperature / wind` (the wind as its band): a finished live round never
carried its conditions before. No new table, so no new grants. Deploy order:
MIGRATION FIRST on both databases (the writers send the columns; a POST before
the column answers 500 → rollback). Reversal: the two `DROP COLUMN` pairs in
the file's header. Expected row on both: `291 APPLIED | 4 | 291`.

## The unit system on the account (migration 293, Oct 29 2026 — the golf steps refinements, PR A)

Tom's spec for the golf round's Conditions step: *"Add a Fahrenheit / Celsius
toggle. Remember the user's choice on their account so it persists across
rounds and devices."* His call: it is the ONE Metric / Imperial preference
Settings → Account already offers (temperatures, distances, weights), moved
from the device onto the account. 293 adds one nullable column to `profiles`:
`unit_system` (`metric` | `imperial`, CHECK; NULL = not chosen — the device
decides, metric by default). Owner-only (`OWNER_ONLY_FIELDS` strips it from
`GET /api/profile`), NULLed by the departure strip, read only through
`sanitizeUnitSystem` (`unit-prefs.ts`), written only by
`unit-prefs-server.ts writeUnitSystem` behind `PATCH /api/settings/units`
(`requireAuth`, the `units` bucket 120/h, `private, no-store`). The device's
`ea.activities.unit` is the cache: `UnitSystemApplier` seeds it from the
column on every profile load (server truth first, 069's rule). No new table,
so no new grants. Deploy order: MIGRATION FIRST on both databases (the route
writes the column; a PATCH before it answers 500). Reversal: the `DROP
COLUMN` in the file's header. Expected row on both: `293 APPLIED | 1 | 293`.

## Which picked courses have a card (migration 294, Oct 31 2026)

`golf_course_picks` holds one row per picked course with its card kind (`provider`, `map`, `none`) and a counter; no user ids; RLS on with no policies, service role only. The one writer is `golf_course_pick_hit`, called best-effort from `GET /api/golf/courses`. Run on both databases BEFORE the code; a failed count never blocks a pick. Reversal is in the file's header. Expected row: `294 APPLIED | 1 | 294`.

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

## The header's numbers in one call (migration 292, Oct 29 2026 — the cost program PR B)

Every signed-in visible tab polled three routes for two numbers (the Live
dot, the bell): two a minute, one every two minutes — three Vercel function
calls a minute per tab, each with its own Supabase trips. 292 adds
`me_pulse(viewer) → {live_golf, live_events, unread_messages}`: the SQL
mirror of the routes' pure rules (round-status.ts's 48 h window and
"any status but declined"; live-now.ts's "a live round" and "accepted";
`get_unread_message_count` as it is), STABLE, invoker, service_role only.
`GET /api/me/pulse` is its one caller; a deploy ahead of it answers 503.
Reversal: `DROP FUNCTION public.me_pulse(uuid)`. Expected row on both:
`292 APPLIED | 1 | true | 292`.

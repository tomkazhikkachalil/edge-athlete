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
   if code must ship before or after it.
2. Run it in the Supabase SQL editor.
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
`search_path = ''` and fully qualify table names.

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

**Not owned yet (separate passes, each with its own idiom):** the POLICIES
of the chain-created tables `profiles` and `golf_rounds` (their live names —
`profiles_select_policy`, `golf_rounds_select_policy` … — came from archived
scripts that replaced 001's / 002's; 190–193 record policies only for the
13 tables they create) and the DB-only FUNCTION bodies (`CREATE OR REPLACE`
is not a no-op guard; that pass compares `md5(prosrc)`).

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

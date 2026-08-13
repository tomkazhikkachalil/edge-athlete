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
| 061 | `group_post_media.segment_number` / `segment_kind` / `duration_seconds` — media attaches to a sport-agnostic segment (hole/inning/quarter/set/lap). Backfilled from `hole_number`, which is deprecated but still dual-written. **No CHECK on `segment_number`** — bounds live per-sport in `src/lib/sports/segment-schemas.ts`, because a DB ceiling would need a migration per sport and would reject extra innings. | Aug 1, 2026 — columns present, backfill complete and faithful across all tagged rows |
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

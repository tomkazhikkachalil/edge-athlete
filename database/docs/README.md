# Edge Athlete Database Documentation

**Start with [`database/MIGRATIONS.md`](../MIGRATIONS.md)** — it is the canonical
guide: what the migration history is, how migrations are run (Supabase SQL
editor, manually, in order — this project does **not** use the Supabase CLI
migration runner), how runs are verified, and where the run record lives
(`DEVLOG.md` at the repo root).

## Directory Structure

- **`/migrations/`** — the numbered migrations. The directory listing is the
  source of truth for the current range; each file's header carries its own
  what/why, pre-flight queries, and verification steps.
- **`/features/`** — feature-development SQL (golf, notifications, search,
  tagging), long since folded into the numbered migrations. Reference only —
  see the README in that directory.
- **`/fixes/`** — one-off fix scripts, also folded into the numbered
  migrations. Reference only.
- **`/tests/`** — diagnostics and verification queries:
  - `/verification/` — schema validation scripts (verify-*, check-*)
  - `/test-data/` — test user creation and sample data
  - `/diagnostics/` — debug scripts for troubleshooting
- **`/archive/`** — superseded and legacy SQL. **Never run anything in it** —
  see [`archive/DO_NOT_RUN.md`](../archive/DO_NOT_RUN.md), which records the
  time an archived script broke production tagging.

## Database Technology

- **Platform**: Supabase (PostgreSQL + extensions)
- **Auth**: Supabase Auth
- **Storage**: Supabase Storage (avatars, post media)
- **Real-time**: Supabase Realtime (live round scores, messaging)

There is deliberately no table list here — `database/migrations/` defines 40+
tables and grows most weeks; a partial list presented as complete is worse than
no list. Read the migrations or introspect the live schema.

## Important Notes

⚠️ **These SQL files are history, not a setup script.** The Next.js app
connects to the live Supabase database; nothing here executes at runtime.

❌ **Do not re-run** old migrations or anything under `/archive/`, `/features/`
or `/fixes/` against an existing database. If you need logic from one of those
files, port it into a new numbered migration (workflow in
[`MIGRATIONS.md`](../MIGRATIONS.md)).

## See Also

- [`PHASE0_GUARDIAN_RECONCILIATION.md`](./PHASE0_GUARDIAN_RECONCILIATION.md) —
  guardian-profiles data reconciliation notes

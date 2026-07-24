# ⚠️ DO NOT RUN ANYTHING IN THIS DIRECTORY

These SQL files are **historical reference only** — superseded migrations,
old hot-fix scripts, and stray legacy SQL. They do **not** reflect the current
schema and running them against a live database can break production.

**This already happened once:** an archived trigger-redefinition script
(`old-migrations/fix-trigger-functions-schema.sql`) redefined
`notify_profile_tagged()` for the wrong table, which broke tagging in
production until migration `025` fixed it.

## The canonical schema history is `database/migrations/` (001–030).

See [`database/MIGRATIONS.md`](../MIGRATIONS.md). If you need logic from a file
in here, **port it into a new numbered migration** — never run the archived
file directly.

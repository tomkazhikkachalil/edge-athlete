# ⚠️ Reference only — do NOT run

Feature-development SQL (golf, notifications, search, tagging) whose logic has
been folded into the numbered migrations. Some files are near-duplicate
`-fixed`/`-simple` variants of the same script — none reflect the current
schema. If you need something from a file in here, port it into a new numbered
migration (see [`../MIGRATIONS.md`](../MIGRATIONS.md)) — never run the file
directly.

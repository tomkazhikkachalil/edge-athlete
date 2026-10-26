# Staging sweep — Oct 26 2026 (the FLOOR)

Target: a Vercel PREVIEW of main (`load/sweep-2026-10`, commit 0c559494) on the Preview env = STAGING (Micro). Seed: 5,009 profiles, 50,044 posts, 53,051 search documents, 95,138 follows, 533 conversations / 2,561 messages (`scripts/seed-volume.mjs`, 13 min). Load generator: this Mac, closed-loop workers, 20 s a step, accounts rotated per request (`scripts/load-ramp.mjs`). Stop rules: p95 > 2 s or errors > 1 %. The numbers are a FLOOR (docs/SCALE_AUDIT.md §3): they prove the fixes hold at thousands of users; the ceiling needs a dedicated project.

| File | Run |
| --- | --- |
| `ramp-…T02-07-14` | the read routes, 5 → 100 workers, 20 accounts |
| `ramp-…T02-22-14` | the write route with 20 accounts (its 404s are the like gate on private owners' posts — a target artefact, fixed below) |
| `ramp-…T02-26-37` | `GET /api/search?q=` alone — 10 workers = the 120/min per-IP `search` bucket (429s by design) |
| `ramp-…T02-27-46` | the like route alone, 20 accounts (the 404 artefact again, before the target fix) |
| `ramp-…T02-33-18` | **the like route, 25 accounts, public owners' posts — the write-path floor** |

Companion: `database/provenance/explain/2026-10-26/` (the plan set at this volume) and the fan-out probe lines in `docs/SCALE_AUDIT.md` §6.

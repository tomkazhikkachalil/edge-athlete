# Function weight — before the diet (Nov 7 2026, local build of main af75e20f)

`node scripts/check-function-weight.mjs` on the build as it was: 668 routes, median 4.3 MB, **40 routes over 25 MB**, the heaviest 172 MB. Every route that imported `src/lib/media/process-server.ts` (to ENQUEUE a job) carried the worker's world; `project` is the repo's own files — 601 PNGs, 91 MB of them the Sep 30 snapshots' uploaded photos, pulled in by a `readFile(join(dir, `${job.id}.png`))` the tracer could not resolve.

| route | traced | heaviest buckets |
| --- | ---: | --- |
| `(app)/events/[id]` | 172.1 MB | project 91.3 MB · ffmpeg-static 43.5 MB · @img/sharp-libvips 17.4 MB · @img/sharp-wasm32 8.9 MB · server/chunks 8.2 MB |
| `(app)/events/[id]/live` | 172.0 MB | the same |
| `api/cron/daily` | 168.1 MB | the same, server/chunks 4.0 MB |
| `api/messages/reports`, `api/tickets`, `api/tickets/guest` | 167.5 MB | the same |
| `api/sport-events/**` (14 routes), `api/admin/recovery/**`, `api/org-claim/[token]`, `api/notifications/[id]/action`, the two contest `event` routes | 167.2 MB | the same |
| **`api/posts` (the feed)** | **166.9 MB** | project 91.2 MB · ffmpeg-static 43.5 MB · sharp 27 MB |
| `api/activities/[id]`, `…/media`, `…/media/[mediaId]`, `api/group-posts/[id]`, `…/media`, `api/golf/scorecards/[id]/scores`, `api/golf/participant-scores`, `api/sport-events/[id]/media`, `…/[mid]` | 166.8 MB | the same |
| `(app)/r/[postId]/card.png` | 34.4 MB | sharp 27 MB (never imported here — traced through `next`'s own optional dependency) |
| `api/golf/courses`, `api/cron/golf-map-sweep`, `api/admin/golf-map-sweep` | 31.4 MB | sharp 27 MB (the same) |
| `(public)/org/[slug]/card.png` | 34.9 MB | sharp — the one legitimate user (exempt) |

Cold start on production with this build: `docs/load/2026-11-07/cold-before.md` — the API routes' first request 1.5–1.8 s against 110–180 ms warm; the whole feed open 1,830 ms.

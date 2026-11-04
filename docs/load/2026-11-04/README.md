# The feed's number — Nov 4 2026 (launch phase 3, PR F step 1)

**Question (the Nov 2 launch review, item 11; `docs/SCALE_AUDIT.md` §4 hole 7):** does the signed-in feed need a viewer-independent cached page before the doors open? **Rule agreed with Tom (Nov 3 2026):** build it only if `GET /api/posts` p95 at 25 workers is over 1 s on the floor's setup; under it, close with the number.

**Answer: no.** p95 at 25 workers is **448 ms** (883 ms on Oct 26, before the trip-count program's migration 281 made the viewer side one RPC); at 50 workers **622 ms** (was 1,171), 0 errors, 101 req/s. Nothing is built; the hole stays listed as "maybe, measure again under real traffic".

Target: a Vercel PREVIEW of main (`vercel deploy` from the clean checkout, commit `2c971913`) on the Preview env = STAGING (Micro, production's compute). Seed: the Oct 26 volume still in place (50,044 posts, 5,009 profiles of which 5,001 seed users; `scripts/seed-volume.mjs`). Load generator: this Mac, `scripts/load-ramp.mjs --routes read --only 'api/posts' --steps 5,10,25,50 --seconds 20 --viewers 20` — closed-loop workers, 20 s a step, 20 signed-in seed sessions rotated per request. Quiet window: no CI smoke, no e2e, no other preview build. Stop rules: p95 > 2 s or errors > 1 % (not reached).

| File | Run |
| --- | --- |
| `ramp-2026-11-04T05-13-36-909Z.md` | `GET /api/posts?limit=20`, 5 → 50 workers |

| Workers | req/s | p50 ms | p95 ms | p99 ms | Oct 26 p95 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 14.3 | 309 | 474 | 2,211 (one cold function) | 851 |
| 10 | 30.8 | 311 | 444 | 565 | 860 |
| 25 | 71.8 | 327 | 448 | 636 | 883 |
| 50 | 101.2 | 489 | 622 | 756 | 1,171 |

**Production, the sanctioned read (no load on production — Tom, Oct 25):** `e2e/perf-feed.spec.ts` on the `mobile` project against edgeathlete.ca (commit `e96bdcd1`, Chromium with the CPU slowed ×4, signed in as the disposable QA user): time to the first post **3,504 ms**, 23 API requests on load, no reload on refocus or token refresh — 1 passed. That is the phone's cold open end to end (the gate, the session, the shell, the feed page and its side calls on a throttled CPU), not the route's cost; the route's cost is the table above.

**What would change the answer:** a real week showing `/api/posts` p95 climbing with concurrent viewers in Sentry / Vercel's per-path view (Observability Plus goes back on at the switch), or the database CPU binding on the Micro during the feed's hours. Then the Oct 10 step 2 (a viewer-independent page under `s-maxage=10–30`, privacy by status column, one per-viewer `liked/saved/hidden` call) is the build, and `perf-feed.spec` + this ramp are its before/after.

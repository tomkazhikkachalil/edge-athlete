# Load ramp — 2026-10-27T04:38:17.124Z · https://edge-athlete-git-perf-search-decorated-toms-projects-b0cec44f.vercel.app · commit 0caf1e9f

Closed-loop workers, 20 s per step, 20 signed-in seed sessions. Stop rules: p95 > 2 s or errors > 1 %.

| Route | Workers | req/s | p50 ms | p95 ms | p99 ms | Errors % | Statuses |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| GET /api/search?q= | 5 | 9.6 | 591 | 838 | 2634 | 37.5 | 200:120 429:72 |

# Cold-start probe — before — 2026-11-08T00:43:03.476Z

Target https://edgeathlete.ca (commit fbcdadc6), the open path fired at once as one feed open does, then 4 warm runs per route (median). The user is a disposable QA account with an empty feed.

| route | status | first (ms) | warm (ms) | first / warm | bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| document /feed | 200 | 475 | 128 | 3.7 | 30196 |
| health | 200 | 371 | 128 | 2.9 | 99 |
| me/pulse | 200 | 1531 | 173 | 8.8 | 82 |
| notifications | 200 | 1544 | 134 | 11.5 | 73 |
| messages | 200 | 415 | 114 | 3.6 | 56 |
| posts (feed) | 200 | 1738 | 172 | 10.1 | 35572 |
| drafts | 200 | 309 | 147 | 2.1 | 39 |
| golf live-now | 200 | 1817 | 179 | 10.2 | 13 |
| sport-events live-now | 200 | 1640 | 159 | 10.3 | 13 |
| videos live-now | 200 | 1257 | 208 | 6 | 13 |
| suggestions | 400 | 1518 | 111 | 13.7 | 31 |
| workout-routines | 200 | 1680 | 128 | 13.1 | 15 |
| guardian athletes | 200 | 1681 | 183 | 9.2 | 31 |

The whole open, first time: **1830 ms**. Slowest first request: golf live-now 1817 ms (warm 179 ms).

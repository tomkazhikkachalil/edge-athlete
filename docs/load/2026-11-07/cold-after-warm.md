# Cold-start probe — after-warm — 2026-11-08T01:57:59.986Z

Target https://edgeathlete.ca (commit 3680ad6f), the open path fired at once as one feed open does, then 4 warm runs per route (median). The user is a disposable QA account with an empty feed.

| route | status | first (ms) | warm (ms) | first / warm | bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| document /feed | 200 | 529 | 174 | 3 | 30196 |
| health | 200 | 1201 | 112 | 10.7 | 133 |
| me/pulse | 200 | 1248 | 123 | 10.1 | 82 |
| notifications | 200 | 1492 | 122 | 12.2 | 73 |
| messages | 200 | 1491 | 119 | 12.5 | 56 |
| posts (feed) | 200 | 730 | 175 | 4.2 | 35572 |
| drafts | 200 | 1487 | 138 | 10.8 | 39 |
| golf live-now | 200 | 1631 | 197 | 8.3 | 13 |
| sport-events live-now | 200 | 1558 | 145 | 10.7 | 13 |
| videos live-now | 200 | 1832 | 140 | 13.1 | 13 |
| suggestions | 400 | 1428 | 112 | 12.8 | 31 |
| workout-routines | 200 | 1483 | 121 | 12.3 | 15 |
| guardian athletes | 200 | 1497 | 124 | 12.1 | 31 |

The whole open, first time: **1846 ms**. Slowest first request: videos live-now 1832 ms (warm 140 ms). · the health instance had been up 697 ms and had served 1 request(s) when it answered

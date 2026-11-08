# Cold-start probe — after-boot-diet — 2026-11-08T02:12:30.277Z

Target https://edgeathlete.ca (commit 17c20c36), the open path fired at once as one feed open does, then 4 warm runs per route (median). The user is a disposable QA account with an empty feed.

| route | status | first (ms) | warm (ms) | first / warm | bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| document /feed | 200 | 1048 | 165 | 6.4 | 29956 |
| health | 200 | 1046 | 88 | 11.9 | 134 |
| me/pulse | 200 | 1132 | 160 | 7.1 | 82 |
| notifications | 200 | 1092 | 118 | 9.3 | 73 |
| messages | 200 | 1078 | 120 | 9 | 56 |
| posts (feed) | 200 | 1282 | 258 | 5 | 35572 |
| drafts | 200 | 1099 | 114 | 9.6 | 39 |
| golf live-now | 200 | 1133 | 178 | 6.4 | 13 |
| sport-events live-now | 200 | 1163 | 151 | 7.7 | 13 |
| videos live-now | 200 | 1281 | 122 | 10.5 | 13 |
| suggestions | 400 | 325 | 80 | 4.1 | 31 |
| workout-routines | 200 | 1062 | 128 | 8.3 | 15 |
| guardian athletes | 200 | 1105 | 113 | 9.8 | 31 |

The whole open, first time: **1289 ms**. Slowest first request: posts (feed) 1282 ms (warm 258 ms). · the health instance had been up 527 ms and had served 1 request(s) when it answered

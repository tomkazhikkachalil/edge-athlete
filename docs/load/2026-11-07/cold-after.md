# Cold-start probe — after — 2026-11-08T01:29:30.114Z

Target https://edgeathlete.ca (commit c8011bbd), the open path fired at once as one feed open does, then 4 warm runs per route (median). The user is a disposable QA account with an empty feed.

| route | status | first (ms) | warm (ms) | first / warm | bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| document /feed | 200 | 1116 | 175 | 6.4 | 30196 |
| health | 200 | 1215 | 103 | 11.8 | 99 |
| me/pulse | 200 | 1864 | 156 | 11.9 | 82 |
| notifications | 200 | 1872 | 125 | 15 | 73 |
| messages | 200 | 611 | 123 | 5 | 56 |
| posts (feed) | 200 | 2175 | 180 | 12.1 | 35572 |
| drafts | 200 | 1855 | 138 | 13.4 | 39 |
| golf live-now | 200 | 1759 | 210 | 8.4 | 13 |
| sport-events live-now | 200 | 1881 | 155 | 12.1 | 13 |
| videos live-now | 200 | 1924 | 222 | 8.7 | 13 |
| suggestions | 400 | 1704 | 109 | 15.6 | 31 |
| workout-routines | 200 | 1863 | 120 | 15.5 | 15 |
| guardian athletes | 200 | 1689 | 108 | 15.6 | 31 |

The whole open, first time: **2183 ms**. Slowest first request: posts (feed) 2175 ms (warm 180 ms).

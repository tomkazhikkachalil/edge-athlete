# Scale audit — what breaks first, and in what order (Oct 25 2026)

> Tom's ask: a game plan for "does the app survive many users at once", executed. His decisions for this round: **no load test against production** (staging and a dedicated project only), **a dedicated load-test Supabase project** (Tom creates it), and **this round is the document** — the ranked holes, no app code. The fixes come later, in approved parts, one PR at a time.
>
> Two halves, as the plan said: a **static sweep** (read the code, find the shapes that break under load) and a **measured sweep** (hit the system, watch what bends). Phases 0–2 are done here from the code and read-only database sessions; Phase 3 is written as a procedure that runs the day the load-test project exists. Every number below carries its environment and date. A code read finds holes; only measurement proves a ceiling.

**Builds on, does not restart:** `docs/HARDENING.md` B1 (live index state) and B2 (the query-cost checklist and its hot-surface walk), its Backlog, and its "Scaling: the first thing to break (Oct 10 2026)" ramp; Round 3 (Sep 22 2026 — `scripts/staging-seed.mjs`, the EXPLAIN pass, migrations 229/230); the seven production slowdowns of Oct 9–18 (support's answer: RAM + swap on Nano; production on Micro since Oct 19, and staging too).

---

## 0. Ceilings — the walls every finding is measured against (official docs, read Oct 25 2026)

| Layer | Limit | Number | Where it bites here |
|---|---|---|---|
| **Vercel Functions (Pro — corrected Oct 25: the project is on Pro, not Hobby)** | Max duration | **300 s default, 800 s maximum** (1,800 s beta) | `maxDuration` 300 on `cron/media-jobs`, `admin/media-jobs`, `cron/platform-rollup` can rise to 800 on Pro |
| | Memory / CPU | 2 GB / 1 vCPU default, **4 GB / 2 vCPU maximum on Pro** | ffmpeg transcodes and the image sniff run inside that |
| | **Request or response body** | **4.5 MB**, else `413 FUNCTION_PAYLOAD_TOO_LARGE` (streaming responses are not bodies) | Post media goes direct to storage (Oct 4) — but `upload/avatar` (5 MB cap), `upload/cover` (10 MB cap) and `upload` (5 MB) still carry bytes through the function: **any file over 4.5 MB is refused by Vercel before the route runs** (§1.5) |
| | Concurrency | auto-scales to 30,000 (Pro) | Not the wall; the database is |
| | Crons | Pro allows more than the 2 `vercel.json` declares; pg_cron carries the other 8 by design | Already shaped around it |
| | File descriptors | 1,024 per instance, shared | Fan-out `Promise.all` over N ids opens N sockets at once (§1.8) |
| | Region | `iad1` (Pro can set multiple regions) | Supabase is `ca-central-1`: every DB round trip crosses regions (~15–25 ms floor) — sequential chains pay it N times |
| **Supabase compute** (Pro plan; **production = Micro, staging = Micro**) | Memory | Nano 0.5 GB · **Micro 1 GB** · Small 2 GB · Medium 4 GB | Nano hit RAM + swap under probe load (support, Oct 21); Micro is the current floor |
| | CPU | **shared** up to Medium; dedicated from Large | Shared CPU = noisy, bursty; the Oct 19 96 % CPU was Nano |
| | Direct connections | 60 (Nano, Micro) · 90 (Small) · 120 (Medium) | PostgREST, Auth, Realtime, pg_cron and the dashboard all draw from these |
| | Pooler max clients | 200 (Nano, Micro) · 400 · 600 | Not used by the app (everything is PostgREST over HTTP) — PostgREST's own pool is sized by Supabase per compute |
| | Disk IOPS baseline / burst | 250 / 11,800 (Nano) · **500 / 11,800 (Micro)** · 1,000 · 2,000 | "Compute sizes up to 2XL can burst above their baseline … drawing on a disk IO budget" — the budget that the free tier and Nano drained under sustained e2e load |
| | Disk throughput baseline | 5 · **11** · 22 · 39 MB/s | |
| | Recommended max DB size | 0.5 · **10** · 50 · 100 GB | Production is ~340 MB (Oct 19) |
| | Price | $0 · ~$10 · ~$15 · ~$60 / month | Small is the next step, by the Oct 21 decision |
| **PostgREST (Data API)** | `max-rows` | **1,000** — a read with no `.limit()` is cut at 1,000 **silently** (Project Settings → API) | The B2 rule; the unbounded reads in §1.8 are the live exposure |
| **Realtime (Pro, spend cap on)** | **Concurrent connections** | **500** (Free 200; Pro without spend cap / Team 10,000) | **One WebSocket per signed-in app tab** (channels multiplex on it). The 501st open tab gets `too_many_connections`: the messages and notifications providers lose their live push and fall back to their polls. **This is the first wall with a number on it.** |
| | Messages per second | **500** (Team / no cap 2,500) — over it, clients are **disconnected** (`tenant_events`) and reconnect when throughput drops | Every change event is delivered once PER SUBSCRIBER. An **unfiltered** `golf_participant_scores` subscription (§1.4) turns one score write into N messages for N spectators: 20 spectators × 25 writes/s on one live event saturates the whole project's budget |
| | Channel joins per second | 500 | A page load joins 2 + N channels (N = listed conversations, up to 30): 20 users opening the app in the same second = 600+ joins |
| | Channels per connection | 100 | A user with > 98 conversations in the list cannot join them all (§1.3) |
| | Presence | 10 keys per object; **50 presence messages/s** (Pro); 5 presence calls per client per 30 s | `presence:global` is ONE presence object for every desktop client: each join/leave is broadcast to all — presence traffic grows with the square of concurrent desktop users (§1.4) |
| | Payloads | Broadcast 3 MB; Postgres-change 1 MB (over it, `new`/`old` keep only fields ≤ 64 bytes) | |
| **Storage / egress** | Plan egress and CDN | Per the billing page (not fetched here) | Media is served through our proxy with CDN `s-maxage=86400`; the proxy streams, so no body limit |

**What the table says before any measurement:** the hard numbers are **500 Realtime connections** and **500 messages/s** (Pro with the spend cap on), **4.5 MB** on three upload routes, **1,000 rows** on every unbounded read, and **shared CPU + 500 IOPS baseline** on Micro. Everything else is a slope, not a wall.

---

## 0a. The geometry (read Oct 26 2026 — the post-audit refinements, item 1)

`vercel.json` pinned every function to **`iad1` (Virginia)**. The Supabase management API says production is in **`ca-central-1` (Montreal)** and staging in **`us-west-2` (Oregon)**. So every production database trip crossed Virginia→Montreal, and the Oct 26 sweep measured Virginia→Oregon through a preview that also lacks `SUPABASE_JWT_SECRET` (the Preview env has none, so every authenticated preview request pays a network `getUser` that production verifies locally) — the sweep's "~150 ms a trip" is pessimistic for production on both counts. **Oct 26: functions moved to `yul1` (= ca-central-1, Montreal; available on Pro).** Production's own round trip (`/api/health` `latency_ms`, ten readings): **before, median 73 ms (54–122); after (functions in `yul1`, Oct 26), median 48.5 ms (30–91)** — a third off every database trip, for one line. Previews now run Montreal→Oregon; a like-for-like sweep would need staging recreated in `ca-central-1` (a day of rewiring, no spend change — not done).

## 0b. Baseline — where the data is today (read-only, Oct 25 2026)

**Production rows** (PostgREST `Prefer: count=exact` with the service key — a read, nothing written). Production was wiped on Sep 30 and is gated, so every growth table is tiny; the only large table is the golf catalog.

| Table | Rows | Table | Rows |
|---|---|---|---|
| profiles | 5 | notifications | 62 |
| posts | 23 | conversations / participants / messages | 4 / 9 / 16 |
| post_likes / post_comments / post_media | 20 / 9 / 17 | message_reactions | 5 |
| follows | 8 | athlete_vitals | 9 |
| workout_sessions / exercises / sets | 15 / 64 / 195 | activities | 4 |
| group_posts / participants / scores / hole_scores | 4 / 5 / 5 / 23 | golf_rounds / holes | 5 / 23 |
| **golf_courses** | **28,984** | live_cheers | 3 |
| media_jobs | 121 | organizations / memberships / events | 1 / 1 / 1 |
| sport_settings | 4 | performances / saved_posts / user_blocks | 0 / 0 / 0 |

`search_documents`, `rate_limits`, `platform_health_samples` are not readable through the API with a plain select (posture A or RLS) — expected. Database size ≈ 340 MB (Oct 19 dashboard; the catalog).

**Staging** (same read + `staging-sql.mjs`): 8 profiles, 44 posts, 9 follows, 109 notifications, 31 messages, 35 scores, 46 MB; `max_connections` 60 (Micro), 12 connections open at rest; `pg_stat_statements` 1.11 present. **The Sep 22 seed is gone** (no `seedsubject`), so this audit re-seeds staging at the script's default size for §2 (500 followers, 2,000 posts, 5,000 notifications, 400 performances — one paced run, sized for the IO budget).

**Observability as it stands:** Sentry `tracesSampleRate` 0.1 in deployed environments (0 in dev); the 5-minute health sampler (`platform_health_samples`: one `profiles` HEAD, `db_ms`, missing slot = down); `/api/health` on demand; Vercel function logs (error level ≈ 1 day); Supabase Postgres logs with `auto_explain` lines for slow statements (seen on staging during the Oct 16 exhaustion); **no slow-query dashboard is read regularly** — Query Performance (by total time) is the view to add to the maintenance checklist.

**For Tom to paste in the production SQL editor** (prod SQL is the editor only — one query at a time; the editor shows the last result):

```sql
-- B1 (1): the indexes on the growth tables
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname='public'
  AND tablename IN ('follows','posts','post_likes','post_comments','post_media','notifications',
                    'messages','conversation_participants','search_documents','golf_participant_scores','live_cheers')
ORDER BY tablename, indexname;
```
```sql
-- B1 (2): which indexes are USED (the never-scanned ones are candidates to drop; the duplicate-index lint is already at zero)
SELECT relname, indexrelname, idx_scan, idx_tup_read, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes WHERE schemaname='public' ORDER BY idx_scan DESC, relname;
```
```sql
-- the statements that cost the most since the last reset (mean × calls is the number)
SELECT calls, round(total_exec_time::numeric,1) AS total_ms, round(mean_exec_time::numeric,2) AS mean_ms,
       rows, left(query, 140) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 25;
```

**The answers (Tom ran the three in the production SQL editor, Oct 25 2026 evening, after 273–275):**

- **B1 (1) — the indexes.** Every growth table is indexed for its hot reads, and the exact-duplicate lint is at zero; but **12 indexes are prefix-covered by a wider one on the same table**, each a write amplification on the hottest tables for no read the planner would choose: `follows` `idx_follows_follower` (⊂ `_follower_status`, `_composite`, the unique key), `idx_follows_following` (⊂ `_following_status`), `idx_follows_status` (one low-cardinality column); `posts` `idx_posts_profile_id` (⊂ `_profile_created`), `idx_posts_created_at` (⊂ `_created_at_id_desc`; 266 scans vs 3,900 for the composite); `post_comments` `idx_post_comments_post_id` (⊂ `idx_comments_post`); `post_likes` `idx_post_likes_profile_id` (⊂ `idx_post_likes_profile`), `idx_post_likes_post` (⊂ the unique `(post_id, profile_id)`); `post_media` `idx_post_media_post_id` (⊂ `_post_display`); `notifications` `idx_notifications_user_id` (⊂ `_user_created`); `conversation_participants` `idx_cp_conversation` (⊂ the unique `(conversation_id, profile_id)`); `golf_participant_scores` `idx_golf_participant_scores_participant` (a twin of the unique `participant_id` key). **Candidate migration 276: drop the 12** — zero behaviour change, fewer index writes per like / follow / post / message; decided after the never-scanned tail of B1 (2) is read (the paste was the top 100 by scans).
- **B1 (2) — usage.** Production is tiny, so the counts are the probes and the crons. What stands out: `idx_golf_courses_elevation_due` — **9,234 scans, 146,400,797 tuples read (15,855 a scan)**: `golf_map_sweep_elevation_due` walks the partial index in `hole_elevation_at NULLS FIRST` order and filters each row through the three OR'd "due" conditions, so a tick with little due work reads most of the index to return ≤ 50 ids (every 2 minutes from pg_cron, 16 ms a call). Cron-side, not a user path; the fix is a narrower predicate or a `hole_elevation_at`-bounded scan — a later small migration. Everything else reads a handful of tuples a scan.
- **The costliest statements.** #1 by total time is **Realtime's own WAL poller** (`SELECT wal->>…`, 460,284 calls, 6.4 ms mean, 49 min) — the platform's standing cost of having Realtime on, independent of our listener count (now 1 per page). Then the golf map sweep (`golf_map_sweep_cells` read 32,333 × 16.6 ms, the elevation COUNT 4,619 × 22.9 ms, the due RPC 9,234 × 16.2 ms, `net.http_post` 23,450 × 8 ms — ≈ 15 min of DB time, all cron). **The one user-facing line: `search_all` before 274 — 84 calls at 837 ms mean and 70 at 308 ms**, the two call shapes — production holds ~29,000 course documents, so the per-row ranking cost was ten times staging's; hole 2 was worse on prod than the seeded plan said. 274 ran today; `pg_stat_statements_reset()` now gives a clean read next week. `rate_limit_hit` on prod: 0.62 ms mean over 37,887 calls (staging's plan said 5.7 ms — the Micro cache is warm here). `pg_timezone_names` at 279 ms × 295 is PostgREST's schema-cache reload (every `NOTIFY pgrst` and deploy) — harmless.

---

## 1. Static sweep — the hot paths as coded (file:line are current as of main `7f0f7996`)

One round trip = one `.from()`, `.rpc()` or storage call. "Stages" = sequential waits (parallel calls inside a `Promise.all` count as one stage). Severity is the static estimate — **High** = breaks at a few hundred concurrent users or one busy live event; **Med** = costs linearly and shows at thousands; **Low** = hygiene.

### 1.1 Feed and posts

| Route / component | Round trips | Bounded | Pagination | Cache | Limiter | Severity · note |
|---|---|---|---|---|---|---|
| `GET /api/posts` list (`src/app/api/posts/route.ts:1225-1714`) | page query → `hiddenAuthorsFor` (3 parallel, each `.limit(2000)`, `src/lib/mutes.ts:24-26`) → follows among page authors → viewer's `saved_posts` + `post_likes` for the page ids → up to 6 enrichment reads → match results (2 + one per finished round) → repost-owner follows. **8–16 queries in 5–7 stages**, all on the admin client, privacy filtered in JS after the page is read (`:1448-1478`) | yes (limit 1–100, default 20; `.limit(limit+1)` keyset) | keyset `(created_at,id)`; legacy offset without a cursor | **none** (`vercel.json` `no-store`); per viewer | **none on GET** | **Med–High.** The hottest per-viewer path; the Oct 10 plan's step 2 (a cached viewer-independent page + one small per-viewer liked/saved call) is still open. Counts come from columns, not COUNTs — good. |
| `feed_following` RPC (`269_…:654-683`) | 1 | `LIMIT LEAST(p_limit,101)` | keyset + offset arg | — | — | Low. Indexed (`idx_posts_created_at_id_desc`, `idx_follows_composite`). |
| `GET /api/posts?postId=` (`:858-1165`) | 3–12 sequential (lazy follows, round, scorecard, shared original, viewer like, tags, sport-event reads) | single row | — | `private, no-store` | none | Med. The per-card refetch target of `useProcessingRefresh` (every 15 s while a video processes) and `useSharedRound` (every realtime event). |
| Feed page (`src/app/(app)/feed/page.tsx`) | mount 1; new-posts poll every 60 s (`?since=`), pauses hidden, 20 s catch-up gap | — | keyset | — | — | Low. The platform-wide realtime post channel was removed Sep 22 — right call. |
| Feed sidebar on mount | `LiveNowStrip` 2 (re-polled 60 s) · `GetStartedCard` 1 · `ConnectionSuggestions` 1 (`/api/suggestions` reads ALL the viewer's follows, unbounded) · `FeedCalendarWidget` 1 + one per guardian child · `YourOrgsCard` 1 | — | — | — | — | Med. A feed open ≈ 7 layout calls + 7 sidebar calls + the page. |
| `PostCard` | no per-item reads (payload carries likes, counts, author, media); views batched (2 s / 50 items) | — | — | — | `post-views` 120/min/IP | Low. |

### 1.2 Search

| Route | Round trips | Bounded | Cache | Limiter | Severity · note |
|---|---|---|---|---|---|
| `GET /api/search` | limiter RPC → `search_all` RPC → up to 5 parallel hydrations → author profiles → follows. 4–9 in 4–5 stages | per-type cap 20 (facets widen to 100) | none | `search` 120/min/IP | Med. `search_all` (`112_search_all.sql:361-469`) reads ONE table (`search_documents`) — GIN on `search_vector`, btree on country/region/lat/type/owner — **but its `ILIKE '%q%'` branch (any query ≥ 2 chars) has no trigram index on `search_documents`**: a sequential scan that grows with the document count. Trigram GINs exist on profiles, clubs, golf_courses, places, organizations — not here. |
| `GET /api/search/facets` | limiter + `search_all_facets` | capped (115) | none | `search` | Low. |
| `GET /api/explore` | limiter + 2 parallel | `.limit` | `public, s-maxage=30, swr=120` | `search` | Low — the Oct 10 ramp: 1,770 req/s. |
| `GET /api/mentions/search`, `calendar/invite-search` | `accessibleProfileIds` → **follows read with no `.limit`** (`src/lib/search/people-server.ts:168-182`) + `search_people` RPC | follows unbounded | none | **none** | **Med–High.** Fires on every debounced keystroke (120 ms), no limiter, and reads the viewer's whole follow graph each time. |
| `GET /api/handles/search` | `search_by_handle` (≤ 50) | yes | none | none | Low. |

### 1.3 Messaging and notifications (mounted on every `(app)` page)

| Route / provider | Round trips | Bounded | Cache | Limiter | Severity · note |
|---|---|---|---|---|---|
| `MessagesProvider` (`src/lib/messages.tsx`) | mount: list (`?limit=30`) + unread-count; both re-polled every **120 s**; hidden tabs skip; catch-up on visibility/online | — | — | — | **High at scale.** **One Realtime channel PER LISTED CONVERSATION** (`messages:{id}`, `postgres_changes` INSERT filtered by `conversation_id`, `:164-224`): 30 channels at first load, more after load-more. Channels = users × conversations; 100 channels per connection is the cap; every channel is a filtered subscription the Realtime workers evaluate per write. |
| `NotificationsProvider` (`src/lib/notifications.tsx`) | one read on SUBSCRIBED (2.5 s fallback); re-read on visibility (20 s gap); no interval | — | — | — | Low. One channel, filtered `user_id=eq.`. |
| `GET /api/notifications/unread-count` | 1 **live `COUNT(*)`** (`head:true`, partial index `idx_notifications_user_unread`) | count | none | none | Low–Med. Indexed; grows with a user's unread backlog, not the table. |
| `GET /api/messages/unread-count` | `get_unread_message_count` RPC: **live `count(*)` over `conversation_participants JOIN messages`**; on RPC error a fallback does **one COUNT per conversation, sequentially** (`route.ts:30-46`) | — | none | none | Med. Polled every 120 s by every open tab; grows with a user's message history; no counter column. |
| `GET /api/notifications` | list → `hiddenAuthorsFor` (3) → unread COUNT; 3 stages | limit ≤ 100 | none | none | Low–Med. |
| `GET /api/messages` (conversation list) | `get_conversation_list` RPC (1) | `p_limit` ≤ 50 | none | none | Low. |
| `GET /api/messages/[id]` (message list) | participant, conversation, participants, messages (4 sequential) → **per-message reads for every shared post/profile** (`:161-215`) → reactions (`.in(ids)`, no limit) → reactor profiles → parents → unread COUNT. **8–10 + N** | limit ≤ 50 | none | none | Med. Also refetched with `?limit=1` on every incoming realtime INSERT (cheap, by design). |
| `POST /api/messages/[id]/messages` (send) | `requireActiveWriter` (network Auth + write-general RPC + moderation read) + `message-send` RPC + 10–14 reads/writes, mostly sequential: **12–17 DB trips + 1 Auth** | — | — | `message-send` 120/10 min | Med. Two separate sender `profiles` reads (`:33`, `:245`). |

### 1.4 Live events

| Route / hook | Round trips | Bounded | Cache | Limiter | Severity · note |
|---|---|---|---|---|---|
| `useSharedRound` (`src/hooks/useSharedRound.ts`) | on enable 1 refresh; poll 60 s live / 30 s degraded; refresh on visibility; **one refresh per realtime event** | — | `no-store` | — | **HIGH.** One channel `shared-round:{id}` with two listeners: `group_posts` UPDATE filtered `id=eq.` (fine) and **`golf_participant_scores` `event:'*'` with NO filter — table-wide** (`:150-153`; the comment at `:131-134` says so). Every score written ANYWHERE is delivered to EVERY mounted hook (every live feed card, every spectator), and each delivery triggers a scorecard refetch. Fan-out = (all score writes/s) × (all viewers). This is the one place that can take the whole project past 500 messages/s on its own. Round 3 left it "for later" (devlog Sep 22). |
| `/live/[groupPostId]` page | open: scorecard, then `useSharedRound` fires a second identical scorecard refresh at once (`:127-131`); course `?holes=1` ×1–2; `LiveCheers` polls `/api/live/cheers` every **10 s** (60 s when quiet) | — | — | — | Med. |
| `GET /api/live/cheers` | gate (2 parallel) + **6 parallel COUNT queries, one per cheer kind** + recent (`src/lib/play/cheers-server.ts:80-83`): **≈ 9 queries per viewer per poll** | yes | `private, no-store` | GET none | **High at an event.** 500 spectators × 9 queries / 10 s = 450 queries/s for a number that is the same for everyone. |
| `GET /api/golf/live-now` | `requireAuth` + **follows with no `.limit`** (`route.ts:24-28`) + participants `.limit(100)` + 2 deep reads `.limit(40)` | follows unbounded | none | none | Med. Polled every 60 s by `useLiveNow` from the header and the tab bar (one shared timer — good). |
| `GET /api/golf/live-now/count`, `/api/sport-events/live-now` | 3–5 stages, bounded | yes | `private, max-age=10` (sport-events) | `sport-event-view` | Low. |
| `GET /api/group-posts/[id]/scorecard` | 1 deep read + 0–7 context reads | single | none | none | Med — the refetch target of every realtime event above. |
| `presence:global` (`src/components/chat-dock/usePresence.ts:24-41`) | 0 DB | — | — | — | **Med–High at scale.** One presence object joined by every signed-in DESKTOP client; presence state is replicated to every member on every join/leave: traffic ∝ N², and the Pro cap is 50 presence messages/s. |
| Publication (`000_rebuild.sql:17987-18005`) | `golf_participant_scores`, `group_posts`, `messages`, `notifications` (`posts` dropped by 249) | — | — | — | No `REPLICA IDENTITY FULL` — change payloads are lean (good). |

### 1.5 Uploads and media

| Route | Bytes path | Cap | Cache | Limiter | Severity · note |
|---|---|---|---|---|---|
| `POST /api/upload/avatar`, `/cover`, `/upload` | **through the function** (`formData()` → `arrayBuffer()` → `prepareImage`) | 5 MB · 10 MB · 5 MB | — | `upload` 240/h | **Med (latent bug).** Vercel refuses any body over **4.5 MB** before the route runs → the 5 and 10 MB caps are unreachable; a 6 MB cover photo fails with a generic 413. Post media already goes direct to storage (Oct 4) — the same `intent → PUT → complete` shape fits these three. |
| `POST /api/upload/post-media/intent` → storage → `/complete` | direct; `complete` **downloads the whole object back into the function** for the video probe/scrub and re-uploads if scrubbed (`upload-server.ts:104-136`) | 50 MB; `maxDuration` 120 | `private, no-store` | `upload` / write-general | Med. A 50 MB video = 50 MB in + 50 MB out through a 1-vCPU function, per upload. |
| `GET /api/media/[token]`, `/o/[token]` | **streams** upstream; range/etag/304 pass-through | — | public `max-age=3600, s-maxage=86400, swr=604800`; private `private, max-age≤86400` | only invalid tokens (`media-miss`) | Low. The CDN takes the public load. |
| `POST /api/cron/media-jobs` (every minute) | claim (`FOR UPDATE SKIP LOCKED`, 360 s lease) → `waitUntil` → **1 video then ≤ 20 light jobs, sequentially**; `MEDIA_JOBS_MAX_RUNNING` default **2** | budget 240 s of 300 | — | `CRON_SECRET` | Med at launch volume: ≈ 60 videos/hour ceiling per worker slot; the queue is the buffer (by design), the number to watch is `media_jobs` age. |

### 1.6 Actions (the hottest writes)

| Route | Round trips | Atomic? | Idempotent on double-tap? | Limiter | Severity · note |
|---|---|---|---|---|---|
| `POST /api/posts/like` (`route.ts:7-149`) | Auth + write-general RPC + `like` RPC + posts read + follows (0–1) + existing check + insert/delete + **`COUNT(*) post_likes`** + **`posts.update(likes_count)`**: **8–9 sequential** | read-then-write toggle; 23505 handled | **No** — the same body toggles (two taps = like, unlike) | `like` 120/10 min | **High (write amplification).** The trigger `trigger_update_post_likes_count` ALREADY recounts and writes `likes_count` on every like row; the route then counts and updates AGAIN. Two `COUNT(*)` and two row updates on `posts` per like — and the trigger's recount itself is O(likes on that post): a post with 100k likes pays a 100k-row count per like. The ±1 shape (`saves_count`, `reposts_count`, follows) is the right one. |
| `POST /api/comments` | `getServerAuth` + moderation read + `comment-create` RPC + profiles + role + parent + mentions + insert…select (embeds) + **COUNT published + `posts.update(comments_count)`** + **`canViewProfile` per mention, sequentially** (`:435-438`) + notify: **8–10 +** | insert + app-side recount (the trigger also recounts) | no dedupe | `comment-create` 60/10 min; **not** write-general (`getServerAuth`) | **High** — the same double count as likes, plus the sequential per-mention loop. |
| `POST /api/comments/like` | `getServerAuth` + `like` RPC + check + insert/delete + recount (count + read + update) | toggle | no | `like` | Med — same shape. |
| `POST /api/posts/save` | `getServerAuth` + check + insert/delete + read | toggle | no | **none at all** (not even write-general) | Med. |
| `POST /api/follow` | `requireActiveWriter` (network Auth) + `follow` RPC + check → delete, or profiles + blocks + **`insert().select().single()`** (full row, only null-checked); supervised +2–3 | toggle; counters by the ±1 trigger (229) | no | `follow` 60/h | Low–Med. |
| `POST /api/posts` repost | `requireActiveWriter` + `post-create` RPC + 8–11 reads + **`insert().select()` + a second full refetch with embeds** (`:593`) | insert; `reposts_count` by trigger | no (no unique constraint, by design, `075`) | `post-create` 30/h | Med. |
| `GET /api/comments` | `getServerAuth` + list (viewer's own `comment_likes` embedded only) ∥ `hiddenAuthorsFor` (3) + 0–2 | limit ≤ 200, **default 100** | **offset** `.range` | none | Med. |

### 1.7 Profiles

| Page / route | API calls on load | Heaviest | Severity · note |
|---|---|---|---|
| `/athlete` (own) | ≈ 8 (achievements, skill-cards, follow stats, pinned posts, statements, orgs, media counts POST + media GET) + the 7 layout calls | `GET /api/profile/[id]/media` | Med. |
| `/athlete/[id]` | ≈ 8–9 (+ profile, + privacy check when needed) + layout | same | Med. |
| `/u/[username]` | server `readPublicHead` (`unstable_cache` 3600) + **1** client call (`/api/public/profile`, CDN `s-maxage=60, swr=300`); tabs lazy | `/api/public/profile`: 12–18 queries in ~7 stages (3 parallel COUNTs, recent posts 24, achievements 12, skill cards: 4 parallel + one `hasActivity` per sport module + one `buildSkillCard` per active sport, orgs 2–4) | Low–Med — behind the CDN; the first viewer per minute pays it. No limiter. |
| `GET /api/profile/[id]/media` (`route.ts:104-560`) | profiles + `canViewProfile` (2–3) + media RPC + post_media ×2 + tagged profiles + `golf_rounds select('*')` + posts + group_posts deep + shared originals + follows + hidden: **12–15 queries, ALL sequential** | limit ≤ 100, default 20; **offset** (`media_offset`) | none | none | **Med–High.** Fired on every profile open, by every viewer, no cache; the sequential chain pays the cross-region floor 12–15 times (≈ 300 ms before any work). |
| `POST /api/profile/[id]/media` (counts) | profiles + `canViewProfile` + `get_profile_media_counts` RPC + 4 parallel COUNTs + profiles | — | — | none | Med. |
| `GET /api/achievements` | Auth + profiles + role + follows + `athlete_achievements select('*')` **no `.limit`** (`route.ts:70-75`) | unbounded | none | none | Low (small table per user; the shape is the issue). |

### 1.8 Cross-cutting

**Every signed-in `(app)` page view starts with ≈ 7 API calls and 2 + N Realtime channels before the page's own work:** `MessagesProvider` 2 (+ N channels), `NotificationsProvider` 1 (+ 1 channel), `AppHeader` 2 (`/api/profile/{id}/organizations`, `/api/admin/me`), `useLiveNow` 2 every 60 s, `presence:global` on desktop.

**Client construction:** admin singleton (`auth-server.ts:21-32`); a fresh `@supabase/ssr` client per `getServerAuth` call (cheap — no connection, just headers); no app-side Postgres pool anywhere (no `pg`/postgres.js/Drizzle/Prisma) — PostgREST over HTTP is the only path, so the ceiling is PostgREST's pool + compute, never our pool. The deliberate own-client exceptions are the five auth/claim routes in `src/app/api/CLAUDE.md`. 329 route files import `getSupabaseAdmin`; 77 use the RLS client.

**Auth cost per request:** local HS256 verification when `SUPABASE_JWT_SECRET` is set (`src/lib/auth/jwt.ts`; tokens live 10 min); **`requireActiveWriter` always makes the network `getUser` + a moderation read** (19 route files: posts, follow, messages, uploads…); every authenticated write adds one `rate_limit_hit` RPC (`write-general`, inline since Oct 22, SHADOW) and a named bucket adds another.

**Reads with no `.limit()` on growth tables** (PostgREST cuts at 1,000 silently): `follows` in `golf/live-now` (`route.ts:24-28`), `people-server.ts:168-182` (mentions + invite search), `suggestions/route.ts:54-57`, `followers/route.ts:138-143` (pending); `message_reactions` `.in(ids)` (`messages/[id]/route.ts:229-232`); `athlete_achievements` (`achievements/route.ts:70-75`); `golf_participant_scores` (`golf/scorecards/[id]/scores/route.ts:320`); guardian queues `posts` / `post_comments` (`guardian/pending-*`); calendar overlay `posts` (`src/lib/calendar/activity-overlay.ts:271,327,337`); lifecycle/delete helpers (`sport-events/lifecycle-server.ts:74,124`); plus the Backlog's `structureAggregateGET`, `structure-options`, `competitionDetailGET`, `recomputeStandings`. **`hiddenAuthorsFor` reads 3 × `.limit(2000)` on every feed, notifications and comments page** — bounded, but 6,000 potential rows per page for a filter that could be one indexed anti-join.

**N+1 by parallelism (`Promise.all` over N ids — N sockets, N PostgREST calls at once):** message list shared posts/profiles; skill cards per sport module and per active sport (`src/lib/sports/server/index.ts:174,202`); cheers 6 COUNTs; match results per finished round (`feed-server.ts:34-41`); badges per sport (`badges-server.ts:65`); tags `canViewProfile` per id (`tags/route.ts:69`); guardian contacts per conversation; leaderboards per round (`leaderboard-server.ts:91`, `match-server.ts:227`); the calendar widget per guardian child (client). **Sequential per item:** `canViewProfile` per mention on comment POST; the unread-count fallback per conversation.

**Rate-limit coverage (476 route files; 82 named buckets; 151 files reference the limiter):**
- **226 GET handlers have no limiter.** By area: feed/posts (`posts` GET — the 2,192-line file limits its POST, not its GET —, `posts/[id]`, `comments`, `tags`, `drafts`, `group-posts/[id]`*, `live/cheers`); search-like (`mentions/search`, `calendar/invite-search`, `handles/search`, `challenges/people`, `admin/recovery/search`); profile (`profile`, `getting-started`, `guardians`, 11 `profile/[id]/*` reads, `public/profile`, `follow/stats`, `followers`, `vitals`, `achievements`, `privacy/check`); messaging (`messages`, `messages/[id]`, both unread-counts, `notifications`); live (`golf/live-now*`, `live-round`, `golf/stats`, `trends`, `rounds*`, `scorecards*`); orgs (~90 `clubs/*` + `leagues/*` reads); admin 29 (behind the console cookie); cron 6 (`CRON_SECRET`); calendar; `media/presets`; `health`; `help/*`; `suggestions`; `sport-settings`; `workouts*`; `equipment`; `performance/rollups`; `connections`; `guardian/*` 11. **The 39 limited GETs:** search/explore/facets/scout (`search`), golf courses/facets/places (`course-search`), handles/check, gifs, contests, the 9 sport-event views, the media proxies (invalid tokens), the invite/claim peeks, org gallery/canvas/widget-data.
- **50 write routes gate on `getServerAuth` and so never meet `write-general`**: comments, scorecards, sport-events, group-posts, `posts/save`, settings/theme, … (HARDENING's "~49"). Some carry their own bucket (`comment-create`); `posts/save` carries none.
- The limiter's own cost: one `rate_limit_hit` RPC per check, fail-open, SHADOW for `write-general` (the flip is one line after the logs show nobody near 120/min). The search GETs' WAF rule is still on the dashboard wish list.

---

## 2. Database sweep — EXPLAIN (ANALYZE, BUFFERS) on seeded staging, plus the structural reads

_(The seeded run and its plans follow in this section — see "2.1 Plans" below once the seed finishes; the structural findings do not depend on volume.)_

### 2.0 RLS, triggers, connections — what the code says

- **RLS is evaluated on the RLS-client routes only (77 files)** — the feed, search, messaging lists, live, profile media and every `requireAuth` route run on the admin client and **bypass RLS entirely**; their cost is the query, not the policy. After migration 271 (Oct 25) the hot tables carry **one permissive policy per command**, and the guardian arm is an OR term whose helper (`private.has_profile_access`, SQL, STABLE, SECURITY DEFINER — one indexed `profile_access` probe) runs only after the owner arm short-circuits. The `(select auth.uid())` initplan rule holds everywhere (126). **No per-row subquery policy remains on a hot table** — the pasted plan's "RLS with subqueries per row" risk is already closed; what remains is the `EXISTS (profiles … follows …)` arm on the visitor-read policies (`golf_rounds`, `performances`, `season_highlights`, `golf_holes`, `post_media`), which costs one or two index probes per candidate row and matters only on RLS-client reads of those tables.
- **Counter triggers:** `likes_count` and `comments_count` are **recounts** (`SET likes_count = (SELECT COUNT(*) …)` — `015`, `095`); `saves_count`, `reposts_count`, `followers_count` / `following_count` are **±1**. A recount is O(rows for that post) on every write; the like and comment routes then count and write again (§1.6). The duplicate triggers were dropped by 199 — the remaining ones are correct, just expensive, and doubled by the routes.
- **Connections:** 60 direct on Micro, shared by PostgREST, Auth, Realtime, pg_cron (8 jobs, the busiest every minute) and the dashboard; 12 open at rest on staging. The app never holds a connection. The Oct 9–18 windows were queueing in front of Postgres (gateway 0.1 s, one-row read 7–40 s) — RAM + swap, not connection count.
- **Cross-region floor:** Vercel `iad1` ↔ Supabase `ca-central-1`; a sequential chain of 12–15 queries (`profile/[id]/media`) pays ~15–25 ms × 15 before any row is read.

### 2.1 Plans (seeded staging, Micro, Oct 25 2026 — 509 profiles, 2,044 posts, 5,753 follows, 10,353 notifications, 2,471 search documents, 59 MB; `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` through `staging-sql.mjs`; the JSON plans are in `database/provenance/explain/2026-10-25/`)

The seed is small on purpose (the IO budget), so the ABSOLUTE times are low; what the plans show is the SHAPE — index probe vs scan, and what grows with what. Buffers = shared blocks touched.

| Query (the route it stands for) | ms | Shape | Grows with |
|---|---|---|---|
| Feed page, default lens (`GET /api/posts` page query) | 0.20 | `idx_posts_created_at_id_desc`, Limit 21, 22 buffers | nothing (keyset) |
| Feed page 1,000 posts deep (keyset) | 0.51 | same index, 27 buffers | nothing — keyset holds at depth |
| `feed_following` RPC (following lens) | 4.1 | 1,144 buffers inside the function | the viewer's follow count × their posting rate |
| `hiddenAuthorsFor` (mutes / blocks, each `.limit(2000)`) | 0.10 each | one index probe each (the blocks-in read is a 0-row seq scan on an empty table) | the viewer's mute/block count — cheap; the cost is three round trips per page |
| Viewer's likes for the page (`post_likes` for 20 ids) | 0.13 | nested loop over the page ids | nothing |
| **One like's recount** (`COUNT(*) post_likes WHERE post_id` — what the trigger AND the route run) | 0.28 at 20 likes | `post_likes` scan **2 passes** (the trigger's and the route's) | **the post's like count — O(likes) per like, twice** |
| Notifications unread COUNT | 0.94 | `idx_notifications_user_unread`, **290 buffers for one count** | the user's unread backlog (every poll pays it) |
| Notifications list page | 0.12 | `idx_notifications_user_created`, Limit 21 | nothing |
| Notifications `metadata @>` | 0.16 | `idx_notifications_metadata_gin` (229) | nothing — the Sep 22 fix holds |
| `get_unread_message_count` RPC | 2.6 | 641 buffers (participants ⋈ messages, live count) | the user's whole message history; polled every 120 s per tab |
| `get_conversation_list` RPC (30) | 6.7 | 1,338 buffers | the user's conversations × their message counts |
| Viewer's follows, no limit (live-now, mentions, suggestions) | 0.24 | Index Only Scan, **300 rows** — the subject follows 300, under the 1,000 cut | the follow count; past 1,000 the answer is silently wrong |
| Followers COUNT vs the column | 0.25 | `idx_follows_following_status` | the follower count (the column from 229 is the answer in 0 ms) |
| Live-now participants `IN (follows)` | 0.26 | index on follows + a 48-row seq scan on `group_post_participants` | the participants table (the `.limit(100)` bounds the output, not the scan — an index on `(profile_id, created_at)` would) |
| Cheers: one kind's COUNT ×6 vs ONE `GROUP BY cheer` | 0.88 ×6 vs 0.19 | both on `idx_live_cheers_context`; the grouped form is one query for all six | the event's cheer count; the ×6 is round trips, not scan cost |
| **`search_all('seed')`** (every post and athlete title matches) | **478** | Function Scan, 1,575 buffers | **the number of documents a query MATCHES — see below** |
| `search_all('se')` (a two-letter query) | **355** | | same |
| `search_all('seed', athletes only)` | 78 | | the matched athletes (509) |
| `search_all('seed-0042')` (a rare term) | 16.5 | | few matches — fast |
| `search_people('see')` RPC | 15 | 1,677 buffers | matched profiles (trigram indexes exist on profiles) |
| `get_profile_media_counts` RPC | 11.4 | 2,285 buffers | the profile's posts |
| Public profile recent posts | 0.20 | `idx_posts_profile_visibility_created` | nothing |
| **`rate_limit_hit` RPC** (one per write, one per limited GET) | **5.7** | ProjectSet, **452 buffers** | the `rate_limits` table's size (it is pruned by the daily cron) — this is the per-write tax |

**The search finding, isolated.** Three probes split `search_all`'s 478 ms: the WHERE alone (`search_vector @@ tsquery OR title/subtitle/city/region/country ILIKE`) over all 2,371 public documents costs **1.4 ms** — the scan is cheap; the per-row **ranking columns** of the `matched` CTE — `search_normalize(title)` (lower + unaccent) two or three times, `to_tsvector('simple', …)`, `search_token_hits` and `search_token_rank` (each unnesting the query tokens and running a tsquery per token) — cost **360 ms for the same 2,371 rows ≈ 0.15 ms per MATCHED row**, computed for EVERY match before the window function keeps 20 per type. So the cost is proportional to the documents a query matches, not to the results: a common prefix ("se", "jo", "ma") matches most of the corpus. At 2,400 documents that is a third of a second per keystroke (120 ms debounce, `search` bucket 120/min/IP); at 50,000 documents the same keystroke is ~7 s of CPU on a shared-CPU Micro — **search would be the first thing to peg the database as CONTENT grows, independent of concurrent users.** The ILIKE arm, incidentally, is not the problem at this size (0.37 ms with LIMIT 50) — the trigram index is still right for later, but the ranking is the hole. Fix shape: rank a BOUNDED candidate set (the tsquery GIN hits ordered by `ts_rank` with a per-type `LIMIT 200`, THEN compute tier / hits / score), precompute `title_norm` and a `title_vector` column so the per-row helpers vanish, and take the ILIKE arm only when the tsquery arm returns fewer than N.

**What did not show (at this size):** the keyset feed holds at depth; every list page is an index probe; the Sep 22 fixes (229 trigger columns, the GIN, `feed_following`) hold. The costs that grow are the RPC-shaped per-user aggregates (`get_unread_message_count`, `get_conversation_list`, `get_profile_media_counts`, `rate_limit_hit`) and the recount triggers.

---

## 3. Measured sweep — the procedure, on STAGING in a quiet window (no new spend — Tom, Oct 25)

**Where (Tom's decision, Oct 25 2026 — Supabase Pro + Vercel Pro, no third project):** STAGING (Micro, the same compute as production) is the measurement environment. Loads run in an agreed **quiet window** with no e2e invocation active (the CI smoke, a local sweep or a preview build would both skew the numbers and starve the IO budget). The numbers are recorded as a **FLOOR** — they prove the fixes hold and the app stays fast at thousands of users; the ceiling needs a dedicated project, revisited only before a large growth push. Every load tool refuses the production ref the way `staging-sql.mjs` does.

**Seed (`scripts/seed-volume.mjs`, an extension of `staging-seed.mjs`):** users created in parallel batches of 20 through `auth.admin.createUser` (the serial loop did 500 in 162 s), **~5,000 users, ~50,000 posts, ~50,000 search documents** (search is where volume matters most — posts and athletes, topped up with synthetic course/org titles), a power-law follow graph, 500 conversations, 50 live rounds with scores — sized to Micro's disk and IO budget; idempotent by email prefix; `--wipe`.

**The ramp (`scripts/load-ramp.mjs`, node, no new dependency):** closed-loop workers 5 → 10 → 25 → 50 → 100 (capped — the question is "comfortably fast at realistic traffic", not the knee), 20 s each, per route: p50 / p95 / p99, error rate, req/s; the database side read from `platform_health_samples` + `pg_stat_statements` deltas (via the management API on the load ref); JSON + a markdown table per run under `docs/load/YYYY-MM-DD/`. **Stop rules:** p95 > 2 s or errors > 1 % ends the ramp (the knee is the capacity number); health > 1 s between steps pauses. **Routes:** signed-in `GET /api/posts` (20 distinct viewers' cookies), `GET /api/profile/[id]/media`, `GET /api/public/profile` (cold and CDN-warm), `GET /api/messages/unread-count`, `GET /api/notifications/unread-count`, `GET /api/search?q=`, `GET /api/golf/live-now`, `POST /api/posts/like` (the write path, with its RPCs), `GET /api/health` (the reference).

**The Realtime scenario (`scripts/load-realtime.mjs`):** N supabase-js clients (100 → 500 → 1,000; the 500-connection wall is expected at N ≈ 500 with the spend cap on) each joining `shared-round:{roundId}` exactly as `useSharedRound` does (one unfiltered scores listener + one filtered group_posts listener) and, for desktop parity, `presence:global`; a writer updates `golf_participant_scores` at 1, 5 and 25 writes/s on ONE round while a second round also scores; **measures** delivery latency (write → event at client, p50/p95), events per client per second (the fan-out factor), `tenant_events` disconnects, `too_many_connections` / `too_many_joins` errors, and the Realtime dashboard's messages/s. The same run with a per-round FILTERED subscription gives the before/after for hole #1.

**The live-event scenario:** one round, 100 / 500 / 1,000 spectators on `/live/[id]` (Playwright pages in a pool, or the ramp against `scorecard` + `cheers` at those viewer counts), scores at 5/s, cheers at 2/s: `cheers` queries/s, `scorecard` refetches/s, p95 of both, DB CPU.

**The mobile-network pass:** the hot surfaces (`/feed`, `/athlete/[id]`, `/live/[id]`, `/messages`) under Playwright CDP throttling (Slow 4G: 400 ms RTT, 400 kbps) with the ramp at its knee running in the background — LCP, time to first post, failed requests; the Oct 10 front-end baselines (feed cold LCP 5.2 s mid-Android, CLS 0.35) are the comparison.

**Recording:** every run's numbers, environment, date and commit go in this file's §6 and in HARDENING.md's Scaling section; a run after each fix in §4 shows the delta.

---

## 4. The ranked holes — what breaks first

Rank = what fails first as concurrent users and live-event size grow, from the static read; §2's plans adjust the order inside a tier, §3's measurements settle it. Size: S (one PR, no DDL), M (one PR, maybe a migration), L (a program). "Pinned by" = the existing rule or test that will keep it fixed.

| # | Hole | Breaks as | Where | Fix shape | Size · DDL | Pinned by |
|---|---|---|---|---|---|---|
| 1 | **Table-wide scores subscription** — every `useSharedRound` receives every score written anywhere, then refetches | one busy live event (N spectators × writes/s) can exceed the project's 500 msgs/s and disconnect EVERY client, including messaging | `src/hooks/useSharedRound.ts:150-153` (its own comment at `:131-134`: "the subscription is table-wide") | `golf_participant_scores` has NO `group_post_id` (only `participant_id`, `000_rebuild.sql` CREATE TABLE), so the choice is: (a) `filter: participant_id=in.(roster)` and resubscribe when the roster changes — zero DDL, the hook already tracks `participantIds`; (b) a denormalised `group_post_id` column + index kept by trigger (one migration + backfill) and `filter: group_post_id=eq.{id}`; (c) Realtime **broadcast** from the score route (`channel.send`) and no table subscription at all — the cheapest at the Realtime layer. (a) first, (c) when live events grow. | S–M · (a) no, (b) yes | a source test: no unfiltered `postgres_changes` on a published table; `e2e/golf-console-race` |
| 2 | **`search_all` ranks every matched row** (0.15 ms per match of per-row helpers: `search_normalize`, `to_tsvector`, `search_token_hits`, `search_token_rank`) before keeping 20 per type | a two-letter keystroke = 355 ms at 2,400 documents, ~7 s at 50,000 — the database pegs as CONTENT grows, whatever the user count | `112_search_all.sql:361-469` (`matched` CTE); §2.1 | rank a BOUNDED candidate set (GIN hits by `ts_rank`, per-type `LIMIT 200`, then tier / hits / score); precompute `title_norm` + `title_vector` columns; ILIKE arm only when the tsquery arm is short; the trigram GIN on `title` for the ILIKE arm later | M · yes (columns + index, `.indexes.sql` twin) | the EXPLAIN in `database/provenance/explain/`; a plan-time test is not possible — the §6 number is the pin |
| 3 | **One Realtime channel per conversation** (30 at first load) + `presence:global` for every desktop client | channels = users × conversations; joins/s on app open; presence ∝ N² toward the 50 msgs/s cap | `src/lib/messages.tsx:164-224`; `usePresence.ts:24-41` | ONE per-user channel (a `recipient_id`/participant-keyed table or a `messages` filter on a per-user column; or subscribe only to the OPEN conversation and keep the 120 s list poll); presence scoped to the dock's contacts or dropped until a real use | M · maybe | a channel-count test (≤ 3 per page); the Realtime dashboard channel count in the maintenance checklist |
| 4 | **Counter double-writes** on like / comment / comment-like (route recounts and updates what the trigger already keeps; the trigger itself is a recount) | the hottest write costs 2 COUNT(*) + 2 updates on `posts`, O(likes) each — the like path collapses first under a viral post | `posts/like/route.ts`, `comments/route.ts`, `comments/like/route.ts`; `015`, `095` | drop the route-side recount (read the column the trigger wrote); make the triggers ±1 like `saves_count` (a migration with a one-time recount backfill) | M · yes | `feed-and-posts.md` "counts are recounts" amended; a route test that `like` makes exactly one write |
| 5 | **Cheers poll: 9 queries per viewer per 10 s**, viewer-independent data | 500 spectators = 450 queries/s on `live_cheers` for one set of totals | `src/lib/play/cheers-server.ts:80-83`; `useCheers.ts:7-10` | one `GROUP BY cheer` query (or a counts row per context kept by trigger); `public, s-maxage=5` on the GET (the payload is the same for every viewer; the viewer's own cheer state is client-side) | S · no | `docs/PLAY.md`; a query-count test |
| 6 | **Unbounded follows reads + `hiddenAuthorsFor` 3×2000 per page** | a user with > 1,000 follows gets a silently wrong live-now / mentions / suggestions; every feed page carries up to 6,000 filter rows | §1.8 list; `src/lib/mutes.ts:24-26` | `.limit()` + the RPC shape (`feed_following` style) for live-now and people search; `hiddenAuthorsFor` → one `hidden_authors(viewer)` RPC / anti-join inside the page query | S–M · maybe | `fk-index`/`.limit` sweep in HARDENING B2; a source test for the four sites |
| 7 | **The signed-in feed: 8–16 queries per page, per viewer, uncached** | the Oct 10 knee (~100 uncached round trips/s on the DB) × 10 queries = ~10 feed pages/s before p95 climbs | `posts/route.ts:1225-1714` | the Oct 10 step 2: a viewer-INDEPENDENT page (CDN `s-maxage=10–30`, privacy by status column only) + ONE per-viewer `liked/saved/hidden` call; collapse the enrichment into the page RPC | L · maybe | `perf-feed.spec`; the ramp number |
| 8 | **Limiter coverage**: 50 writes outside `write-general` (`posts/save` with no bucket at all); `mentions/search` unlimited on keystrokes; the limiter's RPC per check | abuse and accidental storms hit the DB first; the limiter itself adds a round trip to every write | `src/lib/auth-server.ts:139-158`; the 50 routes | move the 50 to `requireAuth` (or a `getServerAuth` variant that enforces); `search` bucket on `mentions/search` + `invite-search`; sample the shadow bucket 1-in-N | M · no | `rate-limit-fail-open.test.ts`; `write-gate.test.ts`'s list |
| 9 | **Avatar / cover / generic uploads through the function** — 4.5 MB wall under a 5–10 MB cap | a 6 MB cover is a 413 today | `src/app/api/upload/{avatar,cover}/route.ts`, `/upload` | the post-media shape: intent → signed PUT → complete (the `storeProfilePhoto` contract stays) | M · no | `upload-direct.spec` extended |
| 10 | **`/api/profile/[id]/media`: 12–15 sequential queries, offset pages** | every profile open, every viewer: ~300 ms of cross-region floor + offset cost at depth | `profile/[profileId]/media/route.ts:104-560` | batch the independent reads (`Promise.all` in 3 stages), keyset by `(created_at,id)`, `private, max-age=30` for the viewer | M · no | `profile-buckets.spec`; a stage-count test |
| 11 | **media-jobs: 2 slots, sequential, one video per tick** | ≈ 60 videos/hour; a launch-day burst queues for hours (visible as `processing` tiles) | `src/lib/media/media-jobs.ts:42-45`, `process-server.ts:200-217` | raise `MEDIA_JOBS_MAX_RUNNING` with the compute; run light jobs in parallel; alert on queue age (`platform_jobs`) | S · no | `docs/MEDIA.md`; the overview's job age |
| 12 | **Backlog leftovers**: `.limit()` on structure/competition routes; the roster import's 50 × 6 sequential admin ops; `comments` GET default 100 offset; `requireActiveWriter`'s network Auth on every write | linear costs that show at thousands of users / big orgs | HARDENING Backlog; `comments/route.ts:99`; `auth-server.ts:433-457` | as listed there; comments default 30 + keyset; a 60 s moderation-state cache keyed by user (or the claim in the JWT) | S–M · no | HARDENING B2 |

**Tiers:** 1–5 break at ONE busy event, ONE viral post, or a modest CONTENT volume — independent of how many users are signed in (1 and 2 are the two that take the database or the Realtime project down for everyone). 6–8 are the "thousands of users" slopes. 9–12 are hygiene with a known shape.

---

## 5. What this audit did not do, on purpose

- No load against production (Tom's decision; the Oct 9–18 windows are the reason), and no dedicated load project (no new spend): staging on Micro in a quiet window is the proxy, and its numbers are a floor.
- No seeding beyond the Sep 22 script's default size on staging; a million profiles is neither feasible on Micro nor needed to see the shapes (the plans show the scan vs probe either way).
- No code changes. Every fix above is a separate decision and a separate PR, measured before and after.

## 7. Trips per request — the inventory (Oct 26 2026; `scripts/db-trace-inventory.mjs`, `src/lib/db-trace.ts`)

Counted, not grepped: the built app with `EA_TRACE_DB=1` wraps both server clients' `fetch` and prints one line per Supabase request; the harness sends one request at a time and keeps the second of two passes. Full table with the distinct paths: `docs/load/2026-10-26/trips.md`. **Caveat:** `GET auth:user` is the network session check a build without `SUPABASE_JWT_SECRET` pays on every authenticated request; production verifies locally — subtract one per authenticated route there.

| Route | Trips | What they are |
| --- | ---: | --- |
| `GET /api/public/profile?handle=` (the origin behind the CDN) | **15** | profiles, posts (HEAD + GET), achievements, sport settings, contest stat lines, an RPC, golf rounds HEAD, memberships — one bundle RPC would make it 1 |
| `GET /api/posts` (the feed) | **8** | auth, mutes, blocks, posts, follows, saved posts, likes — the viewer's four side reads could ride one RPC with the page |
| `GET /api/search?q=` | **7** | limiter, auth, `search_all`, then profiles + posts + follows to decorate — the decoration is the second half |
| `POST /api/posts/like` | **7** | auth, limiter, the gate's post read, the existing-like read, the write, the count read — one RPC (gate + toggle + count) would make it 3 |
| `GET /api/profile/{id}/media` | **6** | auth, profile, the media RPC, post_media, posts |
| `GET /api/notifications?limit=20` | **6** | auth, notifications, mutes, blocks, a HEAD count |
| `GET /api/golf/live-now` | **4** | auth, follows, participants, group posts |
| `GET /api/posts?postId=` | **3** | auth, the post, the viewer's like |
| `GET /api/messages`, the two unread counts | **2** | auth + one RPC each — already the shape to aim for |
| `GET /api/health` | 1 | the reference |

**The program (one PR per route, before/after trips from this harness, p50 at 5 workers from the ramp's `--only`):** 1. the public profile bundle (15 → 1; it is the CDN's origin, so a miss costs fifteen trips), 2. the feed's viewer side reads into the page RPC (8 → ~4), 3. the like toggle as one RPC (7 → 3), 4. search's decoration (7 → ~4), 5. the notifications page (6 → 3). Each is a server-side change behind an unchanged response shape. Not started; Tom schedules.

## 6. Measured numbers (append per run: date · environment · commit · tool · result)

- **Oct 10 2026 · staging (then free tier) via a preview · ramp 5→50 workers:** cached paths 1,770 req/s at 50 workers (p95 40 ms); `/api/health` (one uncached round trip) 103 req/s at 20 workers (p95 316 ms), **18 req/s / p95 20 s / 11 % errors at 50**; the search bucket 429s after seconds, as designed. (HARDENING.md "Scaling".)
- **Sep 22 2026 · staging seed · EXPLAIN:** followers `COUNT(*)` 12 ms → 0.17 ms (229); notifications `@>` seq scan 1,585 ms → 29 ms (GIN); following feed 238 ms before 230. (devlog.)
- **Oct 25 2026 · staging (Micro) · cheer totals after migration 275 (`live_cheer_totals`, 5,000 synthetic cheers on one round, rolled back):** before — six per-key head counts at 1.1 ms / 78 buffers each (≈ 6.6 ms + six round trips per poll); after — one grouped function call 2.1 ms / 115 buffers, one round trip. Statements per poll per watcher 9 → 4. Hole 5 closed by PR 5.
- **Oct 25 2026 · code (zero DDL) · counter writes per like / comment (`counter-writes.test.ts`):** before — two `COUNT(*)` over the like rows (the trigger's + the route's) and two `posts` UPDATEs per like, the same for comments and comment likes; after — one of each (the trigger's), the route reads the column: the like route's own round trips 6 → 4. Hole 4 part a closed by PR 4; part b (±1 triggers + nightly recount) deferred to Tom's call.
- **Oct 25 2026 · staging (Micro) · Realtime channels per signed-in page view (`scripts/realtime-channel-count.mjs`: a seed user with 30 conversations, Chromium on `/feed`, `phx_join` frames counted; both sides built locally against staging):** before fix 3 (main c036110c) — **32** (30 × `messages:{id}` + `notifications` + `presence:global`, dock open or closed); after — **1** (`notifications`) with the dock closed, 2 while the panel is open (`presence:global` joins on open and LEAVES on close), +1 for an open thread. Hole 3 closed by PR 3 (zero DDL; the `new_message` bell is the list's signal).
- **Oct 26 2026 · production · functions `iad1` → `yul1` (Montreal, the database's region):** `/api/health` `latency_ms` median **73 → 48.5 ms** (54–122 → 30–91), ten readings each side; the desktop prod probe 2/2. The per-trip lever, taken.
- **Oct 26 2026 · staging (53k documents) · migration 279 (search candidate cap):** `search_all('seed')` **557 → 247 ms**, `('se')` **500 → 325 ms**, athletes-only 45 → 55 ms, rare term 178 → 182 ms (unchanged — the substring arm's full scan is the floor now); ten lists identical side by side with 274 at one instant. Hole 2b closed with the recorded trade-off; 4b (a trigram index or a narrower substring arm) is the next search lever, not taken.
- **Oct 26 2026 · both DBs · migration 277 (counters part b):** the like / comment / comment-like triggers add or subtract one instead of recounting the set — a like's trigger is one indexed UPDATE, not an O(likes) COUNT; `counters_recount()` nightly is the accuracy rule (staging reconciliation found 0 drifted rows; the eight-step walk exact). Hole 4 closed in full.
- **Oct 26 2026 · staging (synthetic 20k courses, rolled back) · migration 278:** the elevation-due query 546 buffers / 10.5 ms (a scan of the set + a sort) → **50 buffers / 0.14 ms** (an index walk that stops at the LIMIT). The §0b index-walk finding closed.
- **Oct 26 2026 · STAGING SWEEP — the FLOOR (staging Micro; a Vercel PREVIEW of main on the Preview env, commit 0c559494; seed 5,009 profiles / 50,044 posts / 53,051 search documents / 95,138 follows / 533 conversations; closed-loop workers from one Mac, 20 s a step, accounts rotated per request; `docs/load/2026-10-26/`):**
  - **Cached:** `GET /api/public/profile?handle=` **3,426 req/s at 100 workers, p50 27 ms, p95 41 ms, 0 errors** — the CDN; effectively unlimited for us.
  - **Uncached, one round trip:** `/api/messages/unread-count` 265 req/s at 100 workers (p95 516 ms); `/api/notifications/unread-count` 163 req/s at 50 (p95 374 ms) then the collapse at 100 (p95 25.7 s, 3.4 % errors); `/api/health` 191 req/s at 50 (p95 319 ms) then the collapse at 100 (p95 25.4 s, 10 % errors). **The knee is the Micro instance's connection pool at ~50 closed-loop workers ≈ 160–190 one-trip requests a second**, on any uncached route — not a route's query (the plans below are 2–20 ms). Both stalls recovered on their own within a minute.
  - **Uncached, several trips:** the signed-in feed `GET /api/posts` 58.6 req/s at 50 workers (p50 831, p95 1,171 ms), 63 req/s at 100 (p95 2.09 s — the stop rule); `/api/profile/{id}/media` 57.5 req/s at 50 (p95 1,281), 67 at 100 (p95 1,974); `/api/golf/live-now` 52 req/s at 50 (p95 1,232), 55 at 100 (p95 2,573). **At 5 workers the feed already costs p50 575 ms, a like p50 845 ms, health p50 185 ms: the function-to-database round trip is ~150 ms and the routes are 3–6 trips — latency is trip COUNT and region, not query time.** The lever is fewer trips (RPCs) and the function region next to the database; not indexes.
  - **The write path:** `POST /api/posts/like` with 25 accounts on public owners' posts — **p50 845–858 ms, p95 940–1,029 ms flat from 5 to 50 workers (58.5 req/s at 50), 0 errors** (its trigger-only counter write, fix 4, holds under load). With 20 accounts the ladder shows the per-account `like` bucket (120 per 10 min) as 429s above ~4 req/s — the limiter, not capacity.
  - **Search:** `GET /api/search?q=` **p50 1,191 ms, p95 1,678 ms at 5 workers (4.3 req/s, all 200)**; at 10 workers 96 % 429 — the per-IP `search` bucket (120/min) is the designed ceiling from one address. The route's cost at 53k documents: `search_all('seed')` **557 ms** (a token every document matches — the worst case: 50,044 rows ranked at 0.011 ms each; the pre-274 shape of the same query measures **3,864 ms** here), two letters 500 ms, a rare term 178 ms, athletes-only 45 ms. **Hole 2b (open, Tom's call):** a bounded candidate set for the common-prefix case would change the order the Oct 25 decision kept; the alternative is accepting ~0.5 s for a two-letter query at this volume behind the limiter.
  - **Realtime fan-out at volume (`realtime-fanout-probe.mjs`, filtered, 10 accounts over N sockets):** **50 clients — 0 of round B's 20 writes delivered, 1,000 of round A's (20 each); 100 clients — 0 and 2,000**; 40 writes in 11 s. Fix 1 holds at 100 spectators.
  - **Plans at this volume (`database/provenance/explain/2026-10-26/`, warm):** feed keyset deep 20 ms (0.5 at 2k posts — the deep page walks more), `feed_following` 7.3 ms, `get_conversation_list` 14.3 ms, `get_profile_media_counts` 13.9 ms, unread notifications 2.7 ms, unread messages 4.4 ms, `rate_limit_hit` 2.5 ms, followers count 9.2 ms at 95k follows; every list page still an index probe. The cold pass right after the pool stall read 90 / 45 / 108 ms for the three RPCs — cache, not plans.
  - **Not measured here:** the ceiling (a dedicated project), the mobile-network pass, the live-event scenario at 500+ spectators (the 500-connection cap).
- **Oct 25 2026 · both DBs · migration 276:** twelve prefix-covered indexes dropped on `follows` ×3, `posts` ×2, `post_likes` ×2, `post_comments`, `post_media`, `notifications`, `conversation_participants`, `golf_participant_scores` — one fewer index write per like / follow / post / comment / message / notification; the eleven hot read shapes plan on the kept index (`provenance/explain/2026-10-25/plans-after-276.md`). From §0b's production read.
- **Oct 25 2026 · staging (Micro) · search after migration 274 (stored `title_norm` / `title_vector`, token tsqueries parsed once; same order — nine before/after result lists identical):** `search_all('seed')` **478 → 26.9 ms**, `('se')` **355 → 26.4 ms**, rare term 16.5 → 17.0 ms, athletes-only 78 → 13.1 ms. Hole 2 closed by PR 2.
- **Oct 25 2026 · staging (Micro) · Realtime fan-out probe (`scripts/realtime-fanout-probe.mjs`, 10 signed-in clients on round A, 20 score writes on round B then 20 on round A):** unfiltered (the shape before fix 1) — **200 of round B's events delivered** (20 per client) + 200 of A's; filtered to the roster (fix 1) — **0 of B's, 200 of A's**. Hole 1 closed by PR 1 (migration 273 publishes `group_post_participants` for the joiner path) + its follow-up (the roster listener on its own channel — a `postgres_changes` listener on an UNPUBLISHED table fails its whole channel, proven on staging; production's probe before 273 caught it).
- **Oct 25 2026 · staging (Micro) · seeded EXPLAIN pass (509 profiles, 2,044 posts, 2,471 search documents):** every list page an index probe (0.1–0.5 ms, keyset holds at depth); `rate_limit_hit` 5.7 ms / 452 buffers per check; `get_conversation_list` 6.7 ms; `get_unread_message_count` 2.6 ms; `get_profile_media_counts` 11 ms; **`search_all` 478 ms (common prefix), 355 ms (two letters), 16 ms (rare term) — 0.15 ms per matched row of ranking work.** §2.1.

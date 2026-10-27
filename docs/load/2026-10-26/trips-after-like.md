# Database trips per request — after trip-count PR 3, the like toggle (Oct 27 2026; built app on branch perf/like-toggle-rpc, EA_TRACE_DB=1, staging with 282, one request at a time; the second of two passes). POST /api/posts/like 7 → 4: auth, rate_limit_hit ×2 (write-general + like), post_like_toggle; the second pass is the unlike and reads the same 4.

Caveat: `GET auth:user` is the session check over the network — a local build without SUPABASE_JWT_SECRET pays it on every authenticated request; production verifies the JWT locally, so subtract one trip per authenticated route there.

| Route | Status | Trips | ms (local → staging) | Distinct paths |
| --- | ---: | ---: | ---: | --- |
| GET /api/health (reference) | 200 | **1** | 174 | `HEAD profiles` |
| GET /api/posts (the feed) | 200 | **3** | 354 | `GET auth:user` `GET posts` `POST rpc/feed_viewer_side` |
| GET /api/posts?postId= (one post) | 200 | **3** | 332 | `GET auth:user` `GET posts` `GET post_likes` |
| GET /api/profile/{id}/media | 200 | **6** | 662 | `GET auth:user` `GET profiles` `POST rpc/get_profile_all_media` `GET post_media` `GET posts` |
| GET /api/public/profile?handle= | 200 | **2** | 231 | `POST rpc/public_profile_bundle` `GET contest_stat_lines` |
| GET /api/messages (the list) | 200 | **2** | 246 | `GET auth:user` `POST rpc/get_conversation_list` |
| GET /api/messages/unread-count | 200 | **2** | 214 | `GET auth:user` `POST rpc/get_unread_message_count` |
| GET /api/notifications?limit=20 | 200 | **4** | 497 | `GET auth:user` `GET notifications` `POST rpc/hidden_authors_for` `HEAD notifications` |
| GET /api/notifications/unread-count | 200 | **2** | 418 | `GET auth:user` `HEAD notifications` |
| GET /api/search?q=seed | 200 | **7** | 890 | `POST rpc/rate_limit_hit` `GET auth:user` `POST rpc/search_all` `GET profiles` `GET posts` `GET follows` |
| GET /api/golf/live-now | 200 | **4** | 506 | `GET auth:user` `GET follows` `GET group_post_participants` `GET group_posts` |
| POST /api/posts/like (toggle) | 200 | **4** | 443 | `GET auth:user` `POST rpc/rate_limit_hit` `POST rpc/post_like_toggle` |

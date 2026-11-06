# Database trips per request — 2026-11-06 (built app, EA_TRACE_DB=1, staging, one request at a time; the second of two passes)

Caveat: `GET auth:user` is the session check over the network — a local build without SUPABASE_JWT_SECRET pays it on every authenticated request; production verifies the JWT locally, so subtract one trip per authenticated route there.

| Route | Status | Trips | ms (local → staging) | Distinct paths |
| --- | ---: | ---: | ---: | --- |
| GET /api/health (reference) | 200 | **1** | 207 | `HEAD profiles` |
| GET /api/posts (the feed) | 200 | **3** | 388 | `GET auth:user` `GET posts` `POST rpc/feed_viewer_side` |
| GET /api/posts?postId= (one post) | 200 | **3** | 375 | `GET auth:user` `GET posts` `GET post_likes` |
| GET /api/profile/{id}/media | 200 | **5** | 556 | `GET auth:user` `GET profiles` `POST rpc/get_profile_all_media` `GET posts` `GET post_media` |
| GET /api/public/profile?handle= | 200 | **2** | 253 | `POST rpc/public_profile_bundle` `GET contest_stat_lines` |
| GET /api/messages (the list) | 200 | **2** | 272 | `GET auth:user` `POST rpc/get_conversation_list` |
| GET /api/messages/unread-count | 200 | **2** | 251 | `GET auth:user` `POST rpc/get_unread_message_count` |
| GET /api/notifications?limit=20 | 200 | **2** | 252 | `GET auth:user` `POST rpc/notifications_bell_page` |
| GET /api/notifications/unread-count | 200 | **2** | 354 | `GET auth:user` `HEAD notifications` |
| GET /api/search?q=seed | 200 | **3** | 640 | `POST rpc/rate_limit_hit` `GET auth:user` `POST rpc/search_all_decorated` |
| GET /api/golf/live-now | 200 | **4** | 603 | `GET auth:user` `GET follows` `GET group_post_participants` `GET group_posts` |
| POST /api/posts/like (toggle) | 200 | **3** | 353 | `GET auth:user` `POST rpc/rate_limit_hit_many` `POST rpc/post_like_toggle` |

# Database trips per request — 2026-10-26 (built app, EA_TRACE_DB=1, staging, one request at a time; the second of two passes)

Caveat: `GET auth:user` is the session check over the network — a local build without SUPABASE_JWT_SECRET pays it on every authenticated request; production verifies the JWT locally, so subtract one trip per authenticated route there.

| Route | Status | Trips | ms (local → staging) | Distinct paths |
| --- | ---: | ---: | ---: | --- |
| GET /api/health (reference) | 200 | **1** | 183 | `HEAD profiles` |
| GET /api/posts (the feed) | 200 | **8** | 487 | `GET auth:user` `GET user_mutes` `GET user_blocks` `GET posts` `GET follows` `GET saved_posts` `GET post_likes` |
| GET /api/posts?postId= (one post) | 200 | **3** | 369 | `GET auth:user` `GET posts` `GET post_likes` |
| GET /api/profile/{id}/media | 200 | **6** | 658 | `GET auth:user` `GET profiles` `POST rpc/get_profile_all_media` `GET post_media` `GET posts` |
| GET /api/public/profile?handle= | 200 | **2** | 241 | `POST rpc/public_profile_bundle` `GET contest_stat_lines` |
| GET /api/messages (the list) | 200 | **2** | 247 | `GET auth:user` `POST rpc/get_conversation_list` |
| GET /api/messages/unread-count | 200 | **2** | 238 | `GET auth:user` `POST rpc/get_unread_message_count` |
| GET /api/notifications?limit=20 | 200 | **6** | 505 | `GET auth:user` `GET notifications` `GET user_mutes` `GET user_blocks` `HEAD notifications` |
| GET /api/notifications/unread-count | 200 | **2** | 285 | `GET auth:user` `HEAD notifications` |
| GET /api/search?q=seed | 200 | **7** | 919 | `POST rpc/rate_limit_hit` `GET auth:user` `POST rpc/search_all` `GET profiles` `GET posts` `GET follows` |
| GET /api/golf/live-now | 200 | **4** | 583 | `GET auth:user` `GET follows` `GET group_post_participants` `GET group_posts` |
| POST /api/posts/like (toggle) | 200 | **7** | 777 | `GET auth:user` `POST rpc/rate_limit_hit` `GET posts` `GET post_likes` `DELETE post_likes` |

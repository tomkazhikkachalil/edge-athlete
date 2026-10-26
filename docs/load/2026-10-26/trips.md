# Database trips per request — 2026-10-26 (built app, EA_TRACE_DB=1, staging, one request at a time; the second of two passes)

Caveat: `GET auth:user` is the session check over the network — a local build without SUPABASE_JWT_SECRET pays it on every authenticated request; production verifies the JWT locally, so subtract one trip per authenticated route there.

| Route | Status | Trips | ms (local → staging) | Distinct paths |
| --- | ---: | ---: | ---: | --- |
| GET /api/health (reference) | 200 | **1** | 186 | `HEAD profiles` |
| GET /api/posts (the feed) | 200 | **8** | 661 | `GET auth:user` `GET user_mutes` `GET user_blocks` `GET posts` `GET follows` `GET saved_posts` `GET post_likes` |
| GET /api/posts?postId= (one post) | 200 | **3** | 478 | `GET auth:user` `GET posts` `GET post_likes` |
| GET /api/profile/{id}/media | 200 | **6** | 713 | `GET auth:user` `GET profiles` `POST rpc/get_profile_all_media` `GET post_media` `GET posts` |
| GET /api/public/profile?handle= | 200 | **15** | 1656 | `GET profiles` `HEAD posts` `GET posts` `GET athlete_achievements` `GET sport_settings` `GET contest_stat_lines` `POST rpc/get_profile_post_sport_keys` `HEAD golf_rounds` `GET memberships` |
| GET /api/messages (the list) | 200 | **2** | 221 | `GET auth:user` `POST rpc/get_conversation_list` |
| GET /api/messages/unread-count | 200 | **2** | 227 | `GET auth:user` `POST rpc/get_unread_message_count` |
| GET /api/notifications?limit=20 | 200 | **6** | 666 | `GET auth:user` `GET notifications` `GET user_mutes` `GET user_blocks` `HEAD notifications` |
| GET /api/notifications/unread-count | 200 | **2** | 428 | `GET auth:user` `HEAD notifications` |
| GET /api/search?q=seed | 200 | **7** | 982 | `POST rpc/rate_limit_hit` `GET auth:user` `POST rpc/search_all` `GET profiles` `GET posts` `GET follows` |
| GET /api/golf/live-now | 200 | **4** | 639 | `GET auth:user` `GET follows` `GET group_post_participants` `GET group_posts` |
| POST /api/posts/like (toggle) | 200 | **7** | 762 | `GET auth:user` `POST rpc/rate_limit_hit` `GET posts` `GET post_likes` `DELETE post_likes` |

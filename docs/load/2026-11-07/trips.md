# Database trips per request — 2026-11-07 (built app, EA_TRACE_DB=1, staging, one request at a time; the second of two passes)

Caveat: `GET auth:user` is the session check over the network — a local build without SUPABASE_JWT_SECRET pays it on every authenticated request; production verifies the JWT locally, so subtract one trip per authenticated route there.

| Route | Status | Trips | ms (local → staging) | Distinct paths |
| --- | ---: | ---: | ---: | --- |
| GET /api/health (reference) | 200 | **1** | 186 | `HEAD profiles` |
| GET /api/posts (the feed) | 200 | **3** | 344 | `GET auth:user` `GET posts` `POST rpc/feed_viewer_side` |
| GET /api/posts?postId= (one post) | 200 | **3** | 342 | `GET auth:user` `GET posts` `GET post_likes` |
| GET /api/profile/{id}/media | 200 | **5** | 451 | `GET auth:user` `GET profiles` `POST rpc/get_profile_all_media` `GET posts` `GET post_media` |
| GET /api/public/profile?handle= | 200 | **2** | 242 | `POST rpc/public_profile_bundle` `GET contest_stat_lines` |
| GET /api/messages (the list) | 200 | **2** | 239 | `GET auth:user` `POST rpc/get_conversation_list` |
| GET /api/messages/unread-count | 200 | **2** | 216 | `GET auth:user` `POST rpc/get_unread_message_count` |
| GET /api/notifications?limit=20 | 200 | **2** | 233 | `GET auth:user` `POST rpc/notifications_bell_page` |
| GET /api/notifications/unread-count | 200 | **2** | 673 | `GET auth:user` `HEAD notifications` |
| GET /api/search?q=seed | 200 | **3** | 677 | `POST rpc/rate_limit_hit` `GET auth:user` `POST rpc/search_all_decorated` |
| GET /api/golf/live-now | 200 | **4** | 510 | `GET auth:user` `POST rpc/live_now_participants` `GET group_posts` |
| GET /api/me/pulse | 200 | **2** | 241 | `GET auth:user` `POST rpc/me_pulse` |
| GET /api/comments?postId= (page one) | 200 | **3** | 574 | `GET auth:user` `POST rpc/hidden_authors_for` `GET post_comments` |
| GET /api/mentions/search?q=seed | 200 | **3** | 344 | `GET auth:user` `POST rpc/rate_limit_hit` `POST rpc/search_people_for` |
| GET /api/calendar/invite-search?q=seed | 200 | **3** | 358 | `GET auth:user` `POST rpc/rate_limit_hit` `POST rpc/search_people_for` |
| GET /api/suggestions?profileId=me | 200 | **3** | 640 | `GET auth:user` `POST rpc/generate_connection_suggestions` `GET user_blocks` |
| POST /api/posts/like (toggle) | 200 | **3** | 315 | `GET auth:user` `POST rpc/rate_limit_hit_many` `POST rpc/post_like_toggle` |
| GET /api/messages/{id} (the thread) | 200 | **6** | 701 | `GET auth:user` `GET conversation_participants` `GET conversations` `GET messages` `HEAD messages` |
| POST /api/messages/{id}/messages (send text) | 201 | **14** | 1513 | `GET auth:user` `POST rpc/rate_limit_hit_many` `GET profiles` `GET conversation_participants` `GET conversations` `POST messages` `GET user_blocks` `POST notifications` |
| POST /api/comments (create) | 201 | **7** | 786 | `GET auth:user` `POST rpc/rate_limit_hit_many` `GET profiles` `GET profile_access` `POST post_comments` `GET posts` |
| POST /api/posts (a general post) | 200 | **6** | 686 | `GET auth:user` `POST rpc/rate_limit_hit_many` `GET profiles` `GET profile_access` `POST posts` `GET posts` |
| POST /api/follow (toggle) | 200 | **7** | 728 | `GET auth:user` `POST rpc/rate_limit_hit_many` `GET profiles` `GET follows` `GET user_blocks` `POST follows` |
| GET /api/group-posts/{id}/scorecard | 200 | **2** | 296 | `GET auth:user` `GET group_posts` |
| GET /api/live/cheers?context=group_post: | 200 | **5** | 358 | `GET auth:user` `GET group_posts` `GET group_post_participants` `POST rpc/live_cheer_totals` `GET live_cheers` |
| GET /api/golf/live-now/count | 200 | **4** | 338 | `GET auth:user` `GET group_post_participants` `GET group_posts` |
| GET /api/sport-events/live-now | 200 | **4** | 330 | `POST rpc/rate_limit_hit` `GET auth:user` `GET sport_events` `GET sport_event_participants` |

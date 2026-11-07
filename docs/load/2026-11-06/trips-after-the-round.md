# Database trips per request — 2026-11-06, AFTER the improvements round (built app at 4da90aef, EA_TRACE_DB=1, staging, one request at a time; the second of two passes). The inventory now includes the round's routes: the pulse, comments, the two people searches, suggestions.

Caveat: `GET auth:user` is the session check over the network — a local build without SUPABASE_JWT_SECRET pays it on every authenticated request; production verifies the JWT locally, so subtract one trip per authenticated route there.

| Route | Status | Trips | ms (local → staging) | Distinct paths |
| --- | ---: | ---: | ---: | --- |
| GET /api/health (reference) | 200 | **1** | 336 | `HEAD profiles` |
| GET /api/posts (the feed) | 200 | **3** | 835 | `GET auth:user` `GET posts` `POST rpc/feed_viewer_side` |
| GET /api/posts?postId= (one post) | 200 | **3** | 371 | `GET auth:user` `GET posts` `GET post_likes` |
| GET /api/profile/{id}/media | 200 | **5** | 946 | `GET auth:user` `GET profiles` `POST rpc/get_profile_all_media` `GET posts` `GET post_media` |
| GET /api/public/profile?handle= | 200 | **2** | 550 | `POST rpc/public_profile_bundle` `GET contest_stat_lines` |
| GET /api/messages (the list) | 200 | **2** | 536 | `GET auth:user` `POST rpc/get_conversation_list` |
| GET /api/messages/unread-count | 200 | **2** | 372 | `GET auth:user` `POST rpc/get_unread_message_count` |
| GET /api/notifications?limit=20 | 200 | **2** | 275 | `GET auth:user` `POST rpc/notifications_bell_page` |
| GET /api/notifications/unread-count | 200 | **2** | 534 | `GET auth:user` `HEAD notifications` |
| GET /api/search?q=seed | 200 | **3** | 779 | `POST rpc/rate_limit_hit` `GET auth:user` `POST rpc/search_all_decorated` |
| GET /api/golf/live-now | 200 | **3** | 454 | `GET auth:user` `POST rpc/live_now_participants` `GET group_posts` |
| GET /api/me/pulse | 200 | **2** | 228 | `GET auth:user` `POST rpc/me_pulse` |
| GET /api/comments?postId= (page one) | 200 | **3** | 243 | `GET auth:user` `POST rpc/hidden_authors_for` `GET post_comments` |
| GET /api/mentions/search?q=seed | 200 | **2** | 254 | `GET auth:user` `POST rpc/search_people_for` |
| GET /api/calendar/invite-search?q=seed | 200 | **2** | 292 | `GET auth:user` `POST rpc/search_people_for` |
| GET /api/suggestions?profileId=me | 200 | **3** | 421 | `GET auth:user` `POST rpc/generate_connection_suggestions` `GET user_blocks` |
| POST /api/posts/like (toggle) | 200 | **3** | 351 | `GET auth:user` `POST rpc/rate_limit_hit_many` `POST rpc/post_like_toggle` |

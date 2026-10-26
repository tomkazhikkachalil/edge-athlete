# EXPLAIN (ANALYZE, BUFFERS) — staging (Micro), 2026-10-26

Volume: 5,009 profiles, 50,044 posts, 95,138 follows, 100,973 notifications, 53,051 search_documents, 2,561 messages. Run with `scripts/explain-set.mjs` through `scripts/staging-sql.mjs`; the queries (`template.json`) stand in for the hot routes of docs/SCALE_AUDIT.md §2.1. Times are shape, not capacity.

| query | exec ms | plan ms | rows | shared hit | top node | seq scans | indexes |
|---|---|---|---|---|---|---|---|
| feed_page_default | 0.73 | 1.81 | 21 | 23 | Limit | - | idx_posts_created_at_id_desc |
| feed_page_keyset_deep | 1.25 | 2.10 | 21 | 62 | Limit | - | idx_posts_created_at_id_desc |
| feed_following_rpc | 7.32 | 0.04 | 20 | 1256 | Function Scan | - | - |
| hidden_authors_mutes | 0.11 | 0.72 | 0 | 1 | Limit | - | idx_user_mutes_muter |
| hidden_authors_blocks_in | 0.08 | 0.52 | 0 | 1 | Limit | user_blocks(0r) | - |
| viewer_likes_for_page | 0.10 | 2.04 | 0 | 2 | Nested Loop | - | idx_post_likes_profile idx_posts_created_at_id_desc |
| likes_recount_one_post | 0.33 | 0.56 | 1 | 11 | Aggregate | - | post_likes_post_id_profile_id_key |
| notifications_unread_count | 2.70 | 1.05 | 1 | 1467 | Aggregate | - | idx_notifications_user_unread |
| notifications_list_page | 0.27 | 1.27 | 21 | 9 | Limit | - | idx_notifications_user_created |
| notifications_metadata_contains | 0.36 | 1.23 | 0 | 9 | Limit | - | idx_notifications_metadata_gin |
| unread_messages_rpc | 4.40 | 0.03 | 1 | 804 | Result | - | - |
| conversation_list_rpc | 14.28 | 0.04 | 1 | 2444 | Function Scan | - | - |
| follows_of_viewer_unbounded | 0.21 | 0.76 | 300 | 7 | Index Only Scan | - | idx_follows_composite |
| followers_count_column_vs_count | 1.37 | 0.73 | 1 | 10 | Aggregate | - | idx_follows_following_status |
| live_now_participants_in | 0.24 | 1.62 | 0 | 17 | Limit | group_post_participants(48r) | idx_follows_composite |
| cheers_count_one_kind | 0.20 | 0.70 | 1 | 1 | Aggregate | live_cheers(0r) live_cheers(0r) | - |
| cheers_grouped_alternative | 0.15 | 0.64 | 0 | 4 | Aggregate | live_cheers(0r) live_cheers(0r) | - |
| search_all_prefix | 557.47 | 0.09 | 40 | 4186 | Function Scan | - | - |
| search_people_rpc | 48.15 | 0.07 | 20 | 2604 | Function Scan | - | - |
| media_counts_rpc | 13.91 | 0.05 | 1 | 2328 | Function Scan | - | - |
| public_profile_recent_posts | 0.20 | 1.49 | 24 | 27 | Limit | - | idx_posts_profile_visibility_created |
| rate_limit_hit_rpc | 2.47 | 0.05 | 1 | 450 | ProjectSet | - | - |
| search_where_only_count | 27.09 | 5.10 | 1 | 2710 | Aggregate | search_documents(52501r) | - |
| search_tsquery_only_count | 32.27 | 4.51 | 1 | 2768 | Aggregate | - | idx_search_documents_vector |
| search_ilike_only | 0.22 | 1.05 | 50 | 4 | Limit | search_documents(50r) | - |
| search_matched_with_case_columns | 3899.71 | 5.32 | 52501 | 3368 | Gather | search_documents(26250r) | - |
| search_all_rare_term | 178.14 | 0.07 | 0 | 4186 | Function Scan | - | - |
| search_all_two_letters | 500.40 | 0.06 | 41 | 4186 | Function Scan | - | - |
| search_all_athletes_only | 45.08 | 0.09 | 20 | 1672 | Function Scan | - | - |

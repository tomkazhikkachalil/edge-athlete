# EXPLAIN (ANALYZE, BUFFERS) — staging (Micro), Oct 25 2026

Seed: 509 profiles, 2,044 posts, 5,753 follows, 10,353 notifications, 2,471 search documents, 59 MB (scripts/staging-seed.mjs defaults). Run through scripts/staging-sql.mjs; the queries stand in for the hot routes named in docs/SCALE_AUDIT.md §2.1. Times are shape, not capacity. The `*_after274` rows are the same search queries after migration 274; `search-results-before-274.json` and `search-results-after-274.json` are the nine ordered result lists the rewrite had to reproduce (identical).

| query | exec ms | plan ms | rows | shared hit | top node | seq scans | indexes |
|---|---|---|---|---|---|---|---|
| cheers_count_one_kind | 0.88 | 0.70 | 1 | 0 | Aggregate | live_cheers(0r) | idx_live_cheers_context |
| cheers_grouped_alternative | 0.19 | 0.75 | 0 | 4 | Aggregate | live_cheers(0r) | idx_live_cheers_context |
| conversation_list_rpc | 6.74 | 0.04 | 1 | 1338 | Function Scan | - | - |
| feed_following_rpc | 4.11 | 0.04 | 20 | 1144 | Function Scan | - | - |
| feed_page_default | 0.20 | 1.81 | 21 | 22 | Limit | - | idx_posts_created_at_id_desc |
| feed_page_keyset_deep | 0.51 | 1.98 | 21 | 27 | Limit | - | idx_posts_created_at idx_posts_created_at_id_desc |
| followers_count_column_vs_count | 0.25 | 0.94 | 1 | 3 | Aggregate | - | idx_follows_following_status |
| follows_of_viewer_unbounded | 0.24 | 0.81 | 300 | 6 | Index Only Scan | - | idx_follows_composite |
| hidden_authors_blocks_in | 0.10 | 0.68 | 0 | 1 | Limit | user_blocks(0r) | - |
| hidden_authors_mutes | 0.10 | 0.59 | 0 | 1 | Limit | - | idx_user_mutes_muter |
| likes_recount_one_post | 0.28 | 0.74 | 1 | 5 | Aggregate | post_likes(20r) post_likes(2r) | - |
| live_now_participants_in | 0.26 | 1.53 | 0 | 13 | Limit | group_post_participants(48r) | idx_follows_composite |
| media_counts_rpc | 11.38 | 0.05 | 1 | 2285 | Function Scan | - | - |
| notifications_list_page | 0.12 | 1.30 | 21 | 4 | Limit | - | idx_notifications_user_created |
| notifications_metadata_contains | 0.16 | 1.13 | 0 | 5 | Limit | - | idx_notifications_metadata_gin |
| notifications_unread_count | 0.94 | 1.07 | 1 | 290 | Aggregate | - | idx_notifications_user_unread |
| public_profile_recent_posts | 0.20 | 1.53 | 24 | 26 | Limit | - | idx_posts_profile_visibility_created |
| rate_limit_hit_rpc | 5.67 | 0.08 | 1 | 452 | ProjectSet | - | - |
| search_all_athletes_only | 77.78 | 0.09 | 20 | 1505 | Function Scan | - | - |
| search_all_athletes_only_after274 | 13.06 | 0.12 | 20 | 1511 | Function Scan | - | - |
| search_all_prefix | 478.09 | 0.09 | 40 | 1575 | Function Scan | - | - |
| search_all_prefix_after274 | 26.92 | 0.07 | 40 | 1645 | Function Scan | - | - |
| search_all_rare_term | 16.51 | 0.07 | 0 | 1514 | Function Scan | - | - |
| search_all_rare_term_after274 | 17.03 | 0.07 | 0 | 1645 | Function Scan | - | - |
| search_all_two_letters | 354.99 | 0.07 | 41 | 1569 | Function Scan | - | - |
| search_all_two_letters_after274 | 26.44 | 0.07 | 41 | 1645 | Function Scan | - | - |
| search_ilike_only | 0.37 | 1.03 | 50 | 5 | Limit | search_documents(50r) | - |
| search_matched_with_case_columns | 360.74 | 13.35 | 2371 | 130 | Seq Scan | search_documents(2371r) | - |
| search_people_rpc | 15.09 | 0.07 | 20 | 1677 | Function Scan | - | - |
| search_tsquery_only_count | 1.39 | 4.70 | 1 | 68 | Aggregate | search_documents(2371r) | - |
| search_where_only_count | 1.42 | 5.11 | 1 | 68 | Aggregate | search_documents(2371r) | - |
| unread_messages_rpc | 2.64 | 0.04 | 1 | 641 | Result | - | - |
| viewer_likes_for_page | 0.13 | 3.54 | 0 | 1 | Nested Loop | post_likes(0r) | idx_posts_created_at_id_desc |

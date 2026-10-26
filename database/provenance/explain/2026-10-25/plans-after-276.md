# Plans after migration 276 on staging (enable_seqscan = off so the one-page tables show their index) — Oct 25 2026


## follows: follower + status
   Index Only Scan using idx_follows_composite on follows  (cost=0.28..10.68 rows=300 width=16)

## follows: following + status
   Bitmap Heap Scan on follows  (cost=7.61..92.11 rows=500 width=16)
     ->  Bitmap Index Scan on idx_follows_following_status  (cost=0.00..7.48 rows=500 width=0)

## posts: by profile
     ->  Index Scan using idx_posts_profile_created on posts  (cost=0.28..68.01 rows=100 width=24)

## posts: keyset by created_at
     ->  Index Only Scan using idx_posts_created_at_id_desc on posts  (cost=0.28..52.94 rows=2044 width=24)

## post_comments: by post
   Index Scan using idx_comments_post on post_comments  (cost=0.43..2.68 rows=3 width=24)
             ->  Index Only Scan using idx_comments_post on post_comments post_comments_1  (cost=0.14..3.80 rows=24 width=16)

## post_likes: by post + profile
   Index Scan using idx_post_likes_profile on post_likes  (cost=0.40..2.62 rows=1 width=16)
             ->  Index Only Scan using post_likes_post_id_profile_id_key on post_likes post_likes_1  (cost=0.14..2.64 rows=20 width=16)

## post_likes: by post (count)
             ->  Index Only Scan using post_likes_post_id_profile_id_key on post_likes post_likes_1  (cost=0.14..2.64 rows=20 width=16)
     ->  Index Only Scan using post_likes_post_id_profile_id_key on post_likes  (cost=0.14..1.26 rows=1 width=0)

## post_media: by post
   Index Scan using idx_post_media_post_display on post_media  (cost=0.44..2.65 rows=1 width=20)
             ->  Index Only Scan using idx_post_media_post_display on post_media post_media_1  (cost=0.14..4.99 rows=30 width=16)

## notifications: by user
     ->  Index Scan using idx_notifications_user_created on notifications  (cost=0.29..456.73 rows=5119 width=24)

## conversation_participants: by conv
   Index Only Scan using conversation_participants_conversation_id_profile_id_key on conversation_participants  (cost=0.14..2.38 rows=2 width=16)

## golf_participant_scores: by participant
   Index Scan using golf_participant_scores_participant_id_key on golf_participant_scores  (cost=0.14..2.36 rows=1 width=16)

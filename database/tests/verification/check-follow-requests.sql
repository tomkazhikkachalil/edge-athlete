-- Check if follow requests were created
SELECT
  f.id,
  f.status,
  f.message,
  f.created_at,
  follower.full_name as follower_name,
  following.full_name as following_name
FROM follows f
LEFT JOIN profiles follower ON f.follower_id = follower.id
LEFT JOIN profiles following ON f.following_id = following.id
ORDER BY f.created_at DESC
LIMIT 10;

-- Check notifications that were created
SELECT
  n.id,
  n.type,
  n.message,
  n.read,
  n.created_at,
  recipient.full_name as recipient_name,
  actor.full_name as actor_name
FROM notifications n
LEFT JOIN profiles recipient ON n.recipient_id = recipient.id
LEFT JOIN profiles actor ON n.actor_id = actor.id
ORDER BY n.created_at DESC
LIMIT 10;

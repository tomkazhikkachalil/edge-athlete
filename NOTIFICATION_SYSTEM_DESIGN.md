# Notification System Architecture

## Overview

A comprehensive, real-time notification system that keeps athletes connected and informed about activities, requests, and engagement across the platform.

## Database Schema

### notifications Table

```sql
CREATE TABLE notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Recipient
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Notification Details
  type TEXT NOT NULL CHECK (type IN (
    'follow_request',
    'follow_accepted',
    'new_follower',
    'like',
    'comment',
    'comment_reply',
    'mention',
    'tag',
    'achievement',
    'system_announcement',
    'club_update',
    'team_update'
  )),

  -- Actor (who triggered this notification)
  actor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

  -- Related Entities
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  follow_id UUID REFERENCES follows(id) ON DELETE CASCADE,

  -- Content
  title TEXT NOT NULL,
  message TEXT,
  action_url TEXT, -- Where to navigate when clicked

  -- Metadata
  metadata JSONB, -- Flexible field for type-specific data

  -- State
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

  -- Indexes
  UNIQUE(user_id, type, actor_id, post_id, comment_id, follow_id)
);

-- Indexes for performance
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);

-- RLS Policies
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- System can insert notifications
CREATE POLICY "System can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);

-- Users can delete their own notifications
CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update timestamp trigger
CREATE TRIGGER update_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### notification_preferences Table

```sql
CREATE TABLE notification_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,

  -- Notification Type Toggles
  follow_requests_enabled BOOLEAN DEFAULT true,
  follow_accepted_enabled BOOLEAN DEFAULT true,
  new_followers_enabled BOOLEAN DEFAULT true,
  likes_enabled BOOLEAN DEFAULT true,
  comments_enabled BOOLEAN DEFAULT true,
  mentions_enabled BOOLEAN DEFAULT true,
  tags_enabled BOOLEAN DEFAULT true,
  achievements_enabled BOOLEAN DEFAULT true,
  system_announcements_enabled BOOLEAN DEFAULT true,
  club_updates_enabled BOOLEAN DEFAULT true,

  -- Delivery Preferences
  push_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences"
  ON notification_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences"
  ON notification_preferences FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences"
  ON notification_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

## Notification Types & Triggers

### 1. Follow Request (`follow_request`)
**Trigger**: When someone sends a follow request to a private profile
**Actor**: The person sending the request
**Title**: "{actor_name} sent you a follow request"
**Message**: Optional message from the requester
**Actions**: Accept, Decline
**Action URL**: `/app/followers?tab=requests`

### 2. Follow Accepted (`follow_accepted`)
**Trigger**: When your follow request is accepted
**Actor**: The person who accepted
**Title**: "{actor_name} accepted your follow request"
**Actions**: View Profile
**Action URL**: `/athlete/{actor_id}`

### 3. New Follower (`new_follower`)
**Trigger**: When someone follows you (public profile or accepted request)
**Actor**: The new follower
**Title**: "{actor_name} started following you"
**Actions**: View Profile, Follow Back
**Action URL**: `/athlete/{actor_id}`

### 4. Like (`like`)
**Trigger**: When someone likes your post
**Actor**: The person who liked
**Title**: "{actor_name} liked your post"
**Actions**: View Post
**Action URL**: `/feed?post={post_id}`
**Aggregation**: Group multiple likes on same post

### 5. Comment (`comment`)
**Trigger**: When someone comments on your post
**Actor**: The commenter
**Title**: "{actor_name} commented on your post"
**Message**: Preview of comment text
**Actions**: View Post, Reply
**Action URL**: `/feed?post={post_id}#comment-{comment_id}`

### 6. Comment Reply (`comment_reply`)
**Trigger**: When someone replies to your comment
**Actor**: The person replying
**Title**: "{actor_name} replied to your comment"
**Message**: Preview of reply text
**Actions**: View Thread
**Action URL**: `/feed?post={post_id}#comment-{comment_id}`

### 7. Mention (`mention`)
**Trigger**: When someone mentions you in a post or comment
**Actor**: The person mentioning
**Title**: "{actor_name} mentioned you"
**Message**: Preview of content
**Actions**: View Post/Comment
**Action URL**: Depends on context

### 8. Tag (`tag`)
**Trigger**: When someone tags you in media
**Actor**: The person tagging
**Title**: "{actor_name} tagged you in a post"
**Actions**: View Post
**Action URL**: `/feed?post={post_id}`

### 9. Achievement (`achievement`)
**Trigger**: When you unlock a badge or milestone
**Actor**: System
**Title**: "Achievement Unlocked: {achievement_name}"
**Message**: Description of achievement
**Actions**: View Achievements
**Action URL**: `/profile?tab=achievements`

### 10. System Announcement (`system_announcement`)
**Trigger**: Admin posts platform-wide update
**Actor**: System
**Title**: Announcement title
**Message**: Announcement text
**Actions**: Learn More (optional)
**Action URL**: Optional link

### 11. Club/Team Update (`club_update`, `team_update`)
**Trigger**: Organization posts update
**Actor**: Organization admin
**Title**: "{org_name}: {update_title}"
**Message**: Update preview
**Actions**: View Full Update
**Action URL**: `/club/{club_id}`

## API Endpoints

### GET `/api/notifications`
Fetch user's notifications with filtering and pagination

**Query Parameters**:
- `unread_only` (boolean): Only show unread notifications
- `type` (string): Filter by notification type
- `limit` (number): Number of notifications to fetch (default: 20)
- `cursor` (string): Pagination cursor (created_at timestamp)

**Response**:
```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "follow_request",
      "actor": {
        "id": "uuid",
        "first_name": "John",
        "last_name": "Doe",
        "avatar_url": "https://..."
      },
      "title": "John Doe sent you a follow request",
      "message": "Hey! Would love to connect",
      "action_url": "/app/followers?tab=requests",
      "is_read": false,
      "created_at": "2025-10-05T12:00:00Z",
      "metadata": { "follow_id": "uuid" }
    }
  ],
  "unread_count": 5,
  "has_more": true,
  "next_cursor": "2025-10-05T11:00:00Z"
}
```

### GET `/api/notifications/unread-count`
Get count of unread notifications

**Response**:
```json
{
  "count": 5
}
```

### PATCH `/api/notifications/:id/read`
Mark a single notification as read

**Response**:
```json
{
  "success": true
}
```

### PATCH `/api/notifications/mark-all-read`
Mark all notifications as read

**Response**:
```json
{
  "success": true,
  "updated_count": 12
}
```

### DELETE `/api/notifications/:id`
Delete a notification

**Response**:
```json
{
  "success": true
}
```

### DELETE `/api/notifications/clear-all`
Clear all notifications

**Response**:
```json
{
  "success": true,
  "deleted_count": 15
}
```

### GET `/api/notifications/preferences`
Get user's notification preferences

### PATCH `/api/notifications/preferences`
Update notification preferences

## Component Architecture

### NotificationCenter Component
Full-screen modal showing all notifications

**Features**:
- Tabs: All, Unread, Requests, Engagement, System
- Search/filter notifications
- Time-based grouping (Today, This Week, Earlier)
- Quick actions (accept/decline requests, view content)
- Mark as read/unread
- Clear all / Delete individual

### NotificationBell Component
Icon in header with unread badge

**Features**:
- Real-time unread count badge
- Dropdown preview (5 most recent)
- "View All" link to NotificationCenter
- Mark all as read
- Visual/sound alerts for new notifications

### NotificationItem Component
Single notification display

**Features**:
- Actor avatar
- Title with highlighted action
- Timestamp (relative: "2m ago", "1h ago")
- Quick action buttons
- Read/unread indicator
- Swipe to delete (mobile)

### NotificationProvider Context
Global state management

**State**:
- `notifications`: Array of notifications
- `unreadCount`: Number of unread
- `loading`: Loading state
- `error`: Error state

**Methods**:
- `fetchNotifications()`
- `markAsRead(id)`
- `markAllAsRead()`
- `deleteNotification(id)`
- `clearAll()`

## Real-time Updates

### Supabase Realtime Subscription

```typescript
// Subscribe to new notifications
const channel = supabase
  .channel('notifications')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'notifications',
    filter: `user_id=eq.${userId}`
  }, (payload) => {
    // Add new notification to state
    addNotification(payload.new);
    // Show toast/sound
    playNotificationSound();
  })
  .subscribe();
```

### Notification Sound/Visual
- Brief sound effect for new notifications
- Desktop browser notification (if enabled)
- Animated badge pulse
- Toast message for important notifications (follow requests)

## Database Functions for Notification Creation

### Create Notification Function

```sql
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_actor_id UUID,
  p_title TEXT,
  p_message TEXT DEFAULT NULL,
  p_action_url TEXT DEFAULT NULL,
  p_post_id UUID DEFAULT NULL,
  p_comment_id UUID DEFAULT NULL,
  p_follow_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_notification_id UUID;
  v_preferences RECORD;
BEGIN
  -- Check user's notification preferences
  SELECT * INTO v_preferences
  FROM notification_preferences
  WHERE user_id = p_user_id;

  -- If no preferences exist, create default ones
  IF v_preferences IS NULL THEN
    INSERT INTO notification_preferences (user_id)
    VALUES (p_user_id)
    RETURNING * INTO v_preferences;
  END IF;

  -- Check if this notification type is enabled
  IF (
    (p_type = 'follow_request' AND v_preferences.follow_requests_enabled) OR
    (p_type = 'follow_accepted' AND v_preferences.follow_accepted_enabled) OR
    (p_type = 'new_follower' AND v_preferences.new_followers_enabled) OR
    (p_type = 'like' AND v_preferences.likes_enabled) OR
    (p_type = 'comment' AND v_preferences.comments_enabled) OR
    (p_type = 'mention' AND v_preferences.mentions_enabled) OR
    (p_type = 'tag' AND v_preferences.tags_enabled) OR
    (p_type = 'achievement' AND v_preferences.achievements_enabled) OR
    (p_type = 'system_announcement' AND v_preferences.system_announcements_enabled) OR
    (p_type = 'club_update' AND v_preferences.club_updates_enabled)
  ) THEN
    -- Create the notification
    INSERT INTO notifications (
      user_id,
      type,
      actor_id,
      title,
      message,
      action_url,
      post_id,
      comment_id,
      follow_id,
      metadata
    ) VALUES (
      p_user_id,
      p_type,
      p_actor_id,
      p_title,
      p_message,
      p_action_url,
      p_post_id,
      p_comment_id,
      p_follow_id,
      p_metadata
    )
    ON CONFLICT DO NOTHING -- Prevent duplicates
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Notification Aggregation

For high-volume notifications (likes), aggregate multiple actions:

**Example**: "John and 5 others liked your post"

```sql
-- Store aggregation metadata
{
  "actors": ["uuid1", "uuid2", "uuid3"],
  "total_count": 6,
  "latest_actor_id": "uuid1"
}
```

Update logic:
- If notification exists for same post/type within 24 hours, update metadata
- Only create new notification if > 24 hours old

## Performance Considerations

### Indexing
- Index on `(user_id, is_read)` for fast unread queries
- Index on `created_at DESC` for pagination
- Partial index on unread notifications

### Cleanup
- Auto-delete read notifications older than 90 days
- Keep unread notifications indefinitely (or 1 year max)

```sql
-- Scheduled cleanup job
DELETE FROM notifications
WHERE is_read = true
  AND read_at < NOW() - INTERVAL '90 days';
```

### Pagination
- Use cursor-based pagination (created_at)
- Limit to 20-50 notifications per page
- Virtual scrolling for long lists

## UI/UX Guidelines

### Visual Design
- Unread: Bold text, blue dot indicator
- Read: Normal text, gray
- Critical (follow requests): Yellow highlight
- System: Blue info icon

### Timing
- Group by: Today, Yesterday, This Week, This Month, Earlier
- Relative timestamps: "2m ago", "1h ago", "Yesterday at 3:45 PM"

### Accessibility
- Screen reader announcements for new notifications
- Keyboard navigation (arrow keys, enter to open)
- High contrast mode support
- Focus indicators

### Mobile Optimization
- Swipe gestures (swipe left to delete)
- Pull to refresh
- Bottom sheet modal (not full screen)
- Haptic feedback

## Future Enhancements

### Phase 2
- Email digests (daily/weekly summary)
- Push notifications (web push API)
- Smart bundling (AI-grouped notifications)
- Notification muting (per user, per post, per thread)

### Phase 3
- SMS notifications for critical events
- In-app notification feed on profile
- Notification analytics (open rates, CTR)
- A/B testing for notification copy

### Phase 4
- Personalized notification timing (ML-based)
- Cross-platform sync (mobile app)
- Rich notifications (image previews, action buttons)
- Notification history export

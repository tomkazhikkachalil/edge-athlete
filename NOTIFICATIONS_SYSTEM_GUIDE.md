# Notifications & Followers System - Complete Guide

## Overview

This document describes the comprehensive notifications, followers, and connection suggestions system implemented for the multi-sport athlete social network.

## Features Implemented

### 1. Followers & Follow Requests

#### Follow Request Flow
- **Public Profiles**: Instant follow (status: 'accepted')
- **Private Profiles**: Follow request sent (status: 'pending')
- **Optional Message**: Users can include a message with follow requests (up to 200 characters)

#### Followers Page (`/app/followers`)
Three tabs:
- **Followers**: List of users following you
- **Following**: List of users you follow
- **Requests**: Pending follow requests with messages

### 2. Notifications System

#### Notification Types
- `follow_request` - Someone sent you a follow request
- `follow_accepted` - Your follow request was accepted
- `like` - Someone liked your post
- `comment` - Someone commented on your post
- `mention` - Someone mentioned you
- `system` - System notifications

#### Notification UI Components

**NotificationsDropdown** (`/components/NotificationsDropdown.tsx`)
- Bell icon in header with unread count badge
- Dropdown showing last 10 notifications
- Click notification to navigate to relevant page
- "Mark all as read" functionality
- Auto-refresh every 30 seconds

**NotificationsPage** (`/app/notifications`)
- Full notification history
- Filter: All / Unread
- Pagination (load more)
- Rich notification cards with avatars
- Click to navigate to related content

### 3. Connection Suggestions

#### Algorithm
Suggestions based on profile similarity:
- **Same sport + school**: 0.7 score
- **Same sport + team**: 0.6 score
- **Same sport**: 0.4 score
- **Same school**: 0.3 score
- **Same team**: 0.2 score

#### UI Components

**ConnectionSuggestions** (`/components/ConnectionSuggestions.tsx`)
- Shows top 5 suggested connections
- Displays similarity reason ("Same sport and school")
- Follow button for each suggestion
- Dismiss button to hide suggestions
- Compact mode for sidebar

**Integration**
- Feed page sidebar
- Can create dedicated suggestions page

## Database Schema

### Tables Created

#### `notifications`
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  recipient_id UUID REFERENCES profiles(id),
  actor_id UUID REFERENCES profiles(id),
  type TEXT CHECK (type IN ('follow_request', 'follow_accepted', 'like', 'comment', 'mention', 'system')),
  related_post_id UUID REFERENCES posts(id),
  related_comment_id UUID REFERENCES comments(id),
  related_follow_id UUID REFERENCES follows(id),
  message TEXT,
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### `follows` (updated)
Added column:
```sql
ALTER TABLE follows ADD COLUMN message TEXT;
```

#### `connection_suggestions`
```sql
CREATE TABLE connection_suggestions (
  id UUID PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id),
  suggested_profile_id UUID REFERENCES profiles(id),
  score DECIMAL(3,2),
  reason TEXT,
  dismissed BOOLEAN DEFAULT FALSE,
  dismissed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Database Triggers

All automatic notification creation:

1. **Follow Request** - Creates notification when follow inserted with status='pending'
2. **Follow Accepted** - Creates notification when status changes to 'accepted'
3. **Like** - Creates notification when like inserted (not for own posts)
4. **Comment** - Creates notification when comment inserted (not for own posts)

### Helper Functions

```sql
-- Get unread count
get_unread_notification_count(user_id UUID) RETURNS INTEGER

-- Mark all as read
mark_all_notifications_read(user_id UUID) RETURNS INTEGER

-- Get pending requests count
get_pending_requests_count(user_id UUID) RETURNS INTEGER

-- Generate suggestions
generate_connection_suggestions(user_profile_id UUID, suggestion_limit INT)
```

## API Endpoints

### Notifications API

**GET /api/notifications**
```
Query params:
  - limit: number (default: 20)
  - offset: number (default: 0)
  - unreadOnly: boolean (default: false)

Returns:
  - notifications: Notification[]
  - unreadCount: number
```

**PUT /api/notifications**
```
Body:
  - notificationIds: string[] (mark specific as read)
  - markAllAsRead: boolean (mark all as read)

Returns:
  - success: boolean
  - message: string
```

### Followers API

**GET /api/followers**
```
Query params:
  - type: 'followers' | 'following' | 'requests'
  - profileId: string (optional, defaults to current user)

Returns:
  - followers: Follower[] (if type=followers)
  - following: Following[] (if type=following)
  - requests: Request[] (if type=requests)
```

**POST /api/followers**
```
Body:
  - action: 'accept' | 'reject'
  - followId: string

Returns:
  - success: boolean
  - message: string
```

### Suggestions API

**GET /api/suggestions**
```
Query params:
  - profileId: string (required)
  - limit: number (default: 10)

Returns:
  - suggestions: Suggestion[]
```

**POST /api/suggestions**
```
Body:
  - profileId: string
  - suggestedProfileId: string
  - action: 'dismiss'

Returns:
  - success: boolean
  - message: string
```

### Follow API (Updated)

**POST /api/follow**
```
Body:
  - followerId: string
  - followingId: string
  - message: string (optional, up to 200 chars)

Returns:
  - action: 'followed' | 'unfollowed'
  - message: string
  - isPending: boolean (true if private profile)
```

## Component Updates

### FollowButton Component
- Shows modal for follow message when following
- Direct unfollow (no modal)
- Checks target profile privacy
- Sends follow request for private profiles

### Feed Page
- NotificationsDropdown in header
- Followers icon button
- ConnectionSuggestions in sidebar

### Athlete Profile Page
- NotificationsDropdown in header
- Followers icon button

## Setup Instructions

### 1. Run Database Migration

```bash
# Execute the SQL file in your Supabase SQL editor or via psql
psql $DATABASE_URL -f implement-notifications-system.sql
```

This will:
- Create notifications table with RLS
- Add message column to follows table
- Create connection_suggestions table
- Set up all triggers for automatic notifications
- Create helper functions

### 2. Verify Setup

Check that tables and triggers were created:

```sql
-- Verify tables
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('notifications', 'connection_suggestions');

-- Verify triggers
SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trigger_notify%';

-- Verify RLS
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('notifications', 'connection_suggestions');
```

### 3. Test the System

1. **Test Follow Request with Message**:
   - User A follows User B (private profile)
   - Include a message: "Hi! I'd love to connect"
   - User B receives notification with message
   - User B sees request in `/app/followers?tab=requests`

2. **Test Notifications**:
   - Like someone's post → they get notification
   - Comment on post → they get notification
   - Accept follow request → requester gets notification

3. **Test Suggestions**:
   - Create users with same sport/school
   - Check `/feed` sidebar for suggestions
   - Dismiss a suggestion
   - Follow a suggestion

## Navigation Flow

```
Feed Header:
  🔔 Notifications → Dropdown (last 10) → Click "View all" → /app/notifications
  👥 Followers Icon → /app/followers

Followers Page Tabs:
  - Followers (list)
  - Following (list)
  - Requests (with messages + accept/reject)

Notifications:
  - Click follow_request → /app/followers?tab=requests
  - Click like/comment → /feed?post={postId}
  - Click follow_accepted → /athlete/{actorId}
```

## Privacy Integration

The notification system respects privacy settings:

1. **Follow Requests**: Private profiles require approval
2. **Notifications**: Only created for accessible content
3. **Suggestions**: Only suggests public profiles or mutuals
4. **Visibility**: RLS ensures users only see their own notifications

## Real-time Behavior

- Notifications poll every 30 seconds
- Unread count updates in real-time
- Badge shows on bell icon when unread > 0
- Mark as read on notification click

## Mobile Responsiveness

All components are fully responsive:
- NotificationsDropdown: Adjusts to screen size
- FollowersPage: Stacked layout on mobile
- ConnectionSuggestions: Compact cards on mobile
- Follow message modal: Full-screen on mobile

## Future Enhancements

Potential additions:
1. Real-time WebSocket notifications
2. Email/push notification integration
3. Notification preferences per type
4. Mute/block functionality
5. Advanced suggestion algorithm (mutual connections, interests)
6. Notification grouping ("John and 5 others liked your post")
7. Read receipts for messages
8. Follow request expiration

## Troubleshooting

### Notifications not appearing
1. Check triggers are active: `SELECT * FROM pg_trigger WHERE tgname LIKE 'trigger_notify%'`
2. Verify RLS policies allow insert: `SELECT * FROM pg_policies WHERE tablename = 'notifications'`
3. Check notification was created: `SELECT * FROM notifications ORDER BY created_at DESC LIMIT 10`

### Follow requests not working
1. Verify `message` column exists: `\d follows`
2. Check privacy system: Does target profile have `visibility = 'private'`?
3. Verify follow trigger: `SELECT * FROM follows WHERE status = 'pending'`

### Suggestions not showing
1. Check function exists: `SELECT * FROM pg_proc WHERE proname = 'generate_connection_suggestions'`
2. Test function directly: `SELECT * FROM generate_connection_suggestions('user-id', 10)`
3. Verify profile data exists (sport, school, team fields populated)

## Security Considerations

1. **RLS Enabled**: All tables have Row Level Security
2. **User Isolation**: Users can only view/modify their own notifications
3. **Privacy Respect**: Triggers check visibility before creating notifications
4. **Input Validation**: Follow messages limited to 200 chars
5. **Server-side Logic**: All privacy checks done server-side with service role

## Performance Notes

- Notifications table indexed on `(recipient_id, created_at DESC)`
- Suggestions use score-based ordering with limit
- Follow stats cached and only recalculated on change
- Pagination implemented for large notification lists

## Code References

**Database Setup**: [implement-notifications-system.sql](implement-notifications-system.sql)

**API Routes**:
- [/api/notifications/route.ts](src/app/api/notifications/route.ts)
- [/api/followers/route.ts](src/app/api/followers/route.ts)
- [/api/suggestions/route.ts](src/app/api/suggestions/route.ts)
- [/api/follow/route.ts](src/app/api/follow/route.ts) (updated)

**Components**:
- [NotificationsDropdown.tsx](src/components/NotificationsDropdown.tsx)
- [ConnectionSuggestions.tsx](src/components/ConnectionSuggestions.tsx)
- [FollowButton.tsx](src/components/FollowButton.tsx) (updated)

**Pages**:
- [/app/notifications/page.tsx](src/app/app/notifications/page.tsx)
- [/app/followers/page.tsx](src/app/app/followers/page.tsx)
- [/feed/page.tsx](src/app/feed/page.tsx) (updated)
- [/athlete/page.tsx](src/app/athlete/page.tsx) (updated)

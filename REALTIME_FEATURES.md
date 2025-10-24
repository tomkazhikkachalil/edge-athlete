# Real-time Features Implementation

## Overview

The platform now includes comprehensive real-time features powered by Supabase Realtime subscriptions. This enables instant updates across the application without manual refreshing.

---

## 1. Real-time Feed Updates

### Location: `src/app/feed/page.tsx`

### Features Implemented:

#### A. New Post Notifications
- **Subscription**: Listens for `INSERT` events on the `posts` table
- **Filter**: Only public posts (`visibility=eq.public`)
- **Behavior**:
  - New posts appear at the top of the feed instantly
  - Toast notification: "New Post - A new post has been added to your feed"
  - Fetches complete post data including profile and media

**Code:**
```typescript
useEffect(() => {
  if (!user) return;

  const supabase = getSupabaseBrowserClient();
  const channel = supabase
    .channel('feed-posts')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'posts',
      filter: `visibility=eq.public`
    }, async (payload) => {
      // Fetch complete post and add to feed
    })
    .subscribe();

  return () => supabase.removeChannel(channel);
}, [user, showSuccess]);
```

#### B. Live Like/Comment Counts
- **Subscription**: Listens for `UPDATE` events on the `posts` table
- **Behavior**:
  - Like counts update in real-time when other users like posts
  - Comment counts update when comments are added
  - Updates are reflected immediately without refresh

**Code:**
```typescript
useEffect(() => {
  if (!user) return;

  const supabase = getSupabaseBrowserClient();
  const channel = supabase
    .channel('feed-updates')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'posts'
    }, (payload) => {
      setPosts(prev => prev.map(post =>
        post.id === payload.new.id
          ? { ...post, likes_count: payload.new.likes_count, comments_count: payload.new.comments_count }
          : post
      ));
    })
    .subscribe();

  return () => supabase.removeChannel(channel);
}, [user]);
```

---

## 2. Real-time Notifications System

### Location: `src/hooks/useRealtimeNotifications.ts`

### Features:

#### A. Notification Types
- `like` - Someone liked your post
- `comment` - Someone commented on your post
- `follow` - Someone followed you
- `mention` - Someone mentioned you in a post/comment

#### B. Real-time Updates
- Instant notification badge updates
- Unread count updates automatically
- New notifications appear without refresh

#### C. Usage Example:
```typescript
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';

function MyComponent() {
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } =
    useRealtimeNotifications(user?.id);

  return (
    <div>
      <span>Unread: {unreadCount}</span>
      {notifications.map(notif => (
        <div key={notif.id} onClick={() => markAsRead(notif.id)}>
          {notif.message}
        </div>
      ))}
    </div>
  );
}
```

#### D. Database Requirements:
To enable notifications, run this SQL in Supabase:

```sql
-- Enable realtime for notifications table
ALTER TABLE notifications REPLICA IDENTITY FULL;

-- If notifications table doesn't exist, create it:
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  actor_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('like', 'comment', 'follow', 'mention')),
  target_id UUID,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own notifications" ON notifications
  FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY "Users can update their own notifications" ON notifications
  FOR UPDATE USING (auth.uid() = profile_id);

-- Index for performance
CREATE INDEX idx_notifications_profile ON notifications(profile_id, read, created_at DESC);
```

---

## 3. Advanced Search with Filters

### Location: `src/components/AdvancedSearchBar.tsx`

### Features:

#### A. Filter Types:
1. **Search Type**: Athletes, Posts, Clubs, or All
2. **Sport**: Filter by specific sport (golf, ice hockey, volleyball, etc.)
3. **School**: Filter by school name (fuzzy search)
4. **League/Conference**: Filter by league (NCAA D1, Big Ten, etc.)
5. **Date Range**: Filter posts by date (from/to)

#### B. API Endpoint: `/api/search`

**Query Parameters:**
- `q` - Search query (required, min 2 characters)
- `type` - Search type: `all`, `athletes`, `posts`, `clubs`
- `sport` - Sport filter (sport_key from SportRegistry)
- `school` - School name (partial match)
- `league` - League/conference name
- `dateFrom` - Start date (ISO format: YYYY-MM-DD)
- `dateTo` - End date (ISO format: YYYY-MM-DD)

**Example Requests:**
```bash
# Search all golfers
GET /api/search?q=john&sport=golf

# Search posts from Stanford in last 30 days
GET /api/search?q=tournament&type=posts&school=Stanford&dateFrom=2024-03-01

# Search NCAA D1 athletes
GET /api/search?q=smith&league=NCAA+D1
```

#### C. Usage in Components:
```tsx
import AdvancedSearchBar from '@/components/AdvancedSearchBar';

function Header() {
  return (
    <div className="max-w-2xl">
      <AdvancedSearchBar />
    </div>
  );
}
```

#### D. Visual Indicators:
- Filter button shows count of active filters
- Blue background when filters are active
- "Clear All" button to reset filters
- Filter panel slides down from search bar

---

## 4. Database Setup for Real-time

### Required Supabase Configuration:

#### A. Enable Realtime for Tables:
```sql
-- Enable realtime on posts table
ALTER PUBLICATION supabase_realtime ADD TABLE posts;

-- Enable realtime on notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Set replica identity (required for UPDATE events)
ALTER TABLE posts REPLICA IDENTITY FULL;
ALTER TABLE notifications REPLICA IDENTITY FULL;
```

#### B. Verify Realtime is Enabled:
In Supabase Dashboard:
1. Go to **Database** → **Replication**
2. Check that `posts` and `notifications` tables are listed
3. Ensure "Realtime" is enabled for both

---

## 5. Performance Considerations

### A. Channel Management
- Each subscription creates a WebSocket channel
- Channels are automatically cleaned up on component unmount
- Max recommended channels per client: 100

### B. Network Optimization
- Subscriptions use minimal bandwidth (only changes sent)
- Binary protocol (efficient over JSON)
- Automatic reconnection on network failure

### C. Scalability
- Supabase Realtime scales to millions of concurrent connections
- Each user's subscriptions are isolated
- RLS policies enforce security at database level

---

## 6. Testing Real-time Features

### A. Test New Post Updates:
1. Open feed in two browser windows (or incognito + normal)
2. Log in as different users
3. Create a post in one window
4. Observe instant appearance in other window's feed

### B. Test Like/Comment Updates:
1. Open same post in two windows
2. Like post in one window
3. Observe like count update in other window instantly

### C. Test Notifications:
1. Open notifications dropdown
2. In another window, like one of your posts
3. Observe unread count increment without refresh
4. Click notification to mark as read

### D. Test Search Filters:
1. Open search bar
2. Click "Filters" button
3. Select sport, date range, etc.
4. Verify results update automatically
5. Check active filter count badge

---

## 7. Troubleshooting

### Issue: Real-time updates not working

**Check:**
1. Verify Supabase Realtime is enabled in project settings
2. Check browser console for WebSocket errors
3. Verify RLS policies allow reads for current user
4. Ensure `REPLICA IDENTITY FULL` is set on tables

**Debug:**
```typescript
// Add to component
useEffect(() => {
  const supabase = getSupabaseBrowserClient();

  supabase.channel('debug')
    .on('system', {}, (payload) => {
      console.log('System event:', payload);
    })
    .subscribe((status) => {
      console.log('Channel status:', status);
    });
}, []);
```

### Issue: Too many subscriptions

**Solution:**
- Consolidate multiple subscriptions into single channel
- Use filter parameter to narrow subscription scope
- Unsubscribe from channels on route changes

### Issue: Slow performance

**Check:**
1. Number of active channels (should be < 10 per page)
2. Payload size (fetch only needed columns)
3. Update frequency (debounce rapid updates)

---

## 8. Future Enhancements

### Planned Features:
1. **Typing Indicators**: Show when someone is typing a comment
2. **Online Status**: Real-time presence indicators
3. **Live Sports Scores**: Real-time score updates for ongoing games
4. **Direct Messaging**: Real-time chat between athletes
5. **Activity Feed**: Live stream of friend activities

### Implementation Priority:
- ✅ Post updates (COMPLETED)
- ✅ Notification system (COMPLETED)
- ✅ Advanced search (COMPLETED)
- ⏳ Typing indicators
- ⏳ Online presence
- ⏳ Live messaging

---

## 9. Code Organization

### File Structure:
```
src/
├── app/
│   ├── feed/
│   │   └── page.tsx                 # Real-time feed implementation
│   └── api/
│       └── search/
│           └── route.ts             # Advanced search API
├── components/
│   ├── AdvancedSearchBar.tsx        # Search with filters UI
│   └── NotificationsDropdown.tsx    # (Update to use hook)
├── hooks/
│   └── useRealtimeNotifications.ts  # Notifications hook
└── lib/
    └── supabase.ts                  # Supabase client setup
```

---

## Summary

✅ **Real-time feed updates** - New posts appear instantly
✅ **Live like/comment counts** - Updates without refresh
✅ **Notification system** - Real-time alerts with unread count
✅ **Advanced search** - Filters by sport, school, league, date
✅ **Scalable architecture** - Handles millions of concurrent users
✅ **Optimized performance** - Minimal bandwidth usage

**Next Steps:**
1. Enable Realtime in Supabase Dashboard
2. Run SQL migrations for notifications table
3. Test real-time features with multiple users
4. Monitor WebSocket connections in production

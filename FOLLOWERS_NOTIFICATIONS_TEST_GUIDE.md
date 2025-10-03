# Followers & Notifications System - Test Guide

## What Was Fixed

1. ✅ **Follow Button Issue** - Removed `!currentUserId` check from disabled attribute
2. ✅ **Database RLS Policies** - Fixed 406 errors blocking profile access
3. ✅ **Cookie Configuration** - Updated Supabase SSR client setup
4. ✅ **Follows Table** - Created with proper foreign keys and RLS
5. ✅ **Notifications Table** - Created with triggers for follow events
6. ✅ **Auth Loading Issue** - Created cache clearing tool

## How the System Works

### Follow Flow

1. **User A clicks "Follow" on User B's profile**
   - Modal opens asking for optional message (up to 200 characters)
   - User A can add a message like "Hi! I'd love to connect..."

2. **Follow Request is Created**
   - If User B has a **public profile**: Follow is automatically accepted (status = 'accepted')
   - If User B has a **private profile**: Follow is pending (status = 'pending')
   - The message is saved with the follow request

3. **Notification is Sent**
   - If follow is **pending**: User B gets a "follow_request" notification
   - If follow is **accepted**: User A gets a "follow_accepted" notification

### Notification Types

- `follow_request` - Someone wants to follow you (private profiles only)
- `follow_accepted` - Your follow request was accepted
- `like` - Someone liked your post (future)
- `comment` - Someone commented on your post (future)
- `mention` - Someone mentioned you (future)
- `system` - System notifications (future)

## Testing Checklist

### Test 1: Follow a Public Profile

1. Log in as User A
2. Go to User B's profile (make sure User B has `visibility = 'public'`)
3. Click the "Follow" button
4. Add a message: "Hi! Let's connect"
5. Click "Send Request"

**Expected Results:**
- ✅ Follow button changes to "Following" with checkmark
- ✅ User A is now following User B immediately (no pending status)
- ✅ User B's followers count increases by 1
- ✅ User A gets a success toast: "Follow Request Sent"

**Check Database:**
```sql
SELECT * FROM follows WHERE follower_id = 'user_a_id' AND following_id = 'user_b_id';
-- Should show: status = 'accepted', message = "Hi! Let's connect"
```

### Test 2: Follow a Private Profile

1. Log in as User A
2. Change User C's profile to private:
   ```sql
   UPDATE profiles SET visibility = 'private' WHERE id = 'user_c_id';
   ```
3. Go to User C's profile
4. Click "Follow" button
5. Add message: "I'd like to follow you"
6. Click "Send Request"

**Expected Results:**
- ✅ Follow button changes to "Following" with checkmark
- ✅ Status is "pending" (User C must approve)
- ✅ User C receives a notification

**Check Database:**
```sql
SELECT * FROM follows WHERE follower_id = 'user_a_id' AND following_id = 'user_c_id';
-- Should show: status = 'pending', message = "I'd like to follow you"

SELECT * FROM notifications
WHERE recipient_id = 'user_c_id'
  AND type = 'follow_request'
  AND actor_id = 'user_a_id';
-- Should show 1 notification with the follow request
```

### Test 3: Accept Follow Request

1. Log in as User C (who has pending request from User A)
2. Go to `/app/followers` page
3. Click on "Requests" tab
4. See User A's follow request with message
5. Click "Accept" button

**Expected Results:**
- ✅ Request moves from "Requests" to "Followers" tab
- ✅ User A receives "follow_accepted" notification
- ✅ User C's followers count increases by 1

**Check Database:**
```sql
SELECT * FROM follows WHERE follower_id = 'user_a_id' AND following_id = 'user_c_id';
-- Should show: status = 'accepted'

SELECT * FROM notifications
WHERE recipient_id = 'user_a_id'
  AND type = 'follow_accepted'
  AND actor_id = 'user_c_id';
-- Should show 1 notification
```

### Test 4: Reject Follow Request

1. Log in as User C
2. Go to `/app/followers` → "Requests" tab
3. Click "Reject" on a follow request

**Expected Results:**
- ✅ Follow request is deleted from database
- ✅ Request disappears from UI
- ✅ No notification sent to requester

### Test 5: Unfollow

1. Log in as User A (who is following User B)
2. Go to User B's profile
3. Click "Following" button (changes back to "Follow")

**Expected Results:**
- ✅ Button changes to "Follow" with plus icon
- ✅ Follow relationship is deleted
- ✅ User B's followers count decreases by 1
- ✅ Success toast: "Unfollowed"

### Test 6: Notifications Bell

1. Log in as user with notifications
2. Look at header - should see bell icon
3. If unread notifications exist, should see red badge with count
4. Click bell icon

**Expected Results:**
- ✅ Dropdown shows last 10 notifications
- ✅ Each notification shows:
  - Actor's avatar and name
  - Action type ("sent you a follow request", "accepted your follow request")
  - Time ago
  - Message (if follow request)
- ✅ "Mark all as read" button works
- ✅ "View all" link goes to `/app/notifications`

### Test 7: Followers Page

1. Go to `/app/followers`
2. Check all three tabs work:
   - **Followers**: People following you
   - **Following**: People you follow
   - **Requests**: Pending follow requests

**Expected Results:**
- ✅ Each tab shows correct data
- ✅ Accept/Reject buttons work on Requests tab
- ✅ Can see follow messages in requests
- ✅ Profile pictures and names display correctly

### Test 8: Connection Suggestions

1. Go to Feed page
2. Look for "Suggested Connections" sidebar (if implemented)
3. Should show athletes with similar sports/schools

**Expected Results:**
- ✅ Shows relevant suggestions
- ✅ Can follow directly from suggestions
- ✅ Can dismiss suggestions

## API Endpoints Reference

- **POST /api/follow** - Create/delete follow relationship
- **GET /api/follow/stats** - Get followers/following counts
- **GET /api/followers** - Get followers/following/requests lists
- **POST /api/followers** - Accept/reject follow requests
- **GET /api/notifications** - Get notifications list
- **PUT /api/notifications** - Mark notifications as read
- **GET /api/suggestions** - Get connection suggestions
- **POST /api/suggestions** - Dismiss suggestions

## Troubleshooting

### Follow Button Not Clickable
- ✅ FIXED: Removed disabled check for currentUserId
- Refresh page with Ctrl+Shift+R
- Make sure you're logged in

### Notifications Not Showing
- Check database triggers exist:
  ```sql
  SELECT trigger_name FROM information_schema.triggers
  WHERE event_object_table = 'follows';
  ```
- Should see: `trigger_notify_follow_request`, `trigger_notify_follow_accepted`

### 406 Errors on Profiles
- Run the RLS fix SQL from `fix-profiles-rls.sql`
- Verify policies exist:
  ```sql
  SELECT policyname FROM pg_policies WHERE tablename = 'profiles';
  ```

### Loading Screen Stuck
- Open `clear-cache.html` in browser
- Click "Clear Auth Cache"
- Hard refresh app
- Log in again

## Database Schema Quick Reference

### follows table
```sql
- id: UUID
- follower_id: UUID → profiles(id)
- following_id: UUID → profiles(id)
- status: 'pending' | 'accepted' | 'rejected'
- message: TEXT (optional follow message)
- created_at: TIMESTAMP
- updated_at: TIMESTAMP
```

### notifications table
```sql
- id: UUID
- recipient_id: UUID → profiles(id)
- actor_id: UUID → profiles(id)
- type: 'follow_request' | 'follow_accepted' | 'like' | 'comment' | 'mention' | 'system'
- related_post_id: UUID → posts(id) (optional)
- related_follow_id: UUID → follows(id) (optional)
- message: TEXT (optional)
- read: BOOLEAN
- read_at: TIMESTAMP
- created_at: TIMESTAMP
```

## Next Steps / Future Enhancements

- [ ] Add like notifications (when likes table is fixed)
- [ ] Add comment notifications (when comments table is fixed)
- [ ] Add mention detection in posts
- [ ] Real-time notifications with Supabase Realtime
- [ ] Email notifications for important events
- [ ] Push notifications (web/mobile)
- [ ] Notification preferences/settings
- [ ] Block/mute users functionality

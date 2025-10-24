# Notification System Testing Guide

## Overview
The notification system has been completely redesigned to match industry best practices (Instagram, LinkedIn, Twitter patterns). This guide will help you test all the new features.

## Before Testing: Run Database Migration

**IMPORTANT:** You must run the database migration before testing!

1. Open Supabase Dashboard → SQL Editor
2. Run the migration file: `database/migrations/009_notification_actions.sql`
3. Verify success messages in the output
4. Confirm new columns exist:
   ```sql
   SELECT column_name, data_type
   FROM information_schema.columns
   WHERE table_name = 'notifications'
   AND column_name IN ('action_status', 'action_taken_at', 'grouped_notification_id');
   ```

---

## What's New?

### 1. Unified Notification Feed
- **Before:** Separate "Follow Requests" section + notification list
- **After:** Single unified feed with all notifications
- **Benefit:** Single source of truth, less confusion

### 2. Inline Action Buttons
- **Before:** Navigate to separate page to accept/decline
- **After:** Accept/Decline buttons right in the notification
- **Benefit:** Faster workflow, clearer UX

### 3. Smart Status Tracking
- **Before:** Notifications didn't update after action
- **After:** Shows status badges (Accepted/Declined)
- **Benefit:** Complete audit trail of actions

### 4. NotificationBell Improvements
- **Before:** Only showed unread notifications
- **After:** Shows all recent notifications with blue dot for unread
- **Benefit:** Notifications don't vanish, matches Twitter/Instagram

### 5. Auto-Mark as Read
- **Before:** Manual click to mark as read
- **After:** Auto-marks after 2 seconds of visibility
- **Benefit:** Less cognitive load, matches modern platforms

---

## Testing Checklist

### Test 1: Database Migration
- [ ] Migration runs without errors
- [ ] New columns exist in notifications table
- [ ] Existing notifications still display correctly
- [ ] Triggers are active (check pg_trigger table)

### Test 2: Follow Request Flow (End-to-End)

**Setup:** Use two accounts (User A sends request, User B receives)

**Steps:**
1. User A (private profile) sends follow request to User B
2. **Verify User B sees:**
   - [ ] Notification bell shows unread count
   - [ ] Open bell dropdown → see follow request with Accept/Decline buttons
   - [ ] Blue dot indicator next to notification
   - [ ] Notification text: "User A sent you a follow request"

3. User B navigates to full notifications page (`/app/notifications`)
   - [ ] Follow request appears in unified feed (NOT separate section)
   - [ ] Inline Accept/Decline buttons visible
   - [ ] No duplicate "Follow Requests" section

4. User B clicks "Accept"
   - [ ] Button shows "Processing..." with spinner
   - [ ] Notification updates to show green "Accepted" badge
   - [ ] Notification text changes to "You accepted User A's follow request"
   - [ ] User B can now see User A's posts
   - [ ] User A receives "User B accepted your follow request" notification

5. **Verify User A sees:**
   - [ ] Notification bell shows unread count
   - [ ] Notification: "User B accepted your follow request"
   - [ ] Clicking notification navigates to User B's profile

### Test 3: Follow Request Decline Flow

**Steps:**
1. User C sends follow request to User D
2. User D navigates to notifications page
3. User D clicks "Decline"
   - [ ] Notification updates to show gray "Declined" badge
   - [ ] Notification text changes to "You declined User C's follow request"
   - [ ] Follow relationship is deleted from database
   - [ ] User C does NOT receive a notification (as expected)

### Test 4: NotificationBell Dropdown

**Steps:**
1. Generate multiple notifications (likes, comments, follows)
2. Click notification bell icon
   - [ ] Dropdown shows up to 5 recent notifications
   - [ ] Shows BOTH read and unread (not just unread)
   - [ ] Unread notifications have blue dot indicator
   - [ ] Read notifications have dimmed text
   - [ ] Follow request notifications show inline Accept/Decline buttons
   - [ ] "View all notifications" link works

3. Click a notification in dropdown
   - [ ] Navigates to correct page (post, profile, etc.)
   - [ ] Notification is marked as read
   - [ ] Blue dot disappears
   - [ ] Unread count decreases

### Test 5: Auto-Mark as Read

**Steps:**
1. Generate new notifications
2. Navigate to notifications page
3. Scroll slowly through notifications
   - [ ] Blue-highlighted notifications stay visible
   - [ ] After 2 seconds of being in viewport, notification turns white (read)
   - [ ] "New" badge disappears
   - [ ] Unread count in header decreases

4. Scroll quickly past notifications (< 2 seconds)
   - [ ] Notifications remain unread (blue)
   - [ ] Timer is cancelled if scrolled away

### Test 6: Real-Time Updates

**Setup:** Two browser windows with different users

**Steps:**
1. User A sends follow request to User B
2. **In User B's window (without refresh):**
   - [ ] Notification bell count increases immediately
   - [ ] New notification appears in dropdown
   - [ ] Browser notification pops up (if permission granted)

3. User B accepts request (in one browser window)
4. **In User A's window (without refresh):**
   - [ ] Notification bell count increases
   - [ ] "Accepted your follow request" notification appears

5. Open notifications page in both windows
6. User B accepts a different follow request
   - [ ] Status updates to "Accepted" in real-time
   - [ ] Green badge appears without refresh

### Test 7: Notification Types

Test each notification type still works:
- [ ] Like notification (post_like)
- [ ] Comment notification (post_comment)
- [ ] Mention notification
- [ ] New follower (public profile)
- [ ] Follow request (private profile)
- [ ] Follow accepted

### Test 8: Notification Filters

**Steps:**
1. Navigate to notifications page
2. Click "All" tab
   - [ ] Shows both read and unread notifications
3. Click "Unread" tab
   - [ ] Shows only unread notifications
   - [ ] Previously read notifications hidden

### Test 9: Mark All as Read

**Steps:**
1. Have multiple unread notifications
2. Click "Mark all as read" button
   - [ ] All notifications turn white (no blue highlight)
   - [ ] All "New" badges disappear
   - [ ] Unread count becomes 0
   - [ ] Status badges remain visible (Accepted/Declined)

### Test 10: Edge Cases

**Empty States:**
- [ ] No notifications: Shows "No notifications" message
- [ ] All read with unread filter: Shows "You're all caught up!"

**Action Status Validation:**
- [ ] Can't accept already-accepted request (shows error)
- [ ] Can't decline already-declined request (shows error)
- [ ] Clicking notification for accepted request navigates to profile
- [ ] Clicking notification for declined request does nothing (expected)

**Performance:**
- [ ] Page loads quickly with 100+ notifications
- [ ] Intersection Observer doesn't cause lag
- [ ] Real-time updates don't freeze UI

---

## Database Verification Queries

Check notification statuses:
```sql
SELECT
  id,
  type,
  action_status,
  action_taken_at,
  created_at
FROM notifications
WHERE type = 'follow_request'
ORDER BY created_at DESC
LIMIT 10;
```

Check follow relationships:
```sql
SELECT
  id,
  follower_id,
  following_id,
  status,
  created_at
FROM follows
ORDER BY created_at DESC
LIMIT 10;
```

Check trigger activity:
```sql
SELECT
  trigger_name,
  event_manipulation,
  event_object_table
FROM information_schema.triggers
WHERE trigger_name LIKE '%notify%';
```

---

## Known Expected Behaviors

1. **Follow requests never expire** - They stay pending until accepted/declined
2. **Declined requests are deleted** - The follow relationship is removed entirely
3. **Notifications persist after action** - They update with status badges but don't disappear
4. **Auto-mark is delayed** - 2 seconds of visibility required (intentional)
5. **Read notifications visible** - They remain in "All" tab with dimmed styling

---

## Troubleshooting

### Issue: No notifications appearing
- **Solution:** Check database triggers are active (see queries above)
- **Solution:** Verify Realtime is enabled in Supabase Dashboard

### Issue: Action buttons don't work
- **Solution:** Check browser console for errors
- **Solution:** Verify migration ran successfully
- **Solution:** Check API endpoint: `POST /api/notifications/[id]/action`

### Issue: Real-time updates not working
- **Solution:** Enable Realtime replication for `notifications` table in Supabase
- **Solution:** Check browser network tab for WebSocket connection
- **Solution:** Verify user is authenticated

### Issue: Intersection Observer not working
- **Solution:** Check browser compatibility (modern browsers only)
- **Solution:** Verify `data-notification-id` attributes exist in DOM
- **Solution:** Check console for errors

---

## Success Criteria

✅ All 10 test cases pass
✅ No console errors during testing
✅ No duplicate "Follow Requests" section
✅ Inline action buttons work
✅ Status badges appear correctly
✅ Real-time updates work
✅ Auto-mark as read functions
✅ NotificationBell shows all notifications

---

## Next Steps After Testing

1. Test with multiple users in production-like environment
2. Monitor performance with high notification volume
3. Gather user feedback on new UX
4. Consider notification grouping (future enhancement)
5. Add notification preferences UI (already have backend support)

---

## File Changes Summary

**New Files:**
- `database/migrations/009_notification_actions.sql` - Database schema updates
- `src/app/api/notifications/[id]/action/route.ts` - Action handler endpoint

**Modified Files:**
- `src/app/app/notifications/page.tsx` - Complete page redesign
- `src/components/NotificationBell.tsx` - Show all notifications with blue dot
- `src/lib/notifications.tsx` - Real-time update listener

**Total Lines Changed:** ~650 lines added/modified

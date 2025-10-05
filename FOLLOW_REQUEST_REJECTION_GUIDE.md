# Follow Request Rejection & Re-Request Guide

## Overview

The follow request system has been designed to handle rejections cleanly by **completely deleting** rejected requests from the database. This allows users to send new follow requests in the future without any restrictions.

## How It Works

### 1. Follow Request Rejection

When a user **rejects** a follow request:

1. **Complete Deletion**: The follow request is permanently deleted from the `follows` table
2. **No Status Tracking**: No "rejected" status is stored - the record is gone entirely
3. **Both Users Cleared**: The request is removed from both the requester's and receiver's records
4. **Clean Slate**: The system acts as if the follow request never existed

### 2. Re-Requesting After Rejection

After a follow request has been rejected:

1. **No Restrictions**: The same person can send a completely new follow request
2. **Fresh Start**: The new request is treated as a first-time request
3. **UNIQUE Constraint**: The database has a `UNIQUE(follower_id, following_id)` constraint, but since the rejected request was **deleted**, there's no conflict

### 3. Database Schema

The `follows` table structure:

```sql
CREATE TABLE follows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted', 'rejected')),
  message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(follower_id, following_id)  -- Prevents duplicate active requests only
);
```

**Important Notes:**
- The `'rejected'` status in the CHECK constraint is **not used** - it's legacy
- The UNIQUE constraint only prevents having two simultaneous active requests
- Once a request is deleted, the constraint is satisfied for new requests

## API Endpoints

### Reject a Follow Request

**Endpoint**: `POST /api/followers`

**Request Body**:
```json
{
  "action": "reject",
  "followId": "uuid-of-follow-request"
}
```

**Response** (Success):
```json
{
  "success": true,
  "message": "Follow request rejected and removed. User can send a new request in the future.",
  "deletedCount": 1
}
```

**What Happens**:
1. The follow request with `status='pending'` is completely deleted
2. The deletion is logged with details about which user was removed
3. The requester can now send a new follow request without any restrictions

### Send a New Follow Request

**Endpoint**: `POST /api/follow`

**Request Body**:
```json
{
  "followerId": "user-sending-request-uuid",
  "followingId": "user-receiving-request-uuid",
  "message": "Optional message with the request"
}
```

**Response** (For Private Profile):
```json
{
  "action": "followed",
  "message": "Follow request sent",
  "isPending": true
}
```

**Response** (For Public Profile):
```json
{
  "action": "followed",
  "message": "User followed successfully",
  "isPending": false
}
```

**What Happens**:
1. System checks if an **active** follow relationship exists (it won't if it was rejected and deleted)
2. Creates a new follow request with `status='pending'` (for private profiles) or `status='accepted'` (for public profiles)
3. The new request is completely independent from any previous rejected requests

## Testing the Flow

### Test Scenario: Reject and Re-Request

1. **User A sends a follow request to User B** (User B has a private profile)
   - Navigate to User B's profile
   - Click "Follow"
   - A follow request with `status='pending'` is created

2. **User B rejects the request**
   - Navigate to Followers page → "Requests" tab
   - Click "Decline" on User A's request
   - The request is **completely deleted** from the database
   - User A's request disappears from the UI

3. **User A sends a new follow request**
   - Navigate to User B's profile again
   - Click "Follow" (button should be available again)
   - A **new** follow request is created with a new UUID
   - User B sees the new request in their Requests tab

4. **Verification**
   - Check the database: `SELECT * FROM follows WHERE follower_id = 'user-a-id' AND following_id = 'user-b-id'`
   - Should show only the new request (if pending) or no rows (if rejected again)
   - No "rejected" status should ever appear

## Code Implementation Details

### Rejection Logic (`/api/followers/route.ts`)

```typescript
if (action === 'reject') {
  // Reject a follow request (completely delete it from the system)
  // This allows the same person to send a new follow request in the future
  console.log('[FOLLOWERS API] Rejecting (deleting) follow request:', followId);

  const { data: deletedRows, error } = await supabase
    .from('follows')
    .delete()
    .eq('id', followId)
    .eq('following_id', user.id) // Ensure user owns this request
    .eq('status', 'pending')
    .select(); // Return deleted rows for verification

  if (error) {
    console.error('[FOLLOWERS API] Error deleting follow request:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!deletedRows || deletedRows.length === 0) {
    console.warn('[FOLLOWERS API] No rows deleted - request may not exist or already processed');
    return NextResponse.json({
      error: 'Follow request not found or already processed'
    }, { status: 404 });
  }

  console.log('[FOLLOWERS API] Successfully deleted follow request:', {
    followId,
    follower: deletedRows[0].follower_id,
    deletedCount: deletedRows.length
  });

  return NextResponse.json({
    success: true,
    message: 'Follow request rejected and removed. User can send a new request in the future.',
    deletedCount: deletedRows.length
  });
}
```

### Follow Request Logic (`/api/follow/route.ts`)

```typescript
// Check if the user already follows this person
const { data: existingFollow, error: checkError } = await supabase
  .from('follows')
  .select('id')
  .eq('follower_id', followerId)
  .eq('following_id', followingId)
  .maybeSingle(); // Returns null if not found (e.g., after rejection/deletion)

if (!existingFollow) {
  // No existing relationship - create new follow request
  // This works even if a previous request was rejected and deleted
  const insertData = {
    follower_id: followerId,
    following_id: followingId,
    status: isPrivate ? 'pending' : 'accepted',
    message: message || null
  };

  await supabase.from('follows').insert(insertData);
}
```

## Key Benefits

✅ **Clean System**: No residual "rejected" statuses cluttering the database
✅ **Privacy Preserved**: Users can reject requests without permanent consequences
✅ **Flexible Relationships**: Allows users to reconnect if circumstances change
✅ **Simple Logic**: No complex state management for "rejected" vs "deleted" vs "blocked"
✅ **Database Integrity**: UNIQUE constraint prevents duplicates while allowing re-requests

## What's Different from Other Systems?

Many social platforms keep a record of rejected requests (e.g., setting `status='rejected'`). This system is different:

- ❌ **No Rejected Status**: We don't store "rejected" - we delete completely
- ❌ **No Permanent Blocks**: Rejection doesn't create a permanent barrier
- ✅ **Clean Slate**: Each new request is independent
- ✅ **User Control**: Receivers can reject as many times as needed without accumulating records

## Troubleshooting

### Issue: "User already followed" error when trying to re-request

**Cause**: The previous request wasn't properly deleted

**Solution**:
```sql
-- Check for existing requests
SELECT * FROM follows
WHERE follower_id = 'user-a-id'
  AND following_id = 'user-b-id';

-- If a rejected request exists, delete it manually
DELETE FROM follows
WHERE follower_id = 'user-a-id'
  AND following_id = 'user-b-id'
  AND status = 'rejected';
```

### Issue: "Cannot create duplicate" error

**Cause**: A pending or accepted request still exists

**Solution**:
- Check the current status: `SELECT status FROM follows WHERE follower_id = 'user-a-id' AND following_id = 'user-b-id'`
- If `status='pending'`: The previous request is still pending (not yet accepted or rejected)
- If `status='accepted'`: Users are already connected - unfollow first to send a new request

## Monitoring & Logs

When a follow request is rejected, you'll see these logs:

```
[FOLLOWERS API] Rejecting (deleting) follow request: <uuid>
[FOLLOWERS API] Successfully deleted follow request: {
  followId: '<uuid>',
  follower: '<follower-uuid>',
  deletedCount: 1
}
```

When a new request is sent after rejection, you'll see:

```
[FOLLOW API] Existing follow: not found
[FOLLOW API] Target profile visibility: { isPrivate: true, visibility: 'private' }
[FOLLOW API] Inserting follow: {
  follower_id: '<uuid>',
  following_id: '<uuid>',
  status: 'pending',
  message: 'Optional message'
}
[FOLLOW API] Follow created successfully
```

## Summary

The follow request rejection system is designed to be **clean and forgiving**:

1. **Rejection = Complete Deletion** (not status change)
2. **Re-requesting is always allowed** (no restrictions)
3. **Each request is independent** (no history tracking)
4. **Simple and transparent** (easy to understand and debug)

This design prioritizes **user flexibility** and **system simplicity** over permanent relationship tracking.

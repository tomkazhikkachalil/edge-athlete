# Fix Likes and Comments Count - Step-by-Step Guide

## The Problem
The likes and comments counts shown in the UI don't match the actual number of likes/comments in the database.

## Root Causes
1. The `likes_count` and `comments_count` columns may not exist in the database
2. Existing posts have NULL or incorrect counts
3. Database triggers may not be set up to auto-update counts
4. Posts created before the triggers were installed have inaccurate counts

## The Fix (Follow These Steps)

### Step 1: Apply Database Schema Fix

**Go to:** Supabase Dashboard → SQL Editor

**Run this script:** Copy and paste the entire content of `fix-post-counts.sql`

This will:
- ✅ Add `likes_count` and `comments_count` columns if missing
- ✅ Recalculate all existing counts from actual data
- ✅ Create/update trigger functions
- ✅ Install triggers to auto-update counts
- ✅ Verify everything is working

**Expected Output:**
- Step 4 should show all ✓ marks (counts match)
- Step 7 should show 2 triggers installed

### Step 2: Verify the Fix

**Option A: Use the Debug API**

Visit in your browser (while logged in):
```
https://your-app.com/api/debug/counts
```

This will show you:
- Stored counts vs actual counts
- Which posts have mismatches (if any)
- Summary of total mismatches

**Option B: Manual Database Check**

Run in Supabase SQL Editor:
```sql
SELECT
  p.id,
  LEFT(p.caption, 40) as caption,
  p.likes_count,
  (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as actual_likes,
  p.comments_count,
  (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as actual_comments
FROM posts p
ORDER BY p.created_at DESC
LIMIT 10;
```

The `likes_count` should match `actual_likes`, and `comments_count` should match `actual_comments`.

### Step 3: Test in Your App

1. **Refresh your app** (hard refresh: Ctrl+Shift+R or Cmd+Shift+R)
2. **Like a post** - count should increase by 1
3. **Unlike the same post** - count should decrease by 1
4. **Add a comment** - count should increase by 1
5. **Delete the comment** - count should decrease by 1
6. **Refresh the page** - counts should persist correctly

## What Changed in the Code

### 1. API: Post Creation (`/src/app/api/posts/route.ts`)
**Before:**
```typescript
const postData = {
  profile_id: userId,
  caption: caption,
  // ... other fields
};
```

**After:**
```typescript
const postData = {
  profile_id: userId,
  caption: caption,
  likes_count: 0,        // ← Explicitly initialize
  comments_count: 0,     // ← Explicitly initialize
  // ... other fields
};
```

### 2. API: Post Fetching (`/src/app/api/posts/route.ts`)
**Before:**
```typescript
likes_count: post.likes_count || 0,
comments_count: post.comments_count || 0,
```

**After:**
```typescript
likes_count: post.likes_count ?? 0,    // ← Use ?? instead of ||
comments_count: post.comments_count ?? 0,
```

**Why?** The `??` operator only treats `null` and `undefined` as falsy, not `0`. This prevents `0` from being converted to `0` unnecessarily.

## How Counts Work Now

### Database Triggers (Automatic Updates)

**When a like is added:**
```sql
INSERT INTO post_likes (post_id, profile_id) VALUES (...);
-- Trigger automatically runs:
UPDATE posts SET likes_count = likes_count + 1 WHERE id = ...;
```

**When a like is removed:**
```sql
DELETE FROM post_likes WHERE post_id = ... AND profile_id = ...;
-- Trigger automatically runs:
UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = ...;
```

**When a comment is added:**
```sql
INSERT INTO post_comments (post_id, profile_id, content) VALUES (...);
-- Trigger automatically runs:
UPDATE posts SET comments_count = comments_count + 1 WHERE id = ...;
```

**When a comment is deleted:**
```sql
DELETE FROM post_comments WHERE id = ...;
-- Trigger automatically runs:
UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = ...;
```

### UI Flow

1. **Initial Load:**
   - API fetches posts with `likes_count` and `comments_count` from database
   - UI displays these counts

2. **User Likes:**
   - UI updates optimistically (instant feedback)
   - API adds like to `post_likes` table
   - Trigger updates `posts.likes_count`
   - API returns updated count from database
   - UI syncs with actual database value

3. **User Comments:**
   - Comment is added to database
   - Trigger updates `posts.comments_count`
   - UI updates count through callback chain
   - All components stay in sync

## Troubleshooting

### Problem: Counts still don't match after running the fix

**Solution:** The database columns might not have been created. Run this to check:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'posts'
AND column_name IN ('likes_count', 'comments_count');
```

If no results, the columns don't exist. Re-run Step 1 of `fix-post-counts.sql`.

### Problem: Counts are always 0

**Solution:** The triggers might not be installed. Check with:
```sql
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_name IN ('update_likes_count', 'update_comments_count');
```

If no results, the triggers don't exist. Re-run Step 6 of `fix-post-counts.sql`.

### Problem: New likes/comments don't update the count

**Solution:** The triggers are not firing. Check if they're enabled:
```sql
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname IN ('update_likes_count', 'update_comments_count');
```

`tgenabled` should be 'O' (enabled). If not, enable them:
```sql
ALTER TABLE post_likes ENABLE TRIGGER update_likes_count;
ALTER TABLE post_comments ENABLE TRIGGER update_comments_count;
```

### Problem: Counts increase but don't decrease

**Solution:** The trigger might not be handling DELETE events. Re-run the trigger creation from `fix-post-counts.sql`.

## Testing Checklist

- [ ] Database columns exist (likes_count, comments_count)
- [ ] Database triggers exist (update_likes_count, update_comments_count)
- [ ] All existing posts have correct counts
- [ ] Liking a post increases count by 1
- [ ] Unliking a post decreases count by 1
- [ ] Adding a comment increases count by 1
- [ ] Deleting a comment decreases count by 1
- [ ] Counts persist after page refresh
- [ ] Counts are accurate on both Feed and Athlete pages
- [ ] Debug API shows no mismatches

## Summary

After following these steps:
1. ✅ Database has count columns with triggers
2. ✅ All existing posts have accurate counts
3. ✅ New likes/comments automatically update counts
4. ✅ UI displays accurate counts from database
5. ✅ Counts persist and sync across all pages

**The counts should now be 100% accurate!**

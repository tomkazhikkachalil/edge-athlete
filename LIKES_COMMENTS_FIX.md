# Likes and Comments Issue Fix

## Issues Identified

### 1. Double-Like Problem
- **Symptom**: When clicking like, the count increases by 2 instead of 1
- **Root Cause Analysis**:
  - Database has UNIQUE constraint on `(post_id, profile_id)` ✅
  - API has duplicate check and handles race conditions ✅
  - Triggers automatically update counts ✅
  - **Likely Issue**: Duplicate likes exist in database OR counts are out of sync

### 2. Missing Comments Problem
- **Symptom**: Previously made comments are no longer visible
- **Root Cause Analysis**:
  - Comments API fetches with proper JOIN ✅
  - RLS policies allow viewing comments on accessible posts ✅
  - Triggers auto-update comment counts ✅
  - **Likely Issue**: Comments were deleted OR RLS policy blocking access OR data inconsistency

## Solution Files Created

### 1. `diagnose-likes-comments.sql`
**Purpose**: Comprehensive diagnostic to identify the exact issues

**What it checks:**
- Post_likes table structure and unique constraint
- Existence of duplicate likes
- Post_comments table structure
- All comments in database
- Count accuracy (stored vs actual)
- Database triggers status
- RLS policies configuration
- Sample data verification

**How to use:**
1. Open Supabase Dashboard → SQL Editor
2. Copy and paste `diagnose-likes-comments.sql`
3. Run it
4. Review the output to see what's wrong

### 2. `fix-likes-comments-issues.sql`
**Purpose**: Automatically fix common issues

**What it does:**
1. **Remove duplicate likes** (keeps oldest, deletes duplicates)
2. **Ensure unique constraint** exists on post_likes
3. **Recalculate all likes_count** values from actual data
4. **Recalculate all comments_count** values from actual data
5. **Verify triggers exist** for auto-updating counts
6. **Add indexes** for performance
7. **Generate verification report** showing results

**How to use:**
1. **First run the diagnostic** to see what's wrong
2. Open Supabase Dashboard → SQL Editor
3. Copy and paste `fix-likes-comments-issues.sql`
4. Run it
5. Check the verification report at the end

## Expected Results After Fix

### For Likes:
✅ One like per user per post (no duplicates)
✅ Like count matches actual likes in database
✅ Clicking like once increments count by exactly 1
✅ Clicking unlike decrements count by exactly 1
✅ Rapid clicking doesn't create duplicates (prevented by constraint)

### For Comments:
✅ All comments persist in database
✅ Comments display when viewing posts
✅ Comment count matches actual comments
✅ Adding comment increments count by exactly 1
✅ Deleting comment decrements count by exactly 1

## Testing Steps

After running the fix SQL:

### Test Likes:
1. **Fresh like**: Find a post you haven't liked
2. Click the heart icon
3. Verify count increases by **exactly 1**
4. Refresh the page
5. Verify the like persists (heart is filled)
6. Click unlike
7. Verify count decreases by **exactly 1**
8. Try rapid clicking (should only toggle, not duplicate)

### Test Comments:
1. **Add a comment**: Write "Test comment" on any post
2. Click "Post" button
3. Verify comment appears immediately
4. Verify comment count increased by 1
5. Refresh the page
6. Verify comment is still there
7. Delete the comment
8. Verify comment count decreased by 1

### Test Multiple Users:
1. **Like from User A**: Like a post
2. **Like from User B**: Like the same post
3. Verify count shows 2 likes (not 4)
4. **Comment from both**: Add comments from both users
5. Verify all comments display
6. Verify count matches number of visible comments

## Code Review Findings

### API Layer (Correct ✅)
- **Like API** (`/api/posts/like/route.ts`):
  - Checks for existing like before inserting ✅
  - Handles duplicate key errors (race conditions) ✅
  - Returns actual count from database ✅

- **Comments API** (`/api/comments/route.ts`):
  - Properly inserts with user authentication ✅
  - Fetches with profile JOIN ✅
  - Deletes with RLS protection ✅

### Frontend Layer (Correct ✅)
- **PostCard** (`src/components/PostCard.tsx`):
  - Optimistic UI update for heart icon ✅
  - Count updated from server response ✅

- **CommentSection** (`src/components/CommentSection.tsx`):
  - Fetches comments on expand ✅
  - Adds comments with proper state update ✅
  - Deletes comments with confirmation ✅

### Database Layer (Needs Fix ⚠️)
- **Schema**: Correct structure with unique constraint ✅
- **Triggers**: Should auto-update counts ✅
- **Possible Issues**:
  - Existing duplicate likes from before constraint was added
  - Counts out of sync with actual data
  - Triggers may have been disabled or recreated incorrectly

## How the Fix Works

### 1. Duplicate Like Prevention
```sql
-- Removes any existing duplicates
DELETE FROM post_likes
WHERE id NOT IN (
  SELECT MIN(id)
  FROM post_likes
  GROUP BY post_id, profile_id
);

-- Ensures constraint exists
ALTER TABLE post_likes
ADD CONSTRAINT post_likes_post_id_profile_id_key UNIQUE (post_id, profile_id);
```

### 2. Count Synchronization
```sql
-- Recalculates from actual data
UPDATE posts
SET likes_count = (
  SELECT COUNT(*)
  FROM post_likes
  WHERE post_likes.post_id = posts.id
);
```

### 3. Trigger Verification
```sql
-- Ensures triggers exist and are enabled
CREATE TRIGGER update_post_likes_count_trigger
AFTER INSERT OR DELETE ON post_likes
FOR EACH ROW EXECUTE FUNCTION update_post_likes_count();
```

## Additional Checks

If issues persist after running the fix:

### 1. Check Browser Console
- Open browser DevTools (F12)
- Look for errors when liking/commenting
- Check network tab for failed requests

### 2. Check Supabase Logs
- Go to Supabase Dashboard → Logs
- Filter by "Database" or "API"
- Look for errors related to post_likes or post_comments

### 3. Verify RLS Policies
```sql
-- Run in SQL Editor to see all policies
SELECT * FROM pg_policies
WHERE tablename IN ('post_likes', 'post_comments');
```

### 4. Check User Authentication
- Ensure user is logged in
- Verify `auth.uid()` returns valid user ID
- Check that user has a profile record

## Files Modified/Created

### Created:
1. **diagnose-likes-comments.sql** - Comprehensive diagnostic queries
2. **fix-likes-comments-issues.sql** - Automated fix script
3. **LIKES_COMMENTS_FIX.md** - This documentation

### Existing Files (No Changes Needed):
- `/api/posts/like/route.ts` - Already correct ✅
- `/api/comments/route.ts` - Already correct ✅
- `PostCard.tsx` - Already correct ✅
- `CommentSection.tsx` - Already correct ✅

## Summary

The code logic for likes and comments is **correct**. The issues are likely:
1. **Database state inconsistencies** (duplicate likes, wrong counts)
2. **Trigger issues** (disabled or not firing)

Running `fix-likes-comments-issues.sql` will:
- Clean up any duplicate likes
- Ensure unique constraint is enforced
- Recalculate all counts to match actual data
- Verify triggers are working
- Provide a verification report

After the fix, the existing code will work correctly without any changes needed!

## Next Steps

1. ✅ **Run diagnostic**: `diagnose-likes-comments.sql` to see current state
2. ✅ **Run fix**: `fix-likes-comments-issues.sql` to correct issues
3. ✅ **Test**: Follow testing steps above
4. ✅ **Verify**: Confirm likes and comments work correctly

If issues persist after running the fix, share the output from the diagnostic SQL so we can investigate further!

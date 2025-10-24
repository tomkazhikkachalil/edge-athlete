# Data Persistence Fix Guide

## Problem

Comments and likes are not persisting across sessions - they disappear after cache clears or page refreshes.

---

## Root Cause Analysis

After investigating, here are the potential causes:

### 1. **Most Likely: Data Never Saved**
- API routes are correct ✅
- Database tables exist ✅
- **BUT**: RLS policies might be blocking inserts
- Or: No data was ever actually inserted successfully

### 2. **Possible: Data Being Deleted**
- Foreign key CASCADE deletes (expected behavior)
- User/post deletion triggers cascading deletes

### 3. **Less Likely: Frontend Not Saving**
- API calls failing silently
- No error handling showing failures

---

## Solution Steps

### Step 1: Run Diagnostic Script

Run this in **Supabase SQL Editor** to see what's happening:

```bash
File: diagnose-persistence-issue.sql
```

This will show you:
- ✅ How many comments/likes currently exist
- ✅ When they were created (oldest/newest)
- ✅ RLS policies that might be blocking
- ✅ Recent activity in the last 7 days
- ✅ Foreign key cascade rules

**What to look for:**
- If `total_rows = 0` → No data ever saved OR data was deleted
- If `oldest` timestamp shows old data → Data IS persisting
- If no recent activity → No data added recently

---

### Step 2: Fix RLS Policies

Run this in **Supabase SQL Editor**:

```bash
File: fix-data-persistence.sql
```

This will:
- ✅ Recreate all RLS policies correctly
- ✅ Ensure tables are permanent (not temporary)
- ✅ Verify foreign key constraints
- ✅ Check triggers are active
- ✅ Show current data counts

---

### Step 3: Test Data Insertion

After running the fix, test manually:

#### A. Test via SQL (Direct Database)

Run this in Supabase SQL Editor:

```sql
-- Get a test post ID
SELECT id FROM posts LIMIT 1;

-- Get your user ID
SELECT id FROM auth.users LIMIT 1;

-- Insert a test comment (replace UUIDs with real ones)
INSERT INTO post_comments (post_id, profile_id, content)
VALUES (
  'YOUR_POST_ID',
  'YOUR_USER_ID',
  'Test comment - should persist'
);

-- Verify it was inserted
SELECT * FROM post_comments
ORDER BY created_at DESC
LIMIT 1;

-- Wait 30 seconds, then check again
SELECT * FROM post_comments
ORDER BY created_at DESC
LIMIT 1;
```

**Expected result**: Same comment still exists after 30 seconds.

---

#### B. Test via App (Frontend)

1. **Start dev server**:
   ```bash
   npm run dev
   ```

2. **Add a comment**:
   - Go to any post
   - Click "View Comments"
   - Type: "Test comment - checking persistence"
   - Click "Post"
   - **Screenshot or note the comment ID**

3. **Verify in database immediately**:
   - Go to Supabase Dashboard → Table Editor
   - Open `post_comments` table
   - Look for your comment
   - **Is it there?** ✅ Yes → API works | ❌ No → API failing

4. **Test persistence**:
   - Refresh the page (F5)
   - **Is comment still visible?** ✅ Yes → Frontend works
   - Clear browser cache (Ctrl+Shift+Delete)
   - Refresh again
   - **Is comment still visible?** ✅ Yes → Persistence works

5. **Test overnight**:
   - Close browser completely
   - Come back tomorrow
   - Go to same post
   - **Is comment still there?** ✅ Yes → Database persistence confirmed

---

### Step 4: Check API Responses

If comments disappear, check the browser console:

1. **Open DevTools**: F12 or Ctrl+Shift+I
2. **Go to Console tab**
3. **Try adding a comment**
4. **Look for errors**:

```javascript
// Good response (success)
{
  "comment": {
    "id": "uuid-here",
    "content": "Test comment",
    "created_at": "2025-10-07T..."
  }
}

// Bad response (failure)
{
  "error": "Failed to create comment"
}
```

5. **Check Network tab**:
   - Look for POST `/api/comments`
   - Status should be `201 Created`
   - If `401 Unauthorized` → Authentication issue
   - If `500 Server Error` → Database/RLS issue
   - If `400 Bad Request` → Invalid data

---

## Common Issues & Fixes

### Issue 1: "No data in database after inserting"

**Cause**: RLS policies blocking INSERT

**Fix**: Run `fix-data-persistence.sql` to recreate policies

**Verify**:
```sql
-- Check if policy allows your user to insert
SELECT * FROM pg_policies
WHERE tablename = 'post_comments'
  AND cmd = 'INSERT';
```

---

### Issue 2: "Data exists but not showing in UI"

**Cause**: RLS policies blocking SELECT

**Fix**: Run `fix-data-persistence.sql` to fix SELECT policies

**Verify**:
```sql
-- Try selecting as your user (via app)
-- vs. selecting as service role (bypasses RLS)

-- Via app (respects RLS):
SELECT * FROM post_comments WHERE post_id = 'your-post-id';

-- Expected: Should return comments
-- If empty: RLS is blocking
```

---

### Issue 3: "Data disappears after user logs out/in"

**Cause**: Local state issue, not database issue

**Fix**: Check that API calls use correct user ID

**Verify**:
```javascript
// In browser console
console.log(user.id); // Should be consistent across sessions
```

---

### Issue 4: "Old comments missing, new comments work"

**Cause**: Data was deleted (cascade or manual)

**Check database logs**:
```sql
-- Check when data was created
SELECT
  DATE(created_at) as date,
  COUNT(*) as count
FROM post_comments
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- If no data from previous days: it was deleted
```

**Possible reasons**:
1. User account was deleted (CASCADE delete)
2. Post was deleted (CASCADE delete)
3. Manual deletion by user
4. Database reset/migration

---

## How Data Persistence Works

### Normal Flow (Working Correctly):

```
1. User clicks "Post Comment"
   ↓
2. Frontend sends POST /api/comments
   ↓
3. API validates user (auth.uid())
   ↓
4. API calls supabase.from('post_comments').insert()
   ↓
5. RLS checks WITH CHECK policy
   ↓
6. If passes: INSERT to database (PERMANENT)
   ↓
7. Data stays in database forever
   ↓
8. On page load: SELECT query fetches data
   ↓
9. User sees comment (even days later)
```

### What Should NOT Happen:

❌ Data stored in browser cache only
❌ Data stored in temporary table
❌ Data deleted after session ends
❌ Data deleted on cache clear

### What SHOULD Happen:

✅ Data written to PostgreSQL database
✅ Data persists across sessions
✅ Data survives cache clears
✅ Data accessible from any device
✅ Data only deleted when explicitly requested

---

## Foreign Key CASCADE Behavior (Expected)

These are **normal** and **correct**:

### When User Deletes Account:
```sql
DELETE FROM profiles WHERE id = 'user-id';
-- Automatically deletes:
-- - All their posts (CASCADE)
-- - All their comments (CASCADE)
-- - All their likes (CASCADE)
```

### When Post is Deleted:
```sql
DELETE FROM posts WHERE id = 'post-id';
-- Automatically deletes:
-- - All comments on that post (CASCADE)
-- - All likes on that post (CASCADE)
-- - All media for that post (CASCADE)
```

### When Comment is Deleted:
```sql
DELETE FROM post_comments WHERE id = 'comment-id';
-- Automatically deletes:
-- - All likes on that comment (CASCADE)
```

**This is correct behavior** - orphaned data would be useless anyway.

---

## Verification Checklist

After running the fix, verify each:

- [ ] Run `diagnose-persistence-issue.sql` → See data counts
- [ ] Run `fix-data-persistence.sql` → Fix policies
- [ ] Add comment via app → Check database immediately
- [ ] Refresh page → Comment still visible
- [ ] Clear cache → Comment still visible
- [ ] Check tomorrow → Comment still there
- [ ] Check in database directly → Comment row exists

If ALL checks pass ✅ → Persistence is working correctly

---

## API Route Check

Your API routes look **correct**. They use proper INSERT statements:

### Comments API (`/api/comments/route.ts`):
```typescript
await supabase
  .from('post_comments')
  .insert({
    post_id: postId,
    profile_id: profile.id,
    content: content.trim()
  })
```
✅ **Correct** - Direct database INSERT

### Likes API (`/api/posts/like/route.ts`):
```typescript
await supabase
  .from('post_likes')
  .insert({
    post_id: postId,
    profile_id: profileId
  })
```
✅ **Correct** - Direct database INSERT

### Comment Likes API (`/api/comments/like/route.ts`):
```typescript
await supabase
  .from('comment_likes')
  .insert({
    comment_id: commentId,
    profile_id: user.id
  })
```
✅ **Correct** - Direct database INSERT

**All routes use service role key** (`SUPABASE_SERVICE_ROLE_KEY`), which **bypasses RLS**.

---

## Expected Behavior After Fix

### ✅ What You Should See:

1. **Add comment** → Comment appears immediately
2. **Refresh page** → Comment still there
3. **Close browser** → Comment still there when you reopen
4. **Clear all cache** → Comment still there (lives in database, not cache)
5. **Check database** → Row exists in `post_comments` table
6. **Come back tomorrow** → Comment still there
7. **Access from different device** → Comment visible

### ❌ What You Should NOT See:

1. Comment disappears after refresh
2. Comment missing after cache clear
3. Comment missing the next day
4. Empty database tables
5. "Failed to create comment" errors

---

## Testing Script

Run this complete test:

```bash
# 1. Start fresh
npm run dev

# 2. In browser:
# - Go to any post
# - Add comment: "Test 1 - checking persistence"
# - Note the timestamp

# 3. In Supabase SQL Editor:
SELECT
  id,
  content,
  created_at,
  profile_id
FROM post_comments
ORDER BY created_at DESC
LIMIT 1;

# 4. Copy the comment ID, then wait 60 seconds

# 5. Check again:
SELECT
  id,
  content,
  created_at
FROM post_comments
WHERE id = 'PASTE_COMMENT_ID_HERE';

# 6. Should return same comment
# If NULL: Data was deleted
# If returns data: Persistence works!
```

---

## Summary

**Most likely cause**: RLS policies were blocking inserts, so data never saved.

**Solution**: Run `fix-data-persistence.sql` to recreate policies correctly.

**How to verify**: Follow Step 3 testing guide above.

**Expected outcome**: Comments and likes persist permanently unless explicitly deleted.

If issues persist after running the fix, check the diagnostic output and share it - we can identify the exact problem from the diagnostic data.

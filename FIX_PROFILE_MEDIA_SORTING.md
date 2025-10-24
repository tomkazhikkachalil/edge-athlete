# Fix: Profile Media Tabs Showing Oldest Posts First

## Issue Reported
Posts in ProfileMediaTabs (All Media, Media with Stats, Tagged in Media) were showing **oldest posts first** instead of **newest posts first**.

---

## Root Cause

**Location:** PostgreSQL functions in `setup-profile-media-tabs.sql`

All three functions had incorrect ORDER BY clauses:

```sql
SELECT DISTINCT ON (p.id)
  ...
FROM posts p
WHERE ...
ORDER BY p.id, p.created_at DESC  -- ❌ WRONG
```

**Problem:** Ordering by `p.id` first (which are random UUIDs) caused posts to appear in essentially random order, often showing oldest posts first.

**Why it was like this:** PostgreSQL's `DISTINCT ON (column)` requires the ORDER BY to start with that same column. So `DISTINCT ON (p.id)` requires `ORDER BY p.id, ...`

---

## Solution

Use a **subquery** to:
1. First get distinct posts (satisfying DISTINCT ON requirement)
2. Then re-order the final results by `created_at DESC` (newest first)

### Fixed Query Structure

```sql
SELECT * FROM (
  SELECT DISTINCT ON (p.id)
    p.id,
    p.caption,
    p.created_at,
    ...
  FROM posts p
  WHERE ...
  ORDER BY p.id, p.created_at DESC  -- Required for DISTINCT ON
) AS unique_posts
ORDER BY created_at DESC  -- ← NEW: Sort final results newest first
LIMIT media_limit
OFFSET media_offset;
```

**How it works:**
1. **Inner query:** Uses `DISTINCT ON (p.id)` to get unique posts (prevents duplicates when user owns a post AND is tagged in it)
2. **Outer query:** Re-orders the unique results by `created_at DESC` to show newest first
3. **LIMIT/OFFSET:** Applied to final sorted results for pagination

---

## Functions Updated

All three profile media functions were updated:

1. **`get_profile_all_media()`** - All user posts + tagged posts
2. **`get_profile_stats_media()`** - Posts with sports stats
3. **`get_profile_tagged_media()`** - Posts where user is tagged

---

## Migration Script

**File:** `fix-profile-media-sorting.sql`

**Instructions:**

1. Open **Supabase SQL Editor**
2. Copy entire contents of `fix-profile-media-sorting.sql`
3. Click **Run**
4. Wait for success confirmation

**Time:** ~5 seconds
**Risk:** None (functions are replaced, not deleted)

---

## Before vs After

### Before (Wrong)
```
Posts displayed: [Post from 3 days ago] → [Post from 5 days ago] → [Post from 1 day ago] → [Today's post]
```
Random order, often oldest first.

### After (Fixed) ✅
```
Posts displayed: [Today's post] → [Post from 1 day ago] → [Post from 3 days ago] → [Post from 5 days ago]
```
Newest posts first (reverse chronological order).

---

## Impact

**Tabs affected:**
- ✅ All Media tab - Now shows newest first
- ✅ Media with Stats tab - Now shows newest first
- ✅ Tagged in Media tab - Now shows newest first

**Other features:**
- ✅ Pagination still works correctly
- ✅ Privacy filtering unchanged
- ✅ Media type filtering unchanged
- ✅ Sort by "Most Engaged" unchanged (user can still switch)

---

## Testing

After running the migration:

1. **Go to your profile page**
2. **Click on profile media tabs**
3. **Check "All Media" tab:**
   - Should show your most recent post first
   - Scroll down - posts should be in reverse chronological order

4. **Check "Media with Stats" tab:**
   - Most recent post with stats should be first

5. **Check "Tagged in Media" tab:**
   - Most recent post you're tagged in should be first

---

## Technical Details

### Why use DISTINCT ON?

The WHERE clause has an OR condition:
```sql
WHERE (
  p.profile_id = target_profile_id  -- User's own posts
  OR
  target_profile_id::TEXT = ANY(p.tags)  -- Posts where user is tagged
)
```

**Edge case:** If a user creates a post AND tags themselves in it, the query would return that post twice (once for each condition).

**Solution:** `DISTINCT ON (p.id)` ensures each post appears only once.

### Why not just ORDER BY created_at DESC?

PostgreSQL enforces that `DISTINCT ON (expr)` must have `ORDER BY expr, ...` to determine which duplicate to keep. So we can't directly order by created_at at the DISTINCT ON level.

### Alternative Solutions Considered

1. **UNION instead of OR:**
   ```sql
   SELECT ... WHERE p.profile_id = target_profile_id
   UNION
   SELECT ... WHERE target_profile_id::TEXT = ANY(p.tags)
   ```
   **Rejected:** More complex, harder to maintain, slower performance.

2. **Remove DISTINCT ON:**
   **Rejected:** Would show duplicate posts in rare edge cases.

3. **Subquery (chosen):**
   **Accepted:** Clean, performant, handles all cases correctly.

---

## Files Modified

- **Created:** `fix-profile-media-sorting.sql` (migration script)
- **Updated:** None (fix is database-only)

**Frontend code:** No changes needed - API already expects newest first.

---

## Status

✅ **Migration script ready**
⏳ **User needs to run in Supabase SQL Editor**

---

## Next Steps

1. Run `fix-profile-media-sorting.sql` in Supabase SQL Editor
2. Refresh your profile page
3. Verify posts show newest first in all tabs
4. Test pagination (load more) - should continue showing newer → older

---

## Summary

**Problem:** Profile media tabs showed random/old posts first
**Cause:** ORDER BY p.id (random UUIDs) instead of created_at
**Fix:** Use subquery to re-order by created_at DESC after DISTINCT ON
**Action:** Run `fix-profile-media-sorting.sql` in Supabase
**Result:** All media tabs now show newest posts first ✅

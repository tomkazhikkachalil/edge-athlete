# Required SQL Migrations - Run These in Supabase

## Issue: Posts Not Showing on User Profiles

**Problem:** SQL functions for profile media tabs are not deployed to database
**Solution:** Run these SQL scripts in Supabase SQL Editor in this exact order

---

## Migration Order (CRITICAL)

### Step 1: Add Future Sport Columns
**File:** `add-future-sport-columns.sql`
**Purpose:** Adds game_id, match_id, race_id columns to posts table

```bash
# Run this in Supabase SQL Editor
# Copy entire contents of add-future-sport-columns.sql
# Execute
```

**What it does:**
- Adds `game_id`, `match_id`, `race_id` columns to posts
- Creates indexes for performance
- Prepares database for multi-sport support

---

### Step 2: Setup Profile Media Tabs
**File:** `setup-profile-media-tabs.sql`
**Purpose:** Creates 3 SQL functions for profile media tabs

```bash
# Run this in Supabase SQL Editor
# Copy entire contents of setup-profile-media-tabs.sql
# Execute
```

**Creates these functions:**
1. `get_profile_all_media()` - All user posts + tagged posts
2. `get_profile_stats_media()` - Posts with stats/sports data
3. `get_profile_tagged_media()` - Posts where user is tagged
4. `get_profile_media_counts()` - Count badges for tabs

**Why posts aren't showing:**
- These functions MUST exist in database
- API calls these functions: `/api/profile/[profileId]/media`
- Without these, API returns empty results

---

### Step 3: Update for Sport-Specific Data
**File:** `update-stats-media-for-sports.sql`
**Purpose:** Updates functions to include sport-specific posts

```bash
# Run this in Supabase SQL Editor
# Copy entire contents of update-stats-media-for-sports.sql
# Execute
```

**Updates:**
- Includes posts with `round_id` (golf)
- Includes posts with `game_id` (basketball, hockey, etc.)
- Includes posts with `match_id` (soccer, tennis, etc.)
- Includes posts with `race_id` (track, swimming, etc.)

---

### Step 4: (Optional) Clean Up Old Tags
**File:** `cleanup-old-category-tags.sql`
**Purpose:** Remove old category tags from posts.tags column

```bash
# Optional but recommended
# Run this in Supabase SQL Editor
# Copy entire contents of cleanup-old-category-tags.sql
# Execute
```

**What it does:**
- Removes old category tags ('casual', 'lifestyle', etc.)
- Keeps only user UUID tags
- Creates backup table first
- Shows verification report

---

## Verification Steps

### After Running Migrations

1. **Check functions exist:**
   ```sql
   SELECT routine_name
   FROM information_schema.routines
   WHERE routine_schema = 'public'
   AND routine_name LIKE 'get_profile%';
   ```

   **Expected output:**
   ```
   get_profile_all_media
   get_profile_stats_media
   get_profile_tagged_media
   get_profile_media_counts
   ```

2. **Test a function:**
   ```sql
   SELECT * FROM get_profile_all_media(
     'your-user-uuid-here'::uuid,
     'your-user-uuid-here'::uuid,
     10,
     0
   );
   ```

   **Should return:** Your posts

3. **Check columns exist:**
   ```sql
   SELECT column_name
   FROM information_schema.columns
   WHERE table_name = 'posts'
   AND column_name IN ('game_id', 'match_id', 'race_id');
   ```

   **Expected:** 3 rows (game_id, match_id, race_id)

---

## What Each Function Does

### `get_profile_all_media()`
**Returns:** All posts for a profile
- User's own posts
- Posts where user is tagged
- Respects privacy settings

**Used by:** "All Media" tab

### `get_profile_stats_media()`
**Returns:** Posts with stats/sports data
- Posts with stats_data
- Posts with round_id (golf)
- Posts with game_id/match_id/race_id (other sports)

**Used by:** "Media with Stats" tab

### `get_profile_tagged_media()`
**Returns:** Posts where user is tagged
- Only posts with user's UUID in tags array
- Excludes user's own posts
- Respects privacy settings

**Used by:** "Tagged in Media" tab

### `get_profile_media_counts()`
**Returns:** Count badges for tabs
```json
{
  "all_media_count": 15,
  "stats_media_count": 8,
  "tagged_media_count": 3
}
```

**Used by:** Tab badges (All Media (15), etc.)

---

## Current Issue Diagnosis

### Why Posts Don't Show on Profile

**Symptom:** Posts show in feed but not on user profile

**Root Cause:** SQL functions not deployed

**How API works:**
```typescript
// ProfileMediaTabs calls API
GET /api/profile/{profileId}/media?tab=all

// API calls Supabase function
const { data } = await supabase.rpc('get_profile_all_media', {
  target_profile_id: profileId,
  viewer_id: currentUserId,
  media_limit: 20,
  media_offset: 0
});

// If function doesn't exist → Error or empty array
// If function exists → Returns posts
```

### Why Tagged Media Doesn't Show

**Symptom:** Posts don't show in "Tagged in Media" tab

**Root Cause:** `get_profile_tagged_media()` function not in database

**The function looks for:**
```sql
WHERE target_profile_id::TEXT = ANY(p.tags)
```

This finds posts where user's UUID is in the tags array.

---

## Migration Checklist

- [ ] 1. Run `add-future-sport-columns.sql`
- [ ] 2. Run `setup-profile-media-tabs.sql`
- [ ] 3. Run `update-stats-media-for-sports.sql`
- [ ] 4. Run `cleanup-old-category-tags.sql` (optional)
- [ ] 5. Verify functions exist (SQL query above)
- [ ] 6. Test profile page - posts should appear
- [ ] 7. Test "All Media" tab - user's posts show
- [ ] 8. Test "Tagged in Media" tab - tagged posts show
- [ ] 9. Test "Media with Stats" tab - posts with stats show

---

## Quick Test

After running migrations, test with this SQL:

```sql
-- Should return your posts
SELECT id, caption, tags FROM posts WHERE profile_id = 'your-uuid';

-- Should work now
SELECT * FROM get_profile_all_media('your-uuid'::uuid, 'your-uuid'::uuid, 10, 0);

-- Should show count
SELECT * FROM get_profile_media_counts('your-uuid'::uuid, 'your-uuid'::uuid);
```

---

## Summary

**The Problem:**
- SQL functions are in files but not in database
- API tries to call functions that don't exist
- Returns empty results

**The Solution:**
1. Run SQL migrations in order
2. Functions get created in database
3. API can now call them
4. Posts appear on profiles

**Expected Result:**
- ✅ Posts show on creator's profile
- ✅ Posts show in "All Media" tab
- ✅ Posts show in "Tagged in Media" tab for tagged users
- ✅ Count badges show correct numbers

---

**Status:** ⚠️ MIGRATIONS REQUIRED
**Time to Fix:** ~5 minutes (just copy/paste SQL and run)
**Files to Run:** 3-4 SQL scripts in Supabase SQL Editor

# Action Plan: Fix Posts Not Showing on Profiles

## Current Status
✅ Posts show in main feed
✅ Tagging works (visible on posts)
❌ Posts DON'T show on user's own profile page
❌ Posts DON'T show in "Tagged in Media" tab for tagged users

## Root Cause
SQL functions exist as files in this repository but have **never been executed** in your Supabase database.

Your API calls these functions:
- `get_profile_all_media()` - For "All Media" tab
- `get_profile_stats_media()` - For "Media with Stats" tab
- `get_profile_tagged_media()` - For "Tagged in Media" tab
- `get_profile_media_counts()` - For tab count badges

**If these functions don't exist in Supabase, the API returns empty results.**

---

## Step-by-Step Fix (5 minutes)

### Step 1: Find Your User UUID

Run this in Supabase SQL Editor:

```sql
SELECT id as user_uuid, email
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;
```

**Copy your UUID** (looks like: `12345678-1234-1234-1234-123456789abc`)

---

### Step 2: Check If Functions Exist

Run this in Supabase SQL Editor:

```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name LIKE 'get_profile%'
ORDER BY routine_name;
```

**Expected output if functions exist:**
```
get_profile_all_media
get_profile_media_counts
get_profile_stats_media
get_profile_tagged_media
```

**If you get 0 rows**, functions are missing → Continue to Step 3

**If you get all 4 functions** → Skip to Step 6 (Verify)

---

### Step 3: Run SQL Migration 1 - Add Sport Columns

**File:** `add-future-sport-columns.sql`

1. Open Supabase SQL Editor
2. Copy entire contents of `add-future-sport-columns.sql`
3. Paste and click "Run"
4. Wait for success message

**What this does:** Adds game_id, match_id, race_id columns to posts table

---

### Step 4: Run SQL Migration 2 - Create Profile Functions

**File:** `setup-profile-media-tabs.sql`

1. Open Supabase SQL Editor
2. Copy entire contents of `setup-profile-media-tabs.sql`
3. Paste and click "Run"
4. Wait for success message

**What this does:** Creates the 4 SQL functions your API needs

**This is the CRITICAL step** - posts won't show until these functions exist

---

### Step 5: Run SQL Migration 3 - Update for All Sports

**File:** `update-stats-media-for-sports.sql`

1. Open Supabase SQL Editor
2. Copy entire contents of `update-stats-media-for-sports.sql`
3. Paste and click "Run"
4. Wait for success message

**What this does:** Updates functions to include all sport types (not just golf)

---

### Step 6: Verify It Works

Replace `YOUR_UUID_HERE` with your actual UUID from Step 1:

```sql
-- Should return your posts
SELECT * FROM get_profile_all_media(
  'YOUR_UUID_HERE'::uuid,
  'YOUR_UUID_HERE'::uuid,
  10,
  0
);

-- Should show counts
SELECT * FROM get_profile_media_counts(
  'YOUR_UUID_HERE'::uuid,
  'YOUR_UUID_HERE'::uuid
);
```

**If you see posts** → Success! ✅
**If empty** → Check if you have any posts: `SELECT id, caption FROM posts WHERE profile_id = 'YOUR_UUID_HERE'`

---

### Step 7 (Optional): Clean Up Old Category Tags

**File:** `cleanup-old-category-tags.sql`

Only needed if you have posts created before the tagging fix.

This removes old category tags ('lifestyle', 'casual', etc.) from the tags column.

1. Open Supabase SQL Editor
2. Copy entire contents of `cleanup-old-category-tags.sql`
3. Paste and click "Run"
4. Review the verification report

**Creates automatic backup** before making changes.

---

## Quick Diagnostic

If you want to check everything at once, use the diagnostic in `TEST_SQL_FUNCTIONS.sql`:

```sql
DO $$
DECLARE
  user_uuid TEXT := 'YOUR_UUID_HERE';  -- ← REPLACE
  post_count INT;
  function_count INT;
  column_count INT;
BEGIN
  EXECUTE format('SELECT COUNT(*) FROM posts WHERE profile_id = %L', user_uuid) INTO post_count;

  SELECT COUNT(*) INTO function_count
  FROM information_schema.routines
  WHERE routine_schema = 'public'
  AND routine_name LIKE 'get_profile%';

  SELECT COUNT(*) INTO column_count
  FROM information_schema.columns
  WHERE table_name = 'posts'
  AND column_name IN ('game_id', 'match_id', 'race_id');

  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    DIAGNOSTIC REPORT';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'User UUID: %', user_uuid;
  RAISE NOTICE 'Posts by this user: %', post_count;
  RAISE NOTICE 'Profile functions found: % (should be 4)', function_count;
  RAISE NOTICE 'Sport columns found: % (should be 3)', column_count;
  RAISE NOTICE '';

  IF function_count < 4 THEN
    RAISE NOTICE '⚠ MISSING FUNCTIONS!';
    RAISE NOTICE 'Run: setup-profile-media-tabs.sql';
  ELSE
    RAISE NOTICE '✓ All functions exist';
  END IF;

  IF column_count < 3 THEN
    RAISE NOTICE '⚠ MISSING COLUMNS!';
    RAISE NOTICE 'Run: add-future-sport-columns.sql';
  ELSE
    RAISE NOTICE '✓ All sport columns exist';
  END IF;

  IF post_count = 0 THEN
    RAISE NOTICE '⚠ No posts found for this user';
  ELSE
    RAISE NOTICE '✓ User has posts';
  END IF;

  RAISE NOTICE '';
END $$;
```

---

## Expected Results After Migrations

Once you've run the SQL migrations:

✅ Posts appear on creator's profile
✅ Posts appear in "All Media" tab
✅ Posts appear in "Tagged in Media" tab for tagged users
✅ Count badges show correct numbers (All Media (5), etc.)
✅ No console errors

---

## Files Reference

**SQL Migrations (run in order):**
1. `add-future-sport-columns.sql` - Add sport columns
2. `setup-profile-media-tabs.sql` - Create functions ⭐ CRITICAL
3. `update-stats-media-for-sports.sql` - Update for all sports
4. `cleanup-old-category-tags.sql` - Clean old data (optional)

**Testing:**
- `TEST_SQL_FUNCTIONS.sql` - Find UUID and test functions
- `REQUIRED_SQL_MIGRATIONS.md` - Detailed documentation

**Status Reports:**
- `TAGGING_FINAL_STATUS.md` - Tagging fixes summary
- `FIX_CATEGORY_TAGS_CONFLICT.md` - Category tags issue explanation

---

## Troubleshooting

**Posts still don't show after migrations:**
1. Verify functions exist (Step 2)
2. Check you have posts: `SELECT COUNT(*) FROM posts WHERE profile_id = 'your-uuid'`
3. Try clearing browser cache
4. Check browser console for errors

**Functions already exist but posts don't show:**
1. Run the verify query (Step 6)
2. Check post visibility: `SELECT id, visibility FROM posts WHERE profile_id = 'your-uuid'`
3. Verify you're logged in as the correct user

**Getting SQL errors:**
- Make sure you replaced `YOUR_UUID_HERE` with actual UUID
- UUID format: `12345678-1234-1234-1234-123456789abc` (with dashes, lowercase)
- Don't include quotes around the UUID when copying it

---

## Need Help?

If issues persist after running all migrations:

1. Run the diagnostic script (above) and share the output
2. Run: `SELECT id, caption, profile_id FROM posts LIMIT 5;` and share results
3. Check browser console for JavaScript errors
4. Verify Supabase connection is working

---

**Time to Complete:** ~5 minutes
**Difficulty:** Copy/paste SQL scripts
**Risk:** Low (scripts create backups automatically)

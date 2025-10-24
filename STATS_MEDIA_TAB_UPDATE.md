# Stats Media Tab Update - Golf Posts Integration

## Overview

Updated the "Media with Stats" tab on profile pages to include posts with golf rounds (and future sport-specific data), not just posts with generic `stats_data`.

## Problem

**Before:** The "Media with Stats" tab only showed posts where `stats_data IS NOT NULL`, missing all posts with golf rounds attached via `round_id`.

**After:** The tab now shows posts with:
- Generic stats (`stats_data` field)
- Golf rounds (`round_id` field)
- Future: Basketball/hockey games (`game_id`)
- Future: Soccer matches (`match_id`)

## Solution

### Updated Database Functions

**File:** `update-stats-media-for-sports.sql`

Two functions were updated:

#### 1. `get_profile_stats_media()`

**Old Logic:**
```sql
WHERE p.stats_data IS NOT NULL
  AND p.stats_data != '{}'::jsonb
```

**New Logic:**
```sql
WHERE (
  -- Generic stats_data
  (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
  OR
  -- Golf rounds
  p.round_id IS NOT NULL
  -- Future: Add other sports here
  -- OR p.game_id IS NOT NULL
  -- OR p.match_id IS NOT NULL
)
```

#### 2. `get_profile_media_counts()`

Updated the `stats_media_count` calculation to use the same logic, ensuring the tab badge count includes golf posts.

#### 3. Performance Index

Updated the index for faster stats queries:

```sql
CREATE INDEX idx_posts_stats_media
ON posts(profile_id, created_at DESC)
WHERE (stats_data IS NOT NULL AND stats_data != '{}'::jsonb)
   OR round_id IS NOT NULL;
```

## Installation

### Step 1: Run SQL Update

1. Open Supabase Dashboard
2. Navigate to SQL Editor
3. Copy contents of `update-stats-media-for-sports.sql`
4. Click "Run"

**Expected Output:**
```
════════════════════════════════════════════════
    STATS MEDIA FUNCTIONS UPDATED
════════════════════════════════════════════════

Updated functions:
  ✓ get_profile_stats_media() - now includes round_id
  ✓ get_profile_media_counts() - stats count includes round_id

What this means:
  • Posts with golf rounds now appear in "Media with Stats"
  • Stats tab count now includes golf posts
  • Ready for future sports (game_id, match_id)
```

### Step 2: Verify in UI

1. Navigate to a profile with golf posts: `/athlete` or `/athlete/[id]`
2. Click on "Media with Stats" tab
3. Verify golf posts appear
4. Check tab badge count includes golf posts

## Testing

### Manual Test

```sql
-- Test the updated function
SELECT * FROM get_profile_media_counts(
  'your-profile-uuid'::UUID,
  'your-profile-uuid'::UUID
);

-- Expected output:
-- all_media_count: X (all posts)
-- stats_media_count: Y (posts with stats_data OR round_id)
-- tagged_media_count: Z (tagged posts)
```

### UI Test

**Test Profile with Golf Rounds:**

1. **Create Test Post:**
   - Go to create post
   - Attach golf round (use GolfScorecardForm)
   - Add media
   - Post

2. **Verify in Tabs:**
   - Navigate to profile
   - Check "All Media" - should show post ✅
   - Check "Media with Stats" - should show post ✅
   - Check tab counts are correct ✅

3. **Verify Modal:**
   - Click on post thumbnail
   - Modal opens ✅
   - Golf scorecard visible ✅
   - Can expand scorecard ✅

## Architecture

### Posts Table Structure

```sql
posts
├── id (UUID)
├── profile_id (UUID)
├── sport_key (TEXT)
├── stats_data (JSONB) ← generic stats
├── round_id (UUID) ← golf rounds
├── game_id (UUID) ← basketball/hockey (future)
├── match_id (UUID) ← soccer (future)
├── visibility (TEXT)
└── ...
```

### Data Flow

```
User creates post with golf round
           ↓
Post has round_id set
           ↓
get_profile_stats_media() checks:
  - stats_data IS NOT NULL?
  - round_id IS NOT NULL? ← NEW
           ↓
Post appears in "Media with Stats" tab
```

### Tab Logic

**All Media:**
- User's own posts + tagged posts
- No filtering by stats

**Media with Stats:**
- User's own posts + tagged posts
- WHERE stats_data OR round_id OR game_id OR match_id
- **Now includes golf posts**

**Tagged in Media:**
- Only posts by others where user is tagged
- No own posts

## Future Sports

When adding new sports with detailed stats:

### Step 1: Add Foreign Key to Posts

```sql
-- Example for basketball
ALTER TABLE posts ADD COLUMN game_id UUID
  REFERENCES basketball_games(id) ON DELETE SET NULL;

CREATE INDEX idx_posts_game_id ON posts(game_id);
```

### Step 2: Update Stats Functions

In `update-stats-media-for-sports.sql`, uncomment the relevant line:

```sql
WHERE (
  (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
  OR p.round_id IS NOT NULL
  OR p.game_id IS NOT NULL  ← Uncomment for basketball/hockey
  -- OR p.match_id IS NOT NULL  ← Uncomment for soccer
)
```

### Step 3: Update Index

```sql
DROP INDEX idx_posts_stats_media;

CREATE INDEX idx_posts_stats_media
ON posts(profile_id, created_at DESC)
WHERE (stats_data IS NOT NULL AND stats_data != '{}'::jsonb)
   OR round_id IS NOT NULL
   OR game_id IS NOT NULL;  ← Add new sports
```

### Step 4: Rerun SQL

Run the updated `update-stats-media-for-sports.sql` in Supabase.

## Impact

### Before This Update

**Profile with 10 posts:**
- 5 posts with generic stats_data
- 5 posts with golf rounds (round_id)

**Media Tabs:**
- All Media: 10 posts ✅
- Media with Stats: 5 posts ❌ (missing golf)
- Tagged: 0 posts

### After This Update

**Same Profile:**

**Media Tabs:**
- All Media: 10 posts ✅
- Media with Stats: 10 posts ✅ (now includes golf)
- Tagged: 0 posts

## Files

### Created
- `update-stats-media-for-sports.sql` - SQL update to run in Supabase
- `STATS_MEDIA_TAB_UPDATE.md` - This documentation

### Modified (in database)
- `get_profile_stats_media()` function
- `get_profile_media_counts()` function
- `idx_posts_stats_media` index

### Related
- `setup-profile-media-tabs.sql` - Original setup (superseded)
- `add-golf-round-to-posts.sql` - Added round_id column
- `PROFILE_MEDIA_TABS_GUIDE.md` - Original feature docs
- `ADDING_SPORTS_WITH_STATS.md` - Guide for adding new sports

## Troubleshooting

### Golf posts not appearing in Stats tab

**Check 1: Verify round_id exists**
```sql
SELECT id, caption, round_id, sport_key
FROM posts
WHERE profile_id = 'your-uuid'
  AND sport_key = 'golf';
```

**Expected:** Posts should have non-null `round_id`

**Check 2: Verify function is updated**
```sql
SELECT prosrc FROM pg_proc
WHERE proname = 'get_profile_stats_media';
```

**Expected:** Function body should contain `p.round_id IS NOT NULL`

**Check 3: Test function directly**
```sql
SELECT * FROM get_profile_stats_media(
  'profile-uuid'::UUID,
  'viewer-uuid'::UUID,
  20,
  0
);
```

**Expected:** Golf posts appear in results

### Tab count incorrect

**Check counts function:**
```sql
SELECT * FROM get_profile_media_counts(
  'profile-uuid'::UUID,
  'viewer-uuid'::UUID
);
```

**Expected:** `stats_media_count` includes golf posts

### Index not working

**Rebuild index:**
```sql
DROP INDEX IF EXISTS idx_posts_stats_media;

CREATE INDEX idx_posts_stats_media
ON posts(profile_id, created_at DESC)
WHERE (stats_data IS NOT NULL AND stats_data != '{}'::jsonb)
   OR round_id IS NOT NULL;

ANALYZE posts;
```

## Performance

### Query Performance

**Before:** Index on `stats_data` only
**After:** Index on `stats_data OR round_id`

**Impact:** Minimal - index still efficient for both types of stats

### Expected Response Times

- Tab switch: <100ms
- Count query: <50ms
- Media load: <200ms (20 items)

## Version

- **Version**: 1.0.0
- **Date**: 2025-01
- **Status**: ✅ Ready to Deploy
- **Breaking Changes**: None (backward compatible)

## Related Documentation

- [Profile Media Tabs Guide](PROFILE_MEDIA_TABS_GUIDE.md)
- [Adding Sports with Stats](ADDING_SPORTS_WITH_STATS.md)
- [Expandable Stats Implementation](EXPANDABLE_STATS_IMPLEMENTATION.md)

# Fix: Ambiguous Column Error in get_profile_stats_media

## Error Description
```
column reference "stats_data" is ambiguous
function: get_profile_stats_media
```

## Root Cause
The SQL function `get_profile_stats_media` references columns without table qualification in the WHERE clause. When the function has a RETURNS TABLE that includes a column name that also appears in the query, PostgreSQL cannot determine which one you're referring to.

**Ambiguous columns:**
- `stats_data`
- `round_id`
- `game_id`
- `match_id`
- `race_id`

## Fix Applied
All column references in the WHERE clause have been qualified with the `p.` (posts table) prefix.

**Before (lines 136-151):**
```sql
WHERE (
  p.profile_id = target_profile_id
  AND (
    (stats_data IS NOT NULL AND stats_data != '{}'::jsonb)  ❌
    OR round_id IS NOT NULL  ❌
    OR game_id IS NOT NULL  ❌
    ...
  )
)
```

**After:**
```sql
WHERE (
  p.profile_id = target_profile_id
  AND (
    (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)  ✅
    OR p.round_id IS NOT NULL  ✅
    OR p.game_id IS NOT NULL  ✅
    ...
  )
)
```

## How to Apply the Fix

### Option 1: Supabase Dashboard (Recommended)
1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Open the file: `fix-profile-stats-media-ambiguous.sql`
4. Copy the entire contents
5. Paste into Supabase SQL Editor
6. Click **Run** button
7. Verify success message appears

### Option 2: Command Line (If you have psql)
```bash
# If SUPABASE_DB_URL is set in .env.local
psql $SUPABASE_DB_URL < fix-profile-stats-media-ambiguous.sql
```

## Verification
After running the migration, test the profile page:
1. Navigate to any athlete profile
2. Click on "Media with Stats" tab
3. Verify posts load without errors
4. Check browser console - should be no 500 errors

## Files Modified
- ✅ Created: `fix-profile-stats-media-ambiguous.sql`

## Impact
- **Scope:** Profile media tabs (Stats tab specifically)
- **Breaking Changes:** None
- **Performance:** No impact (same query, just properly qualified)
- **Testing:** Test all 3 tabs (All Media, Media with Stats, Tagged)

## Related Functions
This fix only affects `get_profile_stats_media`. The other two functions are already correct:
- ✅ `get_profile_all_media` - No issues
- ✅ `get_profile_tagged_media` - No issues

## Prevention
**Best Practice:** Always qualify column names with table aliases in complex queries, especially when:
- Using subqueries
- Function RETURNS TABLE includes column names that match source tables
- Multiple tables are joined

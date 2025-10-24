# RLS Fix Script Correction

## 🔴 Issue Encountered

When running `fix-remaining-rls-initplan.sql`, you received this error:
```
ERROR: 42703: column "profile_id" does not exist
```

## ✅ Root Cause

The **`athlete_clubs`** table uses `athlete_id` instead of `profile_id` to reference the user.

## 📊 Column Name Reference

| Table | User Column | Fixed In Script |
|-------|------------|----------------|
| `saved_posts` | `profile_id` | ✅ Already correct |
| `athlete_clubs` | **`athlete_id`** | ✅ **NOW FIXED** |
| `post_comments` | `profile_id` | ✅ Already correct |
| `sports` | `profile_id` | ✅ Already correct |
| `season_highlights` | `profile_id` | ✅ Already correct |
| `performances` | `profile_id` | ✅ Already correct |
| `sport_settings` | `profile_id` | ✅ Already correct |
| `connection_suggestions` | `profile_id` | ✅ Already correct |

## 🔧 What Was Changed

### **File: `fix-remaining-rls-initplan.sql`**

**Before (Line 51-56)**:
```sql
CREATE POLICY "Users can view their own club associations"
ON public.athlete_clubs
FOR SELECT
USING (profile_id = (select auth.uid()));  -- ❌ WRONG
```

**After (Line 51-56)**:
```sql
CREATE POLICY "Users can view their own club associations"
ON public.athlete_clubs
FOR SELECT
USING (athlete_id = (select auth.uid()));  -- ✅ CORRECT
```

### **File: `rollback-rls-fix.sql`**
Same correction applied for consistency.

## 🚀 Next Steps

The scripts have been **corrected and are now ready to run**!

### **Run the Fix Again**:

1. Open Supabase SQL Editor
2. Copy the **UPDATED** contents of `fix-remaining-rls-initplan.sql`
3. Paste and run
4. Should complete without errors now
5. Check `remaining_issues` count at bottom (should be 0)
6. Uncomment `COMMIT;` line and run again

## 🛡️ Diagnostic Tool Available

If you encounter ANY future column name issues, use:

**`diagnose-rls-columns.sql`** - Shows:
- Actual policy definitions
- All column names in each table
- Foreign key relationships
- Table structures

This will help identify any other column mismatches.

## ✅ Expected Result

After running the corrected script:
- ✅ All 8 tables optimized
- ✅ ~18 RLS policies fixed
- ✅ 50-100+ Performance Advisor warnings cleared
- ✅ Zero errors

---

**Status**: ✅ **CORRECTED - Ready to Run**

**Last Updated**: January 2025

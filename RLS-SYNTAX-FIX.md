# RLS Script Syntax Error Fix

## 🔴 **Error Encountered**

When running `fix-ALL-rls-policies-auto.sql`, you received:

```
ERROR: 42601: syntax error at or near "AS"
QUERY: CREATE POLICY "Users can delete their own badges"
       ON public.athlete_badges
       FOR DELETE AS PERMISSIVE TO public
       USING (((select auth.uid()) = profile_id))
```

## 🐛 **Root Cause**

PostgreSQL `CREATE POLICY` requires a **specific syntax order**:

```sql
CREATE POLICY name ON table
  AS { PERMISSIVE | RESTRICTIVE }  -- ⚠️ Must come BEFORE FOR
  FOR { ALL | SELECT | INSERT | UPDATE | DELETE }
  TO { role | PUBLIC }
  USING ( condition )
  WITH CHECK ( condition )
```

### **The Bug**

The script was generating:
```sql
CREATE POLICY ... FOR DELETE AS PERMISSIVE ...  ❌ WRONG ORDER
```

### **The Fix**

Now generates:
```sql
CREATE POLICY ... AS PERMISSIVE FOR DELETE ...  ✅ CORRECT ORDER
```

## ✅ **What Was Fixed**

**File:** `fix-ALL-rls-policies-auto.sql`

**Lines 59-76:** Reordered the policy creation logic to:
1. Create base policy statement
2. Add `AS PERMISSIVE/RESTRICTIVE` **first**
3. Add `FOR command` **second**
4. Add `TO roles` third
5. Add `USING` clause
6. Add `WITH CHECK` clause

## 🚀 **Ready to Run Again**

The script has been **corrected and is ready** for another attempt!

### **Steps:**

1. **If you haven't rolled back yet**, run:
   ```sql
   ROLLBACK;
   ```

2. **Copy the UPDATED script**:
   - File: `fix-ALL-rls-policies-auto.sql` (now corrected)

3. **Run again**:
   - Should complete without syntax errors
   - Watch for "Total policies fixed: 168" message

4. **Verify**:
   - Check `remaining_issues: 0`
   - Uncomment `COMMIT;` and run

## 🔍 **What Changed**

**Before (lines 61-66):**
```sql
create_statement := format(
  'CREATE POLICY %I ON %I.%I FOR %s',  -- ❌ FOR comes too early
  ...
);
-- Then added AS PERMISSIVE later (wrong!)
```

**After (lines 61-76):**
```sql
create_statement := format(
  'CREATE POLICY %I ON %I.%I',  -- Base statement only
  ...
);

-- Add AS first (correct!)
IF policy_record.permissive = 'PERMISSIVE' THEN
  create_statement := create_statement || ' AS PERMISSIVE';
END IF;

-- THEN add FOR (correct!)
create_statement := create_statement || ' FOR ' || policy_record.cmd;
```

## ✅ **Expected Result**

After running the corrected script:
- ✅ No syntax errors
- ✅ All 168 policies fixed
- ✅ `remaining_issues: 0`
- ✅ Ready to commit

---

**Status**: ✅ **FIXED - Ready to Run**

**Next Step**: Copy updated script and run in Supabase SQL Editor

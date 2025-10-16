# RLS Performance Optimization - Execution Guide

## Overview

This guide will help you fix **50-100+ Performance Advisor warnings** related to RLS (Row Level Security) policies calling `auth.uid()` directly instead of using `(select auth.uid())`.

**Impact**: 10-100x query performance improvement on affected tables at scale.

**Current Status**: 358 Performance Advisor warnings → Expected: ~250-300 after this fix

---

## 📋 Prerequisites

- Access to Supabase Dashboard
- SQL Editor access
- ~15 minutes of time
- Ability to test application after changes

---

## 🚀 Step-by-Step Execution

### **Step 1: Discovery** (5 minutes)

**Goal**: Understand the scope of the issue

1. Open Supabase Dashboard → SQL Editor
2. Open `find-rls-issues.sql`
3. Copy the entire contents
4. Paste into SQL Editor
5. Click "Run"

**Expected Output**:
```
total_policies_needing_fix: ~18-50
total_tables_affected: ~8-15
```

**Review**:
- Note the count of affected policies
- Check which tables are impacted
- Verify these match the warnings you're seeing

**Decision Point**:
- If count is 0: Your RLS is already optimized! ✅
- If count > 0: Proceed to Step 2

---

### **Step 2: Backup** (2 minutes) ⚠️

**IMPORTANT**: Create a manual backup before proceeding.

**Option A - Supabase Backup**:
1. Supabase Dashboard → Settings → Backups
2. Click "Create Backup"
3. Name it: `before-rls-optimization-[date]`
4. Wait for completion

**Option B - SQL Dump**:
```bash
# If you have local PostgreSQL access
pg_dump -h db.xxx.supabase.co -U postgres -d postgres --schema=public > backup-before-rls-fix.sql
```

---

### **Step 3: Apply Fix** (5 minutes)

**Goal**: Optimize all RLS policies

1. Open Supabase Dashboard → SQL Editor
2. Open `fix-remaining-rls-initplan.sql`
3. Copy the entire contents
4. Paste into SQL Editor
5. **IMPORTANT**: Review the script - it's in a transaction (BEGIN...COMMIT)
6. Click "Run"

**What Happens**:
- Script runs in a transaction (safe, reversible)
- Drops old policies
- Creates new optimized policies
- Checks for remaining issues
- Waits for your confirmation

**Expected Output at End**:
```
remaining_issues: 0
```

**Decision Point**:
- If `remaining_issues = 0`: Scroll to bottom, **uncomment the COMMIT line**, run again ✅
- If `remaining_issues > 0`: Do NOT commit yet, see Troubleshooting section below

---

### **Step 4: Verification** (3 minutes)

**Goal**: Confirm the fix worked

1. Open Supabase Dashboard → SQL Editor
2. Open `verify-rls-fix.sql`
3. Copy and paste into editor
4. Click "Run"

**Expected Output**:
```
remaining_rls_issues: 0
optimized_policies_count: 18+ (should match original count)
```

**Check Supabase Performance Advisor**:
1. Navigate to Supabase Dashboard → Advisors → Performance
2. Look for reduction in "Auth RLS Initialization Plan" warnings
3. Expected: 50-100+ fewer warnings

**✅ Success Indicators**:
- `remaining_rls_issues = 0`
- Performance Advisor shows fewer warnings
- All tables show `rls_enabled = true`

---

### **Step 5: Application Testing** (5 minutes)

**Critical**: Test that RLS still works correctly

**Test These Scenarios**:

1. **View Own Data**:
   - Log in as user
   - View your profile
   - View your posts
   - View your saved posts
   - ✅ Should work normally

2. **Privacy Enforcement**:
   - Try to view another user's private profile
   - ✅ Should be blocked (if not following)
   - Try to edit another user's data
   - ✅ Should fail

3. **Public Access**:
   - Log out
   - View public profiles
   - ✅ Should work
   - Try to access private content
   - ✅ Should be blocked

4. **Following System**:
   - Follow a private profile
   - Owner approves
   - ✅ Should now see their content

**If ANY test fails**:
→ Proceed to Step 6 (Rollback)

---

### **Step 6: Rollback** (ONLY IF NEEDED)

**Use this ONLY if**:
- Authentication is broken
- Users cannot access their own data
- Critical functionality not working

**How to Rollback**:

1. Open Supabase Dashboard → SQL Editor
2. Open `rollback-rls-fix.sql`
3. Copy and paste
4. Click "Run"
5. Verify functionality restored
6. Report the issue for investigation

**After Rollback**:
- Performance warnings will return (expected)
- Performance will be degraded (expected)
- Application should work normally

---

## 📊 Expected Results

### **Before Fix**:
- ~358 Performance Advisor warnings
- Queries slow at scale (each row re-evaluates auth)
- "Auth RLS Initialization Plan" warnings

### **After Fix**:
- ~250-300 Performance Advisor warnings (50-100+ cleared)
- 10-100x faster queries on affected tables
- No "Auth RLS Initialization Plan" warnings

---

## 🔧 Troubleshooting

### **Issue: "remaining_issues > 0" after fix**

**Possible Causes**:
1. Additional tables not covered by the fix script
2. Custom policies with complex logic
3. Recently added tables

**Solution**:
```sql
-- Run this to see what was missed:
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND qual LIKE '%auth.uid()%'
  AND qual NOT LIKE '%(select auth.uid())%';
```

Then manually fix those policies following the pattern in the fix script.

---

### **Issue: "Policy does not exist" error during fix**

**Cause**: Policy name doesn't match exactly

**Solution**:
1. Check exact policy name in discovery script output
2. Update fix script with correct name
3. Re-run

---

### **Issue: Application breaks after fix**

**Immediate Action**:
1. Run `rollback-rls-fix.sql`
2. Verify application works
3. Note which functionality broke
4. Report for investigation

**Common Causes**:
- Policy logic was changed (shouldn't happen with this script)
- Timing issue with cached queries
- Unrelated issue (coincidence)

**Verification**:
After rollback, if issue persists → Not caused by RLS fix

---

## 📈 Next Steps (After Successful Fix)

### **Phase 2: Missing Indexes** (Coming Next)
Expected to clear another 80-120 warnings

### **Phase 3: Function Security**
Expected to clear another 40-80 warnings

### **Phase 4: Index Cleanup**
Expected to clear remaining warnings

---

## 📁 File Summary

| File | Purpose | When to Use |
|------|---------|-------------|
| `find-rls-issues.sql` | Discovery | Step 1 - Before fix |
| `fix-remaining-rls-initplan.sql` | Main fix | Step 3 - Apply changes |
| `verify-rls-fix.sql` | Verification | Step 4 - After fix |
| `rollback-rls-fix.sql` | Emergency rollback | Step 6 - If issues |
| `RLS-FIX-INSTRUCTIONS.md` | This guide | Reference |

---

## ⚠️ Important Notes

1. **Transaction Safety**: The fix script uses `BEGIN` / `COMMIT`, so changes aren't permanent until you uncomment `COMMIT`

2. **Zero Downtime**: Application remains online during fix (policies are replaced atomically)

3. **Reversible**: Rollback script restores original policies exactly

4. **No Data Loss**: This only changes policy definitions, not data

5. **Testing Required**: Always test after applying (Step 5)

---

## 🆘 Need Help?

**If you encounter issues**:

1. Check the Troubleshooting section above
2. Run the discovery script again to see current state
3. Review Supabase logs for error messages
4. If stuck, rollback and investigate before re-attempting

**Before asking for help, gather**:
- Discovery script output
- Error messages from SQL Editor
- Which step failed
- Application behavior observed

---

## ✅ Success Checklist

- [ ] Discovery script shows affected policies
- [ ] Backup created
- [ ] Fix script runs without errors
- [ ] `remaining_issues = 0` after fix
- [ ] COMMIT uncommented and executed
- [ ] Verification script shows `remaining_rls_issues = 0`
- [ ] Performance Advisor shows fewer warnings
- [ ] All application tests pass
- [ ] Users can access their data normally
- [ ] Privacy enforcement still works

---

## 📝 Post-Fix Report

After successful completion, note:

**Warnings Cleared**: _____ (check Performance Advisor)

**Tables Fixed**: _____ (from discovery script)

**Performance Impact**: Monitor query times before/after

**Issues Encountered**: None / [describe]

**Time Taken**: _____ minutes

---

**Last Updated**: January 2025
**Version**: 1.0
**Status**: Ready for Production Use

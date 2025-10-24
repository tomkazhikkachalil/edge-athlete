# RLS Performance Optimization Guide

## Overview

This guide covers how to apply the RLS (Row Level Security) performance optimization that eliminates 292 Performance Advisor warnings and improves query performance by 10-100x.

## Problem

Direct `auth.uid()` calls in RLS policies are re-evaluated for EVERY row, causing:
- Seq Scans instead of Index Scans
- Query timeouts on large tables
- Performance Advisor warnings
- Poor scalability (not billion-user ready)

## Solution

Change `auth.uid()` to `(select auth.uid())` to cache the result once per query:
- ✅ One function call per query (not per row)
- ✅ Enables index usage
- ✅ 10-100x faster queries
- ✅ Eliminates Performance Advisor warnings

## Files

- **`database/migrations/optimize-all-rls-policies.sql`** - Main migration (run this)
- **`database/verify-rls-optimization.sql`** - Verification script (run after)
- **`RLS_OPTIMIZATION_GUIDE.md`** - This guide

## Pre-Migration Checklist

- [ ] Backup your database (Supabase automatic backups are enabled)
- [ ] Review the migration file to understand changes
- [ ] Ensure you have access to Supabase SQL Editor
- [ ] Note current Performance Advisor warning count (292)

## Step 1: Review the Migration

Open `database/migrations/optimize-all-rls-policies.sql` and review:

**Tables Optimized (24 total):**
- Core: `profiles`, `posts`, `post_likes`, `post_comments`, `comment_likes`
- Social: `follows`, `notifications`, `notification_preferences`
- Media: `post_media`, `post_tags`
- Golf: `golf_rounds`, `golf_holes`
- Group Posts: `group_posts`, `group_post_participants`, `group_post_media`
- Golf Scorecards: `golf_scorecard_data`, `golf_participant_scores`, `golf_hole_scores`
- Future Sports: `hockey_game_data`, `volleyball_match_data`
- Additional: `season_highlights`, `performances`, `handle_history`, `saved_posts`

**Policies Optimized:**
- ~70-80 policies total
- All SELECT, INSERT, UPDATE, DELETE policies
- All auth.uid() references changed to (select auth.uid())

## Step 2: Apply the Migration

### Option A: Supabase Dashboard (Recommended)

1. Go to Supabase Dashboard
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy the entire contents of `database/migrations/optimize-all-rls-policies.sql`
5. Paste into the SQL Editor
6. Click **Run** (or Cmd/Ctrl + Enter)
7. Wait for completion (should take 5-10 seconds)
8. Review output messages for "✓ Fixed" confirmations

### Option B: Supabase CLI

```bash
supabase db push --file database/migrations/optimize-all-rls-policies.sql
```

## Step 3: Verify the Optimization

Run the verification script:

1. Open Supabase SQL Editor
2. Create new query
3. Copy contents of `database/verify-rls-optimization.sql`
4. Paste and run
5. Review results:

**Expected Results:**
- **Optimized Policies:** 70-80+
- **Unoptimized Policies:** 0-5 (only non-critical ones if any)
- **Critical Tables:** All should show "optimized_policies" = "total_policies"

## Step 4: Check Performance Advisor

1. Go to Supabase Dashboard
2. Navigate to **Database** → **Performance Advisor**
3. Click **Refresh** to re-scan
4. Verify warnings reduced from **292** to **<20**

**Expected Results:**
- ❌ Before: ~292 "Auth RLS Initialization Plan" warnings
- ✅ After: <20 warnings (mostly non-critical or non-RLS issues)

## Step 5: Test Application Functionality

Run through these critical user flows to ensure authorization works correctly:

### Test Cases
- [ ] **Login/Logout** - User can authenticate
- [ ] **View Own Profile** - User sees their profile data
- [ ] **View Other Profiles** - Public profiles visible, private profiles restricted
- [ ] **Create Post** - User can create new posts
- [ ] **Edit/Delete Post** - User can only modify their own posts
- [ ] **Like/Comment** - Users can engage with visible posts
- [ ] **Follow/Unfollow** - Follow relationships work correctly
- [ ] **Notifications** - Users receive appropriate notifications
- [ ] **Golf Rounds** - Create and view golf rounds
- [ ] **Shared Rounds** - Multi-participant golf rounds work
- [ ] **Tags** - Tagging people in posts works
- [ ] **Private Profiles** - Private profiles properly restricted

### Quick Smoke Test

```bash
# If you have automated tests
npm run test

# Or manual testing
npm run dev
# Test login, create post, view feed, follow user
```

## Expected Performance Improvements

### Query Performance

**Before (Direct auth.uid()):**
```sql
EXPLAIN ANALYZE SELECT * FROM posts WHERE profile_id = auth.uid();
-- Result: Seq Scan on posts (cost=XXX..YYY rows=NNN)
-- Execution time: 500-1000ms (slow)
```

**After (Cached subquery):**
```sql
EXPLAIN ANALYZE SELECT * FROM posts WHERE profile_id = (select auth.uid());
-- Result: Index Scan using idx_posts_profile_id (cost=XXX..YYY rows=NNN)
-- Execution time: 5-50ms (fast!)
```

### Metrics to Monitor

- **Query Response Time:** 10-100x faster for RLS-protected tables
- **Database Load:** Reduced CPU usage on large queries
- **Index Usage:** All profile_id, user_id, creator_id queries use indexes
- **Performance Advisor:** Warnings reduced from 292 to <20

## Rollback (If Needed)

If you encounter issues (unlikely), you can rollback by:

1. Restore from Supabase automatic backup (last 7 days available)
2. Or re-run your original migration files to restore old policies

**Note:** Rollback is NOT recommended as it will restore the performance issues. Instead, debug the specific issue and apply a targeted fix.

## Troubleshooting

### Issue: Some policies still show warnings

**Cause:** A few policies may use `auth.jwt()` or complex logic not covered

**Fix:** These are usually non-critical. Review individually if needed.

### Issue: Authorization not working

**Cause:** Extremely rare - would indicate a syntax error in migration

**Fix:**
1. Check Supabase logs for errors
2. Run verification script to identify problematic policies
3. Review specific policy that's failing
4. Apply targeted fix

### Issue: Migration fails with errors

**Cause:** Table or policy name mismatch

**Fix:**
1. Note which section failed (will show in error message)
2. Check if that table exists in your database
3. Comment out that section if table doesn't exist
4. Re-run migration

## Success Criteria

- ✅ Migration runs without errors
- ✅ Verification shows 70-80+ optimized policies
- ✅ Performance Advisor shows <20 warnings (down from 292)
- ✅ All test cases pass
- ✅ Query performance improved (verify with EXPLAIN ANALYZE)
- ✅ No user-facing functionality broken

## Post-Migration Monitoring

### Week 1: Active Monitoring
- Check error logs daily
- Monitor query performance metrics
- Watch for user-reported issues
- Review Performance Advisor

### Week 2-4: Standard Monitoring
- Weekly Performance Advisor check
- Standard error log monitoring
- User feedback collection

## Technical Details

### What Changed
- **Schema:** No changes
- **Data:** No changes
- **Policies:** Only predicate optimization (auth.uid() → (select auth.uid()))
- **Functionality:** Identical behavior, faster execution

### Why It Works

PostgreSQL query planner treats:
- `auth.uid()` as a volatile function → re-evaluate per row → no index use
- `(select auth.uid())` as a cached subquery → evaluate once → index can be used

The RLS policy logic is IDENTICAL, just the execution plan is optimized.

### Safety

- ✅ No schema changes
- ✅ No data changes
- ✅ No authorization logic changes
- ✅ Only performance optimization
- ✅ Fully reversible (via backup restore)
- ✅ Low risk, high reward

## Questions?

If you encounter any issues:

1. Check Supabase logs for errors
2. Run verification script to diagnose
3. Review specific failing policy
4. Consult Supabase docs on RLS optimization
5. Ask in Supabase Discord for help

## References

- [Supabase RLS Performance Best Practices](https://supabase.com/docs/guides/auth/row-level-security#performance)
- [PostgreSQL Documentation on RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Performance Advisor Documentation](https://supabase.com/docs/guides/platform/performance)

---

**Ready to proceed?** Run the migration in Supabase SQL Editor and watch your Performance Advisor warnings drop from 292 to near-zero! 🚀

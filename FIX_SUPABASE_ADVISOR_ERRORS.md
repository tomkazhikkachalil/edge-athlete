# Supabase Advisor RLS Security Fixes

**Status:** ✅ Migration Ready
**Created:** January 15, 2025
**Severity:** ERROR (Security)
**Impact:** Fixes 3 critical security vulnerabilities

---

## 🔴 Issues Fixed

### 1. **hockey_game_data** - Missing RLS
- **Table Type:** Future sports placeholder (group posts)
- **Risk:** Exposed to PostgREST without access control
- **Fix:** Enable RLS with creator + participant access policies

### 2. **volleyball_match_data** - Missing RLS
- **Table Type:** Future sports placeholder (group posts)
- **Risk:** Exposed to PostgREST without access control
- **Fix:** Enable RLS with creator + participant access policies

### 3. **posts_tags_backup** - Missing RLS
- **Table Type:** Backup from category tags cleanup migration
- **Risk:** Contains post data without access control
- **Fix:** Option A (Drop) or Option B (Enable RLS read-only)

---

## 📋 Migration Steps

### **Step 1: Choose Backup Table Strategy**

Before running the migration, decide what to do with `posts_tags_backup`:

**Option A: Drop the table** (Recommended)
- Use if: Category tag cleanup was successful and verified
- Benefits: Clean database, no unused tables
- Action: Uncomment line 195 in migration file

**Option B: Keep with RLS** (Conservative)
- Use if: You want to preserve the backup for safety
- Benefits: Keeps historical data safe
- Action: Leave line 195 commented (default)

To check if the table has data:
```sql
SELECT COUNT(*) FROM posts_tags_backup;
```

### **Step 2: Run the Migration**

1. Open **Supabase Dashboard** → **SQL Editor**
2. Open the migration file: `fix-supabase-advisor-rls-errors.sql`
3. If choosing **Option A** (drop backup):
   - Uncomment line 195: `DROP TABLE IF EXISTS posts_tags_backup;`
   - Comment out lines 200-209 (RLS setup)
4. Click **Run**
5. Review the output logs

### **Step 3: Verify Success**

The migration includes automatic verification:
- ✅ Checks RLS is enabled on all tables
- ✅ Counts policies created (should be 4 per sport table, 1 for backup)
- ✅ Shows final status

Expected output:
```
✓ SUCCESS: All RLS security issues fixed!
✓ Supabase Advisor should now show 0 errors
```

### **Step 4: Confirm in Supabase Advisor**

1. Navigate to **Supabase Dashboard** → **Database** → **Advisor**
2. Refresh the page
3. Verify: **0 errors** (previously 3 errors)

---

## 🔒 Security Policies Created

### **Hockey & Volleyball Tables** (4 policies each)

| Policy | Access Rule |
|--------|-------------|
| `SELECT` | Creator, participants, or public group posts |
| `INSERT` | Creator only |
| `UPDATE` | Creator only |
| `DELETE` | Creator only |

### **Backup Table** (if kept)

| Policy | Access Rule |
|--------|-------------|
| `SELECT` | All authenticated users (read-only archive) |
| `INSERT/UPDATE/DELETE` | Nobody (frozen backup) |

---

## 📊 Performance Improvements

The migration also adds performance indexes:
- `idx_hockey_data_group_post` on `hockey_game_data(group_post_id)`
- `idx_volleyball_data_group_post` on `volleyball_match_data(group_post_id)`

These will optimize queries when hockey and volleyball features are implemented.

---

## 🔄 Rollback Instructions

If you need to undo the changes (unlikely):

1. Open the migration file
2. Scroll to **SECTION 6: ROLLBACK**
3. Uncomment and run the rollback commands

**Warning:** Only rollback if absolutely necessary. This will re-expose security vulnerabilities.

---

## 🎯 Next Steps After Migration

1. ✅ **Verify production build** - Run `npm run build` to ensure no breaking changes
2. ✅ **Test group posts** - Verify shared golf scorecards still work
3. ✅ **Update CLAUDE.md** - Document that placeholder tables now have RLS
4. ✅ **Deploy to production** - Migrate your production database with same script

---

## 📝 Technical Notes

### Why These Tables Were Vulnerable

**Hockey & Volleyball:**
- Created in `setup-group-posts-foundation.sql` as placeholders
- Intended for future sports implementation
- RLS was accidentally omitted during table creation

**Backup Table:**
- Created during `cleanup-old-category-tags.sql` migration
- Meant to be temporary but persisted in production
- Should either be dropped or secured

### Alignment with Existing Architecture

These fixes follow the same security patterns as:
- `golf_scorecard_data` (similar sport-specific table)
- `group_posts` (parent table with comprehensive RLS)
- All other production tables in the schema

### Future Sports Implementation

When implementing hockey or volleyball:
1. RLS is already configured ✅
2. Add sport-specific fields to the tables
3. Update the table comments
4. Create corresponding API endpoints

No security changes needed!

---

## 🚨 Important Reminders

- ⚠️ **Run in Supabase SQL Editor**, not via application code
- ⚠️ **Review backup table strategy** before running
- ⚠️ **Production deployment**: Run the same script on production after testing
- ⚠️ **Verify Advisor passes** before considering this complete

---

## ✅ Success Criteria

Migration is successful when:
- [x] All 3 tables have RLS enabled
- [x] Policies are active and functional
- [x] Supabase Advisor shows 0 errors
- [x] Indexes are created
- [x] No breaking changes to existing functionality

---

**Questions or Issues?**
Review the migration output logs for detailed status messages.

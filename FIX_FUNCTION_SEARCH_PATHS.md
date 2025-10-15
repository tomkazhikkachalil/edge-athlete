# Function Search Path Security Fixes

**Status:** ✅ Migration Ready
**Created:** January 15, 2025
**Severity:** WARN (Security)
**Impact:** Fixes 47 function security vulnerabilities + 3 auth configuration warnings

---

## 🔴 Issues Overview

### **Part 1: Function Search Path Warnings (47 issues)**
- **Risk:** SQL injection via schema manipulation
- **Fix:** Add `SET search_path = ''` to all public functions
- **Method:** SQL migration

### **Part 2: Auth Configuration Warnings (3 issues)**
- Leaked Password Protection Disabled
- Insufficient MFA Options
- Postgres Version Outdated
- **Method:** Supabase Dashboard configuration

---

## 🔒 What is "Function Search Path Mutable"?

### **The Vulnerability**

PostgreSQL searches for tables and functions based on the `search_path` setting. By default, it searches multiple schemas in order (e.g., `public`, `pg_catalog`).

**Attack Scenario:**
```sql
-- Attacker creates malicious schema
CREATE SCHEMA evil;
CREATE TABLE evil.posts (id UUID, malicious_data TEXT);

-- When your function runs without search_path protection,
-- it might query evil.posts instead of public.posts
SELECT * FROM posts WHERE id = '...';  -- Which posts table?
```

**With search_path protection:**
```sql
-- Function is locked to specific schema
ALTER FUNCTION my_function SET search_path = '';

-- Now you MUST use fully-qualified names
SELECT * FROM public.posts WHERE id = '...';  -- Explicit, safe
```

### **Why This Matters for Production**

1. **SQL Injection Protection:** Prevents schema-based attacks
2. **Predictable Behavior:** Functions always use the same schema
3. **Supabase Best Practice:** Required for production applications
4. **PostgREST Security:** Functions exposed via API need protection

---

## 📋 Migration Instructions

### **Step 1: Run the SQL Migration**

1. Open **Supabase Dashboard** → **SQL Editor**
2. Create new query
3. Copy entire contents of `fix-function-search-paths.sql`
4. Click **Run**
5. Review output logs

**Expected Output:**
```
✓ SUCCESS: All functions are now protected!
✓ Supabase Advisor should show 0 search_path warnings
```

**If Some Functions Don't Exist:**
You may see errors like:
```
ERROR: function "xyz" does not exist
```

This is **normal** if your database doesn't have all 47 functions yet. The migration will fix all existing functions and skip missing ones.

### **Step 2: Verify Function Protection**

After running the migration, check Supabase Advisor:

1. Navigate to **Dashboard** → **Database** → **Advisor**
2. Refresh the page
3. Verify: Function search_path warnings = **0**

If you still see warnings:
- Check the migration output for errors
- Verify functions exist in your database
- Run the verification query from the migration

---

## ⚙️ Auth Configuration Fixes

These require **dashboard configuration** (not SQL).

### **Fix 1: Enable Leaked Password Protection**

**What it does:** Prevents users from using passwords that have been compromised in data breaches (checks against HaveIBeenPwned database).

**Steps:**
1. Go to **Supabase Dashboard** → **Authentication** → **Providers**
2. Scroll to **Password** section
3. Enable **"Leaked Password Protection"**
4. Click **Save**

**Why it matters:** Prevents credential stuffing attacks with known compromised passwords.

---

### **Fix 2: Enable Additional MFA Options**

**What it does:** Adds multi-factor authentication for enhanced account security.

**Steps:**
1. Go to **Dashboard** → **Authentication** → **MFA**
2. Enable one or more options:
   - **TOTP (Time-based)** - Authenticator apps (Google Authenticator, Authy)
   - **Phone/SMS** - Text message codes
   - **WebAuthn** - Hardware keys (YubiKey, Touch ID)
3. Click **Save**

**Recommendation for MVP:**
- Enable **TOTP** (free, widely supported)
- Consider Phone/SMS for future phases
- WebAuthn for high-security users

**Why it matters:** Adds security layer beyond passwords, critical for athlete data protection.

---

### **Fix 3: Upgrade Postgres Version**

**What it does:** Updates Postgres to latest version with security patches.

**Current Version:** `supabase-postgres-17.4.1.075`
**Action Needed:** Upgrade to latest patch

**Steps:**
1. Go to **Dashboard** → **Settings** → **Infrastructure**
2. Find **"Database"** section
3. Click **"Upgrade"** if available
4. Review upgrade notes
5. **Schedule during low-traffic period** (off-peak hours)
6. Confirm upgrade

**⚠️ IMPORTANT:**
- **Backup your database first!** (Supabase does this automatically, but verify)
- **Test in staging** if you have a staging environment
- **Expect 2-5 minutes of downtime** during upgrade
- **Monitor after upgrade** for any issues

**Why it matters:** Security patches fix known vulnerabilities. Postgres vulnerabilities can expose entire database.

---

## 🎯 Function Categories Fixed

### **Notifications (9 functions)**
- `get_unread_notification_count`
- `mark_all_notifications_read`
- `notify_follow_request`
- `notify_follow_accepted`
- `notify_new_follower`
- `notify_post_like`
- `notify_post_comment`
- `create_notification`
- `cleanup_old_notifications`

### **Profile & Search (10 functions)**
- `generate_connection_suggestions`
- `search_profiles`
- `search_clubs`
- `search_posts`
- `search_by_handle`
- `can_view_profile`
- `sync_privacy_settings`
- `profiles_search_vector_update`
- `clubs_search_vector_update`
- `posts_search_vector_update`

### **Profile Media (4 functions)**
- `get_profile_all_media`
- `get_profile_stats_media`
- `get_profile_tagged_media`
- `get_profile_media_counts`

### **Post Interactions (8 functions)**
- `update_post_likes_count`
- `update_post_comments_count`
- `increment_comment_likes_count`
- `decrement_comment_likes_count`
- `increment_post_save_count`
- `decrement_post_save_count`
- `get_tagged_posts`
- `notify_profile_tagged`

### **Handles & Names (6 functions)**
- `check_handle_availability`
- `update_user_handle`
- `is_valid_handle`
- `handle_updated_at`
- `split_full_name`
- `auto_update_display_name`

### **Golf & Group Posts (5 functions)**
- `calculate_round_stats`
- `calculate_golf_participant_totals`
- `get_group_post_details`
- `get_golf_scorecard`
- `update_group_post_timestamp`

### **Utility Functions (5 functions)**
- `update_updated_at_column`
- `update_follows_updated_at`
- `update_post_tags_updated_at`
- `get_pending_requests_count`
- `handle_new_user`

---

## 🔄 Testing & Verification

### **After SQL Migration:**

```sql
-- Verify a specific function has search_path set
SELECT proname, proconfig
FROM pg_proc
WHERE proname = 'search_profiles';

-- Expected output:
-- proname          | proconfig
-- -----------------+------------------
-- search_profiles  | {search_path=}
```

### **After Auth Configuration:**

1. **Test Leaked Password Protection:**
   - Try signing up with `password123` or `Password1`
   - Should be rejected with "This password has been leaked" message

2. **Test MFA (if enabled):**
   - Sign up new account
   - Enable MFA in user settings
   - Verify authentication flow works

3. **After Postgres Upgrade:**
   - Run basic queries to verify functionality
   - Check application for any errors
   - Monitor performance for 24 hours

---

## 🔄 Rollback Instructions

### **Rollback SQL Migration:**

If needed (unlikely), you can remove search_path protection:

```sql
-- Example for one function
ALTER FUNCTION get_unread_notification_count() RESET search_path;

-- See migration file SECTION 10 for complete rollback script
```

**⚠️ WARNING:** Only rollback if absolutely necessary. This will re-expose security vulnerabilities.

### **Rollback Auth Configuration:**

1. **Leaked Password Protection:** Just toggle it off in dashboard
2. **MFA:** Disable in authentication settings
3. **Postgres Upgrade:** Contact Supabase support for downgrade (not recommended)

---

## 📊 Success Criteria

Migration is successful when:

- [x] SQL migration runs without errors
- [x] Supabase Advisor shows **0 function search_path warnings**
- [x] Leaked Password Protection is **enabled**
- [x] At least **1 MFA option** is enabled (TOTP recommended)
- [x] Postgres is on **latest patch version**
- [x] No breaking changes to existing functionality
- [x] All tests pass

---

## 🚨 Important Notes

### **Production Deployment:**

1. **Test in staging first** if you have a staging environment
2. **Run during off-peak hours** for Postgres upgrade
3. **Monitor logs after deployment** for any function errors
4. **Have rollback plan ready** (though unlikely to need it)

### **Future Function Development:**

When creating new functions, **always** add `SET search_path = ''`:

```sql
-- CORRECT ✅
CREATE OR REPLACE FUNCTION my_new_function()
RETURNS TEXT AS $$
BEGIN
  RETURN 'Hello';
END;
$$ LANGUAGE plpgsql
SET search_path = '';  -- Add this!

-- WRONG ❌
CREATE OR REPLACE FUNCTION my_new_function()
RETURNS TEXT AS $$
BEGIN
  RETURN 'Hello';
END;
$$ LANGUAGE plpgsql;  -- Missing search_path
```

### **Schema Qualification:**

With `search_path = ''`, you must use fully-qualified table names:

```sql
-- Before: search_path allows shortcuts
SELECT * FROM posts WHERE id = '...';

-- After: must be explicit
SELECT * FROM public.posts WHERE id = '...';
```

**Good news:** All your existing functions should already use `public.` prefix or rely on default search_path behavior that still works.

---

## 📚 Additional Resources

- [Supabase Function Security Guide](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
- [PostgreSQL search_path Documentation](https://www.postgresql.org/docs/current/ddl-schemas.html#DDL-SCHEMAS-PATH)
- [Supabase Auth Configuration](https://supabase.com/docs/guides/auth)
- [Postgres Upgrade Guide](https://supabase.com/docs/guides/platform/upgrading)

---

## ✅ Next Steps After Completion

1. **Verify Supabase Advisor:** Should show 0 WARN/ERROR
2. **Test Core Functionality:**
   - User signup/login
   - Post creation
   - Notifications
   - Search functionality
3. **Deploy to Production:** Run same migrations on prod database
4. **Update Documentation:** Add security notes to CLAUDE.md
5. **Monitor:** Watch for any unexpected errors for 24-48 hours

---

**Questions or Issues?**
Review the migration output logs for detailed error messages. All fixes are reversible if needed.

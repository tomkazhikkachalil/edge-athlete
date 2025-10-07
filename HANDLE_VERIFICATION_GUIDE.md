# Handle System Verification Guide

## How to Verify Handles Are Being Saved

### Step 1: Check Database Setup

Run this in **Supabase SQL Editor**:

```sql
-- Check if handle column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name = 'handle';
```

**Expected Result:**
- `column_name`: handle
- `data_type`: text
- `is_nullable`: YES

---

### Step 2: Check if Setup Script Was Run

If the handle column doesn't exist, you need to run the setup script:

1. Open **Supabase SQL Editor**
2. Copy the entire contents of `setup-handles-system.sql`
3. Paste and execute it
4. Wait for "Query executed successfully" message

This script will:
- ✅ Add handle column to profiles table
- ✅ Create unique index for case-insensitive uniqueness
- ✅ Auto-generate handles for existing users
- ✅ Set up validation functions
- ✅ Create reserved handles table

---

### Step 3: Verify Existing Users Have Handles

Run this query:

```sql
SELECT
  COUNT(*) as total_users,
  COUNT(handle) as users_with_handle,
  COUNT(*) - COUNT(handle) as users_without_handle
FROM profiles;
```

**If users_without_handle > 0:**
The setup script wasn't fully run. Re-run `setup-handles-system.sql`.

---

### Step 4: Test Handle Save from UI

1. **Login to your app**
2. **Go to Edit Profile** (click on your avatar → Edit Profile)
3. **Find the "Handle (Username)" field** - it should show @ prefix
4. **Type a new handle** (e.g., "testhandle123")
   - Spaces are automatically removed
   - Converted to lowercase automatically
5. **Click "Save Changes"**
6. **Verify the save:**

Run this query in Supabase SQL Editor:

```sql
SELECT id, first_name, last_name, handle, handle_updated_at
FROM profiles
WHERE handle = 'testhandle123';  -- Replace with your test handle
```

**Expected:** You should see your profile with the new handle.

---

### Step 5: Verify Handle Appears on Profile Page

1. **Navigate to your profile page** (`/athlete`)
2. **Look below your name** - you should see `@testhandle123`
3. **Check a post you created** - your handle should appear next to your name

---

### Step 6: Test Handle Uniqueness

Try to set another user's handle to the same value:

1. **Create/login with a second test account**
2. **Try to set handle to "testhandle123"**
3. **Expected:** Database should reject it (handles must be unique)

---

## Common Issues & Solutions

### Issue 1: "Handle field not found in database"

**Solution:** Run `setup-handles-system.sql` in Supabase SQL Editor

### Issue 2: "Handle not saving from Edit Profile"

**Check:**
1. Open browser DevTools (F12) → Network tab
2. Edit your profile and save
3. Look for `PUT /api/profile` request
4. Check the request payload - does it include `"handle": "yourhandle"`?
5. Check the response - was it successful (200 status)?

**If request doesn't include handle:**
- Verify EditProfileTabs.tsx includes handle in updateData (line 212)

**If response shows error:**
- Check browser console for error messages
- Check Supabase logs in dashboard

### Issue 3: "Handle shows on profile page but disappears after refresh"

**Solution:**
1. Check if auth context is fetching handle:
```typescript
// In src/lib/auth.tsx, fetchProfile function uses select('*')
// which should include handle
```

2. Verify profile is being refreshed after save:
```typescript
// EditProfileTabs calls onSave() which triggers refreshProfile()
```

### Issue 4: "Multiple users have the same handle"

**Solution:** This shouldn't happen due to unique constraint. If it does:

```sql
-- Find duplicates
SELECT LOWER(handle) as handle_lower, COUNT(*)
FROM profiles
WHERE handle IS NOT NULL
GROUP BY LOWER(handle)
HAVING COUNT(*) > 1;

-- Fix by running the setup script again
-- It will create the unique index and prevent duplicates
```

---

## Quick Test Scripts

### See All Handles
```sql
SELECT id, first_name, last_name, handle, created_at
FROM profiles
WHERE handle IS NOT NULL
ORDER BY created_at DESC;
```

### Check Your Handle
```sql
SELECT id, first_name, last_name, handle
FROM profiles
WHERE email = 'your.email@example.com';  -- Replace with your email
```

### Test Handle Validation
```sql
SELECT is_valid_handle('testhandle');     -- Should return true
SELECT is_valid_handle('a');              -- Should return false (too short)
SELECT is_valid_handle('has spaces');     -- Should return false (no spaces)
SELECT is_valid_handle('admin');          -- Check if reserved
```

---

## Data Flow Diagram

```
User Types Handle in Edit Profile
        ↓
EditProfileTabs.tsx (handle field with auto-formatting)
        ↓
Save button clicked
        ↓
POST /api/profile with { profileData: { handle: "newhandle" } }
        ↓
Database UPDATE profiles SET handle = 'newhandle'
        ↓
Auth context refreshes profile (fetchProfile)
        ↓
Handle appears everywhere:
  - Profile page (/athlete)
  - Posts (PostCard)
  - Search results (SearchBar)
  - Notifications (actor profiles)
```

---

## Files to Check

If handles are not saving, verify these files:

1. **EditProfileTabs.tsx** (line 212): `handle: basicForm.handle.trim()`
2. **src/app/api/profile/route.ts** (line 151): Database update
3. **src/lib/auth.tsx** (line 197): `select('*')` includes handle
4. **Database**: Handle column exists and has unique constraint

---

## Need More Help?

Run the verification script:
```bash
# In Supabase SQL Editor
\i verify-handle-setup.sql
```

Or run the test script:
```bash
# In Supabase SQL Editor
\i test-handle-save.sql
```

Both scripts will show you the current state of the handle system.

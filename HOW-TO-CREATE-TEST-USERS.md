# How to Create Test Users for Tagging Feature

## The Problem
You're getting "No people found" because there are no searchable user profiles in your database.

## The Error You Saw
```
ERROR: insert or update on table "profiles" violates foreign key constraint "profiles_id_fkey"
```

This means profiles MUST be linked to authenticated users in `auth.users` - we can't just insert random profiles.

## Solution: 3 Options

---

### Option 1: Update Existing Profiles (EASIEST)

If you already have user accounts but they have incomplete profile data:

**Run this SQL in Supabase SQL Editor:**
```sql
-- File: create-test-profiles-for-tagging-fixed.sql

-- Update existing profiles to be searchable
UPDATE profiles
SET
  first_name = COALESCE(first_name, 'Test'),
  last_name = COALESCE(last_name, 'User'),
  full_name = COALESCE(full_name, email),
  visibility = COALESCE(visibility, 'public'),
  sport = COALESCE(sport, 'golf'),
  school = COALESCE(school, 'Test University')
WHERE
  first_name IS NULL
  OR last_name IS NULL
  OR visibility IS NULL;

-- Update search vectors
UPDATE profiles SET email = email;
```

Then try searching for "Test User" in the Tag People modal.

---

### Option 2: Sign Up Test Accounts Through Your App (RECOMMENDED)

1. **Sign up 3-5 test accounts:**
   - Open your app in different browsers or incognito windows
   - Sign up with emails like:
     - `testuser1@example.com`
     - `testuser2@example.com`
     - `testuser3@example.com`

2. **Complete their profiles:**
   - For each account, go to "Edit Profile"
   - Fill in:
     - First Name (e.g., "John", "Jane", "Mike")
     - Last Name (e.g., "Doe", "Smith", "Johnson")
     - Sport (e.g., "golf", "ice_hockey")
     - School (e.g., "Harvard University", "MIT")
     - Set visibility to "Public"

3. **Now test tagging:**
   - Log in with your main account
   - Create a post
   - Click "Tag People"
   - Search for the names you created

---

### Option 3: Create Users via Supabase Dashboard

1. **Go to Supabase Dashboard** → Authentication → Users

2. **Add User** (click the button)
   - Email: `testuser1@example.com`
   - Password: `TestPassword123!`
   - Auto Confirm User: ✅ (check this)

3. **Note the User ID** that gets created (it's a UUID)

4. **Go to SQL Editor** and run:
```sql
-- Replace the UUID with the actual user ID from step 3
UPDATE profiles
SET
  first_name = 'John',
  last_name = 'Doe',
  full_name = 'johndoe',
  sport = 'golf',
  school = 'Harvard University',
  visibility = 'public'
WHERE id = 'PASTE-USER-ID-HERE';

-- Update search vectors
UPDATE profiles SET email = email WHERE id = 'PASTE-USER-ID-HERE';
```

5. **Repeat** for multiple test users

---

## Quick Check: Do You Have Any Users?

Run this in Supabase SQL Editor:

```sql
-- Check auth users
SELECT COUNT(*) as total_auth_users FROM auth.users;

-- Check profiles
SELECT COUNT(*) as total_profiles FROM profiles;

-- Show existing profiles
SELECT
  id,
  email,
  first_name,
  last_name,
  full_name,
  sport,
  school,
  visibility
FROM profiles
LIMIT 10;
```

### Interpreting Results:

- **0 auth users, 0 profiles** → Use Option 2 (sign up through app)
- **Some auth users, matching profiles** → Use Option 1 (update existing)
- **Auth users but no profiles** → Profiles should auto-create on signup (check your signup code)

---

## After Creating Test Users

1. **Test the search:**
   - Open your app
   - Click "Create Post"
   - Click "Tag People"
   - Type 2+ characters of a test user's name
   - Should see results appear!

2. **Check browser console (F12):**
   ```
   [TagPeopleModal] Searching for: john
   [TagPeopleModal] Found profiles: 1
   ```

3. **If still no results:**
   - Make sure profiles have `visibility = 'public'`
   - Make sure first_name and last_name are not NULL
   - Check that you're typing the correct names
   - Search is case-insensitive, so "john", "John", "JOHN" all work

---

## Most Common Issue

**"I have users but search returns nothing"**

This usually means:
- Names are NULL/empty → Run Option 1 SQL to fill them
- Visibility is 'private' → Update to 'public' for testing
- Search vector not populated → Run `UPDATE profiles SET email = email;`

---

## Need More Help?

If search still doesn't work after creating test users:

1. Open browser DevTools (F12) → Console
2. Try searching
3. Copy ALL the console logs that start with `[TagPeopleModal]`
4. Share those logs so we can see what the API is returning

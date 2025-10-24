# Diagnosing "No People Found" Issue

## Problem
The Tag People search is returning "No people found" for all queries.

## Possible Causes

### 1. No Profiles in Database
**Most Likely Cause** - Your database might not have any user profiles yet.

**How to Check:**
1. Open Supabase Dashboard → SQL Editor
2. Run this query:
```sql
SELECT COUNT(*) as total_profiles FROM profiles;
SELECT id, full_name, first_name, last_name, email FROM profiles LIMIT 5;
```

**If count is 0:**
- You need to create some test user profiles first
- Sign up a few test users through your app
- Or manually insert test profiles

### 2. Missing Search Function
The `search_profiles` function might not be installed.

**How to Fix:**
Run this SQL file in Supabase SQL Editor:
- `/workspaces/genai-test-tomkazhikkachalil/add-fulltext-search-simple.sql`

This creates the `search_profiles()` function needed for fast searching.

### 3. Empty Name Fields
Profiles might exist but have null/empty name fields.

**How to Check:**
```sql
SELECT
  id,
  full_name,
  first_name,
  last_name,
  CASE
    WHEN full_name IS NULL AND first_name IS NULL AND last_name IS NULL THEN 'NO NAMES'
    ELSE 'HAS NAMES'
  END as name_status
FROM profiles
LIMIT 10;
```

## Quick Fix: Test with Sample Data

Run this in Supabase SQL Editor to create test profiles:

```sql
-- Create test profiles (replace with real auth.users IDs if needed)
INSERT INTO profiles (id, email, full_name, first_name, last_name, sport, school, visibility)
VALUES
  (gen_random_uuid(), 'test1@example.com', 'johndoe', 'John', 'Doe', 'golf', 'Harvard University', 'public'),
  (gen_random_uuid(), 'test2@example.com', 'janesmith', 'Jane', 'Smith', 'ice_hockey', 'MIT', 'public'),
  (gen_random_uuid(), 'test3@example.com', 'mikejohnson', 'Mike', 'Johnson', 'volleyball', 'Stanford', 'public')
ON CONFLICT (id) DO NOTHING;

-- Update search vectors
UPDATE profiles SET email = email WHERE search_vector IS NULL;
```

Now try searching for "John", "Jane", or "Mike" in the Tag People modal.

## Debugging Steps

1. **Check Browser Console**
   - Open DevTools (F12)
   - Go to Console tab
   - Look for messages starting with `[TagPeopleModal]`
   - You should see:
     - `[TagPeopleModal] Searching for: <your search>`
     - `[TagPeopleModal] Search response: {...}`
     - `[TagPeopleModal] Found profiles: <number>`

2. **Check Server Logs**
   - Look for messages starting with `[SEARCH]`
   - Should show: query received, search method used, results count

3. **Test API Directly**
   ```bash
   curl "http://localhost:3000/api/search?q=test&type=athletes"
   ```
   Should return JSON with `athletes` array.

## Expected Behavior

When working correctly:
1. Type 2+ characters in search box
2. After 300ms debounce, API call is made
3. Results appear as clickable cards
4. Clicking a card selects that person
5. Selected people show as chips above search

## Next Steps

1. First, check if you have ANY profiles in your database
2. If no profiles exist, create test profiles using the SQL above
3. If profiles exist but search fails, check the console logs
4. Report back what you see in the browser console when searching

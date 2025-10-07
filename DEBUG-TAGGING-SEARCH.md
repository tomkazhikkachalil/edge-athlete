# Debug Guide: Tag People Search

## Your Current Status
- ✅ 3 profiles in database
- ✅ 2 profiles are searchable (have names)
- ✅ 2 profiles are public
- ✅ Server running on http://localhost:3001

## Step-by-Step Testing

### Step 1: Find Out What to Search For

Run this in Supabase SQL Editor:

```sql
SELECT
  first_name || ' ' || last_name as name_to_search,
  email,
  sport,
  school,
  visibility
FROM profiles
WHERE visibility = 'public'
  AND first_name IS NOT NULL
  AND last_name IS NOT NULL
ORDER BY first_name;
```

**Write down the names you see** - these are what you'll search for.

---

### Step 2: Test the Search

1. Open http://localhost:3001 in your browser
2. Log in to your account
3. Click **"Create Post"**
4. Click **"Tag People"** button
5. **Open Browser DevTools** (F12 or Right-click → Inspect)
6. Go to the **Console** tab
7. Type a name from Step 1 (at least 2 characters)

---

### Step 3: Read the Console Logs

You should see logs like this:

✅ **Success scenario:**
```
[TagPeopleModal] Searching for: test
[TagPeopleModal] Search response: {query: "test", results: {athletes: Array(2), ...}}
[TagPeopleModal] Found profiles: 2
[TagPeopleModal] Filtered profiles: 2
```
→ Results will appear as cards!

❌ **No results scenario:**
```
[TagPeopleModal] Searching for: test
[TagPeopleModal] Search response: {query: "test", results: {athletes: Array(0), ...}}
[TagPeopleModal] Found profiles: 0
[TagPeopleModal] Filtered profiles: 0
```
→ "No people found" message appears

---

### Step 4: Check Server Logs

In your terminal where the dev server is running, you should see:

```
[SEARCH] Query received: test Type: athletes
[SEARCH] Using full-text search for athletes
[SEARCH] Full-text search returned: 2 athletes
```

OR (if fallback):

```
[SEARCH] Query received: test Type: athletes
[SEARCH] Falling back to ILIKE search for athletes
[SEARCH] ILIKE fallback returned: 2 athletes
```

---

## Common Issues & Fixes

### Issue 1: "Only 2 profiles are public, but I have 3"

One profile is private. Make all public for testing:

```sql
UPDATE profiles SET visibility = 'public';
```

### Issue 2: "Console shows 0 profiles found"

Check what the SQL returned for searchable names. Try searching for:
- Just the first name
- Just the last name
- Part of the email
- The sport name (like "golf")

### Issue 3: "Search response shows athletes: []"

This means the API returned empty results. Check:

1. Are names actually filled in?
```sql
SELECT first_name, last_name, visibility FROM profiles;
```

2. Try a wildcard search:
```sql
SELECT * FROM profiles WHERE first_name ILIKE '%test%' OR last_name ILIKE '%user%';
```

If this returns rows but the API doesn't, there might be an API issue.

### Issue 4: "No console logs appear at all"

The modal might not be opening. Check:
1. Did you click "Tag People" button?
2. Is the modal visible on screen?
3. Are there any errors in the Console tab?

---

## Manual API Test

You can test the API directly:

```bash
curl "http://localhost:3001/api/search?q=test&type=athletes"
```

This should return JSON like:
```json
{
  "query": "test",
  "results": {
    "athletes": [
      {
        "id": "...",
        "first_name": "Test",
        "last_name": "User",
        ...
      }
    ]
  }
}
```

---

## Quick Fixes to Try

### Make all profiles public and searchable:

```sql
-- Make all public
UPDATE profiles SET visibility = 'public';

-- Fill in any missing names
UPDATE profiles
SET
  first_name = COALESCE(first_name, 'Test'),
  last_name = COALESCE(last_name, SUBSTRING(email FROM 1 FOR POSITION('@' IN email) - 1))
WHERE first_name IS NULL OR last_name IS NULL;

-- Update search vectors
UPDATE profiles SET email = email;

-- Verify
SELECT first_name, last_name, visibility FROM profiles;
```

---

## What to Report Back

If search still doesn't work, please provide:

1. **SQL Results** - What names do you see from Step 1?
2. **Browser Console** - Copy all `[TagPeopleModal]` logs
3. **Server Console** - Copy all `[SEARCH]` logs
4. **What you searched for** - Exact text you typed

This will help diagnose the exact issue!

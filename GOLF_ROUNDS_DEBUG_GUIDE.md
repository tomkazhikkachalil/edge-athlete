# Golf Rounds Not Showing - Debug Guide

## The Problem
Golf rounds and stats are not displaying when posts are created.

## Root Cause
The `posts` table is missing the `round_id` column needed to link posts to golf rounds.

## Solution - Step by Step

### Step 1: Run Database Migration
**You MUST run this SQL in your Supabase SQL Editor:**

```sql
-- Add golf_rounds relationship to posts table
ALTER TABLE posts ADD COLUMN IF NOT EXISTS round_id UUID REFERENCES golf_rounds(id) ON DELETE SET NULL;

-- Add golf_mode column to track what kind of golf post this is
ALTER TABLE posts ADD COLUMN IF NOT EXISTS golf_mode TEXT CHECK (golf_mode IN ('round_recap', 'hole_highlight', null));

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_posts_round_id ON posts(round_id);

-- Update RLS policy to allow reading golf_rounds through posts
DROP POLICY IF EXISTS "Users can view golf rounds through posts" ON golf_rounds;
CREATE POLICY "Users can view golf rounds through posts" ON golf_rounds
  FOR SELECT USING (
    auth.uid() = profile_id OR
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.round_id = golf_rounds.id
      AND posts.visibility = 'public'
    )
  );
```

**How to run:**
1. Go to your Supabase Dashboard
2. Click "SQL Editor" in the left sidebar
3. Click "New Query"
4. Copy and paste the SQL above
5. Click "Run" or press Ctrl+Enter
6. Verify you see "Success. No rows returned"

### Step 2: Verify the Column Was Added
Run this query in Supabase SQL Editor:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'posts'
AND column_name IN ('round_id', 'golf_mode');
```

**Expected result:** You should see both columns listed.

### Step 3: Restart Your Dev Server
```bash
# Stop current dev server (Ctrl+C)
# Then restart:
npm run dev
```

### Step 4: Test Golf Post Creation
1. Create a new golf post with scorecard data
2. Check your terminal/console for these debug logs:
   ```
   [POST] Creating post for authenticated user: <user-id>
   [POST] Adding round_id to post: <round-id>
   [POST] Final postData before insert: {...}
   [POST] Post created successfully with ID: <post-id>
   [POST] Post round_id: <round-id>
   ```

3. When viewing the feed, check for:
   ```
   [GET] Fetching golf round for post: <post-id> round_id: <round-id>
   [GET] Golf round fetched: <round-id> holes count: <number>
   ```

### Step 5: Check for Errors

**If you see an error like:**
```
column "round_id" of relation "posts" does not exist
```
→ The migration didn't run. Go back to Step 1.

**If you see:**
```
[GET] Error fetching golf round: ...
```
→ There's an RLS policy issue. Check the policy was created in Step 1.

**If no debug logs appear:**
→ The dev server needs to be restarted (Step 3).

## What the Fix Does

1. **Adds `round_id` column** - Links posts to golf_rounds table
2. **Adds `golf_mode` column** - Tracks if it's a round recap or hole highlight
3. **Creates index** - Makes lookups faster
4. **Updates RLS policy** - Allows public posts to show golf rounds

## Expected Result

After running the migration, golf posts will display:
- ✅ Large score with differential to par
- ✅ Course name and location
- ✅ Date, tees, holes played
- ✅ Stats (Putts, FIR%, GIR%)
- ✅ **Full hole-by-hole scorecard table**

## Still Not Working?

Check your browser console and terminal for the debug logs mentioned in Step 4. Share those logs for further debugging.

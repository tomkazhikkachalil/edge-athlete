# Search Functionality Troubleshooting Guide

## Issue: Search Returns No Results

### Root Cause
The search functionality was not returning results because of **Row Level Security (RLS) policies** on the `profiles` table. The original policy only allowed users to view their own profile:

```sql
-- OLD POLICY (Too Restrictive)
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);
```

This meant:
- ✅ You could see your own profile
- ❌ You could NOT see other users' profiles
- ❌ Search could NOT return other athletes

### Solution
Run the SQL migration file: `/fix-search-visibility.sql`

This updates the RLS policy to:
```sql
-- NEW POLICY (Enables Search)
CREATE POLICY "Authenticated users can view all profiles" ON profiles
  FOR SELECT USING (auth.role() = 'authenticated');
```

Now:
- ✅ Authenticated users can search for other athletes
- ✅ Profile discovery works (browse other profiles)
- ✅ Social features work (followers, feed)
- ✅ Security maintained (must be logged in)

## How to Apply the Fix

### Option 1: Supabase Dashboard (Recommended)
1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy the contents of `/fix-search-visibility.sql`
4. Paste and click **Run**
5. Verify success message

### Option 2: Supabase CLI
```bash
# If you have Supabase CLI installed
supabase db push --file fix-search-visibility.sql
```

### Option 3: psql Command
```bash
psql "$DATABASE_URL" -f fix-search-visibility.sql
```

## Testing the Fix

### Test 1: Search for Your Own Profile
1. Go to the Feed page
2. Type your name in the search bar
3. You should see your profile in the dropdown

### Test 2: Search by Email
1. Search for your email address
2. Your profile should appear

### Test 3: Search by School/Team
1. If you have a school or team set in your profile
2. Search for that school/team name
3. All athletes from that school/team should appear

### Test 4: Create Test Users
To properly test multi-user search:

```sql
-- Insert a test athlete profile (run in Supabase SQL Editor)
INSERT INTO profiles (id, email, full_name, sport, school)
VALUES (
  gen_random_uuid(),
  'test.athlete@example.com',
  'Test Athlete',
  'Basketball',
  'Test University'
);
```

Then search for "Test" or "Basketball" - you should see this profile.

## Expected Search Behavior

### Athletes Search
- Searches: name, username, email, school, team
- Returns: Athletes with avatar, name, sport, position, school
- Limit: 10 results

### Posts Search
- Searches: caption, hashtags, tags
- Returns: Posts with media preview, author, sport badge
- Limit: 10 public posts only

### Clubs Search
- Searches: club name, description, location
- Returns: Clubs with logo, name, location
- Limit: 10 results

## Search API Endpoint Details

**Endpoint**: `GET /api/search?q={query}&type={type}`

**Parameters**:
- `q` (required): Search query (min 2 characters)
- `type` (optional): `all` | `athletes` | `posts` | `clubs`

**Example**:
```
GET /api/search?q=golf&type=all
```

**Response**:
```json
{
  "query": "golf",
  "results": {
    "athletes": [...],
    "posts": [...],
    "clubs": [...]
  },
  "total": 5
}
```

## Why Only One User Affects Search

With just one user in the database:
- ❌ Can't demonstrate multi-user search
- ❌ Can't show profile discovery
- ❌ Can't test follow functionality
- ❌ Limited social feed interactions

**Recommendation**: Add 3-5 test user profiles with different sports to properly test the social features.

## Future Enhancements

### 1. Public vs Private Profiles
Add a visibility flag to profiles:
```sql
ALTER TABLE profiles ADD COLUMN visibility TEXT
  DEFAULT 'public'
  CHECK (visibility IN ('public', 'private', 'friends'));
```

### 2. Search Performance
Add database indexes for common search fields:
```sql
CREATE INDEX idx_profiles_search ON profiles
  USING GIN (to_tsvector('english',
    coalesce(full_name, '') || ' ' ||
    coalesce(school, '') || ' ' ||
    coalesce(team, '')
  ));
```

### 3. Advanced Search
- Filter by sport, location, school
- Sort by followers, posts, rating
- Fuzzy matching for typos
- Recent searches history

## Verification Checklist

After applying the fix, verify:

- [ ] Search bar appears in navigation
- [ ] Typing shows loading spinner
- [ ] Results appear after 2+ characters
- [ ] Can click athlete to view their profile
- [ ] Can click post to view in feed
- [ ] "No results" message shows when no matches
- [ ] Clicking outside closes dropdown
- [ ] Search works for: name, email, school, sport

## Related Files

- `/src/components/SearchBar.tsx` - Search UI component
- `/src/app/api/search/route.ts` - Search API endpoint
- `/fix-search-visibility.sql` - RLS policy fix
- `/SECURITY_ARCHITECTURE.md` - Security documentation

## Support

If search still doesn't work after applying the fix:

1. Check browser console for errors
2. Check network tab for API response
3. Verify RLS policy was applied in Supabase dashboard
4. Ensure you're logged in (auth.role() = 'authenticated')
5. Try creating a test user profile to search for

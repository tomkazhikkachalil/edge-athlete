# Name Structure Migration Checklist

This document tracks all changes needed for the name structure refactor where:
- **OLD**: `full_name` = "John Doe" (display name)
- **NEW**: `first_name` + `middle_name` (optional) + `last_name` = "John Michael Doe" (display name)
- **NEW**: `full_name` = "johndoe" (username/handle)

## ✅ Database Changes

### Required SQL Migration
- [ ] **Run `COMPLETE_NAME_MIGRATION.sql` in Supabase SQL Editor**
  - Adds `middle_name` column to `profiles` table
  - Adds column comments for clarity
  - Includes verification queries

### Database Schema
```sql
profiles table:
- first_name (TEXT) - User's first/given name
- middle_name (TEXT) - User's middle name (optional) ← NEW
- last_name (TEXT) - User's last/family name
- full_name (TEXT) - Username/handle (e.g., johndoe)
- username (TEXT) - Alternative username if needed
```

## ✅ Backend API Changes

All API routes that query profiles have been updated to include `middle_name`:

### Updated API Routes
- [x] `/api/followers` (GET) - All 3 tabs: followers, following, requests
  - [x] Followers tab: Added middle_name to follower profile select
  - [x] Following tab: Added middle_name to following profile select
  - [x] Requests tab: Added middle_name to profile select (uses admin client)
- [x] `/api/search` - Added middle_name to athlete search query
- [x] `/api/suggestions` - Added middle_name to fallback suggestions query
- [x] `/api/follow/stats` - Cookie authentication fix
- [x] `/api/notifications` - Simplified queries
- [x] `/api/privacy/check` - Cookie authentication fix

### API Queries Summary
All these queries now include `first_name, middle_name, last_name, full_name`:

1. **Followers API** (`/api/followers/route.ts`)
   ```typescript
   // Line 57-69: Followers tab
   follower:follower_id (
     id, full_name, first_name, middle_name, last_name,
     avatar_url, sport, school
   )

   // Line 93-105: Following tab
   following:following_id (
     id, full_name, first_name, middle_name, last_name,
     avatar_url, sport, school
   )

   // Line 159-162: Requests tab (uses admin client)
   .select('id, first_name, middle_name, last_name, full_name,
           avatar_url, sport, school')
   ```

2. **Search API** (`/api/search/route.ts`)
   ```typescript
   // Line 38: Athletes search
   .select('id, full_name, first_name, middle_name, last_name,
           username, avatar_url, sport, school, location,
           email, bio, visibility')
   // Also searches middle_name in .or() clause
   ```

3. **Suggestions API** (`/api/suggestions/route.ts`)
   ```typescript
   // Line 33: Fallback suggestions
   .select('id, full_name, first_name, middle_name, last_name,
           avatar_url, sport, school, location')
   ```

## ✅ Frontend Component Changes

All components that display names have been updated to use new formatDisplayName signature:

### Updated Components
- [x] `/components/PostCard.tsx` - Post author display
- [x] `/components/FollowButton.tsx` - Follow button with status
- [x] `/components/PrivateProfileView.tsx` - Private profile view
- [x] `/components/SearchBar.tsx` - Search dropdown results
- [x] `/components/NotificationsDropdown.tsx` - Notification actors
- [x] `/components/EditProfileTabs.tsx` - Profile edit form
  - [x] Added first_name, middle_name, last_name input fields
  - [x] Changed full_name to "Username/Handle" label
  - [x] Added validation for required fields

### Updated Pages
- [x] `/app/feed/page.tsx` - Feed header profile display
- [x] `/app/athlete/page.tsx` - Logged-in user's profile page
- [x] `/app/athlete/[id]/page.tsx` - Public athlete profile page
- [x] `/app/app/followers/page.tsx` - Followers/Following/Requests page
- [x] `/app/app/notifications/page.tsx` - Notifications page

### formatDisplayName Usage
All instances updated from:
```typescript
// OLD
formatDisplayName(full_name, first_name, last_name)
```
To:
```typescript
// NEW
formatDisplayName(first_name, middle_name, last_name, full_name)
```

Total files updated: **17 files**

## ✅ Utility Functions

### Updated Functions
- [x] `/lib/formatters.ts`
  - [x] `formatDisplayName()` - New signature with middle_name
  - [x] `formatDisplayNameLegacy()` - Backwards compatibility function
  - [x] Both functions handle null/undefined gracefully

- [x] `/lib/supabase.ts`
  - [x] Added `middle_name?: string` to Profile interface
  - [x] Added comment clarifying full_name is now username

## 📋 Pre-Commit Checklist

Before committing and deploying:

### 1. Database Migration
- [ ] **CRITICAL**: Run `COMPLETE_NAME_MIGRATION.sql` in Supabase SQL Editor
- [ ] Verify middle_name column exists:
  ```sql
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'profiles'
  AND column_name = 'middle_name';
  ```
- [ ] Should return: `middle_name | text | YES`

### 2. Test Existing Users
- [ ] Check if existing users have first_name and last_name populated
- [ ] If not, users will show as "Unknown User" until they update their profile
- [ ] Consider running data migration if needed:
  ```sql
  -- Check users missing name data
  SELECT id, email, first_name, last_name, full_name
  FROM profiles
  WHERE first_name IS NULL OR last_name IS NULL
  LIMIT 20;
  ```

### 3. Code Verification
- [x] Build successful: `npm run build` ✓
- [ ] All formatDisplayName calls updated (search codebase)
- [ ] All API queries include middle_name field
- [ ] TypeScript types updated

### 4. Functional Testing (After Deploy)
- [ ] Test followers page - all 3 tabs load correctly
- [ ] Test following page - displays names correctly
- [ ] Test requests page - requester names show (not "Unknown User")
- [ ] Test search - finds users by all name parts
- [ ] Test profile editing - can save first/middle/last names
- [ ] Test notifications - actor names display correctly
- [ ] Test post cards - author names display correctly
- [ ] Test athlete profiles - names display without duplication

## 🔍 Known Issues & Solutions

### Issue: "Unknown User" on requests page
**Cause**: Profile doesn't have first_name/last_name populated
**Solutions**:
1. User needs to edit their profile and add their name
2. Or run SQL migration to populate from existing data
3. API now uses admin client to bypass RLS for viewing requester profiles

### Issue: "column profiles.middle_name does not exist"
**Cause**: Database migration not run yet
**Solution**: Run `COMPLETE_NAME_MIGRATION.sql` in Supabase SQL Editor

### Issue: Duplicate name display (e.g., "John Doe John Doe")
**Cause**: Using old formatDisplayName signature
**Solution**: All instances have been updated to new signature ✓

## 📦 Files Modified

### API Routes (6 files)
1. `/src/app/api/followers/route.ts`
2. `/src/app/api/search/route.ts`
3. `/src/app/api/suggestions/route.ts`
4. `/src/app/api/follow/stats/route.ts`
5. `/src/app/api/notifications/route.ts`
6. `/src/app/api/privacy/check/route.ts`

### Components (6 files)
1. `/src/components/PostCard.tsx`
2. `/src/components/FollowButton.tsx`
3. `/src/components/PrivateProfileView.tsx`
4. `/src/components/SearchBar.tsx`
5. `/src/components/NotificationsDropdown.tsx`
6. `/src/components/EditProfileTabs.tsx`

### Pages (5 files)
1. `/src/app/feed/page.tsx`
2. `/src/app/athlete/page.tsx`
3. `/src/app/athlete/[id]/page.tsx`
4. `/src/app/app/followers/page.tsx`
5. `/src/app/app/notifications/page.tsx`

### Utilities (2 files)
1. `/src/lib/formatters.ts`
2. `/src/lib/supabase.ts`

### New Files
1. `COMPLETE_NAME_MIGRATION.sql` - Database migration script
2. `NAME_MIGRATION_CHECKLIST.md` - This file
3. `add-middle-name.sql` - Original migration (superseded by COMPLETE_NAME_MIGRATION.sql)

**Total: 19 files modified + 3 new files**

## 🚀 Deployment Steps

1. **Pre-Deploy**
   - [x] Commit all code changes
   - [ ] Run database migration in Supabase
   - [ ] Verify migration successful

2. **Deploy**
   - [ ] Push code to repository
   - [ ] Deploy to production (Vercel/etc)

3. **Post-Deploy**
   - [ ] Test all functionality listed above
   - [ ] Monitor error logs for any issues
   - [ ] Check that existing users can still log in
   - [ ] Verify new users can sign up with name fields

## 📝 Notes

- **Backwards Compatible**: Code handles both old and new data structures
- **Graceful Fallbacks**: Shows "Unknown User" if name fields missing
- **Optional Middle Name**: middle_name can be null/undefined
- **RLS Safe**: Requests API uses admin client to bypass privacy restrictions for viewing requester info
- **Search Enhanced**: Now searches middle names too

## ✅ Ready to Commit?

Before running `git commit`:
- [ ] Database migration has been run in Supabase
- [ ] All checkboxes in "Pre-Commit Checklist" are checked
- [ ] Build is successful
- [ ] You understand the deployment steps

If all above are true, you're ready to commit! 🎉

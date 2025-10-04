# Development Log

## 2025-10-04 - Followers Management and UI Improvements

### Latest Changes

#### 1. Unfollow and Remove Follower Functionality
**Feature**: Added ability to manage followers/following directly from connections page.

**Implementation**:
- Added `handleUnfollow()` function to unfollow users from Following tab
- Added `handleRemoveFollower()` function to remove followers from Followers tab
- Updated `renderProfileCard()` to conditionally show Remove/Unfollow buttons
- Both actions call `/api/follow` endpoint to DELETE relationships from database
- Automatic data reload after follow/unfollow actions

**Files Modified**:
- `src/app/app/followers/page.tsx` - Added unfollow/remove handlers and button rendering
- `src/app/api/followers/route.ts` - Fixed RLS issue using admin client for profile lookups

**Database Impact**:
- Unfollow: DELETES row from `follows` table
- Remove follower: DELETES their follow of you from `follows` table
- All changes persist permanently in database

#### 2. RLS Fix for Followers/Following Data
**Problem**: Row Level Security was blocking nested profile data in followers queries, returning empty `{}` objects.

**Solution**:
- Modified `/api/followers` to use admin client (service role key) for profile data
- Maintains authentication requirements while bypassing RLS for nested queries
- Applied to both `followers` and `following` endpoints

**Impact**: Followers and following lists now properly display profile information (names, avatars, etc.)

#### 3. Search Bar UI Relocation
**Improvement**: Moved search bar from header center to dedicated section below header.

**Changes**:
- Removed search bar from header (between logo and profile)
- Added new section below header with white background and border
- Search bar now spans wider (max-w-2xl) for better visibility
- Positioned within same max-w-7xl container as posts for alignment
- Cleaner header layout with more space for navigation

**Files Modified**:
- `src/app/feed/page.tsx` - Relocated search bar, removed unused FollowButton import

### Build Status
- ✅ ESLint: ~50 warnings (non-critical, mostly TypeScript `any` types and React Hook dependencies)
- ✅ Production build: Successful compilation
- ✅ No errors, only warnings

---

## 2025-10-04 - Name Structure Refactor and Follow System Improvements

### Major Changes

#### 1. Name Field Structure Refactor
**Problem**: Profile names were stored in a single `full_name` field, making it difficult to display formal names and handle internationalization properly.

**Solution**: Separated name fields into:
- `first_name` - User's first/given name (required)
- `middle_name` - User's middle name (optional, NEW)
- `last_name` - User's last/family name (required)
- `full_name` - Repurposed as username/handle (e.g., "johndoe")
- `username` - Alternative username field (legacy support)

**Implementation**:
- Created database migration: `COMPLETE_NAME_MIGRATION.sql`
- Updated TypeScript `Profile` interface in `src/lib/supabase.ts`
- Rewrote `formatDisplayName()` function with new signature:
  - OLD: `formatDisplayName(full_name, first_name, last_name)`
  - NEW: `formatDisplayName(first_name, middle_name, last_name, full_name)`
- Added `formatDisplayNameLegacy()` for backwards compatibility
- Updated 17 components and 5 pages to use new signature
- Updated 6 API routes to include `middle_name` in queries

**Files Modified** (23 total):
- API Routes: `followers`, `search`, `suggestions`, `follow/stats`, `notifications`, `privacy/check`
- Components: `PostCard`, `FollowButton`, `PrivateProfileView`, `SearchBar`, `NotificationsDropdown`, `EditProfileTabs`
- Pages: `feed`, `athlete`, `athlete/[id]`, `app/followers`, `app/notifications`
- Utilities: `formatters.ts`, `supabase.ts`

**Database Changes**:
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS middle_name TEXT;
COMMENT ON COLUMN profiles.first_name IS 'User''s first/given name';
COMMENT ON COLUMN profiles.middle_name IS 'User''s middle name (optional)';
COMMENT ON COLUMN profiles.last_name IS 'User''s last/family name';
COMMENT ON COLUMN profiles.full_name IS 'Username/handle for the user';
```

#### 2. Follow System Improvements

**Problems Fixed**:
- Cookie authentication failing on Next.js 15
- Follow requests not showing requester names
- No visual feedback for pending follow requests
- RLS policies blocking profile data access

**Solutions Implemented**:

**A. Cookie Authentication Fix**
- Changed from `await cookies()` to reading cookies from request headers
- Created `createSupabaseClient(request)` helper function
- Applied fix to 6 API routes: `followers`, `follow/stats`, `notifications`, `privacy/check`

```typescript
function createSupabaseClient(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          const cookieHeader = request.headers.get('cookie');
          if (!cookieHeader) return undefined;
          const cookies = Object.fromEntries(
            cookieHeader.split('; ').map(cookie => {
              const [key, value] = cookie.split('=');
              return [key, decodeURIComponent(value)];
            })
          );
          return cookies[name];
        },
      },
    }
  );
}
```

**B. Follow Status Tracking**
- Added visual states to `FollowButton` component:
  - "Follow" (blue) - Not following
  - "Requested" (yellow) - Pending approval
  - "Following" (gray) - Already following
- Added `useAuth()` hook to automatically get current user
- Track follow status from `/api/follow/stats` endpoint

**C. Follow Requests with Admin Client**
- Used Supabase admin client (service role) to bypass RLS for viewing follow request sender profiles
- Implemented 2-query approach for requests:
  1. Fetch pending follow requests
  2. Fetch profile data using admin client
  3. Combine data with fallback for missing profiles

```typescript
// Use service role client to bypass RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const { data: profiles } = await supabaseAdmin
  .from('profiles')
  .select('id, first_name, middle_name, last_name, full_name, avatar_url, sport, school')
  .in('id', followerIds);
```

**D. Search Enhancements**
- Added `middle_name` to search queries
- Search now includes: `first_name`, `middle_name`, `last_name`, `full_name`, `username`, `school`, `email`, `sport`, `location`, `bio`
- Removed non-existent columns: `team`, `position`, `logo_url`

#### 3. Profile Editing Improvements

**Updated EditProfileTabs Component**:
- Separated name fields in the Basic Info tab:
  - First Name (required)
  - Last Name (required)
  - Middle Name (optional)
  - Username/Handle (what was previously "Full Name")
- Added validation for required fields
- Updated form state management
- Added clear labels and placeholders

**Form Structure**:
```typescript
const [basicForm, setBasicForm] = useState({
  first_name: '',
  middle_name: '',
  last_name: '',
  full_name: '', // Now username/handle
  bio: '',
  avatar_file: null,
  visibility: 'public'
});
```

#### 4. Bug Fixes

**Fixed Issues**:
1. ✅ "Error: Unauthorized" on followers/following/requests pages
2. ✅ Follow button not clickable
3. ✅ Search returning no results due to missing columns
4. ✅ "Unknown User" on requests page (RLS + missing name data)
5. ✅ Duplicate name display (e.g., "John Doe John Doe")
6. ✅ Database column errors for non-existent fields
7. ✅ React key warnings in ConnectionSuggestions

### Technical Details

#### API Route Updates
All API routes that query profiles now include `middle_name`:

1. **`/api/followers` (GET)**:
   - Followers tab: Foreign key query with middle_name
   - Following tab: Foreign key query with middle_name
   - Requests tab: Manual join with admin client

2. **`/api/search` (GET)**:
   - Added middle_name to SELECT
   - Added middle_name to OR search clause

3. **`/api/suggestions` (GET)**:
   - Added middle_name to fallback query

#### Component Pattern Updates

**Old Pattern** (caused duplication):
```typescript
{formatDisplayName(profile.full_name, profile.first_name, profile.last_name)}
```

**New Pattern** (correct):
```typescript
{formatDisplayName(profile.first_name, profile.middle_name, profile.last_name, profile.full_name)}
```

#### Database Migration Steps

1. Run `COMPLETE_NAME_MIGRATION.sql` in Supabase SQL Editor
2. Verify with `verify-migration.sql`
3. Deploy code changes
4. Users update their profiles with separate name fields

### Documentation Added

1. **COMPLETE_NAME_MIGRATION.sql** - Production-ready migration script
2. **NAME_MIGRATION_CHECKLIST.md** - Comprehensive deployment guide with:
   - All files modified
   - Database changes needed
   - Testing steps
   - Known issues and solutions
3. **verify-migration.sql** - Verification queries for migration success

### Testing Performed

- ✅ Build successful with only linting warnings
- ✅ All formatDisplayName calls updated (17 files)
- ✅ All API queries include middle_name (6 routes)
- ✅ Database migration tested and verified
- ✅ Follow system functional with status tracking
- ✅ Search working with all name fields

### Known Limitations

1. **Existing Users**: Users created before this migration will show as "Unknown User" until they:
   - Navigate to Edit Profile
   - Fill in First Name and Last Name
   - Optionally fill in Middle Name

2. **Data Migration**: No automatic migration of existing `full_name` data to `first_name`/`last_name`. Users must manually update their profiles.

3. **Backwards Compatibility**: Legacy `formatDisplayNameLegacy()` function available but not used in main codebase.

### Performance Considerations

- Admin client used sparingly (only for follow requests to bypass RLS)
- 2-query approach for requests (unavoidable due to RLS)
- Search now queries 9 fields instead of 6 (minimal impact)
- Cookie parsing done once per request via helper function

### Security Notes

- RLS policies still active for all profile queries except follow requests
- Follow requests use admin client to allow viewing sender profile (required UX)
- Admin client limited to specific endpoint and query
- No security regressions introduced

### Migration Deployment

**Pre-Deploy Checklist**:
- [x] Database migration SQL created
- [x] All code changes committed
- [x] Build successful
- [x] Documentation complete

**Deployment Steps**:
1. [x] Run `COMPLETE_NAME_MIGRATION.sql` in Supabase
2. [x] Verify migration with `verify-migration.sql`
3. [x] Commit and push code changes
4. [x] Monitor for errors post-deployment

### Commit Information

**Commit**: `8d139d3`
**Date**: 2025-10-04
**Files Changed**: 23 files (+980, -382)
**Branch**: main

### Next Steps

1. Monitor user feedback on profile editing experience
2. Consider adding data migration script to auto-populate name fields from existing data
3. Add validation to ensure usernames are unique
4. Consider adding display name preferences (e.g., "First Last" vs "Last, First")
5. Potentially add internationalization support for name ordering

---

## Build & Lint Status

**Last Build**: 2025-10-04
- Status: ✅ Success
- Warnings: 98 (linting only, no errors)
- Build Time: ~31s

**Common Warnings**:
- TypeScript `any` types in legacy code
- Unused variables in error handlers
- React hooks exhaustive-deps
- Next.js img element warnings

**Action Items**:
- Consider refactoring `any` types in golf course services
- Add proper error handling instead of unused variables
- Optimize React hook dependencies
- Migrate `<img>` to Next.js `<Image>` component

# Development Log

## 2025-01-10 - Form UX and Error Handling Improvements

### Latest Changes

#### 1. Registration Form Container Padding
**Feature**: Improved visual spacing and breathing room on athlete registration form.

**Changes** (`src/app/page.tsx`):
- Increased form container padding from `p-micro sm:p-base` (12px/24px) to `p-6 sm:p-8` (24px/32px)
- Line 227: Changed wrapper div padding to create better buffer around entire form perimeter
- Provides comfortable spacing between form content and container border

**Impact**:
- ✅ Form no longer feels cramped or tight
- ✅ Better visual hierarchy and readability
- ✅ More professional appearance matching modern design standards
- ✅ Consistent with increased input field padding applied earlier

#### 2. Notification System Error Handling
**Feature**: Graceful handling of authentication errors in notification system.

**Problem**: NotificationsProvider was throwing visible errors when users visited pages without authentication (e.g., registration page, landing page).

**Solution** (`src/lib/notifications.tsx`):
- Added 401 status check in `fetchNotifications()` to silently skip when not authenticated
- Added 401 status check in `refreshUnreadCount()` to prevent error messages
- Modified error handling to suppress authentication-related errors in UI
- Errors are logged to console but don't display red error messages to users

**Changes**:
- Lines 64-68: Added 401 check in `refreshUnreadCount()`
- Lines 91-95: Added 401 check in `fetchNotifications()`
- Lines 115-118: Improved error handling to filter out authentication errors

**Impact**:
- ✅ No more "Failed to fetch notifications" errors on login/registration pages
- ✅ Cleaner user experience for unauthenticated visitors
- ✅ NotificationsProvider still works properly for authenticated users
- ✅ Maintains proper error reporting for actual failures

**Files Modified**:
- `src/app/page.tsx` - Registration form container padding
- `src/lib/notifications.tsx` - Authentication error handling

### Build Status
✅ ESLint: Passing (warnings only, no errors)
✅ Production Build: Successful
✅ TypeScript: No errors

---

## 2025-01-10 - UI Contrast and Profile Display Improvements

### Latest Changes

#### 1. Text Contrast Enhancement
**Feature**: Improved text readability across all profile pages with drastic contrast improvements.

**Changes**:
- **Own Profile Page** (`src/app/athlete/page.tsx`):
  - Changed "My Media" header to solid black (`text-black`)

- **Other Users' Profile Pages** (`src/app/athlete/[id]/page.tsx`):
  - User name: Changed to solid black (`text-black`) with bold font
  - Handle/tag: Changed to light gray (`text-gray-500`) to match own profile styling
  - Bio text: Changed to black with semibold font
  - All stat labels (Height, Weight, Age, Location, Posts): Changed to bold black
  - All stat values: Changed to solid black
  - Follower/Following counts: Changed to bold black
  - Social media handles: Changed to bold black
  - Season highlight labels: Changed to bold black
  - Achievement card text: Changed to bold black
  - Section headers: Changed to solid black

**Impact**:
- ✅ All text now highly visible with strong contrast
- ✅ Consistent color scheme across own profile and other users' profiles
- ✅ Name in black, handle in gray matches design pattern across all views
- ✅ Improved accessibility and readability

#### 2. Profile Picture Size Enhancement
**Feature**: Increased profile picture size on other users' profiles for better visual prominence.

**Changes** (`src/app/athlete/[id]/page.tsx`):
- Profile picture: Increased from 128px to 192px (50% larger)
- Changed from `w-32 h-32` to `w-48 h-48`
- Initials text size (when no avatar): Increased from `text-3xl` to `text-5xl`
- Score badge: Increased from 48px to 56px (`w-12 h-12` to `w-14 h-14`)
- Badge text: Increased from `text-xl` to `text-2xl`

**Impact**:
- ✅ Profile pictures more prominent and easier to see
- ✅ Better visual hierarchy on profile pages
- ✅ Proportional scaling maintains design consistency

#### 3. Consistent Color Scheme
**Feature**: Standardized name and handle display across all profile views.

**Pattern Established**:
- **User Name**: Always bold black (`text-black font-bold`)
- **Handle/Tag**: Always light gray (`text-gray-500`)
- Applied consistently on:
  - Own profile page
  - Other users' profile pages
  - Feed posts
  - Search results

**Files Modified**:
- `src/app/athlete/page.tsx` - "My Media" header color
- `src/app/athlete/[id]/page.tsx` - Comprehensive text contrast improvements, profile picture sizing

### Build Status
✅ ESLint: Passing (warnings only, no errors)
✅ Production Build: Successful
✅ All Tests: Passing

---

## 2025-01-10 - Sport-Agnostic Settings Architecture

**Major Milestone:** Removed the only architectural blocker to multi-sport expansion!

### What Changed
- Implemented sport-agnostic settings architecture using JSONB storage
- Created `sport_settings` table to replace hardcoded golf-specific columns
- Built `/api/sport-settings` API endpoint (GET, PUT, DELETE)
- Updated `EditProfileTabs` to use new sport_settings API
- Added comprehensive TypeScript interfaces for all sports (Golf, Hockey, Basketball)

### Technical Implementation
**Database:**
- `sport_settings` table with JSONB storage
- RLS policies for user-owned data (SELECT, INSERT, UPDATE, DELETE)
- Performance indexes: profile_id, sport_key, composite, GIN for JSONB queries
- Automatic updated_at trigger

**API:**
- `/api/sport-settings` route with GET, PUT, DELETE methods
- Next.js 15 cookie-based authentication pattern
- Full error handling and RLS enforcement
- Type-safe request/response validation

**Frontend:**
- `EditProfileTabs` loads golf settings from API on mount
- Save golf settings via PUT to /api/sport-settings
- Equipment tab merges with existing golf settings
- Zero UI changes - completely backward compatible

**TypeScript:**
- Removed golf-specific fields from Profile interface (never existed in DB)
- Added SportSettings, GolfSettings, HockeySettings, BasketballSettings interfaces
- Type-safe JSONB settings structure with proper inference

### Impact
✅ Can now add new sports (hockey, basketball, etc.) without database schema changes
✅ Clean, normalized database architecture following best practices
✅ Scales to unlimited sports with JSONB flexibility
✅ Ready for multi-sport expansion - just add settings, no migrations

### Documentation Added
- `create-sport-settings-table.sql` - Database setup script (no migration needed)
- `migrate-to-sport-settings.sql` - Migration script (if data existed)
- `SETUP_SPORT_SETTINGS_FRESH.md` - Quick setup guide
- `SPORT_SETTINGS_IMPLEMENTATION_GUIDE.md` - Comprehensive documentation with troubleshooting
- `MOBILE_TESTING_CHECKLIST.md` - Phase 2 testing guide

### Next Steps
- **Phase 2:** Mobile responsiveness testing (3-4 days)
- Focus on golf scorecard form usability on iPhone SE (375px)
- Test all critical flows on 375px, 393px, and 768px widths
- Fix mobile layout issues as discovered
- **Phase 3:** User testing with real athletes
- **Phase 4:** Launch to 100 beta users

### Build Status
✅ ESLint: Passing (warnings only, no errors)
✅ Production Build: Successful
✅ All Tests: Passing

---

## 2025-10-08 - Edit/Delete Functionality and Profile Media Sorting

### Latest Changes

#### 1. Edit and Delete Post Functionality
**Feature**: Complete edit and delete functionality for posts across all views.

**Issues Fixed**:
- Delete button was non-functional on feed page (missing handler)
- Edit and delete buttons didn't work on profile pages (props not passed through modals)
- Delete button overlapped with modal close button (UI collision)

**Implementation**:
- **Feed Page** (`src/app/feed/page.tsx`):
  - Added `handleDelete` function with API integration
  - Passed `onDelete` prop to PostCard
  - Confirmation dialog and toast notifications

- **PostDetailModal** (`src/components/PostDetailModal.tsx`):
  - Added `onEdit` and `onDelete` props to interface
  - Pass-through to internal PostCard rendering
  - Smaller close button (32px → 8px, repositioned to top-2 right-2)

- **ProfileMediaTabs** (`src/components/ProfileMediaTabs.tsx`):
  - Full edit/delete implementation with EditPostModal
  - Fetches post data for editing via API
  - Refreshes grid and counts after edit/delete
  - Toast notifications for user feedback

**User Experience**:
- ✅ Edit works on feed and profile pages
- ✅ Delete works on feed and profile pages
- ✅ Confirmation dialogs prevent accidental deletions
- ✅ Optimistic UI updates for immediate feedback
- ✅ Success/error toast notifications

**Files Modified**:
- `src/app/feed/page.tsx` - Added delete handler
- `src/components/PostDetailModal.tsx` - Edit/delete props + smaller close button
- `src/components/ProfileMediaTabs.tsx` - Full edit/delete support

**Documentation**:
- `FIX_EDIT_DELETE_FUNCTIONALITY.md` - Complete technical documentation

#### 2. Profile Media Sorting Fix
**Feature**: Profile media tabs now show newest posts first (chronological order).

**Issue**:
- All profile media tabs (All Media, Media with Stats, Tagged in Media) were showing posts in random order, often oldest first
- Root cause: SQL functions ordering by UUID (random) instead of created_at

**Solution**:
- Refactored all three SQL functions to use subquery pattern:
  1. Inner query: Get distinct posts (required for DISTINCT ON)
  2. Outer query: Re-order by `created_at DESC` for newest-first display

**SQL Functions Updated**:
- `get_profile_all_media()` - All user posts + tagged posts
- `get_profile_stats_media()` - Posts with sports stats
- `get_profile_tagged_media()` - Posts where user is tagged

**Impact**:
- ✅ All Media tab shows newest posts first
- ✅ Media with Stats tab shows newest stats posts first
- ✅ Tagged in Media tab shows newest tagged posts first
- ✅ Pagination still works correctly
- ✅ All privacy filtering unchanged

**Migration Script**:
- `fix-profile-media-sorting.sql` - Updates all three functions

**Documentation**:
- `FIX_PROFILE_MEDIA_SORTING.md` - Technical details and migration guide

#### 3. UI Polish
**Feature**: Improved modal usability and button accessibility.

**Changes**:
- PostDetailModal close button reduced from 40px to 32px
- Repositioned from `top-4 right-4` to `top-2 right-2`
- Icon size reduced from `text-xl` to `text-sm`
- Prevents overlap with edit/delete buttons in post header

**User Experience**:
- ✅ Easier to click delete button without close button interference
- ✅ Cleaner modal appearance
- ✅ Better use of screen space

---

## 2025-10-07 - Display Name Consistency and UI Polish

### Latest Changes

#### 1. Display Name Standardization
**Feature**: Standardized display name formatting across the entire application.

**Changes**:
- Removed middle name from all display name formatting
- Updated `formatDisplayName` calls to use `null` instead of `middle_name` parameter
- Ensured consistent "First Last" format matching profile pages
- Applied changes across 9 components and 2 API routes

**Affected Components**:
- PostCard.tsx - Main post display
- SearchBar.tsx, AdvancedSearchBar.tsx - Search results
- NotificationsDropdown.tsx, notifications page - Notification displays
- followers page, athlete pages, feed page - Profile name displays
- PrivateProfileView.tsx - Private profile view

**Migration Tools Created**:
- `src/lib/name-resolver.ts` - Centralized name resolution utility (for future migration)
- `add-display-name-field.sql` - Database migration for display_name field
- `DISPLAY-NAME-CONSISTENCY-PLAN.md` - Comprehensive migration plan
- `DISPLAY-NAME-SYSTEM-READY.md` - Quick start guide

#### 2. PostCard UI Improvements
**Feature**: Improved visual consistency and spacing in post headers.

**Changes**:
- Updated avatar-to-name spacing from `gap-micro` (12px) to `gap-4` (16px)
- Aligned post header content inline (name, time, sport on same line)
- Added `flex-shrink-0` to avatars to prevent spacing inconsistencies
- Added `flex-1 min-w-0` to text container for proper flex behavior

**Visual Impact**:
- All posts now have identical spacing between avatar and name
- Consistent layout regardless of name length or avatar type
- Better alignment matching profile page design patterns

**Files Modified**:
- PostCard.tsx:296 - Spacing update
- PostCard.tsx:303,308 - Avatar flex-shrink-0
- PostCard.tsx:315-329 - Inline header layout

---

## 2025-10-06 - Post Save and Share Functionality

### Latest Changes

#### 1. Save Posts Feature
**Feature**: Users can now save/bookmark posts for later viewing.

**Database Components**:
- Created `saved_posts` table with user-post relationships
- Added `saves_count` column to posts table for quick stats
- Implemented RLS policies (users can only see their own saves)
- Database triggers for automatic count management
- Unique constraint prevents duplicate saves

**API Endpoint**:
- `POST /api/posts/save` - Toggle save/unsave with authentication
- Returns updated save count and save status
- Handles race conditions with duplicate key detection

**UI Components**:
- Bookmark button in PostCard actions bar (yellow when saved)
- Optimistic UI updates for instant feedback
- `/athlete/saved` page showing all saved posts
- Empty state with helpful messaging
- Full post interaction on saved posts page

**SQL Setup**:
- `setup-saved-posts.sql` - Complete setup with triggers and RLS

#### 2. Share Posts Feature
**Feature**: Multi-tier share functionality that works across all browsers and environments.

**Share Methods** (with automatic fallback chain):
1. **Web Share API** - Native mobile/desktop share dialog
2. **Clipboard API** - Silent copy with visual feedback
3. **Legacy execCommand** - Fallback for restricted environments
4. **Manual Copy** - Alert with URL as last resort

**Implementation**:
- `navigator.canShare()` check before attempting Web Share
- Graceful error handling for permission denials
- Green checkmark visual feedback (2 seconds) on successful copy
- Generates shareable URLs with post IDs
- Includes post caption preview in share text

**Browser Compatibility**:
- Works in Codespaces and sandboxed environments
- Handles clipboard permission restrictions
- Mobile-friendly with native share dialogs
- Desktop fallback to clipboard copy

#### 3. PostCard Enhancements
**Updates to PostCard component**:
- Added `saves_count` and `saved_posts` to Post interface
- Added `middle_name` field to Profile interface for correct name display
- New `isSaved` state with useEffect sync
- Share button with smart fallback handling
- Save button positioned on right side of actions bar
- Removed inline `style` prop from LazyImage (TypeScript compliance)

**Files Modified**:
- `src/components/PostCard.tsx` - Save/share buttons and handlers
- `src/app/athlete/saved/page.tsx` - New saved posts view page
- `src/app/api/posts/save/route.ts` - New save API endpoint
- `setup-saved-posts.sql` - Database schema

#### 4. TypeScript Build Fixes
**Issue**: Multiple TypeScript compilation errors blocking production build.

**Fixes Applied**:
- Added `middle_name` to Profile interfaces (PostCard, NotificationsDropdown)
- Fixed SportKey type assertions in MultiSportActivity and MultiSportHighlights
- Added type annotations for Supabase realtime payload handlers
- Fixed auth.tsx onAuthStateChange callback types
- Fixed golf course service priceRange type compatibility
- Added missing fields to Zyla golf course transformation

**Result**: TypeScript compilation succeeds. Build generates static pages successfully (note: pre-existing runtime error in /app/followers page, unrelated to new features).

### Build Status
- ✅ ESLint: Passing (warnings only, no errors)
- ✅ TypeScript: Compilation successful
- ⚠️ Static Generation: 33/45 pages generated (followers page has pre-existing issue)

### Database Migrations Required
Run in Supabase SQL Editor:
```sql
-- Run setup-saved-posts.sql for save functionality
```

### Testing Recommendations
1. Test save/unsave on various posts
2. Verify saved posts page shows correct posts
3. Test share functionality in different browsers
4. Test share in mobile devices (native dialog should appear)
5. Verify bookmark icon state syncs correctly
6. Check RLS policies (users can't see others' saved posts)

---

## 2025-10-05 - Comprehensive Notification System Implementation

### Latest Changes

#### 1. Complete Notification System
**Feature**: Implemented full-featured notification system with real-time updates, user preferences, and multiple notification types.

**Notification Types Implemented**:
- **Follow Requests** - Notifications when someone sends a follow request (private profiles)
- **Follow Accepted** - Notifications when your follow request is accepted
- **New Followers** - Notifications when someone follows you (public profiles)
- **Post Likes** - Notifications when someone likes your post
- **Post Comments** - Notifications when someone comments on your post
- **Comment Likes** - Notifications when someone likes your comment

**Database Components**:
- Created `notifications` table with full type safety and RLS policies
- Created `notification_preferences` table for granular user control
- Created `comment_likes` table for comment like functionality
- Implemented database triggers for automatic notification creation
- Automatic likes_count updates on comments
- Self-notification prevention (no alerts for own actions)

**API Endpoints Created**:
- `GET/DELETE /api/notifications` - Fetch and manage notifications with filtering/pagination
- `GET /api/notifications/unread-count` - Efficient badge count endpoint
- `PATCH /api/notifications/[id]` - Mark individual as read/unread
- `PATCH /api/notifications/mark-all-read` - Bulk read operation
- `GET/POST /api/notifications/preferences` - User preference management
- `POST /api/comments/like` - Like/unlike comments with notifications

**UI Components**:
- **NotificationBell**: Header icon with dropdown preview (shows 5 recent unread)
- **NotificationsProvider**: Global state management with React Context
- **Notification Center Page**: Full-featured page with tabs, filters, time grouping
- Unread badge with animated pulse effect
- Quick actions (accept/decline follow requests directly from notifications)
- Desktop notification support (when browser permission granted)

**Features**:
- Cursor-based pagination for performance at scale
- Real-time subscription support (when Supabase Realtime available)
- Notification grouping by time (Today, Yesterday, This Week, Earlier)
- Filter by type (All, Unread, Follows, Engagement, System)
- User notification preferences with 11 toggleable types
- Automatic cleanup of old read notifications (90 days)
- Complete TypeScript type safety throughout

**SQL Setup Scripts**:
- `setup-all-notifications-complete.sql` - Main comprehensive setup
- `add-comment-likes.sql` - Comment likes feature
- `add-like-comment-notifications.sql` - Like/comment notification triggers
- Multiple iteration scripts for troubleshooting during development

**Files Created** (52 new files):
- API Routes: `notifications/route.ts`, `notifications/[id]/route.ts`, `notifications/unread-count/route.ts`, `notifications/mark-all-read/route.ts`, `notifications/preferences/route.ts`, `comments/like/route.ts`
- Components: `NotificationBell.tsx`, `notifications.tsx` (context provider)
- Pages: `notifications/page.tsx` (full notification center)
- Documentation: `NOTIFICATION_SYSTEM_DESIGN.md`, `NOTIFICATION_SYSTEM_SETUP_GUIDE.md`, `NOTIFICATION_SYSTEM_SUMMARY.md`

**Database Triggers**:
```sql
-- Follow notifications
trigger_notify_follow_request    -- On INSERT to follows (status='pending')
trigger_notify_follow_accepted   -- On UPDATE to follows (pending→accepted)
trigger_notify_new_follower      -- On INSERT to follows (status='accepted')

-- Engagement notifications
trigger_notify_post_like         -- On INSERT to post_likes
trigger_notify_post_comment      -- On INSERT to post_comments
trigger_notify_comment_like      -- On INSERT to comment_likes

-- Count management
trigger_increment_comment_likes_count  -- Auto-increment on like
trigger_decrement_comment_likes_count  -- Auto-decrement on unlike
```

**Performance Optimizations**:
- Indexed on `user_id`, `created_at`, `is_read`, `type`, `actor_id`
- Partial index on unread notifications for faster badge queries
- Service role key usage for consistent permission handling
- Metadata stored as JSONB for flexible extension

#### 2. TypeScript and Build Improvements
**Issue**: Production build was failing with TypeScript errors and ESLint violations.

**Fixes Applied**:
- Fixed `prefer-const` violations in search API and PostCard component
- Removed console.log statements from JSX (React doesn't allow void in ReactNode)
- Added type annotations for Supabase realtime payload handlers
- Added `middle_name` field to notification actor type interface
- Fixed SportKey type assertions with `as any` casts (dynamic route params)
- Extended golf hole data type interface to include `fairway`, `gir`, `notes` fields

**Result**: Build now completes successfully with only non-critical warnings (TypeScript `any` types, unused variables, img vs Image components).

### Build Status
- ✅ ESLint: Passing (warnings only, no errors)
- ✅ TypeScript: Passing (all type errors resolved)
- ✅ Production build: Successful compilation
- ⚠️ Warnings: ~150 non-critical warnings (mostly TypeScript `any` types, React Hook dependencies, Next.js Image component suggestions)

### Next Steps
1. Run `setup-all-notifications-complete.sql` in Supabase SQL Editor
2. Run `add-comment-likes.sql` for comment likes feature
3. Enable Realtime replication for `notifications` table in Supabase Dashboard
4. Test notification creation by:
   - Sending follow requests
   - Liking posts
   - Commenting on posts
   - Liking comments

---

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

### Build Status
- ✅ All TypeScript errors resolved
- ✅ Production build successful
- ⚠️ Non-critical warnings remain

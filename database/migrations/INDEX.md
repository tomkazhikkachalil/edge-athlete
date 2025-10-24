# Database Migration Index

## Chronological Migration History

This index lists all database migrations in the order they should be executed.

---

### 001_initial_setup.sql
**Original**: `supabase-setup.sql`
**Date**: Initial setup
**Description**: Complete Supabase database initialization
- Core tables (profiles, posts, post_media, comments, likes)
- Row Level Security (RLS) policies
- Storage buckets (avatars, post-media)
- Essential database functions
- Initial indexes and constraints

**Tables Created**:
- `profiles` - User profiles extending auth.users
- `posts` - Social media posts
- `post_media` - Media attachments
- `post_comments` - Threaded comments with likes
- `post_likes` - Post like tracking
- `comment_likes` - Comment like tracking
- `follows` - Follow relationships
- `notifications` - User notifications
- `notification_preferences` - User notification settings

---

### 002_golf_schema.sql
**Original**: `COMPLETE_GOLF_SETUP.sql`
**Date**: Golf feature implementation
**Description**: Complete golf feature with rounds and scorecards
- Golf rounds table with statistics
- Hole-by-hole scoring
- Course data integration
- Indoor/outdoor round support
- Flexible hole count (not limited to 9/18)

**Tables Created**:
- `golf_rounds` - Golf round metadata
- `golf_holes` - Individual hole scores
- `golf_courses` - Course database

**Features**:
- Automatic stats calculation (pars, birdies, eagles, GIR, FIR)
- Par calculation from actual holes played
- Round type tracking (indoor/outdoor)

---

### 003_notifications.sql
**Original**: `setup-all-notifications-complete.sql`
**Date**: Notification system implementation
**Description**: Comprehensive notification system
- Database triggers for auto-notifications
- Real-time notification support
- Notification preferences (11 types)
- Cursor-based pagination

**Notification Types**:
- `follow_request` - Private profile follow requests
- `follow_accepted` - Request approved
- `new_follower` - New follower (public profiles)
- `post_like` - Post liked
- `post_comment` - Post commented on
- `comment_like` - Comment liked
- And more...

**Functions**:
- `create_notification()` - Core notification creator
- Auto-cleanup of old read notifications (90 days)
- Self-notification prevention

---

### 004_group_posts.sql
**Original**: `setup-group-posts-foundation.sql`
**Date**: Shared scorecards implementation
**Description**: Multi-player golf rounds (shared scorecards)
- Group post infrastructure
- Participant attestation system
- Golf scorecard data tables
- Participant score tracking

**Tables Created**:
- `group_posts` - Core group activity table
- `group_post_participants` - Participant tracking
- `golf_scorecard_data` - Scorecard metadata
- `golf_participant_scores` - Individual scores
- `golf_hole_scores` - Hole-by-hole scores

**Features**:
- Collaborative round entry
- Participant confirmation/decline
- Auto-calculated totals
- Traditional scorecard display

---

### 005_name_migration.sql
**Original**: `COMPLETE_NAME_MIGRATION.sql`
**Date**: Name structure refactor
**Description**: Separated name fields for better data structure
- Split into first_name, middle_name, last_name
- Maintained full_name as username/handle
- Data migration from old structure
- Updated all dependent functions

**Changes**:
- Added `first_name`, `middle_name`, `last_name` columns
- Repurposed `full_name` as username
- Updated formatDisplayName() function
- Migrated existing user data

---

### 006_handles_system.sql
**Original**: `setup-handles-system.sql`
**Date**: @handle username system
**Description**: Unique @handle identifiers for users
- Added `handle` column to profiles
- Unique constraint on handles
- Handle validation function
- Profile lookup by handle

**Features**:
- Unique @handle identifiers
- 3-20 characters (letters, numbers, dots, underscores)
- Case-insensitive uniqueness
- `/u/[handle]` route support

---

### 007_saved_posts.sql
**Original**: `setup-saved-posts.sql`
**Date**: Saved posts feature
**Description**: Bookmark/save posts for later
- Saved posts table
- RLS policies for privacy
- Cascade delete on post removal
- Duplicate save prevention

**Tables Created**:
- `saved_posts` - User bookmarked posts

**Features**:
- Users can save/bookmark posts
- View saved posts collection
- Automatic cleanup when post deleted

---

### 008_tagging_system.sql
**Original**: `setup-tagging-system.sql`
**Date**: User tagging implementation
**Description**: Tag other users in posts
- Post tags table
- Tag notifications
- Tagged posts view
- Privacy-aware tagging

**Tables Created**:
- `post_tags` - User tags in posts

**Features**:
- Tag users in posts (@mention)
- View posts you're tagged in
- Notification on tag
- RLS for privacy

---

## Feature Additions

### Golf Feature Files (`/features/golf/`)
- `add-flexible-golf-rounds.sql` - Support any hole count (5, 9, 12, 18, etc.)
- `add-golf-round-conditions.sql` - Weather, temperature, wind tracking
- `add-golf-round-to-posts.sql` - Link rounds to social posts
- `add-round-id-to-profile-media-functions.sql` - Profile media integration
- `setup-shared-golf-scorecards.sql` - Multi-player rounds
- `fix-golf-par-calculation.sql` - Accurate par from actual holes

### Notification Feature Files (`/features/notifications/`)
- `add-like-comment-notifications.sql` - Notification triggers
- `add-comment-likes.sql` - Comment like feature with notifications

### Search Feature Files (`/features/search/`)
- `add-fulltext-search-indexes-fixed.sql` - Full-text search indexes
- `add-fulltext-search-indexes.sql` - Original search implementation
- `add-fulltext-search-simple.sql` - Simplified search
- `setup-search-compact.sql` - Compact search setup

### Tagging Feature Files (`/features/tagging/`)
- `create-test-profiles-for-tagging-fixed.sql` - Test data for tagging
- `create-test-profiles-for-tagging.sql` - Original test data

---

## Testing & Diagnostics

### Verification (`/tests/verification/`)
Scripts to verify database setup and health

### Test Data (`/tests/test-data/`)
Scripts to create test users and sample data

### Diagnostics (`/tests/diagnostics/`)
Debug scripts for troubleshooting specific issues

---

## Archive

### Old Migrations (`/archive/old-migrations/`)
Historical migrations and superseded files (not for use in new setups)

### Failed Attempts (`/archive/failed-attempts/`)
Abandoned or broken migration attempts (preserved for reference)

---

## Migration Notes

### Performance Optimizations
- RLS policies use `(select auth.uid())` pattern for performance
- Function search paths set to `''` for security
- Schema-qualified table names in all functions
- Proper indexes on frequently queried columns

### Security
- Row Level Security enabled on all tables
- Privacy system (public/private profiles)
- Service role bypasses RLS for admin operations
- Secure function execution with SECURITY DEFINER

### Best Practices Applied
- Idempotent migrations (IF NOT EXISTS)
- Automatic count management (triggers)
- Cascade deletes where appropriate
- Proper foreign key constraints

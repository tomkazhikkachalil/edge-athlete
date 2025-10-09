# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **multi-sport athlete social network platform** built with Next.js 15, Supabase, and TypeScript. It allows athletes to create profiles, share posts with media, track performance statistics, and connect with other athletes. The platform is designed to be sport-agnostic with a flexible adapter pattern that currently supports Golf fully, with other sports (ice hockey, volleyball) registered but not yet implemented.

## Development Commands

```bash
npm run dev          # Start development server (http://localhost:3000)
npm run build        # Production build (checks TypeScript and builds)
npm run start        # Start production server
npm run lint         # Run ESLint
```

## Environment Setup

Required environment variables (see `.env.example`):

```bash
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=  # Server-side only

# OpenAI (optional - for AI features)
OPENAI_API_KEY=

# Email (optional - for contact forms)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
```

## Architecture & Code Structure

### App Router Structure

- **`src/app/`** - Next.js 15 App Router pages
  - **`feed/`** - Main feed with posts from followed athletes
  - **`athlete/[id]/`** - Individual athlete profile pages (by user ID)
  - **`u/[username]/`** - Profile pages accessible by username
  - **`app/profile/`** - Logged-in user's own profile editor
  - **`app/followers/`** - Followers, following, and follow requests management
  - **`app/sport/[sport_key]/`** - Sport-specific pages and forms
  - **`dashboard/`** - Admin dashboard
  - **`api/`** - API routes (posts, comments, likes, search, upload, etc.)

### Key Libraries & Utilities

- **`src/lib/supabase.ts`** - Supabase client setup
  - `supabase` - Browser client (SSR-compatible with cookies)
  - `supabaseAdmin` - Server-side client with service role (bypasses RLS)
  - TypeScript interfaces for all database tables

- **`src/lib/auth.tsx`** - Authentication context provider
  - `useAuth()` hook for accessing user/profile
  - Handles sign up, sign in, sign out, profile updates
  - Manages session state and profile caching

- **`src/middleware.ts`** - Supabase auth middleware
  - Refreshes sessions on every request
  - Required for SSR authentication

### Sport Adapter Pattern

**Location:** `src/lib/sports/`

The platform uses a **sport adapter pattern** to handle sport-specific logic:

```
src/lib/sports/
├── SportRegistry.ts      # Central registry of all sports
├── SportAdapter.ts       # Base adapter interface
├── AdapterRegistry.ts    # Maps sport keys to adapters
└── adapters/
    └── GolfAdapter.ts    # Golf implementation
```

**Key Concepts:**

1. **SportRegistry** defines all sports with:
   - `sport_key` (unique identifier like 'golf', 'ice_hockey')
   - `display_name`, `icon`, `brand_color_token`
   - `metric_labels` (tile1-6 labels for stats)

2. **SportAdapter interface** standardizes how sports work:
   - `getHighlights(profileId, season)` - Returns stat tiles
   - `getRecentActivity(profileId, limit, cursor)` - Returns activity rows
   - `openEditDialog(entityId)` - Opens sport-specific forms
   - `composePost(context)` - Creates sport-specific posts

3. **Implementation states:**
   - **Fully implemented:** Golf (with rounds, scorecards, course data)
   - **Registered but disabled:** Ice hockey, volleyball (show "coming soon")
   - **To add new sport:** Register in SportRegistry → Create adapter → Enable in features.ts

### Design System

**Location:** `src/lib/design-tokens.ts`

Strict design system with enforced tokens:

- **Typography Scale:** 32/24/18/16/14/12px (H1/H2/H3/Body/Label/Chip)
- **Spacing Rhythm:** 12px (micro) / 24px (base) / 48px (section)
- **Icon Sizes:** 24px (header) / 20px (edit/social) / 16px (footer)
- **Card Heights:** Fixed 280px minimum with 80px header, flexible stats, 32px footer

**Usage:**
```typescript
import { TYPOGRAPHY, SPACING, LAYOUT, getSportColorClasses } from '@/lib/design-tokens';

const colors = getSportColorClasses('golf'); // Returns sport-specific color classes
```

### Privacy & Security Architecture

**Privacy System (`src/lib/privacy.ts`):**

- **Simple model:** Public or Private profiles
- **Access control:** Private profiles visible only to owner + approved followers
- **RLS enforcement:** Database-level Row Level Security on all tables
- **Future-ready:** Schema supports granular controls (media, stats, posts visibility)

**IMPORTANT: Privacy checks must be done server-side**
- Privacy functions require `supabaseAdmin` (service role key)
- **Client-side usage:** Call `/api/privacy/check?profileId={id}` API endpoint
- **Server-side usage:** Import and call `canViewProfile(profileId, currentUserId)` directly

**Key functions:**
```typescript
// Server-side only (API routes, server components)
canViewProfile(profileId, currentUserId) // Returns access check result
getProfileWithPrivacy(profileId, currentUserId) // Returns limited or full profile

// Client-side: Use API endpoint
const response = await fetch(`/api/privacy/check?profileId=${athleteId}`);
const { canView } = await response.json();
```

**Database Security:**
- All tables have RLS enabled
- Policies enforce owner-only access for private data
- Service role key (`supabaseAdmin`) bypasses RLS for admin operations
- Storage buckets organized by user ID with path-based policies

See [PRIVACY_ARCHITECTURE.md](PRIVACY_ARCHITECTURE.md) and [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) for details.

### Database Structure

**Core Tables:**
- `profiles` - User profiles (extends auth.users)
- `posts` - Social posts with media, stats, visibility
- `post_media` - Media attachments (images/videos)
- `post_comments` - Post comments with threading and likes_count
- `post_likes` - Post likes (unique constraint per user)
- `comment_likes` - Comment likes (unique constraint per user/comment)
- `saved_posts` - Bookmarked posts (unique constraint per user/post)
- `follows` - Follow relationships with status (pending/accepted)
- `notifications` - User notifications with type, actor, and metadata
- `notification_preferences` - User notification preferences (11 types)
- `golf_rounds` - Golf-specific round data
- `golf_holes` - Individual hole scores
- `season_highlights` - Sport performance highlights per season
- `performances` - Individual performance records
- `athlete_badges` - Achievement badges

**Important Patterns:**
- Foreign keys cascade on delete
- `updated_at` triggers auto-update timestamps
- Counts cached in `posts` table (likes_count, comments_count, saves_count)
- Visibility column controls privacy ('public' or 'private')

**SQL Files:** Root directory contains many `.sql` migration files. Key ones:
- `supabase-setup.sql` - Initial setup
- `implement-privacy-system.sql` - Privacy implementation
- `setup-saved-posts.sql` - Saved posts functionality
- `COMPLETE_GOLF_SETUP.sql` - Golf schema
- `fix-likes-comments-issues.sql` - Latest count fixes
- `COMPLETE_NAME_MIGRATION.sql` - Name structure refactor (separate first/middle/last names)
- `setup-all-notifications-complete.sql` - Comprehensive notification system setup
- `add-comment-likes.sql` - Comment likes feature with triggers

### Feature Flags

**Location:** `src/lib/features.ts`

Controls which features are enabled:

```typescript
FEATURE_FLAGS = {
  FEATURE_SPORTS: ['golf', 'ice_hockey', 'volleyball']
}

isSportEnabled(sportKey) // Check if sport is active
getEnabledSportKeys()    // Get all enabled sports
```

Toggle sports here to enable/disable throughout UI.

### Key Components

**Location:** `src/components/`

- **PostCard.tsx** - Main post display with likes, comments, saves, shares, media carousel. Uses inline header layout with consistent gap-4 spacing between avatar and name
- **CreatePostModal.tsx** - Multi-step post creation wizard
- **EditPostModal.tsx** - Post editing modal
- **EditProfileTabs.tsx** - Profile editor with Basic Info/Sports/Achievements tabs
- **SearchBar.tsx** - Global search (athletes, posts, clubs) with dropdown results
- **FollowButton.tsx** - Follow/unfollow with request handling
- **PrivateProfileView.tsx** - Restricted view for private profiles
- **GolfScorecardForm.tsx** - Golf round entry with hole-by-hole scoring
- **SeasonHighlights.tsx / SeasonHighlightsModal.tsx** - Sport performance tracking
- **NotificationBell.tsx** - Notification dropdown in header with unread badge
- **notifications.tsx** - NotificationsProvider context for global state
- **Toast.tsx** - Toast notification system

### API Patterns

**API Routes (`src/app/api/`):**

**IMPORTANT: Next.js 15 Cookie Authentication Pattern**

All routes must use the cookie header reading pattern (NOT `await cookies()`):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Helper function for cookie authentication
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

export async function GET(request: NextRequest) {
  const supabase = createSupabaseClient(request);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // RLS automatically enforces access control
  // ...
}
```

**When to use Admin Client:**

For operations that need to bypass RLS (e.g., viewing follow request sender profiles):

```typescript
import { createClient } from '@supabase/supabase-js';

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

// Use sparingly - bypasses all RLS policies
const { data } = await supabaseAdmin.from('profiles').select('*');
```

**Key endpoints:**
- `/api/posts` - CRUD for posts
- `/api/posts/like` - Toggle likes
- `/api/posts/save` - Toggle save/bookmark posts
- `/api/comments` - CRUD for comments
- `/api/comments/like` - Toggle comment likes with notifications
- `/api/search` - Global search
- `/api/upload/post-media` - Media uploads
- `/api/follow` - Follow/unfollow
- `/api/golf/*` - Golf-specific endpoints
- `/api/sport-settings` - **NEW** Get/update sport-specific settings (golf, hockey, etc.)
- `/api/debug/counts` - Debug endpoint for like/comment counts
- `/api/followers` - Followers, following, and follow requests (uses admin client for requests)
- `/api/notifications` - Fetch/delete notifications with filtering
- `/api/notifications/unread-count` - Get unread notification count
- `/api/notifications/[id]` - Mark individual notification as read/unread
- `/api/notifications/mark-all-read` - Bulk mark all as read
- `/api/notifications/preferences` - Get/update notification preferences

### Profile Name Structure

**IMPORTANT: Name fields changed in October 2024**

The profile name structure uses separate fields:

**Database Schema:**
```typescript
interface Profile {
  first_name?: string;      // User's first/given name (required for display)
  middle_name?: string;      // User's middle name (optional)
  last_name?: string;        // User's last/family name (required for display)
  full_name?: string;        // Username/handle (e.g., "johndoe")
  username?: string;         // Alternative username (legacy)
}
```

**Display Name Function:**

ALWAYS use the correct signature when displaying names. **As of October 2025, middle names are NOT displayed** to maintain consistent "First Last" formatting:

```typescript
import { formatDisplayName, getInitials } from '@/lib/formatters';

// CORRECT - Current standard (no middle name)
const displayName = formatDisplayName(
  profile.first_name,
  null,  // Don't include middle name in display
  profile.last_name,
  profile.full_name  // username fallback
);

// WRONG - Including middle name (old pattern, removed October 2025)
const displayName = formatDisplayName(
  profile.first_name,
  profile.middle_name,  // ❌ Don't use middle_name
  profile.last_name,
  profile.full_name
);

// For initials
const initials = getInitials(displayName);
```

**API Query Pattern:**

When querying profiles, include `middle_name` in the query (for database compatibility) but **do not display it**:

```typescript
// CORRECT - Query includes middle_name but won't be displayed
const { data } = await supabase
  .from('profiles')
  .select('id, first_name, middle_name, last_name, full_name, avatar_url, sport, school');

// Then display without middle name
const displayName = formatDisplayName(
  profile.first_name,
  null,  // Don't display middle_name even though it's in the data
  profile.last_name,
  profile.full_name
);
```

**Foreign Key Queries:**

```typescript
// For followers/following with nested profiles
.select(`
  id,
  created_at,
  follower:follower_id (
    id,
    full_name,
    first_name,
    middle_name,
    last_name,
    avatar_url,
    sport,
    school
  )
`)
```

**Handling Missing Name Data:**

- Users without `first_name`/`last_name` will show as "Unknown User"
- This is expected for users who haven't updated their profiles yet
- `formatDisplayName()` handles nulls gracefully with fallback to username

**Profile Editing:**

The `EditProfileTabs` component now has separate fields:
- First Name (required)
- Last Name (required)
- Middle Name (optional)
- Username/Handle (what was previously "Full Name")

### Sport-Specific Settings Architecture

**IMPORTANT:** As of January 2025, all sport-specific settings are stored in the `sport_settings` table, NOT in the `profiles` table.

**Database Table:**
```sql
sport_settings (
  id UUID PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  sport_key TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE(profile_id, sport_key)
)
```

**TypeScript Interfaces:**
```typescript
// Sport-specific settings
interface GolfSettings {
  handicap?: number;
  home_course?: string;
  tee_preference?: string;
  dominant_hand?: string;
  driver_brand?: string;
  driver_loft?: number;
  irons_brand?: string;
  putter_brand?: string;
  ball_brand?: string;
}

interface HockeySettings {
  position?: string;
  stick_flex?: number;
  shot_preference?: 'left' | 'right';
  blade_curve?: string;
}

// Generic database record
interface SportSettings {
  id: string;
  profile_id: string;
  sport_key: string;
  settings: GolfSettings | HockeySettings | Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
```

**API Usage:**
```typescript
// Fetch golf settings
const response = await fetch('/api/sport-settings?sport=golf');
const { settings } = await response.json();
// settings = { handicap: 12, home_course: "Pebble Beach", ... }

// Save golf settings
await fetch('/api/sport-settings', {
  method: 'PUT',
  body: JSON.stringify({
    sport: 'golf',
    settings: {
      handicap: 10,
      home_course: 'Augusta National',
      tee_preference: 'white'
    }
  })
});

// Adding a new sport (e.g., hockey) requires NO schema changes!
await fetch('/api/sport-settings', {
  method: 'PUT',
  body: JSON.stringify({
    sport: 'ice_hockey',
    settings: {
      position: 'center',
      stick_flex: 85,
      shot_preference: 'left'
    }
  })
});
```

**Benefits:**
- ✅ Add new sports without database migrations
- ✅ Clean, normalized architecture
- ✅ Flexible JSONB storage for sport-specific data
- ✅ RLS policies ensure users only access their own settings
- ✅ Performance indexes on profile_id, sport_key, and JSONB

**Setup:** See `SETUP_SPORT_SETTINGS_FRESH.md` for implementation guide

---

### Golf Implementation

Golf is the reference implementation for the sport adapter pattern:

**Database:**
- `golf_rounds` table with course, date, total_score, stats
- `golf_holes` table with hole-by-hole scores
- `round_id` foreign key on posts links rounds to social posts
- Automatic stats calculation via database functions

**UI Flow:**
1. User opens Golf form (`EnhancedGolfForm.tsx` or `GolfScorecardForm.tsx`)
2. Selects course from `golf_courses` table or external API
3. Enters hole-by-hole scores with putts tracking
4. Stats auto-calculated (pars, birdies, eagles, etc.)
5. Can attach to post or save standalone
6. Traditional scorecard display with birdie circles (red) and bogey squares (blue)

**Files:**
- `src/lib/golf-course-service.ts` - Course search and data
- `src/lib/golf-courses-db.ts` - Database course operations
- `src/components/GolfScorecardForm.tsx` - Main golf form
- `src/app/api/golf/` - Golf API endpoints

### Styling & Design

**Design System Enforcement:**
- All vertical spacing must be 12px/24px/48px
- Card heights are fixed (280px min) regardless of content
- Missing data shows as "—" placeholder, never empty space
- Season highlight cards always show 2 chips and 4 stats (with placeholders)
- Typography locked to 6-size scale
- Sport colors from registry via `brand_color_token`

**CSS Classes (in `src/app/globals.css`):**
```css
.space-micro { margin-bottom: 12px; }
.space-base { margin-bottom: 24px; }
.space-section { margin-bottom: 48px; }
.gap-micro, .gap-base, .gap-section
.season-card, .season-card-header, .season-card-stats, .season-card-footer
```

### Notification System

**Implementation:** Comprehensive notification system with real-time updates (October 2025)

**Notification Types:**
- `follow_request` - Someone sends a follow request (private profiles)
- `follow_accepted` - Your follow request is accepted
- `new_follower` - Someone follows you (public profiles)
- `post_like` - Someone likes your post
- `post_comment` - Someone comments on your post
- `comment_like` - Someone likes your comment

**Database Triggers:**
```sql
-- Follow notifications
trigger_notify_follow_request    -- On INSERT to follows (status='pending')
trigger_notify_follow_accepted   -- On UPDATE to follows (pending→accepted)
trigger_notify_new_follower      -- On INSERT to follows (status='accepted')

-- Engagement notifications
trigger_notify_post_like         -- On INSERT to post_likes
trigger_notify_post_comment      -- On INSERT to post_comments
trigger_notify_comment_like      -- On INSERT to comment_likes

-- Automatic count management
trigger_increment_comment_likes_count  -- Auto-increment on like
trigger_decrement_comment_likes_count  -- Auto-decrement on unlike
```

**Features:**
- Cursor-based pagination for performance
- Real-time subscription support (when Realtime enabled)
- Notification preferences with 11 toggleable types
- Desktop notifications (with browser permission)
- Time grouping (Today, Yesterday, This Week, Earlier)
- Filter by type (All, Unread, Follows, Engagement, System)
- Automatic cleanup of old read notifications (90 days)
- Self-notification prevention (no alerts for own actions)

**Usage:**
```typescript
// Wrap app with NotificationsProvider
import { NotificationsProvider } from '@/components/notifications';

<NotificationsProvider>
  <YourApp />
</NotificationsProvider>

// Use notification context
import { useNotifications } from '@/components/notifications';

const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
```

**Setup:**
1. Run `setup-all-notifications-complete.sql` in Supabase SQL Editor
2. Run `add-comment-likes.sql` for comment likes feature
3. Enable Realtime replication for `notifications` table (optional)

### Important Patterns & Conventions

1. **Always use `useAuth()` for user/profile access** - Never fetch separately
2. **RLS handles security** - No manual permission checks in API routes
3. **Privacy-aware queries** - Use `canViewProfile()` before showing private data
4. **Sport-agnostic UI** - Never hardcode sport names, use SportRegistry
5. **Design tokens** - Import from `design-tokens.ts`, never hardcode sizes/colors
6. **Toast notifications** - Use `useToast()` hook for user feedback
7. **Optimistic updates** - Update UI immediately, sync with server after
8. **Media uploads** - Use `/api/upload/post-media` with FormData
9. **Search** - Use `/api/search?q=` for global search across athletes/posts/clubs
10. **Notifications** - Wrap app with `NotificationsProvider` for global notification state

### Common Tasks

**Add a new sport:**
1. Register in `SportRegistry.ts` with display_name, icon, metrics
2. Create adapter in `adapters/NewSportAdapter.ts` extending `BaseSportAdapter`
3. Register in `AdapterRegistry.ts`
4. Add to `FEATURE_FLAGS.FEATURE_SPORTS` in `features.ts`
5. Implement sport-specific tables/forms as needed

**Add privacy to new table:**
1. Add RLS policy checking `profiles.visibility`
2. Join with profiles table in policy
3. Check if user is owner OR (profile is public) OR (user follows profile)
4. See `implement-privacy-system.sql` for examples

**Debug like/comment counts:**
1. Check `/api/debug/counts` endpoint
2. Run `diagnose-likes-comments.sql` in Supabase
3. Verify triggers are active: `check-triggers.sql`
4. Re-run count fix: `fix-likes-comments-issues.sql`

**Edit/Delete posts:**
- Edit and delete work on both feed page and profile pages
- PostCard accepts `onEdit` and `onDelete` props
- PostDetailModal passes through edit/delete handlers to PostCard
- ProfileMediaTabs has full edit/delete support with EditPostModal
- Always show confirmation dialog before delete (handled by PostCard)

**Profile media sorting:**
- All profile media tabs show newest posts first by default
- SQL functions use subquery pattern to order by created_at DESC
- Run `fix-profile-media-sorting.sql` if posts show in wrong order
- Functions: get_profile_all_media, get_profile_stats_media, get_profile_tagged_media

### Known Issues & Workarounds

- **Like/comment counts** - If counts are off, run `fix-likes-comments-issues.sql`
- **Double triggers** - Fixed by `fix-double-trigger.sql` (don't re-create triggers)
- **Profile name fields** - Use `full_name` primarily, `first_name`/`last_name` as fallback
- **Weight units** - Use `weight_kg` for storage, `weight_display` + `weight_unit` for UI
- **Golf course data** - Some courses require external API, fallback to database

### Testing & Debugging

**Manual testing:**
1. Create test users: `create-test-users.sql`
2. Toggle privacy and verify access control
3. Test follow flow (request → approve → access granted)
4. Check RLS: Try accessing other user's data (should fail)

**SQL debugging:**
```sql
-- Check RLS status
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

-- Verify policies
SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';

-- Debug counts
SELECT id, likes_count, comments_count FROM posts;
```

### Documentation Files

- [README.md](README.md) - Quick start guide for students
- [PRIVACY_ARCHITECTURE.md](PRIVACY_ARCHITECTURE.md) - Privacy system design
- [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) - RLS and auth patterns
- [DATABASE_SETUP.md](DATABASE_SETUP.md) - Database initialization
- [PRIVACY_IMPLEMENTATION_GUIDE.md](PRIVACY_IMPLEMENTATION_GUIDE.md) - Privacy how-to

### Additional Context

- **Next.js 15** with App Router and React 19
- **Supabase** for auth, database, storage
- **TypeScript** strict mode enabled
- **Tailwind CSS 4** for styling
- **Path alias:** `@/*` maps to `src/*`
- **OpenAI integration** for AI text/image analysis (optional features)
- **Email system** via Nodemailer (contact forms)
- **Multi-sport social network** - Golf is reference implementation

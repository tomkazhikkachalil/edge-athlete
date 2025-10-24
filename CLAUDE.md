# CLAUDE.md

**Project Context for Claude Code** - This file provides essential guidance when working with this codebase.

## 🎯 Project Overview

**Multi-Sport Athlete Social Network** built with:
- **Next.js 15** (App Router) + **React 19**
- **Supabase** (auth, database, storage)
- **TypeScript** (strict mode)
- **Tailwind CSS 4**

**Platform Features:**
- Athlete profiles with performance stats
- Social feed with posts, comments, likes
- Privacy controls (public/private profiles)
- Sport-specific adapters (Golf fully implemented)
- Notification system with real-time updates
- Follow/follower system with request management

---

## 🚀 Quick Start - Local Development

### Environment Variables
**Required** - Create `.env.local` with:
```bash
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional: AI features
OPENAI_API_KEY=your-key

# Optional: Email (contact forms)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your-app-password
```

### Development Commands
```bash
npm run dev          # Start dev server → http://localhost:3000
npm run build        # Production build + TypeScript check
npm run start        # Start production server
npm run lint         # Run ESLint
```

### Production Deployment (Vercel)

**Status:** ✅ Deployed to Vercel

**GitHub Repository:** `https://github.com/tomkazhikkachalil/edge-athlete`

**Deployment Steps:**
1. Push to `main` branch triggers automatic deployment
2. Ensure environment variables are configured in Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (mark as Sensitive)

**Supabase Configuration:**
- **CRITICAL:** Add your Vercel deployment URL to Supabase
- Go to: Authentication → URL Configuration
- **Site URL:** `https://your-app.vercel.app`
- **Redirect URLs:** `https://your-app.vercel.app/**`
- Also keep `http://localhost:3000/**` for local development

**Known Issues:**
- Connection suggestions feature has SQL ambiguous column error (non-critical, affects "People you may know" sidebar only)
- Some debug console.log statements remain in FollowButton.tsx and ProfileMediaTabs.tsx (for future cleanup)

---

## 📁 Architecture Overview

### App Router Structure
```
src/app/
├── feed/                    # Main feed (posts from followed athletes)
├── athlete/[id]/            # Profile pages by user ID
├── u/[username]/            # Profile pages by username
├── app/
│   ├── profile/             # Logged-in user's profile editor
│   ├── followers/           # Followers/following management
│   ├── notifications/       # Notifications page
│   └── sport/[sport_key]/   # Sport-specific pages
├── dashboard/               # Admin dashboard
└── api/                     # API routes
    ├── posts/               # CRUD for posts
    ├── comments/            # CRUD for comments
    ├── follow/              # Follow/unfollow
    ├── notifications/       # Notification management
    ├── golf/                # Golf-specific endpoints
    └── ...
```

### Key Libraries & Utilities

**`src/lib/supabase.ts`** - Supabase client setup
- `supabase` - Browser client (SSR-compatible with cookies)
- `supabaseAdmin` - Server-side client (bypasses RLS, use sparingly)
- TypeScript interfaces for all database tables

**`src/lib/auth.tsx`** - Authentication context
- `useAuth()` - Hook for accessing user/profile
- Handles sign up, sign in, sign out, profile updates

**`src/middleware.ts`** - Supabase auth middleware
- Refreshes sessions on every request
- Required for SSR authentication

### Sport Adapter Pattern

**Location:** `src/lib/sports/`

Platform uses adapters for sport-specific logic:
- **SportRegistry.ts** - Defines all sports (golf, ice_hockey, volleyball)
- **SportAdapter.ts** - Base interface for sport implementations
- **adapters/GolfAdapter.ts** - Reference implementation

**Status:**
- ✅ **Golf** - Fully implemented (rounds, scorecards, stats)
- 🚧 **Ice Hockey, Volleyball** - Registered but not implemented

---

## 🗄️ Database Structure

### Core Tables
- `profiles` - User profiles (extends auth.users)
- `posts` - Social posts with media and stats
- `post_media` - Media attachments (images/videos)
- `post_comments` - Comments with threading and likes
- `post_likes` - Post likes
- `comment_likes` - Comment likes
- `saved_posts` - Bookmarked posts
- `follows` - Follow relationships (with pending/accepted status)
- `notifications` - User notifications
- `notification_preferences` - User notification settings
- `golf_rounds` - Golf round data (with indoor/outdoor support)
- `golf_holes` - Hole-by-hole scores
- `season_highlights` - Sport performance highlights
- `sport_settings` - Sport-specific user settings (JSONB)

### Important Patterns
- **RLS Enabled** - All tables have Row Level Security
- **Cascading Deletes** - Foreign keys auto-delete related data
- **Auto-timestamps** - `updated_at` triggers on all tables
- **Cached Counts** - `likes_count`, `comments_count`, `saves_count` on posts
- **Privacy Column** - `visibility` field ('public' or 'private')

---

## 🔌 API Patterns

### Next.js 15 Cookie Authentication Pattern

**CRITICAL:** All API routes must use cookie header reading (NOT `await cookies()`):

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

### When to Use Admin Client

For operations that bypass RLS (e.g., viewing follow request sender profiles):

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

// Use sparingly - bypasses ALL RLS policies
const { data } = await supabaseAdmin.from('profiles').select('*');
```

---

## 🎨 Design System

### Strict Spacing Rhythm
- **12px** (`space-micro`) - Label-to-value, icon-to-text
- **24px** (`space-base`) - Intra-section gaps
- **48px** (`space-section`) - Section gutters

### Typography Scale
- **H1:** 32px
- **H2:** 24px
- **H3:** 18px
- **Body:** 16px
- **Label:** 14px
- **Chip:** 12px

### Text Contrast Standards
- **User Names**: Bold black (`text-black font-bold`)
- **Handles/Tags**: Light gray (`text-gray-500`)
- **Body Text**: Black or dark gray (`text-black`, `text-gray-900`)
- **Never use**: Light grays for primary content

### CSS Classes
Available in `src/app/globals.css`:
```css
.space-micro, .space-base, .space-section  /* margin-bottom */
.gap-micro, .gap-base, .gap-section        /* flexbox/grid gaps */
.season-card, .season-card-header, etc.    /* component classes */
```

---

## 🔒 Privacy & Security

### Privacy System
**Location:** `src/lib/privacy.ts`

- **Simple Model**: Public or Private profiles
- **Access Control**: Private profiles visible only to owner + approved followers
- **RLS Enforcement**: Database-level Row Level Security on all tables

**IMPORTANT:** Privacy checks must be done **server-side**

```typescript
// Server-side (API routes, server components)
import { canViewProfile } from '@/lib/privacy';
const canView = await canViewProfile(profileId, currentUserId);

// Client-side: Use API endpoint
const response = await fetch(`/api/privacy/check?profileId=${athleteId}`);
const { canView } = await response.json();
```

### Database Security
- All tables have RLS enabled
- Service role key (`supabaseAdmin`) bypasses RLS - use carefully
- Policies enforce owner-only access for private data

---

## 📋 Key Conventions

1. **Always use `useAuth()`** for user/profile access - Never fetch separately
2. **RLS handles security** - No manual permission checks needed in API routes
3. **Privacy-aware queries** - Check `canViewProfile()` before showing private data
4. **Sport-agnostic UI** - Never hardcode sport names, use `SportRegistry`
5. **Design tokens** - Import from `design-tokens.ts`, never hardcode sizes/colors
6. **Optimistic updates** - Update UI immediately, sync with server after
7. **Path alias** - `@/*` maps to `src/*`

---

## 🔧 Common Tasks

### Add a New Sport
1. Register in `src/lib/sports/SportRegistry.ts`
2. Create adapter in `src/lib/sports/adapters/NewSportAdapter.ts`
3. Register in `src/lib/sports/AdapterRegistry.ts`
4. Add to `FEATURE_FLAGS.FEATURE_SPORTS` in `src/lib/features.ts`

### Debug Like/Comment Counts
1. Check `/api/debug/counts` endpoint
2. Run `diagnose-likes-comments.sql` in Supabase
3. Re-run fix: `fix-likes-comments-issues.sql`

### Add Privacy to New Table
1. Add RLS policy checking `profiles.visibility`
2. Join with profiles table in policy
3. Check: user is owner OR profile is public OR user follows profile
4. See `implement-privacy-system.sql` for examples

---

## 🆕 Recent Critical Fixes (January 2025)

### Local Development Migration
**Context:** Migrated from GitHub Codespaces to local VS Code

**Fixed:**
- ✅ Missing `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`
- ✅ Incorrect anon key (was using service_role key - security issue!)
- ✅ Build errors in API routes
- ✅ All environment variables properly configured

### Environment Configuration
`.env.local` now has correct structure:
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Safe for browser
- `SUPABASE_SERVICE_ROLE_KEY` - Server-only, bypasses RLS

### Database Performance Optimizations
**Achievement:** Database optimized for billion-user scale

- ✅ RLS policies optimized: `auth.uid()` → `(select auth.uid())`
- ✅ 70+ policies updated across 18 tables
- ✅ Query speed: 10-100x faster
- ✅ All foreign keys have covering indexes
- ✅ Follow request notifications working for private accounts

**Key Migrations:**
- `fix-rls-initplan-performance-corrected.sql`
- `fix-notification-functions-schema-qualified.sql`
- `fix-follow-request-private-accounts.sql`

---

## 📚 Detailed Documentation

This project has extensive documentation for specific features:

### Setup & Configuration
- `README.md` - Quick start for students
- `DATABASE_SETUP.md` - Database initialization
- `DEPLOYMENT_GUIDE.md` - Production deployment

### Architecture & Design
- `PRIVACY_ARCHITECTURE.md` - Privacy system design
- `SECURITY_ARCHITECTURE.md` - RLS and auth patterns
- `BILLION_USER_SCALE_DEPLOYMENT.md` - Scalability

### Feature Guides
- `NOTIFICATIONS_SYSTEM_GUIDE.md` - Notification implementation
- `TAGGING_SYSTEM_GUIDE.md` - User tagging features
- `SHARED_SCORECARD_IMPLEMENTATION.md` - Multi-player golf
- `SPORT_SETTINGS_IMPLEMENTATION_GUIDE.md` - Sport-specific settings

### Debugging & Testing
- `DEBUGGING_GUIDE.md` - Common issues and fixes
- `END_TO_END_TESTING_GUIDE.md` - Testing procedures
- `TROUBLESHOOTING.md` - Problem resolution

### Database
- `RLS_OPTIMIZATION_GUIDE.md` - Performance optimization
- `FIX_COUNTS_GUIDE.md` - Like/comment count fixes
- `COMPLETE-RLS-FIX-GUIDE.md` - RLS comprehensive fixes

---

## 🎯 Tech Stack Summary

- **Framework:** Next.js 15 (App Router) + React 19
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth (magic links, OAuth)
- **Storage:** Supabase Storage (user avatars, post media)
- **Styling:** Tailwind CSS 4
- **Language:** TypeScript (strict mode)
- **Icons:** Lucide React
- **Optional:** OpenAI API (AI features), Nodemailer (email)

---

## 💡 Pro Tips

1. **Always check RLS policies** when adding new tables
2. **Use `supabaseAdmin` sparingly** - it bypasses all security
3. **Test privacy controls** - Verify private profiles are protected
4. **Follow spacing rhythm** - 12px/24px/48px only
5. **Reference existing patterns** - Look at Golf implementation as reference
6. **Keep .env.local secure** - Never commit to git

---

**Last Updated:** January 2025 (Local Development Migration)
**Environment:** macOS (Darwin 25.0.0), Node 22.18.0, npm 10.9.3

# CLAUDE.md

**Project Context for Claude Code** - This file provides essential guidance when working with this codebase.

## 🎯 Project Overview

**Multi-Sport Athlete Social Network** (Next.js 16 App Router + Supabase — see `package.json` for the full stack).

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

# Optional: Email. Every send site is guarded by
# `if (SMTP_USER && SMTP_PASS)`, so leaving these unset disables outbound
# email rather than erroring — including calendar invites, transfer and
# guardian notices, and the notification digest.
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your-app-password
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

---

## 📁 Architecture Overview

### Sport Adapter Pattern

**Location:** `src/lib/sports/`

Platform uses adapters for sport-specific logic:
- **SportRegistry.ts** - Defines all 11 sports (baseball, basketball, football, golf,
  ice_hockey, soccer, swimming, tennis, track_field, training, volleyball)
- **SportAdapter.ts** - Base interface for sport implementations
- **adapters/GolfAdapter.ts** - Reference implementation

**Status:**
- ✅ **Golf** - Fully implemented (rounds, scorecards, stats)
- 🚧 **The other ten** - Registered in the sport registry but with no adapter;
  see `src/lib/features.ts` for which are actually exposed

---

## 🗄️ Database Structure

### Important Patterns
- **RLS Enabled** - All tables have Row Level Security
- **Cascading Deletes** - Foreign keys auto-delete related data
- **Auto-timestamps** - `updated_at` triggers on all tables
- **Cached Counts** - `likes_count`, `comments_count`, `saves_count` on posts
- **Privacy Column** - `visibility` field ('public' or 'private')

---

## 🔌 API Patterns

**CRITICAL:** All API routes must use the cookie header authentication pattern (NOT `await cookies()`) — see `src/app/api/CLAUDE.md` for the required pattern and admin-client guidance.

---

## 🧭 Navigation Conventions

**No screen may be a dead end.** Every screen, modal, and flow needs a visible way back: signed-in users to `/feed`, signed-out users to the sign-in page. Never require the user to edit the URL. Audited and enforced July 2026 — these rules are the reason it holds:

- **The login form lives at `/`. There is no real `/login` page** — `src/app/login/page.tsx` only redirects there. Never `router.push('/login')`.
- **`BrandBar` carries the exit for standalone pages** (auth, guardian, onboarding, legal). It renders an auth-aware escape link; **the logo is intentionally NOT a link** — don't "fix" that. It hides itself on `/`, during auth boot, and via `hideEscape` for genuinely modal steps (a transfer mid-execution). `/auth/complete-profile` uses `hideEscape` plus its own sign-out link, because `/` bounces profile-less sessions straight back to it.
- **`src/app/not-found.tsx` is the catch-all 404.** Without it Next.js renders a bare page with no links at all.
- **`AppHeader` has three branches** — auth-booting (logo-only shell, prevents a flash), signed-out (Log in + Sign up, and deliberately **no** notification/message bells, which would poll protected endpoints), and authenticated. Public pages (`/explore`, `/u/[username]`) depend on the signed-out branch; the login page's "Explore as Guest" button makes `/explore` a genuine anonymous surface.
- **Check `initialAuthCheckComplete` before `!user`.** The reverse order flashes "Sign In Required" at signed-in users on refresh.
- **Discarding unsaved input requires confirmation.** Use `useDirtyClose` (`src/hooks/useDirtyClose.ts`) with `ConfirmModal` and `COPY.FORMS.DISCARD_*`: every X / Cancel / backdrop path calls `requestClose`; closes that follow a successful save call the raw close directly (never confirm after a save). `ConfirmModal` accepts `overlayZClass` for callers stacked above `z-[60]`.
- **Order destructive multi-step flows so backing out is safe** — e.g. equipment replacement retires the old item only *after* the new one exists, never before.

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
5. **Design tokens** - Import from `src/lib/design-tokens.ts`, never hardcode sizes/colors
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
1. Run `database/tests/diagnostics/diagnose-likes-comments.sql` in Supabase
2. The fix is `database/archive/old-migrations/fix-likes-comments-issues.sql` —
   archived, so read it before running it rather than assuming it still matches
   the current schema

(There is no `/api/debug/counts` route — this step used to name one that was
never built or has since been removed. Don't go looking for it.)

### Add Privacy to New Table
1. Add RLS policy checking `profiles.visibility`
2. Join with profiles table in policy
3. Check: user is owner OR profile is public OR user follows profile
4. For examples, read the live policies in `database/migrations/` — **not**
   `database/archive/failed-attempts/implement-privacy-system.sql`, which this
   step used to recommend without saying it lives under `failed-attempts/`

---

## 📚 Detailed Documentation

Everything listed here has been verified to exist. Commit `790aa7b` removed 120
legacy documents; this index went on naming 15 of them for months, so treat any
addition below as a promise to keep it true.

- `README.md` — quick start
- `DEVLOG.md` — the running record of what changed and *why*. The most useful
  file in the repo for context on a past decision; read it before assuming
  something is arbitrary.
- `AGENTS.md` — agent-facing conventions
- `src/app/api/CLAUDE.md` — **required** API route patterns (cookie auth, admin client)
- `database/MIGRATIONS.md` and `database/docs/` — migration ordering and the
  guardian reconciliation notes. SQL lives under `database/`, sorted into
  `migrations/`, `fixes/`, `features/`, `tests/` and `archive/`.

---

**Last Updated:** July 2026 (spring-clean — dead doc index rewritten, `/api/ai/*`
and `scripts/` deleted)

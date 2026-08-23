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

# Optional: brand logos in the equipment picker (https://logo.dev). Unset →
# initial-letter tiles, which is a supported state rather than a degraded one.
# NEXT_PUBLIC_* is inlined AT BUILD TIME, so setting this in Vercel requires a
# redeploy before it takes effect.
NEXT_PUBLIC_LOGO_DEV_TOKEN=pk_your_publishable_token
```

### Development Commands
```bash
npm run dev          # Dev server → http://localhost:3000 (Turbopack)
npm run build        # Production build
npm run start        # Serve the production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . --max-warnings 0    ← see below
npm run test         # vitest run (node-only; there is NO jsdom)
npm run verify       # typecheck + lint + test + build — THE GATE
```

**`npm run verify` is the gate.** Run it before every commit; nothing lands red.

**`lint` is at zero and stays there.** The cap spent a year as a ratchet
(45 → 43 → 30 → 19 → 11 → 7 → 0, lowered in the same commit that removed the
warnings); as of August 2026 it is `--max-warnings 0`, so a warning fails
`npm run verify` exactly like an error. Fix it, or add a targeted
`eslint-disable-next-line` **with a reason at the site** — do not raise the cap.
Raising it needs a reason in `DEVLOG.md`. Every disable still in the tree is
explained in `eslint.config.mjs`; read that before trying to "fix" one, and note
that `set-state-in-effect` reports at the *setState* line, not the `useEffect(`
line.

**Tests are node-only.** There is no jsdom and no testing-library, so only pure
functions are unit-testable. Anything needing a DOM is verified in a browser, by
hand — don't add a test that pretends otherwise.

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

### App Router Structure
```
src/app/
├── feed/                    # Main feed (posts from followed athletes)
├── athlete/[id]/            # Profile pages by user ID
├── u/[username]/            # Public profile pages by username
├── live/[groupPostId]/      # A live round as a PLACE (see Navigation Conventions)
├── app/
│   ├── profile/             # Logged-in user's profile editor
│   ├── followers/           # Followers/following management
│   ├── notifications/       # Notifications page
│   └── sport/[sport_key]/   # Sport-specific pages
├── dashboard/               # Admin dashboard
└── api/                     # API routes — see src/app/api/CLAUDE.md
```

### Key Libraries & Utilities

**`src/lib/supabase.ts`** — Supabase client setup
- `supabase` — browser client (SSR-compatible, cookie-based)
- `supabaseAdmin` — server client that **bypasses RLS**; use sparingly

**`src/lib/auth.tsx`** — authentication context
- `useAuth()` — the only sanctioned way to read user/profile (see Key Conventions)

**`src/middleware.ts`** — refreshes the Supabase session per request; required for SSR
auth. Deliberately still the `middleware` convention rather than `proxy` — the reason
and revisit triggers are in the file header.

### Sport Adapter Pattern

**Location:** `src/lib/sports/`

Platform uses adapters for sport-specific logic:
- **SportRegistry.ts** - Defines all 11 sports (baseball, basketball, football, golf,
  ice_hockey, soccer, swimming, tennis, track_field, training, volleyball)
- **SportAdapter.ts** - Base interface, plus `BaseSportAdapter` and `DisabledSportAdapter`
- **adapters/GolfAdapter.ts** - Reference implementation (deep tables)
- **adapters/StatLinePostAdapter.ts** - One adapter parameterised by `sport_key`, serving
  every stat-line sport over `posts.stats_data`

**Status** — every registered sport has an adapter; `AdapterRegistry.getAdapter()` throws
rather than falling back, so the fallback is applied at *registration* time:
- ✅ **Golf** — fully implemented (rounds, scorecards, stats), its own deep tables
- ✅ **Ice hockey, volleyball, basketball, soccer, baseball** — `StatLinePostAdapter`.
  Adding another is 2 edits; see `src/lib/sports/stat-schemas.ts`
- 🚧 **Track & field, tennis, swimming, football** — `DisabledSportAdapter` (registered,
  not exposed)
- ⚠️ **`training`** — deliberately has **no** adapter; `getSportAdapter('training')` throws.
  It is an MVP shortcut that should become a post category rather than a sport

`src/lib/features.ts` (`FEATURE_SPORTS`) is what decides which are exposed to users.

---

## 🗄️ Database Structure

**`database/migrations/` is the source of truth for the schema — there is no table
list here on purpose.** It defines 40+ tables and grows most weeks. AGENTS.md used to
carry a hand-written "Core Tables" list of 14, which had silently gone stale: it was
missing `group_posts`, `group_post_participants`, `golf_scorecard_data` and
`golf_participant_scores` — the tables the golf feature actually runs on — plus every
messaging, calendar and guardian table. A partial list presented as the core set is
worse than no list. Read the migrations, or introspect the live schema.

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

### Interaction language — use it, don't reinvent it

One rule for how things respond to a pointer. Inconsistent hover behaviour is what
reads as "unfinished" more than any individual element, so these are shared classes
in `globals.css`, not per-component styling:

```css
.ea-interactive   /* hover: bg tint; press: scale(.97). 150ms / 100ms */
.ea-surface       /* resting card: hairline border + soft shadow */
.ea-surface-raised/* one step up on hover — there are exactly TWO levels */
.ea-icon-btn      /* 40px circular hit area for a bare icon */
.ea-cta           /* the one loud control: gradient, deepens on hover */
```

**Focus is global — never add focus styles to a control.** `:focus-visible` already
sets a 2px brand ring with a 2px offset for the whole app. Adding `focus:ring-*`
overrides it inconsistently; if focus looks wrong somewhere, remove the override.

**Motion needs no per-component guard.** Everything above is transition-based, and
the `prefers-reduced-motion` block neutralises transitions globally.

**Two traps, both hit in practice:**
- **Don't set `display` (or width) in a shared class.** `.ea-icon-btn` used to set
  `display`, which silently beat `lg:hidden` on its callers. Tailwind precedence
  comes from stylesheet order, not class order, so the caller can never win. Same
  bug bit `MediaTile` via `w-full`. Let callers own layout properties.
- **`@theme` in `globals.css` REDEFINES Tailwind's radius scale** — `rounded-lg` is
  12px here, not 8px. Don't "fix" a radius by changing the scale; that restyles
  ~550 usages app-wide. Use `rounded-lg` consistently instead.

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
2. Create adapter in `src/lib/sports/adapters/NewSportAdapter.ts` — or, for a
   stat-line sport, add a schema to `src/lib/sports/stat-schemas.ts` and register a
   `StatLinePostAdapter` (that file's header documents the 2-edit recipe)
3. Register in `src/lib/sports/AdapterRegistry.ts`
4. Add to `FEATURE_FLAGS.FEATURE_SPORTS` in `src/lib/features.ts`

**The sport is then live everywhere except its gear.** The Equipment tab offers every
enabled sport immediately, but with no categories, brand suggestions or spec fields until
you add them — three sibling files, each a `Record<sport_key, …>` with a safe empty
fallback, so a missing entry degrades to free text rather than breaking:

5. Categories → `src/lib/equipment-config.ts`
6. Brand seeds → `src/lib/equipment-brands.ts` (brands only; models are per-season churn,
   see that file's header)
7. Spec fields per category → `src/lib/equipment-specs.ts`

A test asserts every `FEATURE_SPORTS` key has brand seeds, so skipping step 6 fails the
gate rather than shipping an empty dropdown.

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
- `AGENTS.md` — a pointer back to this file. Deliberately thin; see the note in it.
- `src/app/api/CLAUDE.md` — **required** API route patterns (cookie auth, admin client)
- `database/MIGRATIONS.md` and `database/docs/` — migration ordering and the
  guardian reconciliation notes. SQL lives under `database/`, sorted into
  `migrations/`, `fixes/`, `features/`, `tests/` and `archive/`.
- `docs/LAUNCH_RUNBOOK.md` — the pre-launch ops checklist (DNS/email, Supabase
  auth email, OAuth enablement, device walkthrough). Console actions, not code.
- `docs/` — roadmaps (`docs/ROADMAP_2026-07.md`, `docs/MULTI_SPORT_ROADMAP.md`), a
  security audit, and feature write-ups. **`docs/devlog/` is the OLD devlog** (entries
  001–010, superseded by `DEVLOG.md` at the repo root) — history, not current
  state. Several files here predate late 2025; check `git log` before trusting
  a detail.

---

**Last Updated:** August 2026 — this file is the single source of truth for project
conventions. `AGENTS.md` is a pointer to it, deliberately; don't re-expand it into a
second copy. Every file path named above was swept and resolves.

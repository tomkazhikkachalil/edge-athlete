# Architecture, environments and common tasks

> Moved verbatim from CLAUDE.md on Oct 13 2026 (the long form; the short form is in CLAUDE.md).

### Environments — TWO Supabase projects since Round 2 (Sep 21 2026)

| File | Project | Who reads it |
| --- | --- | --- |
| `.env.local` | **STAGING** (`EdgeAthlete-Staging`, us-west-2; was "BackUp" until renamed Sep 22) — disposable | `npm run dev`, the e2e suite, `check:schema`, Vercel **Preview + Development** |
| `.env.prod` | **PRODUCTION** (`edge-athlete`, ca-central-1) | only `TARGET_ENV=prod` / `E2E_TARGET=prod`: `build:baseline`, `check:schema:prod`, `migrate:mark:prod`, `test:e2e:prod`; Vercel **Production** |
| `.env.staging` | the Supabase access token + staging ref | `scripts/staging-sql.mjs` (the management API; refuses the prod ref) |

All three are gitignored (`.env.*`). **The e2e suite refuses production**
(the prod project's ref or the prod app host) unless `E2E_ALLOW_PROD=1` —
`npm run test:e2e:prod` is the one sanctioned prod probe. Staging was built
from `database/baseline/000_rebuild.sql` and is proven identical to prod
(`database/MIGRATIONS.md` → "To build an environment"); every new migration
runs on BOTH (the ledger records each). Production's runner stays the SQL
editor; staging's is `node scripts/staging-sql.mjs <file>`. No pg_cron jobs
on staging, by decision. A `NEXT_PUBLIC_*` value is inlined at BUILD time —
after switching `.env.local`, `npm run build` again before `npm run start`.

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

**`typecheck` and `build` carry an explicit 4 GB heap ceiling (Sep 17 2026).** A
COLD check of this program needs ~2.9 GB and node's default on an 8 GB machine
(this Mac, Vercel's builder) is ~2 GB — the abort is exit 134 / "heap out of
memory", never a type error. The build's form is `NODE_OPTIONS` on purpose: a plain
`node --max-old-space-size` does not reach Next's typecheck worker. When a cold
check nears 4 GB, split the program (e2e out of the root tsconfig, or project
references) rather than raising the number — DEVLOG Sep 17 2026 has the measurements.

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

### App Router Structure — TWO ROOT LAYOUTS (phase 3, Sep 2026)
```
src/app/
├── (app)/                   # THE APP — root layout with auth/theme/providers/nonce
│   ├── feed/                #   Main feed (posts from followed athletes)
│   ├── athlete/[id]/        #   Profile pages by user ID
│   ├── u/[username]/        #   Public profile pages by username
│   ├── live/[groupPostId]/  #   A live round as a PLACE (see Navigation Conventions)
│   ├── league|club/[id]/    #   Org pages (+ /standings — anonymous SSR twins;
│   │                        #   /teams/[teamId] and /divisions/[divisionId], conv. 28)
│   ├── app/                 #   Signed-in tools: profile, followers, notifications,
│   │                        #   sport/[sport_key], org/[side]/[id] (the org console)
│   └── dashboard/           #   Admin dashboard
├── (public)/                # PUBLIC ORG SITES — its own root layout: NO headers()/
│   │                        # providers/Font Awesome; ISR+CDN; follows the visitor's
│   │                        # light/dark theme (a read-only head script) unless fixed
│   ├── org/[slug]/          #   Site home + standings|schedule|teams(+/[teamId])
│   │                        #   + divisions(+/[divisionId])
│   │                        #   + [pageSlug] custom pages + card.png (og image)
│   └── sitemap.ts           #   /sitemap.xml (force-dynamic — LOAD-BEARING)
├── robots.ts                # /robots.txt (must stay at the ROOT — see below)
└── api/                     # API routes — see src/app/api/CLAUDE.md
```

**The (public) segment's iron rules** (each measured, all enforced by the
guardrails script + docs/HARDENING.md §B4): server components only; every
page exports `revalidate` AND `generateStaticParams` (empty ok — without it
the route silently becomes permanent-MISS SSR); readers are viewer-
independent and never throw; person names pass through `publicDisplayName`
masking; `next/og` imports only in `card.png/route.ts`. `robots.ts` cannot
move into a route group (Next's robots regex is root-anchored — it becomes
dead code). **Light and dark (Oct 1 2026 — sites were light-only until
then):** the server render carries NO theme; the visitor's device applies
theirs through `PUBLIC_THEME_SCRIPT` (the read-only variant of the app's head
script — the same cookie, then the mirror, else the default schedule; it
writes nothing), and a site fixed to Always light / Always dark (theme token
`appearance`) wears `data-theme` on its own `.org-scope` root instead — an
island: the palette block re-declares the light values under
`[data-theme="light"]` and the `dark:` variant stops there. A hardcoded
palette colour in that tree carries its `dark:` twin on the same line (the
guardrails advisory counts the ones that do not).

### Key Libraries & Utilities

**`src/lib/supabase.ts`** — Supabase client setup
- `supabase` — browser client (SSR-compatible, cookie-based)
- `supabaseAdmin` — server client that **bypasses RLS**; use sparingly

**`src/lib/auth.tsx`** — authentication context
- `useAuth()` — the only sanctioned way to read user/profile (see Key Conventions)

**`src/middleware.ts`** — refreshes the Supabase session per request; required for SSR
auth. Deliberately still the `middleware` convention rather than `proxy` — the reason
and revisit triggers are in the file header. Order matters inside it: the
ORG_SUBDOMAINS host-301 branch runs FIRST, then the LAUNCH GATE
(`NEXT_PUBLIC_LAUNCH_GATE=1`: a signed-out visitor → `/auth/coming-soon`
everywhere but the doors, robots forbid, `/api/signup` 403 —
`src/lib/launch-gate.ts`, Sep 30 2026), then static-CSP fast paths for
/org/* (behind PUBLIC_ORG_SITES), the standings carve-out, and the crawler
files (/robots.txt, /sitemap.xml) — all of which skip the auth round trip.
Its env flags are BUILD-INJECTED: changing one needs a real build, not a
redeploy.

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
- ✅ **Ice hockey, volleyball, basketball, soccer, baseball, track & field** — `StatLinePostAdapter`.
  Adding another is 2 edits; see `src/lib/sports/stat-schemas.ts`
- ✅ **Swimming, cycling, running, rowing** (Live Activities, Oct 4 2026) — `StatLinePostAdapter`
  over ONE shared endurance stat line (`enduranceSchema`); a recorded or imported
  activity may be POSTED as one of them (the share-time bridge, convention 30)
- 🚧 **Tennis, football** — `DisabledSportAdapter` (registered, not exposed)
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

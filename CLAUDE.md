# CLAUDE.md — Edge Athlete

Multi-sport athlete social network: Next.js 16 App Router + Supabase + TypeScript (strict), on Vercel. Golf is the deep sport; the rest run on stat lines. This file is the short guide and never grows a history. The record lives elsewhere:

- **`docs/devlog.md`** — the running development log (every round, decision, maintenance pass). New entries go HERE, never in this file.
- **`docs/specs/`** — the feature specs (the former Key Conventions 8–43; numbers kept). `docs/specs/README.md` is the index.
- `docs/README.md` — index of every reference doc. **`src/app/api/CLAUDE.md`** — the REQUIRED API route pattern.

## Setup

Two Supabase projects, three gitignored env files:

| File | Project | Read by |
| --- | --- | --- |
| `.env.local` | STAGING (`EdgeAthlete-Staging`, free tier, disposable) | `npm run dev`, e2e, `check:schema`, Vercel Preview + Development |
| `.env.prod` | PRODUCTION (`edge-athlete`) | only `TARGET_ENV=prod` / `E2E_TARGET=prod` scripts; Vercel Production |
| `.env.staging` | management-API token + staging ref | `scripts/staging-sql.mjs` (refuses the prod ref) |

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Optional keys (`SMTP_*`, `NEXT_PUBLIC_LOGO_DEV_TOKEN`, …) are documented in `.env.example`; unset means the feature is off, never an error. A `NEXT_PUBLIC_*` value is inlined at BUILD time — rebuild after changing one. Every migration runs on BOTH databases and `database/MIGRATIONS.md` keeps the ledger: staging through `node scripts/staging-sql.mjs <file>`, production through the SQL editor. The e2e suite refuses production unless `E2E_ALLOW_PROD=1`; `npm run test:e2e:prod` is the one sanctioned prod probe.

## Commands

```bash
npm run dev            # Turbopack dev server → http://localhost:3000
npm run build          # production build (4 GB heap via NODE_OPTIONS — on purpose)
npm run start          # serve the build
npm run typecheck      # tsc --noEmit, 4 GB heap: exit 134 = heap, never a type error
npm run lint           # eslint --max-warnings 0 — a warning fails the gate
npm run test           # vitest, node-only: no jsdom, only pure functions are unit-testable
npm run verify         # typecheck + lint + test + build + check:syntax — THE GATE, before every commit
npm run check:schema   # live schema vs the migration chain (local only); :prod for production
npm run test:e2e       # Playwright against staging; @mobile specs also run in webkit-mobile + android
```

Never raise the lint cap or the heap number: fix the warning (a disable needs a reason at the site) or split the program. Never run the whole `@mobile` set in one invocation against staging — by area, one project at a time.

## Structure

```
src/app/(app)/        the app: one root layout with auth, theme, providers, nonce
                      feed · athlete/[id] · u/[username] · live/[groupPostId] · events/[id]
                      event/[id] · league|club/[id] · app/ (settings, org console) · dashboard/
src/app/(public)/     public org sites: own root layout, SERVER COMPONENTS ONLY, ISR + CDN,
                      every page exports revalidate + generateStaticParams, names masked
src/app/api/          API routes — read src/app/api/CLAUDE.md first
src/middleware.ts     session refresh; order: host 301 → launch gate → static-CSP fast paths
src/lib/              domain logic: pure rules in zero-import files, writers in *-server.ts
src/lib/sports/       SportRegistry (17 sports, 15 on) · GolfAdapter (deep tables) · StatLinePostAdapter
                      (every other sport over posts.stats_data) · stat-schemas.ts · features.ts
src/components/       UI (bubbles/, media/VideoFrame, site-builder/, profile/, golf/)
database/migrations/  THE schema source of truth (numbered; baseline/000_rebuild.sql rebuilds)
e2e/                  Playwright specs + helpers/     scripts/  ops, gates, guardrails
```

## Conventions

- `useAuth()` is the only way to read user/profile. RLS is the security layer; privacy is checked server-side (`canViewProfile` in `src/lib/privacy.ts`); `supabaseAdmin` bypasses RLS — use sparingly.
- Sport-agnostic UI: never hardcode a sport, use `SportRegistry`. Design tokens from `src/lib/design-tokens.ts`. Path alias `@/*` → `src/*`. Optimistic updates, then sync.
- One writer per fact (`*-server.ts`), pure rules in zero-import modules, every rule pinned by a vitest test. A status column (`draft`, `profile_hidden`, `hidden`) is how readers skip rows. The ACCOUNT decides who sees a post; never a per-post audience control.
- No screen is a dead end: the login form is `/` (never `router.push('/login')`); Back is `backOr(router, fallback)`; unsaved input closes through `useDirtyClose` + `ConfirmModal`; every destructive door names what is lost. Check `initialAuthCheckComplete` before `!user`.
- Web and mobile ship together: every change is verified at ~375 px, including reachability and route parity (`/athlete/[id]` vs `/u/[username]`). The browser floor is iOS 15 / Chrome 100 (`browserslist` + `npm run check:syntax`); feature-detect anything newer.
- Design: spacing 12 / 24 / 48 px (`space-micro/base/section`), type 32 / 24 / 18 / 16 / 14 / 12; the shared interaction classes in `globals.css` (`.ea-interactive`, `.ea-surface`, `.ea-icon-btn`, `.ea-cta`); focus is global, never add `focus:` styles; `rounded-lg` is 12 px here; a shared class never sets `display` or width; `sm:gap-base` is dead, use `sm:gap-6`.
- Media: a capture attaches first (nothing heavy before the tile); uploads go DIRECT to storage (a Vercel body is capped at 4.5 MB); one video renderer (`VideoFrame`), one upload queue. Results are never lost: "delete" on a result is a hide unless `planResultDelete` allows more.
- Orgs: `organizations` is ONE table (`kind` league | club); `src/lib/orgs/org-ref.ts` is the one spelling; authority is capabilities (`src/lib/orgs/authz.ts`), never a role string.
- A viewer-dependent API payload is `private, no-store`; a route never takes a media file as its body.
- Before touching a program, read its spec in `docs/specs/` and the devlog entries the spec names.

## Maintenance checklist

Before any round is called done, in order: `npm run verify` (read the exit code explicitly) → `npm audit --omit=dev` → `scripts/hardening-guardrails.sh` → `npm run check:schema` and `check:schema:prod` → the phone-width pass → PR, merge, `/api/health` shows the commit → the prod probe (`npm run test:e2e:prod`, one project at a time) → **a dated entry at the top of `docs/devlog.md`** (what, why, proof). A program that adds rules writes or extends its spec in `docs/specs/` and adds one line to `docs/specs/README.md`. **Nothing is appended to this file**: it holds setup, commands, structure, conventions and this checklist, and stays under 10 k characters.

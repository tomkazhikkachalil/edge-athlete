# Edge Athlete

A multi-sport athlete social network and performance-tracking platform — currently a **golf-first MVP**. Athletes log rounds, track stats and trends, share posts, and connect with other players.

Built with **Next.js 16** (App Router) · **React 19** · **Supabase** (Postgres, Auth, Storage) · **TypeScript** (strict) · **Tailwind CSS 4**.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
#    Fill in your Supabase project values (URL + anon key + service-role key).
#    See .env.example for the full list.

# 3. Run the dev server
npm run dev          # → http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (also runs the TypeScript check) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests |
| `npm run verify` | typecheck + lint + test + build (the full local gate) |

## Database

Migrations live in [`database/migrations/`](database/migrations/), numbered `001`…`030`, applied in order via the Supabase SQL editor. **See [`database/MIGRATIONS.md`](database/MIGRATIONS.md) for the canonical list and workflow** — and note that `database/archive/`, `database/features/`, and `database/fixes/` are historical reference only and must **not** be run against a live database.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — architecture, conventions, and patterns
- [`DEVLOG.md`](DEVLOG.md) — running development log
- [`docs/`](docs/) — feature guides, security audit, roadmap

## Deployment

Deployed on **Vercel** (auto-deploy on push to `main`). Required environment variables are documented in `.env.example`; the Supabase trio (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) is mandatory. CI (GitHub Actions) runs typecheck + lint + test + build on every push and PR.

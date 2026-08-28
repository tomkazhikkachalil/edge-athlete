# Start Session — Edge Athlete Development

> Tom's session-start prompt. Paste this (or point Claude at it) when opening a
> development session. Last aligned with project state: **August 28, 2026**
> (post Family Console Wave 1, migration 128). If the "Where the project
> actually is" section drifts stale, ask Claude to re-align it against
> DEVLOG.md and session memory.

## Context & Vision

I'm building **Edge Athlete** — an athlete-focused networking, media, and
recruiting platform spanning every major sport. The long-term vision is a
global ecosystem built for **a billion users**: thousands of leagues, hundreds
of thousands of clubs and schools, millions of athletes, and decades of
performance data that can be shared, analyzed, and visualized across all
levels of competition — a multi-sport social medium where an athlete's whole
career lives.

The guiding principle is unchanged:

**"Build for today, architect for tomorrow."**

Every feature serves the current launch, but is designed for multi-sport,
multi-tenant scale.

## Where the project actually is (late Aug 2026)

This is no longer an early MVP. The platform is feature-rich, deployed on
Vercel + Supabase, and in pre-launch hardening. Launch blockers are
ops/console gates (docs/LAUNCH_RUNBOOK.md), not code.

**Shipped and live in production:**

- **Multi-sport core** — sport adapter pattern with 6 sports enabled (golf
  deep-dive plus ice hockey, volleyball, basketball, soccer, baseball via
  stat-line adapters; track & field enabled for skill profiles).
  `sport_settings` structure done; the old hardcoded-golf cleanup shipped a
  year ago. Adding a stat-line sport is a 2-edit task.
- **Golf engine** — full WHS handicap (ESR, caps, provisional from round one),
  live shared rounds & scorecards, global course catalog with per-tee data,
  hole-by-hole GPS maps, multi-course clubs.
- **Profiles & stats** — athlete profiles on 3 routes (/athlete, /u, editor),
  vitals dashboard with trends and body-measurement timeline, per-sport skill
  cards with tracked-vs-claimed provenance, layered Stats hub (chips, season
  totals, game logs, PB tables), achievements/trophy case, equipment catalog
  with sport profiles & seasons.
- **Social** — feed, posts (reposts, Notions text rail), nested comments with
  @mentions, likes/saves, follow system with private-profile requests, tagged
  tab, full messaging (DMs, chat dock, action sheets), notifications + email
  digest.
- **Calendar** — views, invites, recurrence, reminders, ICS feeds, workout
  routines on events, drag-create, org fan-out.
- **Media** — in-house WebGL2 photo editor (Lightroom-class), video editing,
  capture inputs on all 9 media surfaces, private storage bucket behind an
  authenticated same-origin proxy, EXIF/GPS stripping.
- **Family console (guardian layer)** — supervised child profiles, consent
  workflow, approvals (posts/comments/follows), acting-as posting, transfers,
  co-guardians, 30-day soft-delete with restore, safety-rail semantics
  (feature flags switch surfaces, never safety). Currently mid-program: a
  5-wave console rebuild — Wave 1 (safety rail) is closed; Wave 2 (unified
  action queue + family calendar surface) is next.
- **Search & geo** — instant search, places, clubs, leagues, affiliations,
  facets.
- **Hardening** — RLS everywhere, CI route-authorization audit, enforced CSP,
  rate limiting, RPC grant audits, soft-delete/purge cron, dark mode, e2e
  smoke suite (desktop + @mobile projects) run against prod after merges.

## Production standard (the baseline, already in force)

- `npm run verify` (typecheck + lint at zero warnings + tests + build) is the
  gate; nothing lands red. No silent catches, no local-only fixes.
- Work lands as atomic PRs (auto-merge enabled), never direct pushes; each
  round ends with a prod probe against the live deployment and a DEVLOG entry.
- **Web + mobile ship together**: every change is verified at phone width
  (~375px), including reachability and route parity (/athlete vs /u).
  Responsive design is a verification duty, not a porting task.
- Schema changes are numbered migrations in database/migrations/ (currently
  at 128), the source of truth for the schema.
- Secrets live in environment variables (Vercel-managed); guardian/minor data
  follows the standing safety lines (no DM transcripts, never auto-publish a
  minor's post, append-only consent/audit).

## Each session

1. Pick up from where we left off — check memory and DEVLOG for the open
   program and continue it unless I say otherwise.
2. Verify recent merges are properly integrated (and prod-probed if that's
   owed).
3. Keep every decision aligned with the long game: a professional-grade
   platform scaling from today's golf-first community to a global,
   multi-sport, billion-user athlete network.

## Long-term direction (unchanged)

Organizations (clubs, schools, leagues) as multi-tenant entities → team pages
and league structures → a full event model (games, matches, tournaments) →
recruiting, scouting, and verification workflows. The multi-sport recruiting
dataset is the real long-term asset; capture is designed for it today.

## Real-world conditions

Design for real users, not lab conditions: multiple tabs, slow devices, old
browsers, flaky connectivity, never-cleared caches. Rugged and resilient
beats clever.

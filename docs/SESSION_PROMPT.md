# Start Session — Edge Athlete Development

> Tom's session-start prompt. Paste this (or point Claude at it) when opening a
> development session. Last aligned with project state: **September 3, 2026**
> (post program 10 and the quick-fixes round, migration 176). If the "Where
> the project actually is" section drifts stale, ask Claude to re-align it
> against DEVLOG.md and session memory.

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

## Where the project actually is (early Sep 2026)

This is no longer an early MVP. The platform is feature-rich, deployed on
Vercel + Supabase, and in pre-launch hardening. Launch blockers are
ops/console gates (docs/LAUNCH_RUNBOOK.md), not code.

**Shipped and live in production:**

- **Multi-sport core** — sport adapter pattern with 6 sports enabled (golf
  deep-dive plus ice hockey, volleyball, basketball, soccer, baseball via
  stat-line adapters; track & field enabled for skill profiles).
  `sport_settings` structure done; the old hardcoded-golf cleanup shipped in
  August 2026. Adding a stat-line sport is a 2-edit task.
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
  routines on events, drag-create, org fan-out, layered household view with
  person/category chips (on /calendar and in the feed sidebar).
- **Media** — in-house WebGL2 photo editor (Lightroom-class), video editing,
  capture inputs on all 9 media surfaces, private storage bucket behind an
  authenticated same-origin proxy, EXIF/GPS stripping with orientation baked
  upright first.
- **Family console (guardian layer)** — supervised child profiles, consent
  workflow, approvals (posts/comments/follows), acting-as posting, transfers,
  co-guardians, 30-day soft-delete with restore, safety-rail semantics
  (feature flags switch surfaces, never safety). The console rebuild and its
  follow-on (dispatcher, autonomy/viewer seats, archive, carpool) are
  COMPLETE (Aug 28–29).
- **Organizations (multi-tenant)** — the org platform, phases 0–6b (Aug 30–
  Sep 1) then 6c–9 and program 10 (Sep 2–3): org console + athlete claim,
  the competition model (house/rep/leaderboard, standings, calendar mirror),
  public org sites with SEO (own root layout, ISR + CDN, custom domains,
  /{slug} vanity paths, share cards), automatic flows (stat lines → profile,
  contest media → Tagged tab, photo consent, public galleries), registration
  (programs/windows, family wizard, registrar console, season rollover),
  sanctioning chains, disputes, CSV/structure/schedule import, golf leagues
  that fill themselves (rules, week hubs, season generator), golf club sites
  (course pages with hole maps, course stats, golf leaders, announcements),
  club sign-up, club privacy + join approval, the /clubs directory, and the
  media/news layer (news covers, share-card hero, announcement archive with
  site Notices, per-hole course photos, members' round-photo galleries with
  member opt-in + manager curation). Payments skipped by decision; leagues
  do not yet have the clubs' privacy/approval settings.
- **Search & geo** — instant search, places, clubs, leagues, affiliations,
  facets.
- **Hardening** — RLS everywhere, CI route-authorization audit, enforced CSP,
  rate limiting, RPC grant audits, soft-delete/purge cron, dark mode, e2e
  smoke suite (desktop + @mobile projects) run against prod after merges.

**No program is open.** Program 10 (media and news depth) closed Sep 3 and
the quick-fixes round (#551) shipped the same day. The next program is Tom's
call; candidates in session memory. Tom still owes ops: Search Console,
custom-domain env, device passes.

## Production standard (the baseline, already in force)

- `npm run verify` (typecheck + lint at zero warnings + tests + build) is the
  gate; nothing lands red. No silent catches, no local-only fixes.
- Work lands as atomic PRs (auto-merge enabled), never direct pushes; each
  round ends with a prod probe against the live deployment and a DEVLOG entry.
- **Web + mobile ship together**: every change is verified at phone width
  (~375px), including reachability and route parity (/athlete vs /u).
  Responsive design is a verification duty, not a porting task.
- Schema changes are numbered migrations in database/migrations/ (currently
  at 176), the source of truth for the schema.
- Secrets live in environment variables (Vercel-managed); guardian/minor data
  follows the standing safety lines (no DM transcripts, never auto-publish a
  minor's post, append-only consent/audit).

## Each session

1. Pick up from where we left off — check memory and DEVLOG for the open
   program and continue it unless I say otherwise.
2. Verify recent merges are properly integrated (and prod-probed if that's
   owed).
3. Flag anything in this document that DEVLOG says is now stale.
4. Keep every decision aligned with the long game: a professional-grade
   platform scaling from today's golf-first community to a global,
   multi-sport, billion-user athlete network.

## Long-term direction (unchanged)

Organizations (clubs, schools, leagues) as multi-tenant entities → team pages
and league structures → a full event model (games, matches, tournaments) →
recruiting, scouting, and verification workflows. The first three steps are
now live (see Organizations above); ranking, scouting, and verification
workflows are what remains. The multi-sport recruiting dataset is the real
long-term asset; capture is designed for it today.

## Real-world conditions

Design for real users, not lab conditions: multiple tabs, slow devices, old
browsers, flaky connectivity, never-cleared caches. Rugged and resilient
beats clever.

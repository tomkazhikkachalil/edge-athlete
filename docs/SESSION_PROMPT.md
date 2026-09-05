# Start Session — Edge Athlete Development

> Tom's session-start prompt. Paste this (or point Claude at it) when opening a
> development session. Last aligned with project state: **September 4, 2026
> (close of day, after the maintenance sweep #582)** — post the Org Staff
> Program (#576–#581, migration 178) and the camera incident's close (#575). If the "Where the project
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
  authenticated same-origin proxy, EXIF/GPS stripping. **Capture v2 (Sep 3,
  #574):** a camera capture attaches as a tile immediately, the editor is the
  tile's pencil, video metadata is scrubbed server-side, the JPEG strip keeps
  Orientation; an in-app camera (getUserMedia/MediaRecorder) is a fallback
  behind a touch-only link. Proven on other phones Sep 4; the one device that
  still failed (Tom's iPhone after an iOS update) fails at the OS camera
  boundary in every browser — device, not app. `/app/diag/media` is the
  on-device measurement page; read its log before touching capture code.
- **Family console (guardian layer)** — supervised child profiles, consent
  workflow, approvals (posts/comments/follows), acting-as posting, transfers,
  co-guardians, 30-day soft-delete with restore, safety-rail semantics
  (feature flags switch surfaces, never safety). The console rebuild and its
  follow-on (dispatcher, autonomy/viewer seats, archive, carpool) are
  COMPLETE (Aug 28–29).
- **Organizations (multi-tenant)** — the org platform, phases 0–6b (Aug 30–
  Sep 1) then 6c–9 and programs 10–12 (Sep 2–3): org console + athlete claim,
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
  member opt-in + manager curation), and leagues parity (program 11: one
  side-generic membership-and-privacy layer — visibility, join approval, the
  join door, private-site gates, members' reads, the /leagues directory),
  and league round photos (program 12: the members' round-photo layer for
  both sides), then the **Org Staff Program** (Sep 4, #576–#581, migration
  178): organizer accounts, section-scoped staff grants read by one
  capabilities module, intents on every route family, owner-minted email
  invites, the Hierarchy & people console section, season expiry at
  rollover. Payments skipped by decision.
- **Search & geo** — instant search, places, clubs, leagues, affiliations,
  facets.
- **Hardening** — RLS everywhere, CI route-authorization audit, enforced CSP,
  rate limiting, RPC grant audits, soft-delete/purge cron, dark mode, e2e
  smoke suite (desktop + @mobile projects) run against prod after merges.

**No program is open.** The **Org Staff Program** (Sep 4, #576–#581,
migration 178 — RUN) closed the same day it opened: **organizer accounts**
(a `user_type 'organizer'` with no date of birth; the Club/League door asks
"Do you already have an account?" first), **section-scoped staff grants**
on the one membership table (`kind='staff'`, `admin` or a `sections[]`
subset of the nine console keys at org | division | team scope; the
capabilities reader in `src/lib/orgs/authz.ts`; every route family names
its intent; `manage_org` stays owner|manager|admin — "not the overall
site"), **owner-minted email invites** (`/org-invite/[token]`, wrong-account
safe, audit-trailed), the console's **Hierarchy & people** section with
Invite on every node, reachability for section staff, and **season expiry
at rollover**. Every round prod-proven (the door, capabilities, the intent
matrix, the invite loop, the hierarchy on both mobile engines). Before it,
program 12 (league round photos), program 11 (leagues parity, migration
177), program 10 and the quick-fixes round all closed Sep 3; the camera
incident closed Sep 4 as a device issue. The close-of-day maintenance
sweep (#582: gate green on `main` — 2,759 tests, floor gate, lint at zero —
guardrails + `npm audit` clean, branches pruned, deploy verified) leaves
`main` at the #582 merge (1441646) with nothing in flight. The next program is Tom's call; candidates in session
memory. Tom still owes ops: Search Console, custom-domain env, device
passes — including the capture-fix pass (three portrait photos un-edited,
one edited photo + a video, a live-round hole photo) and a first real
staff invite on his own league.

## Production standard (the baseline, already in force)

- `npm run verify` (typecheck + lint at zero warnings + tests + build) is the
  gate; nothing lands red. No silent catches, no local-only fixes.
- Work lands as atomic PRs (auto-merge enabled), never direct pushes; each
  round ends with a prod probe against the live deployment and a DEVLOG entry.
- **Web + mobile ship together**: every change is verified at phone width
  (~375px), including reachability and route parity (/athlete vs /u).
  Responsive design is a verification duty, not a porting task. Phone width
  covers layout, not memory: media work is verified with phone-SIZED inputs
  (`e2e/fixtures/rotated6-12mp.jpg`), not thumbnails.
- Schema changes are numbered migrations in database/migrations/ (currently
  at 178), the source of truth for the schema.
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

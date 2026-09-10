# Start Session — Edge Athlete Development

> Tom's session-start prompt. Paste this (or point Claude at it) when opening a
> development session. Last aligned with project state: **September 9, 2026
> (after the Site Builder program, #616–#634)** — migration head 180;
> `main` at the #634 merge (32d86de5), deployed (the prod release meta reads
> 32d86de5). If the "Where the project actually is" section drifts stale, ask
> Claude to re-align it against DEVLOG.md and session memory.

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
guardrails + `npm audit` clean, branches pruned, deploy verified) left
`main` at the #582 merge (1441646) with nothing in flight.

**Sep 8 — a small-refinements round, one PR per fix, each prod-proven, zero
DDL** (Tom: "before we make any big changes, let's work on a few small
aspects"): #584 mentions and post tags render the person's chosen name
instead of the `@handle` (display only — stored text keeps the handle;
the Aug 9 id+handle-only hydration rule was reversed on the record);
#585 the "Private" badge no longer sits on the author's name at phone
width (root cause: the nowrap timestamp drawing under the owner cluster;
a lock glyph below `sm`); #586 an owner's pin/edit/delete collapse into
one "…" menu below `sm` (`PostOwnerMenu`, portaled, `placeMenu`;
`usePopoverDismiss` now takes several refs and makes Escape close the
topmost popover only). The close-of-day sweep (#587: gate green on
`main` — 2,764 tests, floor gate, lint at zero — guardrails + `npm audit`
clean, branches pruned, memory index trimmed) leaves `main` at the #587
merge (02caee0) with nothing in flight. One incident from the sweep: the
GitHub → Vercel webhook missed the docs-only #587 merge (the three fix
merges all fired); production was deployed manually from the synced
`main` and carries the merge SHA — check for a deployment row after
every merge, and re-fire by hand when there is none.

**Sep 8 — Onboarding v2 (the Club Model's onboarding slice; #589–#594,
migration 179, every round prod-proven the same day).** Tom pasted "The
Club Model" and asked to improve club and league onboarding with it. Three
audits found its principle already law (golf principle 2) and its
inventory stale — most "new" objects were built; five small walls blocked
a four-friends club. Now: an org is LIVE BY LINK from creation and admin
approval gates only the LISTING (`listing_status`; directory, sitemap,
search, noindex); a supervised profile can never create an org; the wizard
is one screen on the small path from every entry point (name, sport, home
town, directory-or-link-only, a collapsed "more details") and hands off
into the console; members join by a link the console shares and can count
themselves in leagues (adults in one act, supervised via the guardian
offer); a golf org's season, league and weekly windows start with one tap
at any course; the public site fills from members' posted rounds (a
members table and leaders, description under the hero) with zero admin.
Parked from the spec: competition formats (Stableford, match play,
allowance, order of merit), brackets, ad hoc teams, external athlete
entries, hole-level contest media. The docs close (#595: masterplan
§4/§6/§8/§11, CLAUDE.md convention 10, this doc) and the evening sweep
(#596: gate green on `main` — 2,792 tests, floor gate, lint at zero —
guardrails + `npm audit` clean, branches pruned, memory index trimmed;
the webhook fired for every merge since the #587 miss) closed the program.
The end-of-session sweep (#599) found one new item: GHSA-p293-qw3h-jr36, a
critical Next advisory (Windows-hosted servers only; prod is Linux) that
turned the guardrails' `npm audit` step red for every PR — fixed by #598,
`next` + `eslint-config-next` 16.3.1 → 16.3.4 within the existing ranges,
lockfile only, verify green incl. the browser-floor gate; then sharp
(libheif, via the `overrides` pin → 0.35.4) and nodemailer (→ 9.1.1) in
#600 when two more advisories landed mid-sweep (prod after #600: Ready on
the alias, `/_next/image` encodes AVIF and WebP; the floor gate was run on
the downloaded deployed chunks after #598). A temporary demo
golf club (Tom as owner, unlisted, 8 QA members, 47 rounds, a running
points-race league) was seeded on prod for screenshots and torn down the
same evening; the sweep verified nothing of it remains. The public-site
breakdown/wireframes artifact from that walk-through is linked in session
memory. That close left `main` at the #599 merge (64c3ef8e).

**Sep 8 evening — five quick fixes, one PR each, every one prod-proven,
zero DDL** (#602–#606): a golf post's hole cells got outlines (the par
bucket in `SCORE_CELL_RING` had none, so pars floated) and the feed card's
player rows took the detail Overview's look — no hole strip, creation
order, no medals (Tom lifted the Aug 10 feed-rendering freeze for it; it
stands again); the feed sidebar calendar opens on Month (prefs key bumped
to v2 so the flip landed for everyone); the post header shows the name
only (no `@handle`, also in the quoted-post embed); the chat dock's
minimized pills are a translucent light violet (the white `ea-surface`
chip vanished on the canvas; the dock is desktop-only) and they now order
newest-at-left (MINIMIZE prepends; cap evictions still append). Two of
those PRs collided on the DEVLOG's top entry — the second needed a rebase.

**Sep 8–9 night — the Org Pages Program (#607–#612), COMPLETE and
prod-proven.** Tom: "take the principles from how we polished up the
Vitals section and apply them to the league and club pages … not enough
media integration … connected back to the styling of the app." Five
rounds, one PR each, every one merged by Tom and probed on production
before the next opened; zero DDL; two routes added (baseline 257).
**R1** #607 folded the 983-line league/club page twins into one `OrgPage`
(`side` prop) with a byte-identical DOM proof against production.
**R2** #608 gave it the `.org-app-scope` dialect (the two shadow levels
re-pointed, never `--brand`; `.ea-bubble` / `ea-pop-in` / `--ea-spring`
lifted from Vitals) and a media hero — the site's logo, hero photo and
accent ride the org GET as `brand`; a DRAFT site's brand shows for
everyone (Tom's call; the bytes were already anonymous) with a "Site
draft" pill for managers; a theme-readable text tint is derived per
surface with no new column. **R3** #609 put every section behind a
tappable bubble (one big number + a sub-line) whose `LargerWindow` hosts
the existing section unchanged (`bare`); 13 specs tap the bubble first
(`e2e/helpers/org-page.ts openWindow`); `?window=` deep links; the page
hook shows its spinner on the first load only (a refresh used to remount
the page — and would have closed the window a mutation was made in).
**R4** #610 brought the site's media in-app: a Photos bubble on a new
`/api/{leagues,clubs}/[id]/gallery` read under IDENTICAL public gates
(masked labels — one policy), news covers, course + hole photos, and two
bug fixes it found (the activity thumbnail broken since the media-privacy
flip; one Escape closing two layers — `LargerWindow` now yields to the
topmost dialog). **R5** #611 added the members' posts wall on a new
`?org=<side>:<id>` arm of the posts route (the org lens's own rule,
`withMedia=1`, members-only for a private org; supervised authors not
additionally excluded, by decision). The close (#612) added CLAUDE.md
convention 11 naming the house pieces. Left for later, on purpose: retire
the `.vt-card` / `.vt-pop-in` aliases and the two vitals re-export shims;
the all-day event date semantics on the Events face; logos in the public
directories. Standing traps from the night (in session memory): the e2e
global setup mints fresh QA users per run; a gate that stops at typecheck
leaves the OLD build for any spec run that follows; prod streamer checks
after a revoke need a cache-busted URL; the pop-in entrance scales cards
for 350ms, so measure after the animations settle.

After the close, Tom asked for a preview of the org pages: an artifact of
production captures, then rebuilt as a FILLED club (seven disposable
accounts, a five-week Thursday league two weeks in, news with covers,
announcements, a course with hole photos, a six-photo gallery, six member
round posts) seeded against a LOCAL production build and torn down in the
same run — nothing reached production. The link is in session memory.
The end-of-session sweep (#614, DEVLOG only) closed the day: gate green on
`main` — 265 files / 2,815 tests, 171 static pages, the floor gate over
163 chunks — guardrails green, `npm audit` 0 at every level; the webhook
fired; the floor gate was re-run on 34 downloaded deployed chunks.

**Sep 9 — the Site Builder program (#616–#634), BUILT.** Tom's design doc
("Edge Athlete Site Builder": a dashboard editor whose panels are public —
a closed widget catalog bound to live queries, a constrained 12-column grid
with per-widget constraints and vertical compaction, one composition
rendering web + in-app with mobile derived, chrome fixed, draft → publish →
revisions, templates and a checklist) superseded masterplan §6. Nineteen
PRs, one per step, each merged by Tom before the next opened; ONE migration
(180, `org_site_revisions`); phases 6–8 zero DDL. **Phase 1** (#616–#620):
the Manage menu, the widget registry (zero imports; `WEB_WIDGET_KEYS` ≡
`MODULE_KEYS` pinned), the public home and the glance grid rendering ONLY
from a layout — both byte-identical proofs. **Phase 2** (#621–#623): drafts,
publish, history, restore; the rows of `org_sites` / `org_site_modules` are
the PUBLISHED PROJECTION, mirrored on publish; the preview in its own route
group. **Phase 3** (#624–#627): one data resolver with three callers, the
grid editor on react-grid-layout (undo, autosave, conflict chip, a phone
notice with working doors), the public grid renderer ("empty widgets never
render publicly"), the picker whose tiles preview the club's own data.
**Phase 5** (#628): the properties panel generated from field descriptors —
content stays on the org objects and wins over the instance. **Phase 6**
(#629–#630): text / image / embed widgets riding the layout INSTANCE under
the gate (a deviation from the plan's `org_site_blocks` table, recorded:
a block row would go live before Publish); embeds are a structure, never a
URL; `frame-src` in both CSP builders; a compact block editor, photo upload,
paste-a-link. **Phase 7** (#631–#632): the template's decisions became theme
tokens with the template as fallback; five self-hosted OFL heading faces, one
loaded per site only when chosen; the canvas finally wears the brand; the
theme panel with live preview and a contrast readout. **Phase 8**
(#633–#634): template seeds (order = side × sport, pairing = template),
publish metrics into `revisions.stats`, two draft-fidelity fixes (the canvas
after a publish; a fresh draft inheriting the published layout), the
checklist rail. CLAUDE.md convention 12 names every invariant.

`main` is at the #634 merge (32d86de5), deployed; the public renderer
(grid, seeds, theme tokens, heading faces) is live for every site. The editor went live behind a flag on Sep 9 (Vercel env + rebuild) and
became the Website section's door in phase 10 (P10-C, the flag retired). Open:
(a) the rollout — flag on, a prod probe with a disposable org, a real
branded club through the editor on Tom's phone and laptop, the one-hour
metric read from `revisions.stats`; (b) the phase-3 leftover — several
instances of one module widget; (c) older ops Tom owes: Search Console,
custom-domain env, the capture-fix device pass, a first real staff invite.

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
  at 180), the source of truth for the schema.
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

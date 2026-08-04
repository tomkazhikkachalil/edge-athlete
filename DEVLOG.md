# Development Log

## August 4, 2026 — Custom equipment sets: "Tournament bag" as a first-class shelf

Third store-browse pass. Tom's grouping rule: smart auto-groups by default,
with the athlete able to custom-assign — "most kids would just have
equipment with small changes year over year," so the custom layer must cost
nothing to ignore. It does: one nullable column.

**Migration 064** adds `athlete_equipment.group_label TEXT`. A column, not a
groups table — no ordering, no empty sets, no per-set metadata needed in v1,
so a label avoids a join, new RLS policies and a second CRUD surface. NULL
is exactly today's behavior. ⚠️ **Order of operations: 064 must run BEFORE
this deploys** — POST and validateEquipmentPatch write the column
explicitly (42703 otherwise); the GET is `select('*')`, so the column
landing early breaks nothing.

**Semantics: sets RE-FILE, they don't duplicate.** A labeled item moves out
of its category shelf and into its ★ set shelf (rendered above the
categories, violet rail entries above the category entries). Partition
happens AFTER the season filter, so a set shelf in a year view holds only
that year's members and disappears when empty — one rule. Labels are
trim-matched case-insensitively with first-seen casing preserved
(`partitionByGroupLabel`, node-tested), and the modal's new "Set /
Collection" field carries a datalist of the athlete's existing labels so
typos don't fragment sets. Cap 60 chars via `EQUIPMENT_FIELD_CAPS`; PATCH
flows through `validateEquipmentPatch` (empty/null clears); no distinct-
label count cap (an athlete can only clutter their own profile — accepted).

E2E extended: seed a labeled putter → ★ "Tournament bag" shelf above the
categories, rail entry present, and NO Putter category entry (re-filing
proven). `deleteQaUser` already clears `athlete_equipment`.

## August 4, 2026 — Equipment seasons: the time machine strip

Second store-browse pass: "you can also go back in time and see all the
legacy equipment, what they used season over season." A chip strip —
**Now · 2026 · 2025 · …** — above the shelves (explore-page chip-rail
pattern, ARIA tablist, edge-bleed below sm). Picking a year re-renders every
sport section as **that season's bag**: everything in-bag-during-Y via the
existing `isInBagDuringYear`, INCLUDING gear retired since — which is
exactly what "what did they play with in 2024" means. Headings carry the
year ("In the Bag — 2024"), the rail gets a Seasons entry, and each card's
ownership span ("2021 – 2023") does the storytelling.

**It replaces the year multi-select filter** (single-select timeline was
the chosen model; multi-year cross-sections are gone deliberately).
**History is NOT replaced** — a season view renders no History section (the
view is itself historical), but the 'now' view keeps it, because its
"Earlier" bucket is the only home for undated retired gear. That constraint
became a real bug during testing: `isInBagDuringYear` reads a null
retirement date as "still in the bag", so an undated RETIRED item would
have ghosted into every season. `filterEquipmentForView` (pure, 5 new node
tests) excludes date-less retired rows from year views explicitly.

**Two spec traps recorded:** the rail ALSO has a "History" button, and
`getByRole(...).first()` resolves to it (DOM order: rail before sections) —
its handler always opens, never toggles, so a "collapse" click silently
re-opened; scope History toggles to `section`. And a season assertion after
opening History must collapse it first — the retired card is legitimately
visible in Now view through the open History.

## August 4, 2026 — Equipment goes store-browse: category rail + shelves on desktop

Tom's verdict on the morning's redesign: nice, but stacked boxes don't FLOW
on web — it should navigate like a sports store, and survive a sponsored
athlete listing hundreds of items. First of three passes (rail+shelves,
then a seasons timeline, then custom sets).

**The layout.** At lg+ the Equipment tab becomes rail + shelves inside the
existing ~1184px content box (deliberately NOT widening `max-w-7xl` — that
would restyle the whole profile): a ~210px sticky category rail (docked
under the app header via the `--ea-banner-h` contract at z-30, the first
sticky sidebar in the app) listing each sport's categories with active
counts plus a History entry, and each category rendering as a **horizontal
shelf** — the canonical LiveNowStrip pattern (`overflow-x-auto
scrollbar-hide` + `shrink-0` cards at 240-260px), where the partially
cut-off card is the "more here" affordance. No scroll-snap, no arrow
buttons (none exist in the app; consistency beats novelty). "**See all N ›**"
in the category header swaps the shelf to a grid in place. Below lg nothing
changes — the stacked flow the phones already verified.

**One DOM, CSS-switched.** `EquipmentShelf` renders a single child list
whose container classes flip grid↔strip by breakpoint; card width lives on
a `ShelfCard` wrapper, not in any shared class (the `.ea-icon-btn` lesson:
shared classes never own display/width). Rail jumps are plain
`scrollIntoView` + `scroll-mt-24` anchors — no scrollspy in v1 (a whole new
observer pattern the lint ratchet doesn't need today); History jumps also
expand the target section first via one rAF hop.

**Decomposition.** The 677-line EquipmentSection shed its card
(`equipment/EquipmentCard.tsx`, moved verbatim) and gained
`equipment/EquipmentShelf.tsx` + `equipment/EquipmentRail.tsx`. The rail's
data model is a pure `buildEquipmentNav` in equipment-display.ts (config
lookups injected; anchor ids from a shared `equipmentAnchorId` slugifier so
rail and sections cannot drift) — node-tested like the rest of the module.

**Verification.** The equipment e2e spec now seeds 5 drivers and drives the
chrome: rail visible at 1280, rail entry jump lands the category block in
the viewport, "See all 5" expands and collapses, and the retire step is
scoped to the card under test (five Retire buttons exist now). Screenshot
pass at 320/768/1280/1536: zero horizontal overflow everywhere, rail stays
docked under the header while scrolling. Zero new effects; lint stays at
the 45 cap.

## August 4, 2026 — Equipment: search, sort, and gear that illustrates itself

The second half of the equipment pass (the IA landed separately): finding
things and Tom's "images should be auto added — people might get lazy."

**Search + sort.** Client-side (the GET already returns everything):
case-insensitive substring over brand/model/notes and BOTH the raw category
value and the humanized label athletes actually see; sort by Newest
(acquisition date, audit-timestamp fallback, undated last) or Brand A–Z.
Both are pure functions in `equipment-display.ts` with tests. The controls
sit on their own row — input `flex-1 min-w-0`, fixed select — so the pair
always fits one line at 320px. A sport section with zero matches disappears
whole. The planned third sort ("by category") was dropped as meaningless:
the setup grids already GROUP by category, so it would have been a no-op.

**Auto imagery = brand logos, not product photos.** The one prior attempt at
product imagery is a documented graveyard (124 of 126 external catalog URLs
dead), so the honest automatic image is the brand mark logo.dev already
serves. `resolveBrandDomain` (equipment-catalog) maps free-text brand →
seed domain by exact canonical/alias match, then the same across every
sport's seeds (golf brand on a General item still resolves) — and NEVER
fuzzy-matches: a wrong logo is worse than none. Cards get a 16px mark
beside the brand name, and the image well's fallback chain is now
photo → large brand logo → category emoji. `BrandLogo` grew an optional
`fallback` node for exactly that (the picker rows keep their letter tiles);
its no-token behavior is unchanged, so cards degrade to the emoji cleanly.

**E2E:** `equipment.spec.ts` — seed via API → renders under "In the Bag"
with an imagery element (asserting an element, not logo.dev bytes — CI may
lack the token) → search narrows and empties honestly → Retire moves it
into History's current-year bucket. `deleteQaUser` now also clears
`athlete_equipment`. New locator-trap entry: the athlete profile has OTHER
"Golf" headings (sport posts strip), so equipment assertions anchor to the
section that carries the setup label.

**Explicitly out, on purpose:** gear-on-rounds linking (needs composer +
post-render work — the natural next equipment feature); community
suggestions (deferred with the documented k≥2 privacy floor);
`/u/[username]` equipment (the public page has no equipment surface at
all); product-photo scraping (see graveyard, above).

## August 4, 2026 — Equipment becomes a per-sport profile: current setup vs. history

Tom's direction, near-verbatim: every sport's gear grouped like a mini
profile — see what you're playing with NOW; history legible year over year,
driven by the dates; "bag makes sense for golf, for biking it wouldn't."
The insight that kept this PR small: **the data model already had all of
it.** "Current setup" is `status='active'`; history is the retired rows plus
`retired_on`. No new columns — the whole change is presentation.

**The new shape.** One section per sport (header + "3 active · 1 retired"
counts — always rendered now; the section IS the sport's gear profile, so
identity beats the old only-when-multi-sport rule). Inside: a
**current-setup group** (active items, category-grouped as before) under a
sport-appropriate label — `getSetupLabel()` in equipment-config, golf says
"In the Bag", everything else defaults to "Current Setup", and a sport
without a meta entry degrades to the default rather than breaking. Then
**History**: collapsed by default, retired gear bucketed by retirement year
descending (user date first, audit timestamp fallback, an "Earlier" bucket
for undated legacy rows). Grouping/counting are pure functions in the new
`src/lib/equipment-display.ts` with node tests; the component only derives.

**The status filter is gone** — active/retired is structural now, so the
select was redundant, and it was one of the controls that made the FilterBar
wrap to ~4 rows at 320px before any gear was visible. Sport and year filters
stay (the year filter answers "what was in my bag during 2023" — a
cross-section the year-grouped History can't).

**Polish debts from the exploration, same pass:** cards `rounded-xl` →
`rounded-lg`; retired dimming moved off the card root onto image+info so
Edit/Activate/Delete keep full contrast; redundant `lg:grid-cols-3` dropped;
`resultNoun` aligned with sibling tabs; ReplaceEquipmentModal matches
AddEquipmentModal's shape (`rounded-xl`) and its stale
`golfwrx.com`-special-case `unoptimized` hack now uses
`isOptimizableImageSrc`; equipment-catalog `DEFAULT_LIMIT` 60 → 100 (golf
has 73 brand seeds — browse-all was silently truncating, and the production
verify at the time even recorded "golf 60" without flagging it).

Verified with a scripted browser pass (seeded golf active ×3 / retired ×1 +
soccer retired ×1 via API): sport sections and labels render, History is
hidden until expanded and shows year buckets, zero horizontal overflow at
320/768/1280. Cleanup left no rows.

## August 4, 2026 — Smoke suite v2: the social loop finally has a second player

The suite's biggest blind spot was that every spec ran as one user — and the
bug class this app keeps producing (PR #33's invisible live rounds, the
silent shared-round invites before that) is precisely "works for me, broken
for the other person." Three new specs close it: a full follow-request loop
(A requests on B's private profile → B accepts on Fan Requests → A sees the
acceptance notification), a DM loop (A opens the conversation and messages
via API, B reads AND replies in the real UI, A sees the reply, B gets the
notification), and a shared-round invite (A creates a round with B as
participant → B gets the group_invite notification).

**Why the cross-user setup goes through the API:** `/api/search` filters
athletes to public profiles only, so two private QA users cannot find each
other in ANY search UI (New Message modal, Tag People). Rather than make B
public — which would break the follow-request path, since only private
targets produce pending requests — relationships are created with
`request.newContext` carrying the minted cookie, and the assertions stay in
the real UI. One private B satisfies all three flows because privacy blocks
neither DMs (messaging_permission defaults to 'everyone') nor invites.

**Teardown grew a social-cleanup block**, and it runs FIRST: cross-user rows
are what block the partner's deletion — a conversation's messages from BOTH
sides, follows in either direction, and (the sneaky one) notifications where
the user is the ACTOR, which are owned by the other user. The teardown
deletes B then A, attempting both even if one throws, so the second deletion
constantly re-proves the steps idempotent. Verified: full suite twice
back-to-back, both users deleted every run, zero `edgeqa-*` residue by
admin listing.

**The trap this session recorded:** name-based assertions must match how
each surface COMPOSES names, not what the profile says. Nearly everything
renders `formatDisplayName(first, last)` ("Edge Alpha") — but the messaging
notification title alone uses the full display name ("Edge QA Alpha sent
you a message"). Three assertions failed on exactly this before being
pinned to per-surface copy. QA users are now "Edge QA Alpha"/"Edge QA
Bravo" — distinct, and neither name a substring of the other, or every
`getByText` would ambiguate.

## August 4, 2026 — The empty scorecard: a manual course now gets its grid on mount

The bug the smoke suite surfaced yesterday, fixed the day after — with the
suite's workaround deleted so the spec now pins the repaired path.

**Root cause was a regression from the react-hooks cleanup (`01c40d4`).** The
grid-building `useEffect([holeCount, startingHole])` in GolfScorecardForm ran
on mount; its render-phase-sync replacement fires only when the count/start
CHANGE, and `syncedHoles` seeds from the current values — so at the default
(18, front) it never fired at all. A manually-typed course rendered a
scorecard with zero score cells and Create Post stayed disabled. Worse,
quick-entry LOOKED fine (ScoreEntryModal builds its own grid from
`holesPlayed`) while silently wrecking data twice over: every par fell back
to 4 (`holePar` guard on empty hole data), and its `onSave` merge maps over
the form's `holesData` — `[].map` — so every entered score was discarded
without an error.

**Fix:** the grid loop is now `buildDefaultHoles(holeCount, startingHole)` in
`src/lib/golf/scoring.ts` (the file that owns par knowledge), and `holesData`
seeds from it in a lazy `useState` initializer — no effect, no new
`set-state-in-effect` warning, and the change-guard stays exactly as it was,
now owning transitions only (it's deliberately false on mount because the
initializer used the same defaults). Six node tests pin the helper: standard
pars sum 72, 9-front = holes 1-9, 9-back = holes 10-18 (sum 36), par-3s get
`fairway: 'na'`, yardages exactly 150/380/520 (deterministic on purpose).

Also removed: the **dead `initialData` prop** — declared, passed by
CreatePostModal, and never destructured. Wiring it would only help a
same-modal-session remount and would create a second initialization path;
two init paths is precisely how this bug was born.

**Still deferred, recorded here on purpose:** `selectCourse` after typing
scores and toggling 18→9→18 both wholesale-replace `holesData`, destroying
entered scores. Real but lower-stakes (both require entering scores FIRST,
then changing the course setup); candidates for a merge-instead-of-replace
pass.

## August 4, 2026 — A smoke suite that gates CI (Playwright, disposable prod users)

The last Sprint 6 item with real substance: `npm run test:e2e` now drives the
built app through Chromium — 7 specs covering health, the anonymous landing
page, a real UI login, a text post's full round-trip (compose → feed → survive
reload), a 9-hole golf round through the composer, and the messages/
notifications surfaces. A `smoke` job in CI runs it on every PR and push to
main, against a `next build` + `next start` server for prod parity.

**Why a new tooling directory is justified** (the repo deliberately deleted
its orphaned `scripts/*.mjs` QA helpers in July): this suite is wired into CI
and gates merges — it cannot rot unnoticed, because rot = red check. The
architecture is the proven session-recipe made permanent: global setup
creates a disposable `edgeqa-<rand>@example.com` user via the admin API
(admin-created users get NO profiles row from the signup trigger — inserted
manually with `email`, which is NOT NULL, and `visibility: 'private'` so
nothing leaks into public surfaces; the row is re-read after insert because a
probe against a missing fixture passes vacuously). Specs run authenticated
via a minted `sb-<ref>-auth-token` cookie (base64url, no padding); one spec
drives the real login UI instead. Teardown always deletes the user walking
the golf chain child-first (the auth cascade 500s while a round exists) and
sweeps `edgeqa-*` orphans older than 24h from killed runs. There is no
staging Supabase — the suite runs against prod by design (Tom's call), which
is also why teardown failure throws loudly instead of logging.

**CI mechanics:** the job gates on a first step checking the secrets (the
`secrets` context is unreadable from job-level `if:`), so forks and
pre-secret runs skip green. Tom's action: add `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` as repo secrets
to arm it. Playwright's Chromium adds ~1–2 min; the report uploads as an
artifact on failure. `vitest.config.ts` now pins discovery to
`src/**/*.test.ts` so `npm run test` can never wander into `e2e/`; `verify`
itself is unchanged (fast, env-free).

**The locator traps earned their keep again** — both recorded ones fired on
the first run: `getByText('Edge QA').first()` resolved to the hidden
off-canvas drawer copy, and an unscoped `/golf/i` clicked a covered element
under the sport-selector overlay. Two new ones for the file: **Escape closes
the whole composer**, not the course-suggestions dropdown; and the scorecard
hole grid **only initializes when the hole count changes** — with a manual
course and the default 18 holes, `holesData` stays `[]` and there are no
score cells until you toggle the count (the spec picks "9 holes"
deliberately). That second one is arguably a product bug for real users
logging a manual course — filed here rather than fixed, it's out of scope.

## August 4, 2026 — Auth residual: the cookie parser stops truncating, and the last 21 hand-rolled gates

Sprint 6's July 23 consolidation (`6f652cd`) collapsed ~19 hand-rolled cookie
parsers into one shared client — but deliberately left each route's own
`getUser()` + 401 block, kept the known-buggy parser, and never updated the
doc that teaches the pattern. This pass finishes the job. Three changes:

**1. `cookie.split('=')` is fixed — as a pure, tested function.** The shared
parser truncated any cookie value containing `=` (base64 padding is the
canonical case) and `decodeURIComponent` threw on a malformed `%` sequence,
turning one bad cookie from any source into a 500 on every request. Logged
since July, unfixed; consolidation made it a one-line whole-app fix. The
parsing now lives in `src/lib/cookies.ts` (`parseCookieHeader`) — no
`next/server` import, so it's testable under the node-only vitest setup —
with 9 cases pinning first-`=` splitting, decode fallback, and the Supabase
cookie shape. Every API route now parses cookies through it.

**2. The 21 residual hand-rolled gates landed on `getServerAuth`, not
`requireAuth`.** The choice matters: these routes wrap their handlers in
catch-alls, and `requireAuth` **throws** a Response — which a catch-all
swallows into a 500 unless every route adds the rethrow boilerplate (the
exact bug this log already records once). `getServerAuth` is non-throwing
and returns the RLS client the routes need anyway, so the diff is strictly
smaller: 17 routes / 21 call sites (comments ×3, sport-settings ×3, the
group-posts and golf families, handles/update, posts/save, check-session),
plus the two optional-auth routes (`privacy/check`, profile media) which now
read the nullable user through the same helper. The 401 body is standardized
on `'Authentication required'` (requireAuth's body; grep confirmed no client
matches the old `'Unauthorized'` string). Left alone on purpose:
`account/delete` and `auth/reauthenticate` (password re-verify, destructive),
and the cookie-WRITER routes (`auth/activate`, `auth/username-login`), which
must stay on `await cookies()` + inline client because the shared helper's
`set`/`remove` are deliberate no-ops. `requireProfileRole` still has zero
call sites — kept, it's the feature-flagged guardian gate, not dead weight.

**3. `src/app/api/CLAUDE.md` stops teaching the deleted anti-pattern.** Since
July 23 the doc has instructed every new route to define a local
`createSupabaseClient` with the buggy inline cookie-split — the exact
boilerplate the consolidation removed. Rewritten around the real helpers
(`getServerAuth` standard gate, throwing variants with the MUST-rethrow rule,
optional auth, lazy `getSupabaseAdmin()` inside handlers), with the
deliberate exceptions listed so nobody "fixes" them.

Roadmap risk #10 / Sprint 6 item 2 annotated as shipped. Verify green; lint
stays at exactly the 45 cap (the 4 auth-only handlers that no longer need the
client had their `supabase` destructure dropped to keep it there).

## August 4, 2026 — Migration-dir hygiene: the last unnumbered strays, and docs that stop lying

Sprint 6 (July 23) unified the three migration dirs and fenced `archive/` with
`DO_NOT_RUN.md` — but left residue this pass clears. No SQL semantics changed
anywhere; every edit to an applied migration is comment-only.

**Ten unnumbered legacy SQL files were still sitting inside
`database/migrations/`** (`add-shared-golf-rounds.sql`,
`create-equipment-table.sql`, the `fix-*`/`optimize-*`/`final-*`/`perfect-*`
RLS scripts) — exactly the kind of runnable-looking stray the archive fence
exists for, parked in the one directory whose contract is "run these in
order". All ten are `git mv`'d to `database/archive/loose-legacy/`, which
already held the strays consolidated from the old `database-migrations/` and
`supabase/migrations/` dirs. The four current-file references to them
(044, 052, 063 headers + `verify-rls-optimization.sql`) now name the archive
path; **older DEVLOG entries keep their pre-move paths on purpose** — history
records where things were.

**Two docs were actively wrong and are gone rather than fixed:**

- `database/migrations/INDEX.md` presented itself as "all database migrations
  in order" while documenting only 001–008. That is the "partial list
  presented as complete" failure mode this project keeps re-learning
  (AGENTS.md core-tables list, the docs index before commit `790aa7b`).
  Deleted in favor of `MIGRATIONS.md`; its two referrers updated, and 018's
  header note about the INDEX.md convention now says the convention was
  retired.
- `database/docs/MIGRATION_GUIDE.md` was generic boilerplate that contradicted
  `MIGRATIONS.md` on nearly every load-bearing point: Supabase-CLI-as-runner
  (explicitly not used here), a staging database that doesn't exist,
  "document in INDEX.md", and — worst — troubleshooting steps that pipe
  scripts from `database/archive/old-migrations/` straight into psql, the
  precise action that broke prod tagging once. The only still-true unique
  content (idempotent-SQL conventions, `(select auth.uid())`, SECURITY
  DEFINER `search_path = ''`) is ported into `MIGRATIONS.md`'s workflow
  section.

`database/docs/README.md` is rewritten to defer to `MIGRATIONS.md` instead of
carrying its own 001–008 table and a fake `supabase sql` command. `fixes/` and
`features/` get local do-not-run READMEs (the warning previously lived only
one level up). Stale range claims (`MIGRATIONS.md` "001…062",
`DO_NOT_RUN.md` "001–030") now say "the numbered files in
`database/migrations/`" — wording that can't go stale again.

## August 3, 2026 — Live rounds were invisible to the audience (PR #33 + migration 063)

The first real two-account test of live following found it broken: a signed-in
non-participant watching a public live round saw the media and nothing else —
no players, no scores, no updates, even on hard refresh. Two independent
defects, each masking the other's absence of errors:

**1. A 200 with empty embeds is what an RLS gap looks like.** The scorecard
endpoint read through the RLS client. `group_posts`, `golf_scorecard_data` and
`group_post_media` all carry a `visibility='public'` SELECT branch —
`group_post_participants` lost its branch in migration 035 (whose header
claims "semantics preserved exactly"; add-shared-golf-rounds.sql had the
branch, 035's rewrite dropped it), and the two score tables never had one.
PostgREST filters every embed independently, so strangers got a perfectly
"successful" response with full media and `participants: []`. No error fired
anywhere; the hook even cleared its stale flag. The route now reads via the
admin client behind `canViewSharedRound()` (`src/lib/golf/round-access.ts`) —
an exact, node-tested copy of the group_posts RLS three-branch rule, with a
sync obligation comment on both sides. Deny is 404, so existence isn't
confirmed.

**2. SUBSCRIBED must never switch off the safety net.** Realtime delivers
`postgres_changes` through the SUBSCRIBER's SELECT policies, so those same
viewers received zero score events — but the channel still reported
`SUBSCRIBED`, and `connectionState === 'live'` disabled the 30s poll fallback.
A total freeze with the net down. `useSharedRound` now polls always (30s
degraded, 60s even while "live"), refetches on visibilitychange, fetches
no-store, and treats a score event with an unknown participant id as a
stale-roster signal (throttled refresh) instead of discarding it. The scores
route also bumps `group_posts.updated_at` per hole save — every viewer holds a
server-filtered subscription on that row and its RLS has had the public branch
since 035, so each hole becomes a realtime tick that worked even before the
migration ran (measured: 3 seconds, scorer's save → stranger's open page).

**Migration 063** restored the public branches on all three tables via
SECURITY DEFINER helpers (035's recursion-safe pattern; both historical
policy-name variants dropped per table) and re-asserted the 031/038 realtime
publication — which had no verified-run record until now. Verified live with a
disposable stranger account: direct reads return rows for a public round and
zero for a private one, and a `golf_participant_scores` UPDATE event reached
the stranger's realtime subscription in seconds. That's the first positive
proof the score publication works in production.

Worth remembering: the feed and Live Now strip read through the admin client,
so every surface Tom had tested before showed correct scores — the one surface
that used RLS reads was the one built specifically for the audience.

## August 2, 2026 — Mobile round 2, and equipment stops being write-once

Round 1 (PRs #27-29) covered the surfaces you look at; round 2 (PRs #30 → #31 →
#32, stacked) covered the surfaces you *do things* in — and shipped the first
real feature to come out of a polish pass.

### The P0s were all "the important control is somewhere you can't reach"

TagPeopleModal clipped the bottom of its results unreachably (80vh +
overflow-hidden + a fixed 300px list); EventFormModal buried Create/Save below
the entire scrolling form; AddEquipmentModal's submit had the same disease
until round 1. The modal shape from round 1 (`.max-h-modal flex flex-col`,
body `flex-1 min-h-0 overflow-y-auto`, pinned `shrink-0` footer) fixed all of
them — it is now the only acceptable shape for a modal with a primary action.

The composer's shared-round scorecard was the starkest number of the audit:
its ~212px sticky player column was wider than the whole scroll window at
320px, so **zero** hole columns were visible — the score inputs the modal
exists for. Sticky columns now step down below `sm` (72-90px, avatars hidden,
names truncating); the round-detail scorecard went from ~1.75 visible hole
columns to ~4.5.

### TrendLineChart: HTML labels beat clever measurement

The 600×220 viewBox scales uniformly, so at 320px its 10px axis text rendered
at 4.3px ×4 charts on /trends. The fix moves every `<text>` into absolutely-
positioned HTML spans using the same percent mapping the tooltip always used —
true pixel size at every width, zero effects, zero state, nothing for the
`set-state-in-effect` rule to reject (the ResizeObserver alternatives all
fight it). `vectorEffect: non-scaling-stroke` keeps the lines 2px.

### Equipment: editable at last

Items were write-once outside status/dates — fixing a typo meant
delete-and-recreate or corrupting the gear timeline via Replace. Now:

- **PATCH accepts everything** (brand/model/category/sportKey/specs/imageUrl/
  notes), every field optional, `undefined` = unchanged. That contract is what
  keeps the three pre-existing sparse-body callers untouched, and it is pinned
  by node tests (`lib/equipment-validation.ts` — pure, 10 cases, including
  each compat body). A sport change requires `category` in the same request,
  because it invalidates the specs schema.
- **AddEquipmentModal gained an `editingItem` prop instead of a fork.** The
  seeding mechanism is the part worth remembering: a SECOND, conditional
  instance with `key={item.id}` — a fresh mount per item means plain
  `useState` initializers seed all ~12 form atoms from one snapshot, with no
  effects and no render-phase sync to audit. The snapshot also drives
  `resetForm` and `isDirty`, so add mode and edit mode are one code path and
  an untouched editor closes without the discard prompt (sweep-verified).
- **Sport is locked in edit mode** — flipping it silently wipes specs, and
  Replace exists for genuine re-gearing.
- EditEquipmentDatesModal is deleted (the full editor covers dates); the
  card's native `confirm()` — the last unstyled confirm on the profile —
  became ConfirmModal.

### Verification

Each PR verify-green at exactly the 45-warning cap; 796 tests (+10). Headless
sweep: 8 routes × 7 widths, zero overflows; probes for settings tabs
(scrolls, last tab clickable), EventFormModal (Save visible + clickable at
320×568), TagPeopleModal (bounded flex panel, scrollable list), and the
equipment edit round-trip (seed via API → Edit → change model → Save → card
updates → re-open re-seeds from saved values → clean close, no discard
prompt). Two probe failures on the first run were the *recorded* locator
traps firing again — `/new/i` matching the header's "Create new post", and a
button labeled by its dynamic text ("Add Tags"), not its section heading.
The traps continue to earn their place in the testing notes.

## August 2, 2026 — The mobile pass: three PRs, one flex trap, everywhere

A responsiveness sweep over the core flows (PRs #27 → #28 → #29, stacked), after
three parallel audits of the header/nav, the feed/media/live flows, and the
profile/modal surfaces. The single most repeated defect across all three audits
was one CSS fact: **a flex item's `min-width` defaults to `auto`**, so text
inputs (~177px intrinsic), long names and fixed-width icon buttons refuse to
shrink — the row either overflows the viewport or silently crushes its
neighbours. Roughly half the diff is `min-w-0` + `truncate` + `shrink-0` placed
where that trap had already fired.

### The headline was a regression, not legacy debt

PR #26 added HeaderSearch and the Connections icon to the header's right
cluster without a phone re-measure. At 320px the cluster overflowed outright;
between ~330 and 414px it *looked* fine while the `.ea-icon-btn` circles
quietly squashed below touch size — it fit on a Pro Max and failed on every
mainstream phone, which is why it survived review. Below `sm` the wordmark now
yields to `logo-mark.png` and Connections yields its slot; it stays in
`navLinks` because the drawer must remain a superset (that invariant is why
Connections is still reachable on a phone at all). Anti-squash `shrink-0` went
on every call site and **never on `.ea-icon-btn` itself** — the class owning
layout is the documented `lg:hidden` precedence bug.

### Two stickies can't share top:0

The guardian/transfer banners (`z-[60]`) and the header (`z-40`) were both
`sticky top-0`, so once the page scrolled the banner simply buried the header.
The fix is a shared `StickyBanner` shell that publishes its **measured** height
as `--ea-banner-h` on `<html>`; the header's `top` reads the variable and docks
underneath. Measured (ResizeObserver), not hard-coded, because the banner wraps
on narrow screens with long athlete names. No banner → variable unset → top:0.

### Modals: the footer must never live in the scroll area

Every modal defect reduced to the same shape: bound the panel
(`.max-h-modal`, dvh-aware), make the body the only scroll area
(`flex-1 min-h-0 overflow-y-auto`), pin header/footer (`shrink-0`).
EditProfileTabs was the worst offender — no width below `sm` at all
(`w-full` was `sm:`-gated on an `inline-block`), a 15-tab strip that wrapped
into ~240px of chrome, a hard `max-h-96` that pushed Save below the fold on an
SE, and the only `useDirtyClose` consumer with no scroll lock. Its restructure
preserves the Tailwind-v4 `relative z-10` landmine comment — verified again by
`elementFromPoint` over a tab in the sweep. AddEquipmentModal had the inverted
version: the submit button *inside* the scroll container, reachable only after
ten fields. FollowersModal's `max-h-[calc(80vh-140px)]` magic-number header
offset is gone for the same flex layout.

### Things learned worth keeping

- **The lint ratchet did its job.** The first MultiSelectDropdown viewport-flip
  used `setState` in a `useLayoutEffect` and became warning #46 — the gate
  failed, and the rewrite (measure, then set `style.left/right` directly on the
  panel, which remounts per open) is genuinely better: no extra render at all.
- **LazyImage bakes width/height into an inline style that beats Tailwind.**
  The composer's media previews passed `width={200}` into ~114px grid cells and
  every preview rendered as its own top-left corner. Call sites that want
  fill-a-frame use MediaTile (which also owns the `isOptimizableImageSrc`
  opt-out for `blob:` previews); LazyImage itself was left alone — other
  consumers rely on the pixel behaviour.
- **MediaCollage never forwarded `sizes`**, so the round-overview hero in a
  max-w-6xl modal told the browser to fetch a 200px image. One optional prop.
- **The tablet band was dead space by construction**: `lg:grid-cols-12` meant
  every width from 640–1023 stacked the feed sidebar below the entire
  paginated feed. `md:` starts the two-column layout at 768px now.
- `EditProfileModal.tsx` was dead code (every call site imports
  EditProfileTabs) — deleted, 640 lines.

### Verification

`npm run verify` green on each PR (0 errors, 45 warnings — exactly at the cap,
no new ones). Headless system-Chrome sweep (playwright-core, disposable QA
user, `isMobile: false` per the recorded emulation trap): 8 routes × 10 widths
(320→1280) asserting `scrollWidth ≤ innerWidth`, plus interaction checks —
drawer scroll lock + Escape + Sign Out reachability at 320, HeaderSearch panel
bounded, Edit Profile tab strip one-row/scrollable with Save visible and
clickable. Still owed to a real device: `env(safe-area-inset-*)` and
keyboard-up dvh behaviour (ScoreEntryModal footer, drawer, banners) — iOS
Safari only.

The app worked but didn't feel *built*. Tom's diagnosis was the right one and worth
recording because it generalises: **inconsistent hover behaviour reads as unfinished more
than any individual element does.**

### Two of the asks were already done

Before writing anything: `:focus-visible` already set a 2px brand ring with a 2px offset
globally, which is exactly what was asked for. So the focus work was *removing overrides*
that fight it, not adding rules. And the `prefers-reduced-motion` block already zeroes
every transition, so a transition-based pill snaps correctly for motion-sensitive users
with no per-component code.

**The radius ask needed the opposite of the obvious fix.** The `@theme` block redefines
Tailwind's scale — `rounded-lg` is already 12px across all ~550 usages. The inconsistency
was `rounded-md` (8px) mixed in beside it. Changing the scale would have silently
restyled the entire app; the fix was to stop mixing. Same story on the background: pages
already paint `bg-gray-50` and only `body` was white, so one line rather than 49.

Worth stating plainly because both would have been easy to "fix" destructively.

### Search collapsed into the bar

Header went from ~136px to **65px**. It is also a net gain in *reach*: search previously
existed on 5 routes, and `/explore` had **no input of its own** — it depended entirely on
that band. It's now everywhere the header is.

⌘K, Ctrl+K and `/` open it. The shortcut *rules* live in a pure tested module, because
"does ⌘K fire while someone is typing a caption?" has a right answer worth pinning. It
bails on text fields and while any dialog is open — `MediaLightbox` and `PostDetailModal`
both listen on `window` for Escape and arrows without stopping propagation, so a new
global listener has to be a careful neighbour.

### The sliding pill needed a finding to work at all

**Every page mounts its own `AppHeader`** — it is not in the layout — so the header
*remounts* on navigation and component state is lost. The pill could never slide between
routes, only be re-placed on a fresh mount, which is precisely the disappearing and
reappearing it exists to replace.

Keeping the last geometry at module level lets a new mount start where the old one ended,
turning a remount into a slide. Verified by **polling for intermediate transform values** —
the first check sampled once at 60ms, before the new page had even mounted, and wrongly
reported no animation.

Nav items became `<Link>` on the way through (middle-click, prefetch and `aria-current`,
none of which existed), and `/live/[id]` finally lights up Live.

### The Live dot was lying

It pulsed permanently, driven by a static `accent:'live'` literal rather than data.
Promoting it to a status chip would have made that worse, so it now reads from a shared
`useLiveNow` over the endpoint `LiveNowStrip` already polls on `/feed`, `/explore` and
`/live` — those pages make no extra request.

### Then: nav shows places, not tools

Messages already had an icon, so the nav said it twice; Connections joined it in the
cluster. That freed room to more than double the search field (120px → 320px), and left
the nav with the five entries that are actually *places*.

**Both entries stay in `navLinks`, marked `iconOnly`** — that array also feeds the mobile
drawer, and below `lg` the drawer is the only route to Connections. Deleting them would
have made it unreachable on a phone, which is the failure the file already warns about
("the drawer has to be a superset"). Live is then inserted at the computed midpoint rather
than a fixed index, because Calendar is flag-gated: the nav is 4 items in production and 5
locally, so a hard-coded position would centre it in one environment only.

### Chat dock

Selecting a conversation no longer collapses the pill. Checked first whether the collapse
was defensive — nothing documented it, no test coupled `OPEN_WINDOW` to `CLOSE_PANEL`, and
there was no space conflict (windows sit at `right-[22rem]`, the panel occupies 336px from
the right, so the reserve already assumed the panel could be open).

The panel and a conversation window are now one shared height constant instead of two
numbers written independently 51px apart. The panel grew to the window, **not** the
reverse: the window's `30rem` is a recorded regression fix — the emoji/reaction pickers
need ~350px and were clipped at 26rem. Checked the cost at 1024×600, the shortest viewport
the dock renders at: 119px of headroom remains, so nothing clips.

### Three bugs caught by measuring rather than looking

- **`.ea-icon-btn` set `display`**, which silently beat `lg:hidden` — Connections *and* the
  hamburger stayed visible on desktop. Same class-precedence trap as `MediaTile`'s
  `w-full` earlier the same day: precedence is stylesheet order, so a caller can never win.
  Shared classes must not own layout properties.
- **The search field at `lg:w-56` overflowed the row by 89px at exactly 1024px** — the same
  failure the nav's `lg` breakpoint comment records from last time. Re-measured, not
  assumed, when it was widened again later.
- A reorder of the nav array could have desynced the pill, which indexes by position.

### Housekeeping

Deleted `SearchBar.tsx` (254 lines, zero imports) and stopped club results linking to
`/club/[id]` — a route that does not exist, so every click was a 404, which this app's
navigation rules forbid.

Gate: **786 tests** (from 759), 45 warnings / 0 errors. Browser verification 18/18 then
15/15 then 5/5, asserting rendered geometry rather than class names throughout.

**Deferred deliberately:** the composer's inline-expand (it rewrites a 2,100-line modal),
and `BrandBar` — the header on `/`, `/contact`, `/privacy` and the auth pages. The `ea-`
classes cover its buttons for free but its layout is untouched, so the two bars will
diverge slightly until it gets a pass. Also: `showSearch` is now accepted-and-ignored at
24 call sites rather than removed, to keep the diff reviewable.

---

## August 1, 2026 — Round media: attached to the moment, not piled at the bottom

Shipped as **#22 → #23 → #24** (`bb31959`, `299d63d`, `3700b45`), with migrations **061**
and **062** run and verified. Confirmed working in production, 10/10.

Tom's report was that media "breaks the layout" and the page "just gets longer and messier
the more someone posts". Three symptoms, three *different* causes, and two of them turned
out not to be layout problems at all.

### The bar that wasn't sticky

Nothing in that modal was ever `position: sticky`. The scroll pane was `flex-1
overflow-y-auto` with **no `min-h-0`** — a column flex item defaults to `min-height: auto`
and refuses to shrink below its content, so the pane grew past `max-h-modal` and the
panel's `overflow-hidden` clipped the bottom instead of letting it scroll. That is
literally why "7 of 18 holes" was cut in half.

Compounding it: the round media gallery was rendered **inside the footer container**, so a
round with photos turned the "bar" into a tall block. Moving media out *was* the layout
fix. The two stacked footers collapsed into one action bar — Close already existed as the
header X, and duplicating an affordance already on screen is what made the modal feel
cluttered.

### The letterboxing, which bit twice

`LazyImage` turns `width={200}` into an inline `style="width:200px"`, and **inline styles
beat the `w-full h-full` classes beside them**. The image was sizing its own container: a
grid row track at 200px inside a ~90-150px column, so one photo sat in a box twice its
width with an empty cell beside it.

The same bug was in `PostCard` at `width={600} height={600}`, where a 600×400 photo became
a stretched dark slab — which is almost certainly why a round *with* photos read as "stats
only, no media" in the feed.

`MediaTile` renders `next/image` with **`fill`** and has no width/height in its API at all,
which makes the bug unreintroducible rather than merely fixed. `LazyImage` itself was left
alone deliberately — its inline style is load-bearing at nearly every avatar call site.

### Media belongs to a segment, not a hole

The architectural half. `group_posts`, `group_post_participants` and `group_post_media` are
already documented in their own DDL as generic — "any sport or activity type" —
and `hole_number` was the single golf-specific thing in the table. Building
media-per-moment on it would have meant rebuilding it for sport #2.

`segment-schemas.ts` gives hole / inning / quarter / period / set / lap. Only the **label**
is sport-specific; the grouping, the scorecard band and the lightbox footer are the same
code for every sport.

Two decisions worth defending later:

- **No CHECK constraint on `segment_number`.** The old `BETWEEN 1 AND 18` meant a migration
  per sport, and a fixed ceiling would reject an 11th inning or an overtime period — which
  is ordinary play, not corrupt data. Bounds live in the schema file with a `variable`
  flag. Only `> 0` is universally true, so only that is in the database.
- **`segment_kind` is stored, not derived.** The table carries no sport key, so deriving it
  would mean a join on every read, including inside the mirror.

Dual-write to `hole_number` is **conditional** — it keeps its old 1..18 constraint, so a
future lap-24 row would fail the insert outright if written blindly.

### The scorecard thumbnail needed a real decision

That table is players-as-rows × holes-as-**columns**. There is no hole row to hang a
thumbnail on and a 40px column cannot host one. A dedicated MEDIA band beneath PAR reuses
the existing column grid, so hole 3's photo sits in hole 3's column with a "+N" badge.
Restructuring to hole-per-row was the alternative and was rejected: it would destroy the
multi-player comparison that layout exists for.

### Auto-tagging is a suggestion, deliberately

Media captured during scoring is tagged exactly. Media added afterwards has only its
capture time, and two things make that untrustworthy: `File.lastModified` is not reliably
capture time (some Android pickers report the copy time), and a retrospectively entered
card stamps every hole within seconds of the others, so proximity carries **no positional
information at all**. The span guard detects that and declines for the whole batch rather
than producing confident nonsense — and it scales to round length, so a genuine 3-hole
round is not judged by 18-hole standards.

That is exactly why the reassignment UI is mandatory rather than a nicety. Migration 062's
UPDATE policy is what made it possible at all: `group_post_media` had SELECT, INSERT and
DELETE policies and **no UPDATE**, so with RLS on, every reassignment was silently denied.

### Colour

Chrome neutralised — green header, table chrome, yellow PAR row, trophy, and the
purple-vs-violet badge collision. Violet survives as the single **action** accent, so the
one remaining colour still means "you can press this". The score badges keep their colour
and now carry a `SEMANTIC COLOUR — DO NOT NEUTRALISE` comment at each site: greyscaling
them would make a birdie and a double look identical. LIVE stays red.

### A claim I got wrong, recorded so nobody re-fixes it

I reported the feed bug as a missing mirror call — that `advanceRoundStatus` bumps a round
into the feed without carrying its media. The function indeed does not mirror, but **all
three of its callers mirror immediately afterwards**, so the gap does not exist. I built
the fix, tested it against the real code path, found it redundant, and reverted it rather
than shipping a no-op and calling it a bug fix. The real cause was the `PostCard`
letterboxing above.

### Verification, and four assertions that were wrong first

746 tests (from 656). Browser verification at each stage, plus a production sweep after
deploy. Four checks failed against *correct* code before being fixed, each worth knowing:

- `next/image` `fill` legitimately sets inline `width:100%` — only **pixels** are the
  regression signature. The first version would have failed forever.
- A collage tile **is** the grid item, so `parentElement` is the grid, not a cell.
- `MediaTile`'s clickable variant emitted `w-full`, silently overriding the 36px the
  scorecard band asked for. Tailwind precedence is stylesheet order, so the caller could
  never have won.
- `body.segment_number ?? body.hole_number` — `??` treats an explicit `null` as absent,
  which is exactly what "move back to the whole round" sends.

**The production sweep earned its keep.** It came back 9/10: the add-media and per-item
controls were absent on `/live/[groupPostId]`, because that page never passes
`onStatusChange`. Passing it would have been wrong — on `/live` that prop navigates away to
the finished post, which is right when a round ends and actively harmful when someone has
just corrected a photo's hole. A separate `onMediaChanged` prop shipped as #24. The bug was
invisible locally because the fixture drove the feed card, which does pass it.

---

## August 1, 2026 — Sport settings reach the profile, and stop inventing preferences

`sport_settings` had been write-only since it was created: athletes could enter a
position, jersey number, handedness, handicap and home course, save successfully, and see
it **nowhere**. Roadmap item §5 called a display block "the natural next step". This is it
— and it is the first real piece of the recruiting story, since position and jersey number
are precisely what a coach looks for.

### The read path did not exist

`/api/sport-settings` hard-filters `.eq('profile_id', user.id)` in every handler, and RLS
on the table is owner-only SELECT. So this was never "call the existing route with a
different id" — it needed a new gated route,
`GET /api/profile/[profileId]/sport-settings`, modelled on `/api/vitals`.

The load-bearing detail is **optional auth rather than `canViewProfile`**. That helper
returns false for a null viewer *even on a public profile* (the trap is already documented
at `profile/[profileId]/media/route.ts:102-125`), so using it would have silently broken
`/u/[username]` for exactly the logged-out visitor the public profile exists to serve.
Equally, `/api/equipment`'s shape was wrong here — it 401s anonymous callers.

Not bolted onto `active-sports` either, even though that route already reads this table:
its ungated design is justified *because* it exposes only `sport_key` and never `settings`.
Widening it would have quietly invalidated its own reasoning.

### The route shapes for display, not the component

Two guarantees are properties of the API surface rather than of one view a future consumer
might forget to copy:

- **Legacy keys never cross the wire.** `mergeSettingsForSave` deliberately preserves keys
  no schema declares, so rows still carry `driver_brand`/`ball_brand` from the golf
  equipment tab removed earlier today. Walking `Object.entries(settings)` would have
  published dead gear fields on public profiles. The helper iterates the **schema**.
- **Empty rows are omitted entirely.** Onboarding writes a `{}` row for every sport an
  athlete declares, so most rows have nothing in them. A sport with nothing to show is
  absent from the response, not present-and-empty.

Verified by asserting on the **JSON**, not the DOM — a seeded `driver_brand` is absent
from the response body, which is the only check that actually proves it.

### The part that mattered most: the form was inventing preferences

Selects preselected a real value (`Right-handed`, `White tees`, `Point Guard`) and
`formValuesToSettings` persisted it, so merely opening a sport tab and pressing Save
recorded preferences nobody had stated. Harmless while the data was invisible. The moment
it renders on a public profile, it is the app putting words in an athlete's mouth.

Every select now starts at **`— Not specified`**, which is a real, selectable state. Blank
values were already dropped on save and are skipped on display, so no new logic was
needed — but the guarantee is pinned by a test over *every* schema:
`settingsToDisplayItems(schema, formValuesToSettings(schema, emptySettingsValues(schema)))`
must be `[]`. And confirmed in the real app: an untouched Save sends `settings: {}`, and
the profile API then returns nothing for that sport.

This is why the ordering was fixed — the change had to land *before* anything displayed.

### Golf: two handicaps that measure different things

The declared index shows as **"Official Handicap"**, symmetric with the trends page's
existing "Handicap est." and "not an official index". No rename was needed there. The
sport cards carry no handicap of their own (`GolfAdapter.ts:80-85`), so the two numbers
never sit side by side — the labels just have to make the distinction unmissable.

### Verification

Node tests cover the pure helper (`{}`/null → nothing; legacy keys ignored; retired select
options skipped rather than shown raw; **jersey number `0` renders**, since it is legal and
falsy and a truthiness check would silently drop it; schema field order; every option in
every schema round-tripping to its label).

Browser + API, against real Chrome with disposable fixtures: **26/26**. The privacy matrix
is the important half — public profile readable logged-out (200), private profile 403 for
both a logged-out viewer *and* a logged-in non-follower, 200 for the owner. Plus the
public `/u` page rendering anonymously at 375px and 1280px with no overflow.

Fixtures deleted afterwards and confirmed gone by service-role lookup; Tom's 3 profiles
untouched.

Gate: **666 tests** (was 653), 45 warnings / 0 errors — ratchet unchanged.

### Noted, not fixed

Cards in the 3-across grid now have slightly different stat-tile baselines, because a
sport with three declared details pushes its tiles up more than one with none. Checked in
the screenshot: the rows bottom-align above the footer and it reads as intentional. The
fix would be a `min-h` that reintroduces a blank strip on settings-less sports, which is
worse. Left alone deliberately.

---

## August 1, 2026 — Edit Profile: a modal nobody could click, and three blank sport tabs

Started as roadmap item #5 (kill the hardcoded golf tab). Ended up finding that the
**entire Edit Profile modal was unusable in production** — a bug that had nothing to do
with the refactor and would have been missed by any amount of reading.

### The modal ate every click

`document.elementFromPoint` at a tab's centre returned the **backdrop**, not the tab. A
real mouse click at those coordinates closed the dialog. Confirmed against
**production**, not just localhost, before changing anything.

The backdrop is a `fixed` sibling of the panel, so it paints in the positioned layer.
The panel was `position: static`, so it painted *underneath*. Every click inside the
modal — tabs, inputs, Save — hit the backdrop and dismissed it.

It had worked **by accident**: Tailwind v3's `transform` utility always emitted a
transform, and a non-`none` transform creates a stacking context. Under Tailwind v4
`transform` computes to `none` (verified in the browser: `modalTransform: "none"`), so
the accident stopped happening. The fix is `relative z-10` on the panel, with a comment
saying it is load-bearing, because it looks exactly like a decorative class.

Only this modal uses the separate-backdrop idiom — every other modal makes its own
`fixed` container the overlay, which never had the problem. So: one file, not a sweep.

### Three sports had a tab that rendered nothing

`generateTabs` pushed a tab for every registered adapter and cast each key with
`adapter.sportKey as TabId` — into a union that named only `golf | ice_hockey |
volleyball`. That cast is why TypeScript never complained. `renderTabContent` ended in
`default: return null`, so **basketball, soccer and baseball rendered a blank white
panel**. Worse, `saveTab` had no `case` for them either, so `hasChanges` stayed false:
no request, no toast, a Save button that silently did nothing. All three are in
`FEATURE_SPORTS` and clickable in production.

Fixed structurally rather than by adding three `case`s: `src/lib/sports/settings-schemas.ts`
(the `stat-schemas.ts` shape the roadmap prescribed) + one generic `SportSettingsForm`.
A sport either has a schema (real form) or does not (explicit "coming soon") — there is
no third state, so the blank panel is no longer reachable. `TabId` is now
`'basic' | 'vitals' | 'socials' | SportKey`, which removes the cast that hid it.

Adding a sport's settings is now **1 edit**. A test fails the gate if any
`FEATURE_SPORTS` key lacks a schema, so enabling a sport can't quietly ship an empty tab.

### The second Equipment tab is gone

The editor carried a golf-only equipment form (driver/irons/putter/ball) writing into
`sport_settings`. Nothing read those fields back — grepped every consumer. It duplicated
the real `athlete_equipment` feature, which went fully sport-agnostic on Aug 1 and is
what actually shows on a profile. Two entry points, one of which was a dead end.

**Care taken:** removing that UI must not delete data. The naive save writes a fresh
object from schema fields, which would have dropped `driver_brand`/`ball_brand` from
stored rows as a silent side effect of saving an unrelated field. `mergeSettingsForSave`
preserves keys no schema declares, while still clearing schema fields the athlete
emptied — both cases are tested.

### Worth knowing: these settings are write-only

Nothing reads `sport_settings` back onto a profile. The handicap the app *displays* is
the WHS-style estimate computed from logged rounds in `/api/golf/trends`, which is the
better source. So the golf tab has always been a form that saved into a void. Left as
found — surfacing it is a product decision, not a refactor — but recorded in the roadmap
so it isn't rediscovered as a bug.

### Verification

Node tests can't see any of this (no jsdom), so it was driven in real Chrome against
the dev server with a disposable QA user: **12/12 passing** — all six enabled sports
render schema-scoped controls, basketball's save fires `PUT 200`, the value round-trips
from the database on reopen, jersey `150` is blocked before the request, no horizontal
overflow at 375px, no page errors.

**The negative control is the part that makes that mean anything.** The same script run
against the old code (with only the stacking fix applied, so the modal was reachable at
all) scored **0/8** — five blank panels, golf's unscoped ids, Equipment tab still there.
A green suite that also passes on the broken code proves nothing.

Gate: **653 tests** (was 628), 45 warnings / 0 errors — ratchet unchanged.

---

## August 1, 2026 — Maintenance pass: the gate on merged main, and three stale doc claims

Ran the checklist against `main` as actually merged, which is a state no branch ever had —
each PR was verified on its own branch, and merge commits can produce something none of
them saw. It passes: **45 warnings / 0 errors, 628 tests, clean build, 0 advisories.**
Production confirmed serving `main`'s HEAD with the Logo.dev token inlined (checked via the
attribution appearing in `/terms`' raw HTML, which only renders when the token is present).

Nothing was outstanding to commit — so the useful work was documentation drift, which is
where this repo's rot actually accumulates.

### `docs/MULTI_SPORT_ROADMAP.md` §5 described finished work as pending

It listed equipment as golf-hardcoded and cited **`src/app/api/equipment/route.ts:70` as
hardcoding `sport_key: 'golf'`**. Checked before rewriting: line 70 is unrelated code and
no such hardcode exists — the route validates against `getEquipmentSportOptions()` and 400s
on unknown sports. That was fixed in July; the doc never caught up, and would have sent the
next person hunting for a line that isn't there.

Split into what's done (equipment, now fully sport-agnostic) and what genuinely remains
(`EditProfileTabs.tsx`'s golf tab and `sport_settings`, still the only writer at
`?sport=golf`).

### CLAUDE.md claimed ten sports have no adapter

It said "🚧 **The other ten** — Registered in the sport registry but with no adapter."
Verified against `AdapterRegistry.ts`: five (ice hockey, volleyball, basketball, soccer,
baseball) run `StatLinePostAdapter`, four run `DisabledSportAdapter`, and exactly one —
`training` — has none and throws. The fallback is applied at *registration* time, which is
why `getAdapter()` can throw without anything breaking. Corrected, with `training`'s
deliberate absence called out since it is the one that will surprise someone.

### "Add a New Sport" stopped short of the gear

The 4-step recipe left a new sport appearing in the Equipment tab with no categories, no
brand suggestions and no spec fields. Extended to 7 steps naming the three
`Record<sport_key, …>` files, and noting the test that fails the gate if brand seeds are
skipped — so the omission cannot ship quietly.

### Left alone on purpose

Six fully-merged branches are still on origin. They are harmless (their commits are in
`main`), and older squash-merged branches from PRs #10–#12 are still there too, so deleting
only today's would make the remote *less* consistent, not more. Flagged rather than tidied.

Token set in Vercel (Production, Preview **and** Development so previews and local match),
and a fresh production deploy cut, since `NEXT_PUBLIC_*` is inlined at build time and an
env-var change alone would have done nothing.

Validated the key against `img.logo.dev` **before** wiring it — real 96×96 PNGs for
titleist.com, bauer.com and rawlings.com — rather than deploying and hoping.

Verified live in the production picker with a disposable user: **24 logo requests, 24/24
decoded at 96×96, zero broken images**, and the attribution rendering beside them with
`rel="noopener"`. The credit is also in `/terms`' raw HTML, so verification can see it
without executing JavaScript.

One thing worth recording for whoever writes the next assertion: **Logo.dev answers 202,
not just 200**, for marks it generates on demand, and those images decode perfectly well.
A strict `every(status === 200)` check fails against a working feature.

The mixed state is the designed one and is visible in production now: brands Logo.dev has a
mark for (adidas, Bauer, Bladetech) show it; brands it doesn't (A&R Sports, Bishop) keep the
initial-letter tile. No broken image either way.

Nothing outstanding on the equipment work.

---

## August 1, 2026 — Logo.dev attribution, and the two ways it silently fails verification

Prerequisite for turning brand logos on. Logo.dev's free tier requires a visible credit for
**commercial** use, and their definition explicitly includes "startups, including pre-launch
and pre-revenue" — so Edge Athlete owes it. Their docs were read rather than guessed at,
which was worth doing, because the obvious implementation fails on two counts.

### `rel="noopener noreferrer"` would have failed it

Verification requires the link to be **passing referrer data**. The reflexive `rel` for an
external `target="_blank"` link strips exactly that. `noopener` alone is kept — it closes
the reverse-tabnabbing hole without removing the referrer. A test asserts no `rel` attribute
in the component contains `noreferrer`, since the next person to "harden" that link would
otherwise break a contractual requirement with a change that looks like an improvement.

### A client-rendered credit may not count

The other two conditions are that the link be on **production** and **publicly accessible
and viewable in a browser**. The equipment picker is behind login, and their docs name that
case directly ("on about pages — for apps behind authentication").

The login page footer at `/` was the obvious public home — but `/` is a client component, so
the credit only exists **after hydration**. Confirmed by fetching the page: absent from the
served HTML, present in a real browser. A verifier that does not execute JavaScript would
see nothing.

So the credit also goes on `/terms`, a **server component that is statically prerendered** —
verified by curling the built page and finding the anchor in the raw HTML. Three placements
in total: near the logos (picker), the public footer, and the no-JS-required Terms page.

Renders nothing at all when no token is configured — verified in both directions, including
that no orphaned "Credits" heading is left behind. Crediting a service we are not using
would be worse than not crediting it.

Gate: **45 warnings / 0 errors, 628 tests (+9), clean build (109 pages).**

**The token itself is still Tom's to create** — it requires a Logo.dev signup. It is a
*publishable* key (it ships in the client bundle by design, so it is not a secret). Until it
is set the picker shows initial-letter tiles, which is the designed fallback.

---

## August 1, 2026 — Maintenance sync: the equipment stack landed in production

Merged the three stacked equipment PRs into `main` in order — **#13 → #14 → #15** — and
deployed. Each had to have its base retargeted to `main` after its parent merged, since
GitHub only auto-retargets when the base branch is deleted and these were kept.

Before merging, `main`'s tree was compared against the exact commit the browser tests ran
on: `git diff feat/equipment-catalog-multisport main` came back **empty**. What deployed
is byte-for-byte what was verified, not a re-resolved approximation of it.

**What went live**

- `POST /api/upload/equipment` — equipment photo upload had been targeting `media`, a
  bucket that does not exist, so it failed for **every** user since it was written.
- The catalog's 124 dead external URLs are gone; the brand picker no longer renders 66
  broken images or fires ~30 doomed requests per open.
- Brand suggestions, per-category spec fields and free-text entry now work for **all six**
  enabled sports rather than golf alone.

**Housekeeping**

`mediabunny` 1.52.1 → 1.52.2, the only in-range patch available. The other four drifting
packages are majors and stay put: `@supabase/ssr` 0.7 → 0.12, `@types/node` 22 → 26, and
`eslint` 9 → 10 / `typescript` 6 → 7, the last two already recorded here as blocked by the
ecosystem. Nothing was forcing an upgrade — **0 advisories**, prod and full.

Gate: **45 warnings / 0 errors, 619 tests, clean build (109 pages), 0 vulnerabilities.**
The lint cap stays at 45: deleting ~16 golf branches removed one warning and `BrandLogo`'s
deliberate `<img>` added one, so the ratchet could not be lowered this time.

**Found by testing production, which local testing could not have shown**

The oversized-upload case returns **413 `FUNCTION_PAYLOAD_TOO_LARGE`** from Vercel's edge,
not the route's own friendly 400 — the platform rejects the body before the function runs,
at a limit below the route's 5MB cap. Locally the route answers 400, so this only appears
against the real deployment.

Not user-reachable through the UI (the picker validates at 5MB *before* the editor, and the
editor re-encodes to a ≤1200px JPEG, typically a few hundred KB). The real defect it
exposed was in the client: `await response.json()` ran unconditionally, so **any** non-JSON
failure body — the 413's plain text, or a gateway 502/504's HTML — threw a syntax error
that was then displayed to the athlete as the upload message. Now parsed defensively with
a specific message for 413. The unreachable path is left unreachable; the error handling
that sat behind it is the thing that was actually wrong.

**Still outstanding, and not a bug:** `NEXT_PUBLIC_LOGO_DEV_TOKEN` is unset in Vercel, so
the brand picker shows initial-letter tiles. That is the designed fallback, verified
against a dead logo host. Setting the token requires a **redeploy** — `NEXT_PUBLIC_*` is
inlined at build time.

---

## August 1, 2026 — The equipment tab serves six sports; its catalog served one

The Equipment tab has accepted gear for seven options (General + golf, ice hockey,
volleyball, basketball, soccer, baseball) since July. Its **brand/model catalog was
100% golf**, and `AddEquipmentModal` guarded every autocomplete path with
`if (sportKey !== 'golf') return`. Picking Ice Hockey gave you two blank text boxes and
no Specifications section at all.

### There is no API to buy here — that was checked, not assumed

Every "sports API" on the market (TheSportsDB, API-Sports, SportsDataIO, Sportmonks)
serves scores, fixtures and player stats. **Nobody sells an equipment catalog**, for any
sport. So the data is curated seed lists: ~20–40 brands per sport, which is an afternoon
of work and covers the overwhelming majority of real gear.

Brands and models have opposite economics, and the design follows that split. Brands are
~30 per sport and essentially never change. Models are thousands per sport and turn over
every season — a hand-typed model list is a treadmill nobody will run. So golf keeps its
legacy 39 models and **no other sport gets one**; the long tail is covered by free text.

### The dead seam, replaced by a live one

`getCatalogService(sport)` was a switch with a golf case and an `async () => []` default
— and that default was **dead code**, because the modal early-returned before ever
calling it. The variation point that matters is the *source* of a suggestion (curated
seed vs. what other athletes typed), not the sport.

It is deliberately **not** replaced with another empty interface. The community layer
plugs in as an argument — `rankSuggestions(seeds, community, query)` — so when the
endpoint lands the caller fetches and passes it in and nothing here changes shape.
Shipping a second placeholder abstraction ahead of its implementation is the exact
mistake being undone.

Also gone: an `await new Promise(r => setTimeout(r, 100))` that imitated an API call the
catalog never made. Seeds are plain data, so suggestions are now **derived during render**
instead of fetched in an effect, and the dropdown paints on the first keystroke.

### Free text everywhere, including golf

Golf used to reject any brand not in the list ("Please select a brand from the list").
That blocked every custom builder, every brand we forgot to seed, and any golfer who
typed "Ping Golf". The dropdown now suggests; it never constrains. This is a **behaviour
change for existing golfers** and the intended one.

### Specs became data

Six hardcoded golf inputs (loft/shaft/flex/length/lie/grip) rendered only for golf, held
in six `useState`s cleared in four separate places. Now one `Record<sport, SpecFieldDef[]>`
scoped per **category**: a hockey stick asks for blade curve, flex, lie and hand; skates
ask for size and holder; a bat asks for length, weight drop and certification; keeper
gloves ask for cut. Golf's keys are byte-identical so equipment saved before this change
renders exactly as before.

Declaration order is load-bearing — cards show only the first three specs and JSONB
preserves insertion order — so the most identifying spec comes first per category. Specs
are built from the *visible* fields at submit, which also drops values stranded by a
category switch: a stick's blade curve never rides along on a pair of skates.

### Logos: Clearbit's actual successor, with the lesson applied

Clearbit's Logo API shut down 8 Dec 2025; **Logo.dev** is the drop-in successor Clearbit
itself points to. Wired up behind `NEXT_PUBLIC_LOGO_DEV_TOKEN`, guarded like the SMTP
sites — unset means initial-letter tiles, a supported state rather than a degraded one.
The golf brand domains were **recovered from the deleted `logo.clearbit.com/<domain>`
URLs** in the previous commit rather than retyped: 66 of 73.

The important part is `BrandLogo` falling back on **`onError`**, not merely on a missing
URL. The old code chose on presence alone, which is why a dead host produced 66 broken
images instead of nothing. A plain `<img>` is deliberate: `next/image` proxies the fetch,
so an upstream 404 arrives as an error from our own origin rather than the clean `onError`
the fallback depends on.

Two traps written down in `.env.example`: `NEXT_PUBLIC_*` is inlined **at build time**, so
setting it in Vercel needs a redeploy; and Logo.dev's free-tier attribution requirement
should be checked before relying on it.

### Verified in the running app, every sport

Production build, disposable user, system Chrome — **40/40**. For each of the seven
options: the category list is sport-specific, the brand dropdown populates (golf 60,
hockey 25, soccer 24, baseball 22, basketball 20, volleyball 19; General correctly has
none), the expected brand is present, spec fields match sport **and** category, and no
visible `<img>` fails to decode. Then the long tail end-to-end: `Totally Custom
Stickworks` — in no seed list — saves, survives a reload, and shows its curve `P28`.
**Zero failed external requests across all seven sports.**

Separately, the clearbit scenario re-run on purpose: built **with** a token, then aborted
every `img.logo.dev` request with `namenotresolved`. 24 requests attempted (proving the
token inlined), **zero broken images**, letter tiles throughout. If Logo.dev ever goes the
way of Clearbit, the picker degrades to today's clean state.

Net **−649/+306** lines across the touched files, plus three new modules. Gate:
**45 warnings / 0 errors, 619 tests (+36), clean build (109 pages).**

Deferred on purpose: community-ranked suggestions (needs a Postgres RPC, functional
indexes, `count(DISTINCT profile_id)` so one golfer with 14 Titleist clubs can't dominate,
and a privacy floor of public profiles only with k ≥ 2 — a `count: 1` suggestion is a
one-to-one leak).

---

## August 1, 2026 — The equipment catalog was 98% dead links

Follow-up to the upload fix below. `src/lib/equipment-catalog.ts` carried 126 external
image URLs. **Two of them load.**

### Decided in a browser, not with curl

curl alone would have been misleading: titleist and scottycameron answered **403** and
callaway/odyssey **429**, which look like bot-blocking rather than missing files. So every
URL was loaded as a real `<img>` in system Chrome and judged on `naturalWidth > 1`. Same
verdict — **2 of 126 decode**. The 403/429 hosts fail for a browser too.

- All 66 `logo.clearbit.com` brand logos: DNS does not resolve (that API was decommissioned).
- All ~110 manufacturer product shots: 403/404/429, with fabricated-looking path hashes
  (`dw1a2b3c4d`, `dw5e6f7g8h`, `dw9i0j1k2l` — sequential alphabet runs). They most likely
  never worked.
- Survivors: two Unsplash stock photos. A third was a 404.

### Deleted, not patched

An `onError` fallback would have hidden the breakage while still firing ~30 doomed requests
every time the picker opened. And a preset that cannot load is worse than no preset:
selecting one writes a permanently dead URL into `athlete_equipment.image_url`, which is
then stuck on the athlete's tile.

Both fallbacks already existed and now actually get used — the initial-letter brand tile in
`AddEquipmentModal`, and "No preset images available" in `EquipmentImageUpload`. The
optional `logo` field stays on `EquipmentBrand` as the extension point for self-hosted
marks. `iron_set`, `wedge` and `bag` lost their generic preset because it was the dead
photo; that is left honest rather than re-pointed at an unrelated stock image.

Worth saying: hotlinking manufacturer CDNs was a licensing problem even when the URLs
worked. Real product imagery needs to be hosted by us.

### Verified in the running app

Production build, disposable user, 5/5: no broken images anywhere in the open brand picker
(`naturalWidth === 0` on any visible `<img>`), brands render initial-letter tiles, **zero
failed external requests with the picker open** (was ~30), the Presets button still appears
for driver, and its thumbnail decodes at 400px. Saved preset URLs still render because
`OptimizedImage` marks non-Supabase sources `unoptimized`, so no `remotePatterns` change is
needed.

Net: −169 lines, +93. Gate: **45 warnings / 0 errors, 583 tests, clean build (109 pages).**

---

## August 1, 2026 — Equipment photo upload targeted a bucket that does not exist

`EquipmentImageUpload` uploaded straight from the browser to `supabase.storage.from('media')`.
There is no `media` bucket in this project — the buckets are `avatars`, `badges`, `uploads`
and `consent-evidence` — so **every** equipment photo upload has been failing with
"Bucket not found" and surfacing as a red error under the picker. Noted in passing at the
end of the previous entry while tracing upload targets; this is the fix.

### Routed instead of client-direct

New `POST /api/upload/equipment`, following the cover route's pattern rather than repairing
the direct-to-storage call: `requireAuth`, admin client, field `image`, the shared
`ALLOWED_IMAGE_MIME` allowlist, 5MB, and a server-chosen path of
`equipment/{userId}/{timestamp}.{ext}` in `uploads`. Going through a route moves the
size/MIME check to where it cannot be skipped and stops the client picking its own storage
path.

It writes no DB column, which is the one way it differs from the avatar and cover routes:
the modal holds the returned URL and saves it with the rest of the equipment row, or
discards it on cancel. An abandoned upload is therefore a genuine orphan — and is collected
by the storage sweep after its 48h grace, because `athlete_equipment.image_url` is already
one of the scanned `URL_SOURCE_COLUMNS`. That was checked, not assumed.

### Verified end to end against the production build, not the dev server

`npm run start`, driven with a disposable authenticated user:

- API (16/16): unauthenticated → **401**; no file → 400; `application/pdf` → 400; >5MB →
  400; real PNG → **200** with the URL under `uploads/equipment/<uid>/`; file confirmed
  present via the storage **list** API (never the CDN URL); the URL survives
  `POST /api/equipment` and reads back verbatim through `GET /api/equipment`; the row is
  visible to the sweep's scanned column.
- Real UI in system Chrome (10/10): profile → Equipment → Add Equipment → file chooser →
  media editor → upload → preview decodes (`naturalWidth > 0`, not just "an img exists") →
  save → **tile still shows the image after a reload**.
- Fixtures deleted afterwards and the deletion verified by service-role lookup — user gone,
  profile gone, zero files left under the folder.

Two harness traps worth remembering: the tile renders through `next/image`, so the bucket
path arrives **URL-encoded** and a raw `includes('/uploads/equipment/')` misses it; and in
the Add Equipment modal, brand is a searchable combobox (must be picked from its list) while
model's placeholder names examples rather than the word "model".

Gate: **45 warnings / 0 errors, 583 tests, clean build (109 pages), prod-build E2E 26/26.**

### Found while verifying: the equipment catalog points almost entirely at dead URLs

Probed all 126 external URLs in `src/lib/equipment-catalog.ts` — **124 are dead.** All 66
`logo.clearbit.com` brand logos fail DNS outright (the Clearbit logo API was decommissioned),
and every manufacturer preset image returns 403/404/429 with fabricated-looking paths
(`dw1a2b3c4d`, `dw5e6f7g8h`, …). Only 2 Unsplash images still resolve.

User-visible today: 66 broken image slots in the brand picker, ~30 failed requests per open,
and a "Presets" feature that can never show a preset — worse, picking one would persist a
permanently dead URL into `athlete_equipment.image_url`. Stripped in the entry above.

---

## August 1, 2026 — Turning the sweep cron loose, and the column that would have made it destructive

Dropped `?dryRun=1` from the `vercel.json` storage-sweep cron so the weekly run actually
deletes. Checking coverage first turned up the reason that was not yet safe.

### The reference scan had a hole, and it was invisible

Enabling automatic deletion makes the reference scan load-bearing: any column holding a
storage URL that the scan misses makes those files look unreferenced, and the cron
deletes them. So the schema was introspected for every URL-bearing column rather than
trusting the existing list.

**`group_post_media.thumbnail_url` was missing** — the hole-video poster-frame column
added by migration 060. It is currently empty in production, which is exactly why it was
invisible: the sweep looked correct, and would have stayed correct right up until the
first golfer captured a hole video with a poster frame, whose poster would then be
deleted 48 hours later.

Also absent: `conversations.avatar_url`, `athlete_equipment.image_url`,
`athlete_badges.icon_url` — all empty today, all the same shape of latent trap.

### The asymmetry that decides the design

`BUCKET_SOURCES` (per-bucket column lists) became a single `URL_SOURCE_COLUMNS` scanned
for **every** bucket, because `bucketPathFromUrl` already discards URLs belonging to
another bucket. Listing a column for a bucket it doesn't apply to is harmless; omitting
one is data loss. Adding a source can only ever **grow** the referenced set, so it can
only ever prevent a deletion, never cause one. When in doubt, add the column.

Pinned by tests: seven specific table/column pairs must stay covered, `group_post_media.thumbnail_url`
named explicitly with a comment saying why it was missed.

### Failure mode, stated on purpose

If any part of the reference scan fails, the sweep **throws and deletes nothing**. That is
deliberate and now documented at the cron route: completing a sweep against an incomplete
reference set is worse than not sweeping at all. The only exception remains
`profiles.cover_url` (absent before migration 047), which degrades to the columns that
exist; everything else rethrows.

### Verified through the exact production path

Not just the admin endpoint — the **cron route**, which has its own auth and its own
`dryRun` parsing:

- no `Authorization` → **401**; wrong secret → **401**
- real `CRON_SECRET`, no `dryRun` param (the new config) → `ok=true, dryRun=false`,
  scanned 15, referenced 16, **orphans 0, deleted 0, failed 0** — a real run that was a
  safe no-op, because there was nothing left to collect
- `?dryRun=1` still forces report-only, so the rollback lever works

The expanded scan hit all seven tables without error against the live schema (200 in 2.0s).

### What happens next, concretely

The two remaining orphaned avatars are still inside the 48h grace (~28h at the time of
writing). They age out ~03:45 UTC Aug 2, and the first real cron run — **Monday Aug 3,
06:00 UTC** — will collect them. No further manual action.

To revert to report-only: put `?dryRun=1` back on the `vercel.json` cron path. Nothing
else changes.

Gate: **45 warnings / 0 errors, 583 tests (+8), clean build (108 pages), 0 advisories.**

### Unrelated bug found while tracing upload targets

`EquipmentImageUpload.tsx` uploads to a bucket named **`media`**, which does not exist in
this project (buckets are `avatars`, `badges`, `uploads`, `consent-evidence`). Equipment
image upload is therefore broken. Not touched here — it is outside this change and wants
its own fix. It is *not* a sweep risk, since `media` is not in `SWEEP_BUCKETS`.

---

## August 1, 2026 — The storage sweep never looked at the avatars bucket

Purged the July guardian-E2E fixtures from production, which surfaced a gap in the
sweep that had been there since it was built.

### Purging the QA fixtures — and the account that nearly went with them

13 fixtures deleted (5 supervised `@minors.invalid` children, 8 `@example.com`
guardians), children first so no supervised profile was stranded mid-purge. Zero posts
between them; all 11 production posts survived. Profiles 16 → 3.

**The near-miss worth recording:** the session's earlier notes claimed *14* QA profiles
and that only `tom.kazhikkachalil` and `testpartner` were real. The 14th was
`tom.kazhikkachalil@calian.com` — no handle, display name "John Parent", which is
exactly what test residue looks like. It is Tom's **work-email account**, it had signed
in that day, and it owns **2 of the 11 posts**. Classifying on "no handle" would have
destroyed real content.

What prevented it: classify strictly by **email pattern**, and refuse to delete any
profile that owns a post. Dry run printing both the delete list and the keep list, then
apply. Both belts, because either alone would have been enough to be wrong.

`consent_records` behaved exactly as migration 056 intends — **14 rows preserved with
their FKs NULLed**, 0 dangling. Two other tables looked like they had dangling
references until checked against the right target table (`pending_profile_id` points at
`pending_profiles`, and `guardian_email_snapshot` is a string, not an id). Verified
before reporting, not after.

Left deliberately: one `pending_profiles` row (`testkid@gmail.com`, handle `kidztest`,
`awaiting_guardian`) with its `guardian_invites` row — Tom's own manual test, the invite
went to his real gmail. Self-expires Aug 26.

### The gap: a bucket nothing ever swept

Deleting those profiles left **orphaned avatars**, and pointing the storage sweep at
them did nothing — it was hard-coded to the `uploads` bucket in all three places
(`uploadsPathFromUrl` matched only `/public/uploads/`, the walker listed `from('uploads')`,
the delete targeted `from('uploads')`). Confirmed by running it rather than by reading it:
a dry run scanned **13 files, all uploads**; the avatars bucket was never opened.

So **every deleted user with an avatar left a permanent orphan** that nothing collected.

The sweep is now bucket-aware, driven by `SWEEP_BUCKETS` (`uploads`, `avatars`) with a
`BUCKET_SOURCES` map of which DB columns can reference each. Two invariants are written
down because getting either wrong deletes live data:

- **A bucket must never be swept without reference sources.** With none, every file in it
  looks unreferenced and the whole bucket goes. Enforced by pairing the two maps.
- **`consent-evidence` is denylisted** — it is the legal audit trail for minors' consent,
  and the account-deletion engine excludes it for the same reason. Pinned by a test, so
  adding it takes a deliberate act.

Also tightened while in there: the `cover_url`-missing fallback used to swallow **any**
scan failure, which would silently shrink the referenced set and turn live files into
"orphans". It now degrades only for that specific known-missing column and rethrows
otherwise.

### Result

Dry run first, and it was worth it: of the 3 orphaned avatars only **1** was eligible —
the other two were **26.5h and 26.7h old, inside the 48h grace window**. That guard is
the only thing standing between the sweep and an in-flight upload (files are uploaded
before the row referencing them is written), so it was left alone rather than overridden.

Applied: **2 files deleted, 0 failed** — one genuine uploads orphan (an old post image
predating delete-time cleanup) and one avatar. Verified afterwards that every live image
still resolves: profile avatar 200, cover 200, **11/11 post_media 200, zero broken**.

**The remaining 2 avatars will not self-clean:** `vercel.json` runs the weekly cron as
`/api/cron/storage-sweep?dryRun=1`, so it reports and never deletes. Dropping that param
is a deliberate decision, and the route comment asks for a reviewed run first — now that
there is one, it's Tom's call.

Admin access for the run used a **disposable QA account via an `ADMIN_EMAILS` shell
override at dev-server launch** (shell env beats `.env.local`), never Tom's account; the
401-without-cookie control was checked first, and the account was deleted and confirmed
gone afterwards.

Gate: **45 warnings / 0 errors, 575 tests (+6), clean build (108 pages), 0 advisories.**

---

## August 1, 2026 — Mobile responsiveness pass: the tablet had no account menu

Drove the real app in system Chrome (playwright-core, localhost dev server so
StrictMode is on) across 13 routes and a dense range of viewport widths, asserting
geometry programmatically rather than eyeballing screenshots — then read the
screenshots anyway, which is how two of these were confirmed.

**Everything below 768px was already clean.** The responsive foundation is sound;
what follows are the gaps it did not cover.

### The one that mattered: every page overflowed 66px at exactly 768px

The header switched to full desktop chrome at `md` (768px), but logo + 7 nav links +
3 icon buttons + Post + the account menu need **~834px**. At 768px — iPad portrait,
and the single most common tablet width — the account menu was pushed **completely
off the right edge**, taking View Profile, Saved Posts, Settings and **Sign Out**
with it, and the page scrolled sideways.

This is the no-dead-ends rule failing on a whole device class. The breakpoint moved
to `lg` (1024px), so 768–1023px now gets the drawer, which already carries every one
of those destinations. Nothing was reachable at 768px before that isn't now.

### The drawer itself was a dead end on short phones

The drawer's list is ~840px tall and **had no scroll container**. On a 667px viewport
— iPhone SE, the shortest phone we support — Saved Posts, Settings and **Sign Out**
sat below the fold with nothing to scroll. A signed-in user on that device could not
sign out.

`flex-1 min-h-0 overflow-y-auto`. The `min-h-0` is load-bearing: a flex child will not
shrink below its content height without it, so `overflow-y-auto` alone would have done
nothing. Verified by asserting Sign Out is scrollable-to **and click-actionable** at
320×568, 375×667 and 390×844 — not merely present in the DOM.

### CreatePostModal's primary button was clipped on every phone

The footer was one non-wrapping row (hint + Cancel + Preview + Create Post). At 375px
the submit button ran to **424px in a 375px viewport**. Now stacks below `sm`, single
row above; desktop untouched.

### Two flexbox min-width traps

Both the same root cause — a flex item defaults to `min-width:auto` and will not shrink
below its content:

- the hashtag input (`flex-1`, no `min-w-0`) pushed its Add button past the modal edge at 320px
- the workout editor's date/duration inputs and the `shrink-0` Save Workout button could
  not share a line, pushing the button ~19px past its container

### Tap targets: two that were genuinely too small

Most sub-40px controls measured 36–38px, which is fine. Two were not, and both were
fixed by growing the **hit area with the visual unchanged**:

- **Calendar day cells were 24×24px** — and tapping a day is *the* phone interaction for
  the month view, since chips are hidden below `sm`. An `::after` overlay makes the whole
  64px cell tappable below `sm` only; at `sm`+ it is removed so event chips stay clickable.
  Proven with `elementFromPoint` at the bottom of a cell, not by reading CSS. The day
  button also gained a real `aria-label` — it previously announced only a number.
- **The feed composer's Photo/Video, Stats and Achievement buttons were 16px tall** (Stats
  and Achievement are icon-only on phones, 20×16). `py-3.5 -my-3.5` takes them to 44px;
  the negative margin cancels the padding so the row height (16px) and card height (107px)
  are provably unchanged. Both icon-only buttons also gained accessible names.

### Guardian switcher existed only on desktop

`Your athletes` / Approval queue / Account transfers / Add an athlete lived **only** in the
desktop dropdown, so they were desktop-only — and moving the nav to `lg` would have taken
them from tablets too. Mirrored into the drawer, so the drawer is a genuine superset of the
dropdown. Still dark in Vercel (flag unset); this is so enabling it doesn't ship desktop-only.

### A testing lesson worth keeping

**Mobile emulation hid a real overflow.** With `isMobile: true`, Chrome expands the layout
viewport to fit content — `window.innerWidth` reported **323** for a requested 320px
viewport, so `scrollWidth - innerWidth` came out to 0 and the page looked clean. The same
page under `isMobile: false` reported the true +3px overflow and named the element. Measure
overflow with mobile emulation **off**; use it for touch behaviour, not for layout geometry.

### Scope, honestly

CSS-class changes and comments only — **no logic touched**. Two things were found and
deliberately left:

- the composer's icon-only buttons are now 44px tall but still **20px wide**; widening them
  needs the row's `gap-2` to grow first or adjacent hit areas would overlap, and that is a
  spacing decision, not a bug fix
- `/api/follow/stats` fires **once per suggested profile** on a repeating poll — an apparent
  N+1 in the suggestions widget. Observed in the dev log only; not investigated.

Verified: **364 route/width combinations** (13 routes × 28 widths, dense around every Tailwind
breakpoint) with zero horizontal overflow; 15 drawer/modal scenarios across 5 viewports with
no clipped controls; zero console, page or server errors. `npm run verify` green with every
number unchanged — **45 warnings / 0 errors, 569 tests, clean build (108 pages)** — which is
the point for a CSS-only change. Two disposable QA accounts created and deleted, each
confirmed gone by service-role lookup; production back to exactly 16 profiles.

---

## August 1, 2026 — Security re-verification: the audit was wrong in both directions

Go-live pass over `docs/SECURITY_AUDIT_2026-07-17.md`. The document turned out to be
**stale in both directions at once** — reporting four fixed findings as open, while saying
nothing at all about the 43 routes added since it was written.

### Nothing needed fixing

All four open MEDIUM findings were already resolved in code: `/api/suggestions` gates
`profileId !== user.id`, `/api/upload` enforces `requireAuth` with the anonymous `temp/`
path gone, `/api/follow/stats` derives the viewer from the session, and `/api/posts/[id]`
gates private posts via `canViewProfile` returning **404 not 403** so it doesn't confirm
the post exists.

**No route logic was changed.** Touching working auth code to satisfy a stale document is
how live systems break.

### The bypass the audit worried about does not reproduce

The July audit patched three RPCs at the API layer and warned they "STILL leak if called
directly" — a legitimate fear, since the anon key is public and anyone can call an RPC from
a browser console.

Tested against production with ground truth of **16 profiles, 8 private**, calling each
function directly with the public key **and** as a signed-in stranger:
`search_by_handle`, `search_profiles`, `search_posts`,
`generate_connection_suggestions` (with an arbitrary `p_user_profile_id`),
`get_profile_media_counts`, `check_handle_availability` — **zero private profiles in every
result, both roles.**

Stated honestly in the doc: this is *behavioural* evidence. The function bodies aren't in
the repo, so we know **that** they filter, not **why**.

### The gap that mattered: 43 unaudited routes

The audit covered 67 routes. There are now **107** — and the 43 added since include the
most sensitive surfaces in the product: guardian (minors' data, credentials, consent),
admin, cron, transfers, invites, a token-addressed calendar feed.

All held under live probing as a signed-in stranger: admin → 403, cron without secret →
401, guardian → 404, bogus capability tokens → 404. The **destructive** probe
(`DELETE /api/guardian/athletes/<id>`) was aimed at a disposable victim so a gate failure
couldn't damage real data — it was rejected, and the target profile was confirmed intact
afterwards.

### Two testing lessons worth keeping

**Anonymous-clean does not imply authenticated-clean.** Supabase RLS for the
`authenticated` role is routinely broader than for `anon`, and a signed-in stranger is the
realistic attacker for a social app. Everything was re-run under a real session.

**`admin.auth.admin.createUser` does not create a `profiles` row.** The first probe run
"passed" its private-profile checks against a profile that never existed — a vacuous pass
that looked identical to a real one. Caught by an FK violation on the post insert, not by
the assertions. The profiles row must be inserted explicitly, or the whole probe is
theatre.

### One real gap closed

The admin gate — one string comparison guarding all of `/api/admin/*` — **had no test**.
Extracted `isAdminEmail` from `requireAdmin` (pure, ~5 lines moved, behaviour identical)
and pinned its contract: unset/empty/whitespace `ADMIN_EMAILS` denies **everyone**, and
entries match whole rather than substring, so `om@example.com` can't ride in on
`tom@example.com`. Proved to bite — flipping the empty-allowlist branch to `true` fails 2
of 8.

`resolveProfileAction` needed nothing; `profile-roles.test.ts` already covers the full
role × action matrix.

### Cleanup

Three disposable accounts across three probe runs, all deleted and **verified gone by
service-role lookup** rather than trusting the delete's status code. Production is back to
exactly 16 profiles with zero leftover probe posts.

`npm run verify` green: **45 warnings / 0 errors**, **569 tests** (+8), **0 advisories**.

---

## August 1, 2026 — Auditing the spring-clean: it fixed one of two twin files

Tom asked for a double-check before securing the work. Nothing needed pushing — tree
clean, `main` in sync, prod verified. The audit found three problems, **two of them
caused by the spring-clean itself.**

### The fix landed in one of two identical files

**`AGENTS.md` was a 408-line near-duplicate of CLAUDE.md — 60 of CLAUDE.md's 98
substantive lines byte-identical.** The July 31 cleanup corrected CLAUDE.md and never
touched AGENTS.md, so **within a single session the twins diverged**, and AGENTS.md was
left asserting every single thing that had just been fixed:

the same 15 dead documentation links · `OPENAI_API_KEY` (routes deleted, never set in
Vercel) · "Next.js 15" ×3 · three sports instead of eleven · the `/api/debug/counts` task
· 7 unqualified `.sql` paths, three resolving into `archive/failed-attempts/` · a re-copy
of the API auth pattern CLAUDE.md had deliberately extracted to `src/app/api/CLAUDE.md` ·
a "Recent Critical Fixes (**January 2025**)" section

This is the **two-doors failure in documentation form** — the same shape as the live-round
bug, where Go Live was wired on one of three composer sites. Duplicating a file guarantees
the fix lands in one copy.

AGENTS.md is now **31 lines**: a pointer to CLAUDE.md, and an explanation of why it's a
pointer so nobody helpfully re-expands it. Everything unique *and verified* moved into
CLAUDE.md first — Development Commands (which CLAUDE.md lacked entirely, and which
AGENTS.md had stale: no `typecheck`, no `test`, no **`verify`**), App Router Structure
(all 9 paths confirmed), Key Libraries (all 3 confirmed).

**"Core Tables" was deliberately not moved.** It listed 14 tables; `database/migrations/`
defines 40+. It was missing `group_posts`, `group_post_participants`,
`golf_scorecard_data`, `golf_participant_scores` — the tables golf actually runs on — plus
all messaging, calendar and guardian tables. A partial list labelled "Core Tables" is
worse than none, so the migrations are now named as the source of truth.

### The cleanup broke two documents

Deleting `scripts/` left **`docs/qa-test-guide.md`** instructing readers to run
`node scripts/qa-tests.mjs`, and **`docs/work-plan.md`** naming
`/scripts/qa-frontend-tests.mjs`. Removing code and leaving docs pointing at it is exactly
the rot that PR set out to remove — missed because nothing sweeps docs for dead paths.
Both repaired; the QA guide now points at `npm run verify`.

### The new index was itself incomplete

The rewritten CLAUDE.md index omitted **`docs/` entirely** — 20 tracked files including
`docs/devlog/`, the *old* devlog superseded by this file. Now indexed, with that
distinction stated.

### Also found, while in there

`docs/SECURITY_AUDIT_2026-07-17.md` item 4 (the `/api/ai` paid-OpenAI spend vector) is now
resolved permanently — the routes are deleted, so there's no auth check left to regress.
Item 3 (`/api/upload` unauthenticated uploads) **is already fixed in code** —
`requireAuth` is called and the `temp/` fallback is gone — but the doc still listed it as
open. Rather than half-update a security document, it's marked apparently-fixed-pending-
re-audit and the file now carries a staleness note. **The remaining open items were not
re-verified and are not claimed to be.**

### The check that would have caught all of this

```bash
grep -ohE '`[A-Za-z0-9_./-]+\.(md|ts|tsx|sql|css|json|mjs)`' CLAUDE.md AGENTS.md \
  | tr -d '`' | sort -u | while read p; do [ -e "$p" ] || echo "MISSING $p"; done
```

It now returns only `NewSportAdapter.ts`, which is a create-this-file placeholder. Worth
running whenever a doc names a path — it caught two unqualified paths I introduced *in the
commit that fixes unqualified paths*.

Docs only. `npm run verify` green with every number unchanged — **45 warnings / 0 errors,
561 tests, 0 advisories** — which is the point: a docs-only change that moves those
numbers touched something it shouldn't have.

---

## July 31, 2026 — Dependency majors: four taken, two blocked by the ecosystem

Seven major upgrades were outstanding. **Four landed, one was deleted rather than
upgraded, and two are blocked by their own ecosystems** — not by risk appetite.

### Taken

**`uuid` 13 → removed.** One call site (the storage filename in `/api/upload`). Node 22,
our pinned runtime, has `crypto.randomUUID()` built in and it is cryptographically random
exactly as uuid v4 is. Removing a dependency beats upgrading one.

**`zod` 3 → 4.** Small surface, but it hid a trap. `z.string().uuid()` → `z.uuid()` was
verified against the UUID shapes Postgres and Supabase actually emit (v4, v7, nil, max,
uppercase all still accept; a non-RFC variant still rejects) rather than assumed.

`emailString` was the real hazard. The natural v4 rewrite —
`z.email().trim().toLowerCase()` — validates the **raw** input, so it rejects
`"  Tom@Example.COM  "`, which the zod-3 chain accepts because it normalised first. That
is precisely the silent tightening `validation.ts`'s own header warns would 400 valid
production traffic. The correct form keeps normalisation ahead of validation via
`.pipe(z.email())`. The existing test caught it; a second test now pins the ordering,
because the failure is invisible by reading. Both were proved to bite by reintroducing
the naive form.

**`lucide-react` 0.525 → 1.28.** v1 removed **all** brand icons for trademark reasons.
Rather than guess which of 55 icons were also renamed, the upgrade went in first and
`tsc` was asked: exactly three broke, all three brand icons, and the other 52 came
through unrenamed.

`Twitter`/`Instagram` on `/u/[username]` moved to FontAwesome `fab fa-*` — not a new
convention, since `athlete/page.tsx` already renders those same two networks that way and
FontAwesome is already a dependency. Both links also turned out to have **no accessible
name** (a bare lucide `<svg>` announces nothing), so the icon is now `aria-hidden` and
the anchor carries a real label. `Dribbble` (basketball) → `CircleDot`; volleyball had
been pointing at `Trophy` as a placeholder and v1 ships a real `Volleyball` icon.

Verified past `tsc`: no dynamic or string-keyed lucide access exists, and all 54 remaining
icons resolve at runtime against the installed package.

**`typescript` 5.9 → 6.0.3.** tsconfig needed no edits — all four headline TS 6 breaks
were checked first and none applied (`strict` already true, `target` ES2017 not es5,
`moduleResolution` bundler not node10, `paths` with no `baseUrl`). **Zero type errors on
the first run.** Checked specifically because a silently-degraded linter is worse than
none: typescript-eslint still resolves and `eslint .` still reports exactly 45 warnings
rather than quietly finding fewer.

### Blocked — and the evidence, so this isn't re-litigated

**`typescript` 7.0.2.** `typescript-eslint@8.65.0` declares
`typescript: ">=4.8.4 <6.1.0"`. TS 7 ships no stable programmatic API until 7.1, so npm
refuses the install and forcing past the ERESOLVE crashes ESLint inside typescript-estree.
Upgrading a compiler by switching off the linter is not an upgrade. **Revisit when 7.1
ships.**

**`eslint` 10.8.0.** Attempted, and it does not merely add findings — **it cannot run at
all**:

```
TypeError: Error while loading rule 'react/display-name':
contextOrFilename.getFilename is not a function
  at eslint-plugin-react/lib/util/version.js:31
```

ESLint 10 removed the deprecated `context.getFilename()` that `eslint-plugin-react`'s
React-version detection calls. **`eslint-plugin-react@7.37.5` is the latest release and
its peer range ends at `^9.7`** — there is no fixed version to move to, and
`eslint-config-next`, including its 16.3 canary, still depends on `^7.37.0`. Reverted
cleanly; we stay on 9.39.5, which is still the `maintenance` dist-tag. **Revisit when
eslint-plugin-react ships ESLint 10 support.**

**`@types/node` 22 → 26**, unchanged and deliberate: `engines` and `.nvmrc` both say Node
22. Types must match the runtime, or code compiles against APIs Vercel doesn't run. Bump
alongside the runtime, never before it.

**`openai` 4 → 7** is moot — the spring-clean deleted its only two consumers.

Net: **six dependencies removed or upgraded, zero features lost.** `npm run verify` green
— tsc clean, **45 warnings / 0 errors**, **561 tests** (+2), clean build (108 pages),
**0 advisories**.

---

## July 31, 2026 — Spring-clean: the map pointed at nothing

Scoping the dependency sprint turned up something worse than stale dependencies.
**CLAUDE.md — the file every session loads first — named 16 documents, and 15 of them
did not exist.** Commit `790aa7b` removed 120 legacy docs; the index was never updated,
so for months the project's primary orientation file was a map to nowhere.

Everything below was verified against the repo rather than trusted:

| claim in CLAUDE.md | reality |
|---|---|
| 16 documents in "Detailed Documentation" | 15 gone — repo-wide search, not moved, deliberately deleted in `790aa7b` |
| "Check `/api/debug/counts`" | never a route |
| "See `implement-privacy-system.sql` for examples" | it lives in `database/archive/**failed-attempts**/` |
| "Next.js 15 App Router" | 16.2.12 since three commits ago |
| "Defines all sports (golf, ice_hockey, volleyball)" | the registry defines **11** |
| `design-tokens.ts` | `src/lib/design-tokens.ts` |

The index now lists only what exists, and says outright that adding an entry is a
promise to keep it true.

### Dead code, and the dependencies it was holding hostage

**`/api/ai/text` + `/api/ai/image`** — template scaffolding. No UI, no test, no route
referenced either. They proxy a **paid** OpenAI call behind nothing but an auth check,
and `OPENAI_API_KEY` is not set in Vercel production (checked, not assumed) — so the only
thing they could do in prod was 500. Deleting them removed `openai` and took the
**openai 4 → 7 upgrade off the board entirely**.

**`scripts/`** — 7 one-off diagnostics, orphaned. Nothing in `package.json`, README,
CLAUDE.md or CI ran them, and they had rotted: `qa-tests.mjs` reads a `.env` this project
doesn't use, `qa-frontend-tests.mjs` only prints prose. Sole importers of `dotenv`.

**`@types/uuid`** — `uuid` has shipped its own types since v7; the stub was shadowing the
real ones.

Three dependencies gone, no feature lost.

### The lint gate that wasn't

`eslint.config.mjs` asserted that *"`npm run lint` passes `--max-warnings 0`, so these
are gated, not advisory."* The script was a bare `eslint .`. **Nothing was gated** — all
45 warnings were advisory and warning 46 would have landed silently.

Rather than correct the comment down to the truth, the ratchet it described is now
installed: `eslint . --max-warnings 45`. Verified in both directions — at 45 lint exits
0; at 44, standing in for one new warning, it exits non-zero. The cap is 45 rather than 0
because the remainder is a known documented list, and a number that can only go down
beats a zero that isn't true.

### Flagged, not fixed

**Outbound email is off in production.** Ten route files gate their sends behind
`if (SMTP_USER && SMTP_PASS)`, and neither variable is set in Vercel — so calendar
invites, transfer and guardian notices, the notification digest, waitlist and contact
mail all silently no-op. Not a crash, not a regression, and out of scope here, but it is
a shipped feature that does nothing in prod. CLAUDE.md now documents the behaviour.

`npm run verify` green end to end: tsc clean, **45 warnings / 0 errors**, **559 tests**,
clean build, **0 advisories**.

---

## July 31, 2026 — Maintenance sync (live-round work shipped to production)

PR #5 squash-merged to `main` (`422db29`) and deployed. The merged branch is
deleted on both sides.

**Gates, all on `main` after the merge:**

| check | result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint .` | **45 warnings, 0 errors** — unchanged across the whole sprint |
| `vitest run` | **559 tests / 51 files pass** (1.44s) |
| `npm run build` | clean from a wiped `.next`; 110 static pages, **no warnings** |
| `npm audit` | **0 vulnerabilities** — was 4 at the last sync |

The advisory count reaching zero is the tail of the earlier dependency work
(nodemailer 7→9, dropping `@supabase/auth-helpers-nextjs`, the in-range bumps)
landing in the lockfile.

**Production verified live**, not merely deployed: `/`, `/explore`, `/live` and
`/api/health` all 200. The two new surfaces are up and behaving —
`/live/<uuid>` renders its shell, and `GET /api/group-posts/<uuid>/scorecard`
returns **401** unauthenticated rather than leaking a round.

**Known major-version drift, deliberately not taken** — each is a breaking
upgrade and the instruction was to break nothing:

`typescript` 5.9→7.0, `eslint` 9→10, `zod` 3→4, `openai` 4→7,
`lucide-react` 0.525→1.28, `@types/node` 22→26, `uuid` 13→14.

Worth scheduling as its own sprint: zod 4 and openai 7 both touch runtime code
paths, and eslint 10 would land on top of the flat-config migration that just
settled.

**Still outstanding, unchanged:** the browser walkthroughs for the live-round
flow (mine to write, Tom's to run), Sentry alert rules scoped to
`environment:production`, `.MOV`/HEVC transcoding (deferred), and the
`auth-server.ts:42` cookie `split('=')` truncation (logged, unfixed).

---

## July 31, 2026 — A live round is now a place you can go

Tom: *"Going live still doesn't take me into the round. It boots me out of the
window and the live score input screen never appears. Instead it posts to the
feed, and I have to go find the post that says 'awaiting scores' and click edit
score."*

### The previous fix was mine, and it was wrong

Not in what it did — in where it lived. It set `resumePostId` in `feed/page.tsx`'s
`handlePostCreated`, so `PostDetailModal` opened the scorer via an
`autoOpenScoreEntry` flag. That works. It landed in **one of three**
`CreatePostModal` render sites:

| site | had the fix |
|---|---|
| `src/app/feed/page.tsx` | yes |
| `src/app/athlete/page.tsx` | **no** — its handler is `onPostCreated={() => {…}}`, it ignores the argument entirely |
| `src/components/VitalsTab.tsx` | no |

And `AppHeader` does `router.push('/athlete')` whenever a page doesn't pass
`onCreatePost` — only `/feed` and `/athlete` do. **So the header "+" funnelled
the user from everywhere else into the one unfixed site.** That is the reported
path, exactly.

Explicitly refuted along the way: nothing clears `resumePostId` except the
modal's own `onClose`, and there is no `router.push`/`refresh`/`revalidate` in
the create chain. The "it opens and then gets replaced by a redirect" theory is
wrong — the scorer simply never opened.

### The structural gap

There was **no route that opens a group-round scorer**. The only way in was a
React state flag on one page. That cannot survive a reload or the back button,
cannot be linked, and lets every new render site drift — which is precisely what
happened. Since "leaving the screen and coming back should return me to the live
round where I left off" is a hard requirement, modal state was never going to be
enough.

### `/live/[groupPostId]`

Deliberately **not** under `/app/sport/golf/` — that namespace already has
`rounds/[roundId]`, which takes a *different primary key for the same-sounding
noun* (`golf_rounds.id`, the post-completion mirror). Putting a second one beside
it is the exact drift trap that caused this bug. `/live` already declares itself
the sport-agnostic live seam, so `/live` → `/live/<id>` needs no explanation and
a hockey period lands there later. The param is named `groupPostId` so it stays
grep-distinguishable.

The page mounts `ScoreEntryModal` **unchanged** over a `SharedRoundQuickView`
shell. That modal is 806 lines carrying draft merge, per-hole persistence, hole
media upload and player switching; with no jsdom in the test harness, extracting
a body from it would be an unverifiable refactor on the exact path being
complained about. On mobile `fixed inset-0` already *is* the full-screen scorer.

Two small pieces of new surface:

- **`GET /api/group-posts/[id]/scorecard`** — the existing `GET
  /api/group-posts/[id]` carries participants and media but no
  `golf_scorecard_data` and no `golf_participant_scores`, so it has neither the
  hole data nor the scores. ~50 lines reusing `GROUP_SCORECARD_SELECT` and
  `transformGroupPostToScorecard`, RLS-scoped via the user client. Keying on the
  group-post id means it works even when `post_id` is null.
- **`resolveRoundEntry`** (`src/lib/golf/round-viewer.ts`) — one pure function
  deciding `not-found` / `final` / `watch` / `score`, so the page has no
  branching logic of its own and the rules are unit-testable without a DOM. It
  defers to `effectiveRoundStatus`, so the 6h auto-end rule is honoured for
  free. A non-participant on a public round gets **watch, not 403** — watchable
  public rounds are the promise `/live` and Live Now already make.

### Navigation moved into the composer

The old fix failed because navigation lived in a *parent callback*. It now lives
in the single place a round is created — `CreatePostModal`'s shared-golf branch —
gated by `shouldEnterScorerAfterCreate` in `src/lib/golf/round-route.ts`. **This
fixes all three render sites at once**, because `router.push` doesn't care which
page mounted the composer, and a fourth site cannot drift because it no longer
participates in the decision.

That gate keys on **`group_post.id`**, never `post_id`. `post_id` reaches the
client through a re-fetch that can silently fail, and the old guard tripped over
it with no toast and no error.

### One door, not two

Every entrance was repointed and the old one deleted:

| surface | now |
|---|---|
| resume banner | `router.push(liveRoundPath(group_post_id))` — the banner state already carried it |
| Live Now cards | same; participants get the scorer, everyone else the watch view |
| `/api/golf/live-now` | dropped `.filter(r => r.post_id !== null)` — a round whose backfill failed is still watchable |
| `autoOpenScoreEntry`, `resumePostId`, the second `PostDetailModal` | deleted |

Two ways in is how this drifted in the first place.

**Coming back where you left off** is mostly free once the round has a URL:
`/live/<id>` re-resolves from the server, and `ScoreEntryModal` already resumes
at `firstUnscoredHole` and re-merges its localStorage draft. Auto-open is guarded
by **state, not a ref** — a ref read during render is what `react-hooks/refs`
forbids, and state is the better fit anyway: it resets on unmount, so closing the
scorer to check the leaderboard sticks while leaving and returning re-arms it.

**End Round** does `router.replace('/feed?post=<post_id>')` — `replace`, not
`push`, so the back button can't return to a scorer for a finished round. Ending
already re-timestamps the post, so it sits at the top of the feed.

### The silent failure underneath

`POST /api/group-posts` ended with `const { data: completeGroupPost } = …` — no
error binding, no log — then fell back to `groupPost`, selected **before** the
`post_id` backfill and therefore structurally null. A failed re-fetch returned a
201 that looked perfectly healthy while handing back a round with no feed post:
indistinguishable from the reported bug, and invisible in the logs. Now the error
is bound and logged, `post_id` is stamped from the value the request already
knows, and the backfill retries once.

### Verification

`resolveRoundEntry` and `shouldEnterScorerAfterCreate` are covered across every
state — including the regression test for the actual report: *"keys on the group
post id, never `post_id`"*. No migration; latest stays **060**. tsc clean, eslint
**45 warnings / 0 errors** (unchanged), **559 tests pass**, production build
clean.

Browser walkthroughs still owed, first one being the exact reproduction: header
"+" from `/explore` → `/athlete` → Create Post → **Go Live**.

---

## July 31, 2026 — Golf live rounds: five reported bugs, seven fixes

Tom ran a live round and hit five problems. All were traced end to end and
**verified against production data** before anything was changed — which mattered,
because the leading hypothesis was wrong.

### The hypothesis that was wrong

The theory was that the round saves before uploads finish, persisting a `blob:`
reference instead of the real file. **It doesn't.** `ScoreEntryModal` awaits
`uploadPostMedia` and stores the returned URL, exactly like the workout path.
Production confirms it: all three `group_post_media` rows hold real storage URLs
and every one returns **200** (jpeg 237KB, jpeg 340KB, quicktime 2.09MB).
Nothing was corrupted and nothing was lost.

### What was actually wrong

**The feed-media split (reported issues 4 + 5, one cause).** Hole media is
written to `group_post_media`; the feed renders `post.media`, mapped from
`post_media` — a different table, with nothing bridging them. Confirmed: all
three golf posts had **0 rows in `post_media`**. That is the whole "post shows
stats but no media, click in and it's there" symptom. Fixed by extending the
existing round→post mirror, deduped on `media_url` so it is re-runnable, media
attached *after* completion still lands, and media put on the post by any other
path is never destroyed. **Backfilled production** — the existing post has its
photos and video back.

**`post_id` was never selected (issue 3).** `/api/golf/live-now` maps
`post_id: sc.group_post.post_id ?? null` and then filters `post_id !== null`,
but `GROUP_SCORECARD_SELECT` never selected the column. Always `undefined` →
every round filtered out → the endpoint returned an empty list
**unconditionally**. LiveNowStrip on the feed and Explore, and the entire `/live`
page, had never shown anything to anyone. TypeScript could not catch it: the
transform returns `any`. Pinned by a test on the select string, verified to fail
when the field is removed again. Scoping also relaxed so **public** live rounds
reach any signed-in viewer, not just followers.

**Go Live didn't enter the round (issue 2).** The handler ended with
`closeAndReset()` — no navigation. The path that opens the scorer already
existed (`PostDetailModal` + `autoOpenScoreEntry`) but was wired only to the
resume banner, which requires `status='active'`; a new round is `pending`, so
the one door in could never open for the round you just started. Creation now
reuses it. Creation stays `pending` deliberately — flipping to `active` would
make the feed's live filter hide the post immediately.

**Solo rounds were never blocked (issue 1)** — client, API and DB all accept
zero participants. It was copy: an ungated "Add at least one participant to
create a shared round", a "Round Participants" heading, and a "+ Add Myself"
button that does nothing on a live round (the server inserts the creator
regardless). Also dropped `roundType` from `isDirty`, which made the golf
composer dirty the instant it opened so every close prompted to discard work
that hadn't started.

**Video (the other half of issue 4).** The stored clip is `video/quicktime`. Two
separate poster drops made it *look* broken on top of that: `thumbnail_url` was
selected in all three posts queries and then omitted from all three mappings, so
`poster=` was always undefined and **every video in the app** rendered black;
and `ScoreEntryModal` threw away the poster the editor already produced because
`group_post_media` had no column for it (**migration 060**). Both fixed, plus
`object-contain` so a 4:3 capture is letterboxed rather than cropped square.
Actually decoding HEVC outside Safari still needs transcoding — deliberately its
own project.

### Two bugs found that were not reported

**Composer media silently discarded.** The shared-golf branch returned *before*
the media upload block, so photos on an already-played shared round vanished
with no error — the only place a `previewUrl` was held and never exchanged.

**Abandoned rounds never reach your stats.** `advanceRoundStatus` runs only on a
score write, so a round abandoned mid-way stays `active` forever. The display
layer copes (the 6h quiet rule applies at read time), but the row never reaches
`completed`, and `mirrorCompletedRound` requires it. Production has a round from
2026-07-25 with **two players' real scores and zero `golf_rounds` rows** —
missing from trends and handicap, permanently, with no job that would ever have
fixed it. `runRoundSweep` now re-evaluates quiet rounds on the daily cron.

### Verification

541 tests (+9), tsc + lint clean, lint total still 45 warnings.

⚠️ **Migration 060 must run before deploy** — the mirror and the media POST both
write `group_post_media.thumbnail_url`.

Browser work still outstanding, in Tom's own scenarios: solo and partner starts,
switching between them, going live → scoring a full round, a second account
seeing it mid-round, and media playback after finishing.

## July 31, 2026 (sync) — Maintenance checklist

Run against the composer branch before merging it.

- `tsc --noEmit` clean · lint **0 errors / 45 warnings** · `vitest` **528 passed**
  (49 files) · `npm ci --dry-run` clean · clean `npm run build` (`.next/build`
  wiped first), **Turbopack, compiled in 9.4s**.
- **`npm audit --omit=dev`: 0 vulnerabilities.** The overrides added with the
  Next 16 upgrade (postcss 8.5.25, sharp 0.35.3) are holding.
- Node 22 agrees in all five places: `engines` `22.x` · `.nvmrc` `22` · CI
  `node-version: 22` · devcontainer `:22` · local v22.18.0.
- Migrations unchanged at **059** — this work is UI-only, no schema.
- The 45 lint warnings are the documented `set-state-in-effect` set from the
  Next 16 pass; no new ones were added by any of the 16 commits on this branch.
  The one build warning is the deliberate `middleware`-convention deprecation.
- Tom's dev server stayed up throughout. Next 16 separates `.next/dev` from
  `.next/build`, so concurrent dev + build is no longer the corruption hazard it
  was on Next 15.

## July 31, 2026 — Group chat in the dock pill + picker anchoring

Same branch, 8 more commits. 528 tests, tsc + lint clean, lint total still 45.

### Pickers now anchor to the field, not to their button

The emoji panel sat off-centre and, worse, stopped tracking the composer as it
grew. **Both were my own regression** from the iMessage layout commit: moving
the button inside the field left the panel anchored to the *button*.

The diagnosis took two passes and the first one was wrong, so it is worth
recording. There are **two** positioned layers, not one: `EmojiPickerButton`'s
root is `relative`, *and* the holder around it was `absolute right-1 bottom-0`
— an abspos element is itself a containing block. Dropping `relative` alone
(my first instinct) would have re-anchored the panel to a 40px shrink-wrapped
box still pinned to the field's bottom, reproducing both symptoms.

The fix makes the holder **congruent with the field**: `absolute inset-y-0
right-0 pr-1 flex items-end`. Its height *is* the field's height, so
`bottom-full` resolves to the field's top at every height and `right-0` to the
field's right edge. Alignment and growth-tracking both fall out of the box
model — no ResizeObserver, no portal, no measurement. `pr-1` sits inside the
containing block, so the button is still 4px in and looks identical.
`pointer-events-none` on the strip is load-bearing: it now spans the whole
field, so without it clicking the right gutter of a multi-line composer would
stop moving the caret.

`EmojiPickerButton` gained `anchor?: 'trigger' | 'container'` (additive,
default `trigger`) — the third additive prop in this series, and the other
three call sites stay untouched.

**Right edge, not centred** — chosen deliberately. On the full page the field
can exceed 1000px, so centring a 300px panel would park it ~350px from the
button that opened it and read as detached.

The **GIF picker now sits the same way**, reviving `GifPicker`'s
`variant='popover'` branch (dead since it was written) retuned to `right-0
w-72 max-w-[80vw]` and rendered as a sibling of the emoji strip so it shares
the containing block. Below 640px it stays the bottom sheet: with a keyboard up
on a 375px phone only ~350px is visible, so a 360px popover would be
off-screen. Exactly one branch mounts — `GifPicker` fetches trending and
autofocuses on mount, so two would double-fetch Giphy and fight for focus.
Fixed an outside-click bug it would have hit head-on: the listener is
unconditional and `mousedown` beats `click`, so against a `prev => !prev`
toggle it closed and immediately reopened. Guarded by
`[data-gif-picker-toggle]`, inert for all five modal call sites.

The emoji panel clears the 320px dock window by exactly **4px** (320 − 16 − 300).
That was previously luck; `pickerFitsSurface` now makes it a test. Writing that
test caught a modelling error in my first draft — I budgeted against the
padding *box* (288px), which fails the panel. A popover is not in-flow: it
floats over the left padding and only has to stay inside the surface.

### Group chat without leaving the pill

"New group chat" now leads the expanded panel, above search — a labelled row,
not a fifth unlabelled icon in a bar already carrying four in 320px. The whole
flow runs in the pill; nothing navigates to `/messages`.

The board's `NewConversationModal` **cannot** be reused (448px fixed-inset card,
above the dock's z-band, redirects on success), so what is shared is the
**rules**: `group-draft.ts` owns the name requirement, the member minimum, the
toggle, the submit predicate and the payload — and the board was migrated onto
it in the same pass, which is what actually stops the two drifting.

**`GROUP_MIN_MEMBERS = 2`, deliberately stricter than the server's 1.** Not
taste: a 2-person "group" is functionally a DM but takes the group code path,
which has **no duplicate detection**, so picking one person would mint a fresh
room on every attempt instead of reopening the DM you already have. Pinned by a
test named THE POLICY. The server staying permissive costs nothing — every
member is block- and permission-checked either way.

`composing: boolean` became `DockComposeMode = 'list' | 'direct' | 'group'`, so
the modes are mutually exclusive by construction and the pen's `aria-pressed`
stays honest.

Two dock-specific calls worth not re-litigating:

- **Chips scroll horizontally** (the panel's own "Active now" idiom) rather than
  wrapping like the modal. Wrapping is unbounded and would eat a 384px panel;
  this costs a fixed ~34px at any member count, with the count in the footer
  button so nothing is hidden.
- **No discard confirm**, deviating from CLAUDE.md's dirty-close rule. Resolved
  by making the loss not happen: the draft lives in `DockPanel`, which is always
  mounted, so collapsing the pill, Cancel, or bouncing to the direct composer
  all preserve it. Nothing is discarded, so there is nothing to confirm — and a
  full-screen `z-[60]` confirm over a 320px pill would be worse than the loss.
  Navigating to `/messages` unmounts the dock and does lose it; accepted.

Also fixed en route: **DockPanel dispatched `OPEN_WINDOW` before an un-awaited
`fetchConversations()`**. ChatDock renders a window only for a conversation the
provider knows and PRUNEs ids on every update, so a realtime INSERT or the 30s
poll landing in that gap dropped the brand-new id and the window silently never
appeared. Pre-existing DockComposer bug, fixed before the group flow inherited
it. And `useProfileSearch` extracted the debounce + seq-guard that was about to
exist a third time (DockComposer migrated; the board's copy deliberately not —
it differs on both knobs and nothing here can regression-test it).

### Not verified in a browser

Same caveat as always: vitest is node-only, so the 528 tests cover policy and
nothing visual, and there is no component or e2e harness for the dock at all.
Highest-risk items: the `min-h-0` chain (the dock body is fixed-height and
`overflow-hidden`, so a missing one silently clips the Create button away); the
PRUNE race, which needs a >30s wait to reproduce; double-submit making two
rooms (no server dedupe on this path); the strip's `pointer-events` on a
multi-line composer; the GIF toggle open/close; and the emoji panel escaping the
mini window's top edge at max composer height, which is new behaviour because
today the panel never rises at all.

## July 31, 2026 — iMessage-style message composer

Branch `feat/composer-imessage-layout`, 7 commits. The composer put **three**
action buttons before the text field — `[emoji][GIF][paperclip][textarea][send]`
— squeezing the typing area worst at 375px and in the 320px dock window.

Now: **emoji lives pinned inside the field's trailing edge in every state**, and
**attachment + GIF collapse into a single chevron on the first keystroke**. The
split is the point — emoji is *text entry*, used constantly mid-sentence, while
GIF and attachments are *media insertion* used far less often, so only the
latter pair earns the collapse.

Note `DockComposer.tsx` is **not** a message composer (it is the dock's
new-conversation people search). There is exactly one, `MessageInput`, rendered
on two surfaces — the full page and the dock's fixed-height mini window.

**Three decisions worth not re-litigating:**

1. **No auto-expand when the field is emptied.** The latch is one-way: typing
   collapses, backspacing to empty does *not* re-expand; only the chevron or a
   successful send re-opens it. Backspacing to empty is overwhelmingly mid-edit
   — fixing a typo, not deciding to attach a photo — and re-expanding there
   yanks 40px out from under the caret and slides the send button while a thumb
   hovers it. Send is the real session boundary. The tempting
   `leadingOpen = text.length === 0` derivation gives exactly the behaviour we
   rejected; `composer-layout.test.ts` fails 3 cases if anyone "simplifies" it
   back, including one named `THE POLICY`.
2. **Explicit px width constants + `w-10` on the buttons.** Two reasons, both
   previously learned: `auto` cannot be interpolated by a CSS transition (the
   chat-dock morph, Jul 28), and FontAwesome is an icon **font**, so a
   padding-sized button measures differently before and after the font loads —
   a measured or padding-derived width would be wrong on a cold cache.
3. **Touch targets stay under 44px, at 40.** Continues the documented exception
   for dense composer chrome (see the entries at ~3286/3296) — and is actually
   *up* from the previous ~36-38px.

Mechanism is the chat dock's morph idiom verbatim: both boxes stay **mounted**
and counter-animate `width` between explicit constants, with `inert` +
`aria-hidden` on whichever sits at zero. One flex item holds both, so the
collapsed state has one `gap-1` rather than two stray ones. Reduced-motion is
already handled globally — not re-implemented.

`EmojiPickerButton` gained two **additive** props, `align` and `disabled`.
`align` reuses `ReactionBar`'s existing vocabulary verbatim (same name, same
JSDoc phrasing, same ternary) rather than inventing collision detection: a
trailing-edge button needs `right-0` or its 300px panel runs off screen, and
left-at-leading / right-at-trailing are both inherently safe. `disabled` closes
a real gap — the composer disabled its other three buttons but not this one —
and closes an open panel when the button goes disabled mid-send. Done as a
render-phase sync, not an effect, so it neither paints an orphaned panel for a
frame nor adds a 46th `set-state-in-effect` warning to the 45 documented today.

Also folded in: the GIF modal was rendered *as a flex child of the button row*
(it is `fixed inset-0`, so it was a zero-width flex item plus a stray gap); the
hidden file input moved to the component root, because an `inert` ancestor can
swallow a programmatic `.click()`; the `120` duplicated between the inline
style and the resize handler (once as `120`, once as `5 * 24`) collapsed into
one constant; and the error `<p>` gained `role="alert"` to match DockComposer.

**Separate commit, droppable: an IME guard.** `handleKeyDown` had no
`isComposing` check, so pressing Enter to *commit* a Japanese or Chinese
composition sent the half-composed text. Real correctness bug, three characters,
in the exact handler this work reasons about.

**Deliberately out of scope:** `CommentSection`'s two near-duplicate emoji+GIF
clusters. The space problem is weaker there (two leading buttons, and emoji
leaves the row anyway), the mechanics differ (`<input>`, not a growing
textarea; a text submit button, not a 44px circle), and bundling them triples
the browser matrix. Both keep working untouched because the new props default
to current behaviour. A parity pass — folding in their drifted `p-2` vs `p-2.5`
and `items-center` vs `items-end` — is the natural follow-up.

**Verification.** 508 tests (20 new, all policy: the latch, the height clamp,
the send predicate), tsc + lint clean, lint total still 45 warnings. The tests
cover **no** visual behaviour — vitest is node-only with no jsdom, so
positioning, the width transition, `inert` semantics, panel geometry and real
`scrollHeight` are all invisible to it. Geometry was checked by arithmetic
against the Tailwind scale: `w-10` = 40px, two = 80px matching the constants;
`right-1` (4px) + a ~38px `p-2.5` emoji button = 42px against a 48px `pr-12`
gutter, so ~6px clearance and text cannot run under it at any line count.

**Not yet verified in a browser** — the real remaining risk: the mobile keyboard
chain (`h-dvh` + `--vvh` + `interactiveWidget`, broken and fixed twice before —
mitigated structurally by keeping every edit inside `.px-4.py-3` and never
touching the shell's `shrink-0 safe-bottom`); the right-flipped emoji panel at
375/768/1440 and in a 320px dock window, where a 300px panel is expected to
spill ~48px *inward* (acceptable — `MiniChatWindow` deliberately omits
`overflow-hidden` so popovers can escape); composer `offsetHeight` being
byte-identical before/after, since a fixed-height dock window trades composer
height for message rows; a dock draft mounting already collapsed with no flash;
tab order skipping the zero-width box; and the first-keystroke reflow not
jumping the caret.

## July 31, 2026 — Next.js 16 upgrade (+ the react-hooks reckoning it triggered)

Branch `chore/next-16`, 20 commits. `npm run verify` green throughout:
tsc clean, **0 lint errors, 488 tests, clean Turbopack build in 7.6s**
(webpack was ~23s). **npm advisories 4 → 0.**

### The upgrade itself was the small part

Next 15.5.22 → 16.2.12. No React, Node or TypeScript change needed — 19.2.8,
22.x and 5.9.3 already cleared 16's floors. The codebase turned out to be
unusually well-positioned: zero parallel/intercepting routes (so the new "every
slot needs `default.js` or the build fails" rule never applied), zero
`export const dynamic|revalidate|runtime`, zero `unstable_cache`/PPR/AMP/
`serverRuntimeConfig`, and the async request APIs were already fully migrated.

**Turbopack is now the default bundler and it just worked.** The feared failure
— "a plugin is adding a webpack option" — did not happen: `@sentry/nextjs`
10.69.0 declares `next: ^16.0.0-0` and ships the Turbopack-compatible hook, and
the build log confirms it runs (`Running next.config.js provided
runAfterProductionCompile ... Completed in 278ms`). No `--webpack` fallback.

**`images.qualities` was the one real breaking change here.** Next 16 narrowed
the default from "any quality" to `[75]` and coerces anything else to the
nearest listed value **silently** — no error, no warning, just softer images.
`OptimizedImage` ships 85 and 90 to live surfaces, so `[75, 85, 90]` is
declared, landed one commit *before* the bump so the bump is image-neutral.
`imageSizes` and `minimumCacheTTL` are now marked load-bearing in
`next.config.ts`: Next 16 changed both defaults, so those explicit values are
the only thing holding current behaviour.

**The advisories were not fixed by the major, contrary to the premise.**
`next@16.2.12` still pins `postcss` 8.4.31 exactly and `sharp` ^0.34.5; the
advisory range is `next 9.3.4-canary.0 - 16.3.0-preview.7`. npm `overrides`
(postcss 8.5.25, sharp 0.35.3) were always the only route, at any Next version.
Since `sharp` powers `/_next/image`, it was smoke-tested directly rather than
assumed — AVIF encode OK, libvips 8.18.3.

**One accepted build warning, deliberately.** `⚠ The "middleware" file
convention is deprecated.` We stay on `middleware` because `proxy` is forced to
the Node runtime and "cannot be configured", while `vercel.json` pins
`regions: ["iad1"]` and this middleware makes a Supabase network call on every
non-API request — a Sydney user would pay Sydney→Virginia→Supabase→back before
routing begins, plus Node cold starts on 100% of navigations. The matcher
comment already records that the `api` exclusion exists *because* `getUser()`
cost 100–300ms per call; migrating re-introduces that on a larger surface.
Dated rationale and revisit triggers are in `src/middleware.ts`.

### The part that actually cost the session

`next lint` is removed in 16, and migrating is not a script rename. `next lint`
silently scoped itself to source dirs; `eslint .` does not. Run as-is this repo
reported **34,840 problems**, 34,831 of them from `.next/` build output — and
the official `next-lint-to-eslint-cli` codemod does *not* fix that, because it
emits the FlatCompat shape and `compat.extends()` cannot carry flat-config
`ignores`. We adopted the native flat config instead, with `globalIgnores`
stated explicitly rather than inherited from a transitive default.

Then `eslint-config-next@16` brought `eslint-plugin-react-hooks` v6, whose
React Compiler rules arrived **as errors** and flagged **121 pre-existing sites
across 80 files**. 76 were fixed. Five of the six rules — `refs`,
`immutability`, `purity`, `static-components`, `preserve-manual-memoization` —
are now at **zero and gate as errors**.

`set-state-in-effect` is held at `warn` for the 45 that remain, deliberately:

- **~31 are flagged at the CALL SITE.** The rule cannot see through a
  `useCallback`, so removing every synchronous `setState` does not clear it —
  verified directly on FollowersModal. Satisfying it means inlining ~31
  data-fetching functions into their effects as cancellable async IIFEs, which
  is worth doing but belongs in its own PR with its own testing.
- **~13 are legitimately effects**: mount-time `sessionStorage`/`location`
  reads that would break hydration if moved into render, realtime connection
  lifecycle, and the media editor's object URLs — which **must** stay
  effect-owned (see the StrictMode revoke bug, July 26).

**Do not silence these by wrapping calls in `void (async () => …)()`.** It
satisfies the analyzer without changing when anything executes. Noted in
`eslint.config.mjs` next to the rule.

Two genuine bugs were introduced *by the refactor* and caught before landing,
both from lifting `if (!isOpen) return;` out of an effect body into the
component body: `EventFormModal` (caught by `rules-of-hooks` — it skipped
`useDirtyClose`) and `AddAchievementModal` (would have returned `undefined`
from render, i.e. crashed on close). The tree was swept for that shape; those
were the only two. Two `snapRef.current = …` writes also drifted into render
and were split back into effects.

Worthwhile changes that fell out of it: `QuickMessagesToggle` now uses
`useSyncExternalStore` (retiring a hand-rolled subscribe and its `ready` flag);
`WorkoutEditorScreen`'s sync is a true single-flight instead of self-recursion,
and its timer stores a timestamp instead of a throwaway counter;
`MessageBubble`'s 15-minute edit window is evaluated when the menu opens rather
than depending on render timing; `PostCard` shed a write-only state.

### Not verified by me — needs a browser and a preview deploy

The 488 tests **de-risk approximately none of this**: `vitest.config.ts` sets
only the `@` alias, so it runs in Node with no jsdom, and every test is a
pure-function lib test. They stay green whether this worked or broke every
image on the site. Outstanding: image quality on the production optimizer
(`/_next/image?…&q=85`/`q=90` must not 400), auth/session survival, the
media-editor filter and trim scrub, `next/font` rendering, and Sentry
symbolication under the Turbopack source-map hook.

## July 31, 2026 — Image optimization (the 6 that matter) + Sentry environments

Branch `chore/image-optimization-sentry-env`, five commits.

**Only 6 of the 18 raw `<img>` sites were worth converting.** The audit that
prompted this counted 18 `@next/next/no-img-element` suppressions and read
them as 18 missed optimizations. They are not:

- **6 convertible** — 2 cover photos (Supabase Storage) + 4 avatar/message
  thumbnails. Real optimizer wins, now `<Image>`.
- **5 Giphy** — the optimizer *streams animated GIF/WebP/APNG through
  unchanged*. `<Image>` would save zero bytes while spending a billable
  Vercel Image Optimization transformation per source-per-size. (The
  animation-loss fear that motivated the original raw `<img>` choice turns
  out to be wrong — but the conclusion holds for a better reason.)
- **7 `blob:`/`data:`** — the optimizer fetches server-side and cannot read a
  client-only URL. `next/image` force-sets `unoptimized` for these, so
  `<Image>` is strictly overhead plus a maintenance trap: a future reader
  sees no `unoptimized` prop and assumes optimization is happening.

The 12 keep their raw `<img>` and their `eslint-disable`, but each now
carries the reason above it. 18 bare suppressions → 18 explained ones. Two
sites also record what must survive verbatim: `style={{filter}}` (the live
media-editor preview *is* that prop) and `draggable={false}` (the trim
scrubber would otherwise hijack to a native image drag). Lint was already
clean before and after — the rule is `"warn"` and every site suppressed it —
so converting the 12 would have bought nothing.

**Live bug found while planning: Google-OAuth avatars were already broken.**
`deriveAvatarUrl` (`lib/oauth-profile.ts`) returns Google's `picture` URL
verbatim and `api/auth/complete-profile` writes it to `profiles.avatar_url`.
`lh3.googleusercontent.com` is **not** in `next.config.ts` `remotePatterns`,
so `GuestPicker`, `EventDetailModal` and the guardian transfers page have
been 400ing at `/_next/image` for every Google-signup user since OAuth
shipped Jul 27. Fixed in its own commit. New `lib/media/image-src.ts`
(`isOptimizableImageSrc`) is the shared guard — same-origin paths and
Supabase Storage objects only — and every converted site uses it. **Not**
touched: `OptimizedImage.tsx`'s looser `!src.includes('supabase')` heuristic
would accept `https://evil.com/supabase`; tightening it hits ~22 files of
consumers and deserves its own pass.

**Sentry could not tell dev from prod.** All three inits gated solely on DSN
presence with no `environment` field, so the DSN added to `.env.local` this
session meant local errors + 10% of traces landed in the production project,
indistinguishable from real incidents. New `lib/observability/sentry-env.ts`
resolves `explicitEnv → vercelEnv → nodeEnv`; unrecognized strings fall
through so a typo cannot mint a rogue environment. Traces 0.1 in
production/preview, **0** locally. Dev stays *enabled and tagged*, not
silently disabled — that would be the kind of hidden fix the standing
requirements forbid, and it would block verifying Sentry locally.

Two things that are easy to get wrong and are now pinned by comment + test:
the resolver takes env values as **arguments** and never reads `process.env`
itself (Next's DefinePlugin substitutes `process.env.X` at the *call site*;
a module reading them internally would inline nothing in the browser build);
and the client reads **`NEXT_PUBLIC_VERCEL_ENV`**, not `VERCEL_ENV`, because
only `NEXT_PUBLIC_*` reaches the browser and Vercel preview builds run
`NODE_ENV=production` — losing that value would tag every preview browser
event as `production`. Verified in the built bundle: the call site compiles
to `{…,vercelEnv:i.env.NEXT_PUBLIC_VERCEL_ENV,nodeEnv:"production"}` and the
sampling ternary to `.1*("development"!==a)`.

Tests **469 → 488** (45 → 47 files). tsc + lint clean, clean `npm run build`
(dev server confirmed stopped first).

**Two follow-ups still open — the code is done, these are not:**
1. **Sentry dashboard (Tom):** scope alert rules to `environment:production`.
   Without it events are tagged correctly but dev errors still page. This is
   the difference between "tagged" and "actually fixed".
2. **Confirm preview tagging on a real preview deploy.** If a preview event
   reports `production`, Vercel's *Automatically expose System Environment
   Variables* is off → set `NEXT_PUBLIC_SENTRY_ENVIRONMENT=preview` on the
   Preview environment. Worth noting: `vercel env pull --environment=
   production` did **not** list `NEXT_PUBLIC_VERCEL_ENV`, so this is a real
   possibility, not a theoretical one.

Not verified by me: the 6 conversions in a browser (no jsdom in this repo, so
they cannot be unit-tested) — the Google-avatar render check, the cover-photo
responsive pass, and the media-editor filter/scrub smoke are Tom's.

## July 31, 2026 (sync) — Maintenance checklist

Run against `eb4f935`, closing out the three dependency passes.

- lint clean · `tsc --noEmit` clean · `vitest` **469 passed** (45 files) ·
  `npm ci --dry-run` clean · clean `npm run build` (dev server stopped and
  `.next` wiped first), 80 routes in the manifest.
- Node 22 agrees in all five places: `engines` `22.x` · `.nvmrc` `22` ·
  local v22.18.0 · CI `node-version: 22` · devcontainer image `:22`.
- Production healthy: core pages 200 · `/login` → 307 · unknown URL →
  branded 404 · `/api/calendar/events` unauthenticated → 401 · image
  optimizer serving `image/webp`.
- Live flags verified by inlined value (not string presence):
  `FEATURE_CALENDAR: !0`, `FEATURE_CHAT_DOCK: !0`.
  `FEATURE_GUARDIAN_PROFILES` remains unresolved, i.e. intentionally dark.
- Migrations through **059**, all run and verified. `main` is the only
  branch locally and on the remote. `AGENTS.md` stays untracked by choice.

**Dependency posture after this week's work: 8 → 4 production advisories.**
Cleared: the critical `tar` DoS, `ws` memory disclosure, `form-data`,
`uuid`, and all six `nodemailer` CVEs. Everything updatable inside the
declared ranges is current, and the deprecated `@supabase/auth-helpers-nextjs`
is retired. The remaining 4 share one root cause — Next pins `postcss`
8.4.31 exactly and `sharp` `^0.34.3`, which also makes `next` and
`@sentry/nextjs` appear — so clearing them needs a Next 16 major or npm
`overrides` forcing past those pins. Deliberately deferred; both routes
deserve their own pass.

## July 30, 2026 (deps 3) — Retire the deprecated Supabase auth-helpers

`@supabase/auth-helpers-nextjs` is deprecated upstream ("Package no longer
supported") in favour of `@supabase/ssr`. Turned out to be a pure deletion:
**zero imports anywhere in `src/`** — the migration to `@supabase/ssr` had
already happened (8 files use it: `middleware.ts`, `lib/supabase.ts`,
`lib/auth-server.ts`, the auth callback and username-login/activate routes,
and more). The package was only a declared dependency, dragging in
`@supabase/auth-helpers-shared` and `set-cookie-parser` behind it.

Removed the one line from `package.json`; both it and its private
dependency are gone from the tree, and nothing else depended on them.
No source changes.

Verified: tsc + lint clean, 469 tests, cold `npm ci` + build (proves the
lockfile resolves without it). Because the package is auth-adjacent even
while unused, also re-ran the auth/session browser smoke — **12/12**:
logged-out redirect, signed-in deep link, session surviving a refresh,
plus realtime, images and upload. Diff is 44 deleted lines, nothing added.

## July 30, 2026 (deps 2) — nodemailer 7 → 9, then the in-range updates

Two separate commits so a regression bisects cleanly.

### Phase A — nodemailer 7 → 9 (b7a9699)

Clears its six advisories, including SMTP command injection
(GHSA-c7w3-x93f-qmm8). **Zero code changes were needed**, and the DEVLOG's
earlier fear about this bump turned out to be overstated once the surface
was actually measured:

- Exactly ONE file imports nodemailer (`src/lib/email-service.ts`): one
  `createTransport` with only host/port/`secure:false`/auth, ten
  `sendMail` calls whose entire option vocabulary is
  from/to/subject/text/html/replyTo, and one `verify()` that is dead code.
  Return values are all discarded, so `SentMessageInfo` changes can't bite.
- Neither breaking change applies. v9 tightened TLS validation when
  *fetching remote content* (attachment href/path URLs, OAuth2 endpoints,
  proxy CONNECT) — we do none of those and use plain SMTP user/pass. v8
  renamed `NoAuth` → `ENOAUTH` — nothing matches on it. The hardening
  around `envelope`, `raw`, `List-*`, `disableFileAccess`/`disableUrlAccess`
  is moot: zero uses in `src/`. The calendar path emails HTML only — the
  .ics generator is download/subscribe-feed, never a mail attachment.
- `@types/nodemailer` 6.4 → 8.0 in step. Verified against the published
  tarball that **nodemailer ships no `.d.ts` and has no `types` field**, so
  the types package is still required (an exploration pass had claimed
  otherwise).

**Email has no automated coverage, no dry-run mode, and `.env.local` has
no SMTP keys — so `npm test` proves nothing here.** The send path was
exercised for real instead: a purpose-built local SMTP sink advertising
AUTH (our transporter always authenticates and hardcodes `secure:false`,
so a plain debug server won't do), dev server pointed at it, then
`POST /api/contact` — chosen because it's the only route that hard-fails
on mail errors and it exercises the widest option set including the sole
`replyTo`. Result: **200**, message received with correct envelope,
From/To/Subject, `Reply-To` preserved, and a multipart/alternative body
carrying both text and HTML parts. Failure path re-checked with the sink
stopped: clean 500, error logged, route and server unaffected.

### Phase B — in-range updates (13a5e3c)

Lockfile only; `package.json` byte-identical, so all declared ranges are
untouched. Notable: `@supabase/supabase-js` 2.57 → **2.111** (54 minors —
realtime and auth), `tailwindcss` + `@tailwindcss/postcss` 4.1.6 → 4.3.3,
`react`/`react-dom` 19.1 → 19.2.8, `typescript` 5.8.3 → 5.9.3,
`@sentry/nextjs` 10.69, `date-fns` 4.4, `eslint` 9.39.

Verified against what changed, not just "the suite is green": tsc clean on
TS 5.9, lint clean, 469 tests, cold `npm ci` + build. Browser — realtime
smoke **12/12** (two-browser DM both directions, presence, dock mini
thread, auth/middleware, image decoding, upload) and the widget suite
**35/35**, which numerically compares computed colours and the flush seam
and therefore doubles as a genuine CSS-output regression detector for the
Tailwind bump. Feed screenshot reviewed — no visual change.

Side effect worth knowing: the middleware bundle grows **137 kB → 159 kB**
from the larger supabase-js.

### Where the dependency posture now stands

**8 → 4 production advisories** across both dependency passes, critical and
nodemailer gone. The remaining 4 are all one root cause: Next pins
`postcss` 8.4.31 exactly and `sharp` `^0.34.3`, and those two surface again
as the `next` and `@sentry/nextjs` entries. Clearing them needs either a
Next 16 major or npm `overrides` forcing past Next's pins — a deliberate
decision for another day, not a drive-by. Majors still available and
deliberately untouched: Next 16, zod 4, openai 7, eslint 10, uuid 14,
lucide 1.x, TypeScript 7.

Also noted while in here, not actioned: `@supabase/auth-helpers-nextjs`
(0.10.0) is deprecated upstream in favour of `@supabase/ssr`, which the
project already uses — worth retiring the old package eventually.

## July 30, 2026 (sync 2) — Maintenance checklist

Run against `9b03205`, after the chat-widget flag was restored and verified
live in production.

- lint clean · `tsc --noEmit` clean · `vitest` **469 passed** (45 files) ·
  `npm ci --dry-run` clean · clean `npm run build` (dev server stopped and
  `.next` wiped first), 80 routes in the manifest.
- Node pin agrees everywhere: `engines` `22.x` · `.nvmrc` `22` · local
  v22.18.0 · CI `node-version: 22` · devcontainer image `:22`.
- Production health: `/`, `/feed`, `/explore`, `/calendar`, `/messages` →
  200 · `/login` → 307 · unknown URL → branded 404 ·
  `/api/calendar/events` unauthenticated → 401.
- **Live flag state** (the check that actually proves anything — inlined
  literal, not string presence): `FEATURE_CALENDAR: !0`,
  `FEATURE_CHAT_DOCK: !0`, `FEATURE_GUARDIAN_PROFILES` still an unresolved
  runtime lookup, i.e. intentionally dark pending Tom's walkthrough.
- Migrations: numbered files through **059**, all run and verified.
  Nothing pending. `main` is the only branch; `AGENTS.md` stays untracked
  by choice.

Dependency posture unchanged from the earlier pass: **5** production
advisories (1 moderate, 4 high), no critical. All five need major bumps —
`nodemailer` 7 → 9, and sharp/postcss which are pinned by Next (so they
also surface as the `next` and `@sentry/nextjs` entries). Still deliberately
not actioned here; `nodemailer` in particular wants its own pass with real
send-path testing.

## July 30, 2026 (flag) — Chat widget re-enabled in production

Tom reported the messaging widget missing from production. It was: the
code shipped fine, but `NEXT_PUBLIC_FEATURE_CHAT_DOCK` was absent from the
Production environment when the last build ran, so the flag evaluated
false and `ChatDock` rendered nothing. Tom re-added the variable; this
docs-only commit triggers the fresh build that bakes it in
(`NEXT_PUBLIC_*` is inlined at build time — saving the variable alone
changes nothing about the running site).

**Diagnostic lesson worth keeping.** On July 29 I "verified" the dock was
live by finding its strings in the deployed bundle. That check is
worthless: `FEATURE_FLAGS.FEATURE_CHAT_DOCK` is a property on an exported
object, so the minifier cannot dead-strip the component and its markup
ships whether the flag is on or off. The check that actually proves
anything is the **inlined flag value** in the chunk that contains
`FEATURE_SPORTS`:

```
FEATURE_CALENDAR: !0                                             ← enabled
FEATURE_CHAT_DOCK: "1"===a.env.NEXT_PUBLIC_FEATURE_CHAT_DOCK     ← NOT set at build time
```

Both live in the same object in the same build, so the contrast is
conclusive: a defined variable is replaced with a literal, an undefined
one is left as a runtime lookup against an empty browser `env` object
(always false). Behavioural confirmation used alongside it: sign a
disposable user into production in headless Chrome and count
`[data-testid="chat-widget"]`.

No code changed in this commit — the tree is identical to d1eae86, which
already passed lint, tsc, 469 tests, a clean build, CI and a production
deploy. The only delta is the environment variable.

## July 30, 2026 (node) — Pin Node 22 in the repo

Closes the gap the dependency pass surfaced: CI (`.github/workflows/ci.yml`),
the devcontainer and local dev were all on Node 22, but nothing enforced it
for Vercel or for a contributor's shell — and the `@img/sharp-*` binaries
the audit fix added are ABI-sensitive, so a Node-major mismatch would surface
as image-optimizer failures rather than an obvious error.

- `package.json` → `"engines": { "node": "22.x" }`
- `.nvmrc` → `22` (so `nvm use` picks it up automatically)

**Consequence worth knowing:** per Vercel's docs, `engines.node` *overrides*
the Node.js Version setting in the project dashboard, and Vercel's default
for new projects is now **24.x**. So if the dashboard was on 24.x, production
builds move to the latest 22.x — deliberate, since the whole point is that
prod, CI, the devcontainer and local all run the same major. Vercel maps
`22.x` to the latest 22 patch and applies security updates itself. Switching
everything to 24 later is a one-line change in these two files plus the CI
workflow.

Verified: `engines` parses and local v22.18.0 satisfies `22.x`, `npm ci`
clean with no `EBADENGINE` warnings, tsc + lint clean, 469 tests (45 files),
clean production build.

## July 30, 2026 (deps) — In-range audit fixes: 8 vulnerabilities → 5

Lockfile-only change (`package.json` verified byte-identical before and
after — that's what "in-range" means).

**Genuinely remediated (4):** `tar` 7.4.3 → 7.5.22 (**the critical** —
two uncatchable DoS paths), `ws` 8.18.2 → 8.21.1 (uninitialized memory
disclosure + memory-exhaustion DoS), `form-data` 4.0.4 → 4.0.6, `uuid`
13.0.0 → 13.0.2.

**Bumped but still flagged — correcting yesterday's note, where I trusted
npm's optimistic `fixAvailable` flag:** `next` 15.5.7 → **15.5.22** (the
advisory range runs to ≤16.3.0-preview.7, so only a Next major clears it),
`sharp` 0.34.4 → 0.34.5 (needs ≥0.35.0; `next@15.5.22` declares
`sharp: "^0.34.3"`), `nodemailer` 7.0.10 → 7.0.13 (needs v9).
`postcss` was **not touched at all** — Next exact-pins 8.4.31, while the
copy that actually compiles our CSS is `@tailwindcss/postcss`'s 8.5.22,
already above the advisory. So the CSS pipeline was never at risk.

The 5 remaining trace to just three roots: postcss + sharp pinned by Next
(which is why `next` and `@sentry/nextjs` appear too — inheritance, not
flaws in their own code) and nodemailer needing a major. **Do not run
`npm audit fix --force`**: npm's suggested "fix" for the next/postcss/sharp
entries is a downgrade to `next@9.3.3`.

**Where the risk actually was** — not the four remediated packages, but
Next moving 15 patch releases. Those releases tightened
`images.remotePatterns` matching (GHSA-9g9p-9gw9-jx7f), and our config uses
leading-wildcard hostnames (`**.supabase.co`, `**.giphy.com`) — exactly
that surface. A regression would have broken every avatar, post image and
GIF. So a **baseline was captured before upgrading**: `/_next/image` for a
real Supabase Storage avatar and a Giphy URL, plus page codes. After the
upgrade both responses are **byte-identical** (2,915 and 2,434,068 bytes),
webp negotiation still works, and a non-allowlisted host still gets a 400.

Verification: `tsc` clean · lint clean · 469 unit tests · **cold**
`rm -rf node_modules .next && npm ci && npm run build` (the step that bites
in CI — proves the new tar/Tailwind-oxide native path and ~122 added
`@img/sharp-*` platform entries resolve from scratch), 152 routes ·
post-upgrade browser smoke **12/12** (logged-out redirect, signed-in deep
link, session-survives-refresh, images decode with no broken `img`
elements, live DM delivery both directions between two browsers, dock
presence dot, dock mini thread, avatar upload through a route handler) ·
widget suite re-run unchanged **35/35** · zero page errors.

Deliberately not covered, and why: AI endpoints (they cost credits, and
`form-data` only arrives via `@types/node-fetch` while our AI routes are
plain JSON), `uuid` (its one import site is `/api/upload/route.ts`, which
has no callers, and the advisory affects v3/v5/v6 with a `buf` argument
while we use v4), email (nodemailer untouched by this pass).

Rollback if ever needed: one file — `git checkout <sha> -- package-lock.json
&& npm ci`, or revert the commit.

Follow-ups this surfaced: (a) `nodemailer` 7 → 9 needs its own pass (touches
contact, waitlist, calendar invites, digests, transfers); (b) clearing the
sharp/postcss advisories needs either a Next major or npm `overrides`
forcing past Next's pins — the latter is doable but riskier; (c) no
`engines` field or `.nvmrc` exists — CI and the devcontainer both say Node
22 and local is 22.18, but nothing enforces it for Vercel or a contributor
shell, and the `@img/sharp-*` binaries are ABI-sensitive.

## July 30, 2026 (sync) — Maintenance checklist

Tom confirmed the rebuilt messaging widget works well; full checklist run
against `84c0ecb` (already pushed and deployed).

- lint clean · `tsc --noEmit` clean · `vitest` **469 passed** (46 files) ·
  `npm ci --dry-run` clean · clean `npm run build`, **152 routes** (dev
  server stopped and `.next` wiped first).
- Prod health, all as designed: `/`, `/feed`, `/explore`, `/calendar`,
  `/messages` → 200 · `/login` → 307 to `/` · unknown URL → 404 (the
  branded not-found page) · `/api/calendar/events` unauthenticated → 401.
- Migration state: numbered files through **059**, all run and
  behaviourally verified. Nothing pending.
- Housekeeping: deleted the leftover local `build-wt` branch (fully merged,
  never pushed — `git branch -d` verified that before removing it), and the
  throwaway `preview-flag-check` branch is gone from both local and remote.
  `main` is now the only branch. `AGENTS.md` stays untracked by choice.

**Flagged, deliberately NOT actioned in this sync** — `npm audit`
(production deps only) reports 8 vulnerabilities: 1 critical (`tar`), 6
high (`next`, `form-data`, `postcss`, `sharp`, `ws`, `nodemailer`), 1
moderate (`uuid`). Seven have fixes *inside* the current semver ranges, so
`npm audit fix` would resolve them with patch/minor bumps; `nodemailer`
needs 7 → 9, which is a major and would touch the contact-form mail path.
Left alone here because dependency upgrades aren't part of the maintenance
checklist and Tom asked for no breakage — this wants its own pass with the
full suite plus a build and smoke run after upgrading, and the nodemailer
major handled separately from the in-range ones.

## July 30, 2026 (later) — Messaging widget: one element, two states

Two defects in yesterday's panel, both reported by Tom.

**1. It was two components, not one.** The panel and the pill were
siblings — `DockPanel` had its own violet banner AND the violet pill
button rendered below it. Even sitting flush that's two violet bars: the
"duplicated / overlapping pill". Now there is a single `chat-widget`
element whose violet bar is the same DOM node in both states — collapsed
it IS the pill, expanded it becomes the body's banner:
- Width transitions between two explicit values (`w-44` → `w-80`);
  `auto` can't be interpolated, so the collapsed pill takes a fixed width.
- Body height transitions `0` → `min(24rem, calc(100vh - 7rem))`. A FIXED
  target on purpose: a content-derived height needs measurement and
  collapses unevenly when the content is shorter than the clamp. The list
  already scrolls, so this is smooth in both directions.
- `DockPanel` lost its banner and is body-only (search + active-now +
  list + composer); the bar in `ChatDock` owns compose/settings/minimize/
  close, so compose state lifted up with it.
- The body stays mounted with `inert` + `aria-hidden` while collapsed, so
  the morph is a pure transition — **no mount/unmount, and both
  `setTimeout(160)` calls are gone** (they were un-cancelled on unmount).
  The `ea-dock-rise`/`ea-dock-sink` keyframes are deleted with them.
- Verified: collapsed 176px → expanded 320px, bottom and right edges
  unchanged (anchor holds), and **exactly one violet bar in both states**.

**2. Close was a dead end.** `dismissed` was `useState` in a component
that lives in the root layout and never unmounts, so closing survived
navigation and only a hard refresh restored it — while I had described it
as returning "on next page load". Measured: close → /explore → back to
/feed → still gone; refresh → back. Now:
- New `src/lib/chat-dock-visibility.ts` persists the preference under its
  own key (`ea:chat-dock-hidden:v1`, `'1'`-or-absent, matching the app's
  other dismissal flags). Deliberately NOT a field in `ea:chat-dock:v1` —
  reshaping that payload risks wiping existing users' window layout on
  parse — and deliberately in `lib/` not `chat-dock/`, so the Messages
  toggle doesn't break if the dock folder is ever deleted.
- The dock never remounts, so a write from /messages can't be picked up by
  re-reading: the lib dispatches a `CustomEvent` (the native `storage`
  event does not fire in the writing tab) and also listens to `storage`
  for other tabs. This is the codebase's first cross-component event; it
  follows house style (namespaced const, silent try/catch, subscribe in an
  effect with cleanup).
- Close also clears the workspace via a new pure `CLEAR_WINDOWS` action —
  open mini windows go too, per Tom's choice.
- Restore lives in the Messages area: `QuickMessagesToggle`, an
  always-visible switch pinned under the conversation list ("Quick
  messages / Chat pill in the corner of every page"), `hidden lg:flex`
  since the widget only exists at ≥1024px. The page's sidebar wrapper
  became a flex column with `min-h-0` so the list keeps its own scroll and
  the row stays pinned — `ConversationList` itself is untouched, and note
  `lg:block` → `lg:flex` in the active-conversation branch.

Verification: 469 unit tests (11 new — visibility lib incl. private-mode
throws, event and cross-tab paths, `'1'`-only coercion; plus
`CLEAR_WINDOWS`) · lint + tsc clean · clean production build · browser
smoke **35/35**: one widget element and one violet bar collapsed AND
expanded, no separate pill when open, width/height morph with bottom-right
anchor held, minimize→reopen twice, selecting a person unchanged, close
removes widget + windows and stays gone across soft nav, return trip, and
hard refresh, restore from the Messages toggle puts the pill back
bottom-right with the switch reflecting state on revisit, on-screen at
620px tall, absent at 390px, zero page errors. Screenshots reviewed for
both states.

## July 30, 2026 — Chat dock panel: expands out of the pill

The expanded state read as a disconnected dropdown (white header, lone
compose pen, pill-shaped search matching nothing else, full-page-sized
rows). Redesigned into one continuous surface with the pill.

- **Rise/sink animation** — new `ea-dock-rise` keyframes in globals.css
  beside the existing `ea-*` microinteractions, `transform-origin: bottom
  right` so the panel unfolds from the pill's corner (no Tailwind utility
  can express that origin here). Exit keeps the panel mounted for one
  160ms animation using the Toast idiom (`Toast.tsx:74-83`). The global
  `prefers-reduced-motion` wildcard neutralizes both automatically — no
  per-component variants needed. Pill chevron now rotates rather than
  swapping glyphs, matching AppHeader.
- **Violet banner** matching the pill and mini-window chrome: own avatar
  at 28px, "Messages" + unread total, then compose / messaging settings /
  minimize / close. `-mb-2` on the panel wrapper cancels the column gap so
  the panel sits FLUSH on the pill — banner on top, white body, pill as
  the foot, one surface. Smoke asserts the seam is ≤2px.
- **Search** moved directly under the banner using the full messages
  page's exact markup (`bg-gray-100 rounded-lg`, inset search icon), which
  the dock previously diverged from.
- **`DockConversationRow`** (new) sized for 320px chrome: 36px avatar,
  presence dot, two-line hierarchy, divider lines, and rows whose
  conversation already has a window get the active violet treatment.
  `ConversationItem` is untouched apart from `export` on its two pure
  formatters, so preview/timestamp wording stays single-sourced with the
  full page (it still serves /messages at full width).
- **`conversation-identity.ts`** (new) replaces the direct-vs-group
  derivation that was copy-pasted across three dock files with different
  fallbacks — a row could read "Unknown" while the window it opened said
  "Conversation". Also fixes a latent bug: the dock matched participants on
  the nested `profile?.id`, which selects the CURRENT USER when a
  participant's profile fails to load. Groups never get a presence dot.
- **Minimize vs close** now mean different things: minimize collapses to
  the pill; close clears the corner for this page view (deliberately not
  persisted — it returns next load, and messaging stays reachable from the
  header nav, so it is not a dead end).
- **Active-now** avatars filtered to partners with an existing direct
  thread — a partner known only from a group chat had no thread to open, so
  the avatar was a silent no-op. Empty state gained the messages-page
  treatment plus a compose CTA.
- **Settings deep link**: `/settings` now honours `?tab=<id>` via a
  Suspense-wrapped reader (house rule for `useSearchParams`), so the gear
  lands on Messaging instead of Account. Unknown values keep the default.

Verification: 458 unit tests (8 new for the identity helper, incl. the
self-selection and missing-profile cases) · lint + tsc clean · clean
production build · browser smoke **25/25**: all four banner controls by
aria-label, banner colour numerically equal to the pill's, flush seam,
banner→search→list order by bounding boxes, panel fully on-screen at
1280×900 and 1280×620, selecting a person still opens the window with
history, minimize/reopen, close-then-reload, settings deep link, compose
open/cancel, no dock at 390px, zero page errors. Screenshots reviewed at
both heights.

Three harness lessons worth keeping: the panel's open state persists
across navigation (that's the product), so a test must never blind-click
the pill to "open" it; Tailwind 4 emits `oklch()` and a mid-transition
element can serialize as `oklab()`, so colour assertions must normalize
rather than string-compare; and a hovered pill reports its hover shade, so
park the cursor before measuring.

## July 29, 2026 (later) — Chat dock: not a regression, but four real fixes

Tom reported the messaging pop-up regressed "after a recent push".
Audited the dock across every route, viewport and auth state.

**No regression from the push.** `git diff a459a70 HEAD` over the dock,
`layout.tsx`, `auth.tsx`, `messages.tsx`, `features.ts` and `globals.css`
shows only the 3 a11y/test-id lines from 487af29. `<ChatDock/>` is a
SIBLING of `{children}` in the app's only layout and all three providers
render zero DOM, so nothing a page or modal does can become its ancestor,
create a containing block, or clip it — the nav batch is structurally
incapable of breaking it. Confirmed the deployed prod bundle still
contains the dock (`Messages dock` present in `layout-*.js`).

**Root cause of "it disappeared": `.env.local` never had
`NEXT_PUBLIC_FEATURE_CHAT_DOCK`.** The flag was only ever set in Vercel
Production, and `NEXT_PUBLIC_*` is build-time-inlined, so on `npm run dev`
the component returns null and renders NO DOM. The dock has never
appeared locally. Added the flag to `.env.local` (gitignored). Note:
Vercel Preview needs the var too if preview URLs are being tested.

**Four genuine defects fixed (all present since launch):**
- The dock column is bottom-anchored and grows upward with no height cap
  (panel 448px + bubbles + pill ≈ 650px), and `lg` gates on width only —
  so on iPad landscape or a 1280×800 window the panel's top was cut off
  above the viewport. Added max-heights on the column, panel and window
  plus a `(min-height: 600px)` gate: below that it hides rather than
  rendering clipped.
- Mini window 26rem → 30rem. The message scroller is `overflow-y-auto`,
  which per spec computes overflow-x to `auto` too, so it clips BOTH axes
  — defeating the shell's deliberate "no overflow-hidden". The ~350px
  emoji/reaction pickers had only ~300px. Fixed by height alone; no
  shared messaging component was touched (never fork messaging).
- Window-row wrappers lacked `shrink-0` while children are a hard `w-80`,
  and the cap came from `innerWidth` (includes the scrollbar the
  fixed-positioning viewport excludes) — at a cap boundary that fit one
  window too many and they overlapped. Now `shrink-0` +
  `documentElement.clientWidth`.
- z-[45] kept deliberately (above the z-40 header, below the 50+ dropdown
  /modal bands so modals correctly cover the dock) — now documented in
  the component so nobody "fixes" it.

**Contextual suppression** — new `isDockSuppressedPath` in `dock-state.ts`
(colocated, so deleting `chat-dock/` still leaves messaging untouched).
Hides the UI on `/messages` (the full experience) and on focused
workflows: every guardian screen incl. Add Sub-Profile, transfer of
control, the workout editor, onboarding, complete-profile,
activation/invite tokens, password flows, contact, settings, and the
sign-in page. Prefix matching requires a segment boundary, so `/contacts`
and `/app/guardianship` are unaffected. Suppression gates the UI ONLY —
presence, badges and localStorage keep running, so open windows and
half-typed drafts are intact on the way back out. Kept visible on
`/privacy`, `/terms`, `/dashboard/*` and all browsing surfaces.

Verification: 450 unit tests (5 new for the path predicate incl. the
boundary and null cases) · lint + tsc clean · clean production build ·
browser smoke **27/27**: launcher bottom-right, panel and window fully
on-screen at 1280×900 and at 620px tall, dock absent at 560px and back
when the viewport grows, open→minimize→restore→close twice with no
duplicates, absent on six focused routes + the sign-in page, the Add
Sub-Profile submit button hit-testable via `elementFromPoint`, the open
window restored after leaving the flow, no dock at 390px, zero page
errors. Harness lesson: an onboarded user is redirected off
`/onboarding`, so testing suppression there needs a NOT-yet-onboarded
user — and the same user must still get the dock on `/feed`, proving the
absence is route-based rather than a broken gate.

## July 29, 2026 — Navigation audit: no more dead ends

Full audit of every route, modal, and flow for screens a user could get
stuck on. Three parallel explorer passes (routes/nav, modals/forms,
auth boundary) found one systemic cause plus a set of point defects;
all fixed in 7 commits. Ships live (no flag) — it only adds exits.

**Systemic cause.** `BrandBar` — the header on all 15 standalone pages
(auth flows, guardian flows, onboarding, legal) — was deliberately
non-interactive, so ~10 screens had no way back: guardian
approvals/transfers had NO exit in any state, and consent/transfer/
activate/reset-password/invite/onboarding had dead-end states. The logo
stays non-interactive (original intent); a right-aligned auth-aware
escape link now guarantees an exit — signed in → /feed, signed out →
the sign-in page. Hidden on "/" itself, while auth resolves, and via
`hideEscape` for genuinely modal steps (transfer mid-execution;
complete-profile, which gets its own sign-out).

**Other fixes.**
- No `not-found.tsx` existed → bad URLs hit Next's bare 404 (no links at
  all). Added a branded one; `/login` (a route that never existed but
  which TWO pages pushed to — saved posts' Sign In button and the sport
  activity guard) now server-redirects to "/".
- `AppHeader` had no logged-out branch: anonymous visitors on /explore
  and /u/[username] saw the full authenticated nav — bells polling
  protected APIs, Post button, empty avatar, Sign Out — and no way in.
  Now a logo-only shell while auth resolves, then Log in + Sign up.
  ("Explore as Guest" on the login page makes /explore a real public
  surface, so this path matters.)
- `/auth/complete-profile` was a genuine trap loop: "/" bounces
  profile-less sessions straight back, and the form state had no exit,
  so any persistent profile-creation error stranded the user. Now a
  permanent "Sign out and return to login".
- Onboarding gets a quiet per-step sign-out (gating unchanged); the
  signup `guardian` step gets the "Log in" footer every other step had;
  reset-password gets "Back to sign in" under the form and inside the
  submit-time expired-link error; the private-profile view and saved
  posts' signed-out/error states now mount the header; `global-error`
  gets "Go home" (reset() alone can re-mount a broken tree forever).
- Saved posts had a guard-order bug: a signed-in refresh flashed "Sign
  In Required" (and its button 404'd). Auth boot now wins.

**Unsaved-changes confirmations.** New `useDirtyClose` hook +
`COPY.FORMS.DISCARD_*`, reusing the existing ConfirmModal (which gained
an optional `overlayZClass` so it can stack above the z-[65] media
editor). Wired into 8 modals: CreatePostModal (its X silently reset ~30
fields including a full 18-hole scorecard — the worst loss available in
the product), EditProfileTabs (per-tab save + a backdrop click that
discarded every other tab; its guard snapshots each field group and
refreshes only the group that saved), AddEquipment, EventForm, AddVital,
MediaEditor, EditPost, NewConversation. Clean closes and post-save
closes are untouched — no confirm after a successful save.

**Destructive half-state fixed.** ReplaceEquipment retired the old item
BEFORE the add step, so backing out left the athlete with retired gear,
no replacement, and no undo. The retire now runs after the new item
exists; if only the retire fails they keep the new gear and get told to
retire the old one manually.

Verification: 445 unit tests · lint + tsc clean · clean production build
(152 routes; /_not-found and /login present) · production-server check
confirming the branded 404 body and the /login 307 · browser smoke
**24/24** over 7 scenarios (404 both auth states, /login alias,
logged-out explore header with zero protected-API polling, BrandBar
escape present off-"/" and absent on it, complete-profile sign-out
escape, CreatePostModal clean-vs-dirty close incl. Keep-editing
preserving the caption and Discard clearing it, saved-posts guard
order), zero page errors. Harness lesson: `text=Create Post` also
matched a hidden menu label — anchor composer assertions on the h2.

Deliberately out of scope: BrandBar logo stays non-link; onboarding
gating unchanged; no per-route notFound() calls; no AppHeader-into-
layout refactor; no beforeunload guards (in-app close paths only); no
new Esc-key close paths; no draft persistence (confirm was the ask).

## July 28, 2026 (night 4b) — 🚀 CHAT DOCK LAUNCHED

Tom set NEXT_PUBLIC_FEATURE_CHAT_DOCK=1 in Vercel (Production); this
commit triggers the fresh build that inlines the flag. Live for all
signed-in desktop users (≥1024px, everywhere except /messages): the
Messages pill with unread badge, conversation panel with presence and
inline compose, mini chat windows that persist across navigation and
refresh (drafts included), and minimize-to-bubble. Phones keep the
existing full-screen messaging untouched. Launch verification: headless
Chrome against prod with a disposable user must find the dock pill on
/feed.

## July 28, 2026 (night 4) — Persistent chat dock (shipped DARK)

FB/LinkedIn-style bottom-right chat dock on every big-screen page,
behind new flag `NEXT_PUBLIC_FEATURE_CHAT_DOCK` (dark until Tom flips
it in Vercel + fresh build — same routine as the calendar launch).

- **One system, two doors** (the brief's golden rule): the dock is a
  pure second VIEW over existing messaging. `MessagesProvider` is its
  entire list/badge data source; mini windows reuse MessageBubble /
  MessageInput / TypingIndicator and the same `/api/messages/*`
  endpoints on a distinct realtime topic (`dockchat:<id>`, coexisting
  with the provider's `messages:<id>` — dual channels already proven in
  prod). Deleting `src/components/chat-dock/` leaves messaging pristine.
  Only live-messaging file touched: MessageInput, additive
  `initialText`/`onTextChange` props (~10-line diff, inert when absent).
- **Persistence IS the product**: dock mounts once in the root layout
  (App Router soft nav never unmounts it); layout persists to
  localStorage `ea:chat-dock:v1`, per-conversation drafts to
  `ea:chat-draft:v1:<id>` (48h TTL, debounced 400ms, write-through on
  empty so send clears reliably). Minimized windows stay mounted-hidden
  for instant restore; a minimizedRef guards read-marking.
- Pill → panel (active-now row, filter, ConversationItem list reused
  verbatim, inline composer) → up to 3 mini windows (width-aware cap
  `clamp(1,3,floor((vw-360)/336))`, oldest auto-minimizes) → avatar
  bubbles. Presence v1: client-only Supabase Realtime Presence channel
  `presence:global`, mounted only inside the gated dock — no DB, no
  migration; mobile users read as offline (documented v1 limit).
- Gates are JS-level, not just CSS (phones must not run phantom
  presence/read-marking): flag && user && matchMedia(min-width:1024px),
  and the dock renders nothing on /messages (the full page IS the big
  door). z-[45]: above header (40), below all modals (50+).
- Verification: 445 unit tests green (dock reducer 10, drafts 4 — node
  env with a localStorage stub, no jsdom dep). Two-browser Chrome smoke
  **20/20** incl. THE test: mini window + half-typed draft survive
  /feed→/calendar navigation AND a hard refresh; realtime both
  directions; B's unread badge; A's presence dot in B's panel;
  dock-read state agrees with the full messages page; minimize→bubble→
  instant restore; "Open full view" lands on /messages?c=<id>; dock
  suppressed on /messages and on a 390px viewport; zero page errors.
- Smoke-harness lesson: `button:has-text("Messages")` matched the
  header NAV button and silently navigated instead of opening the dock
  → the pill now carries aria-label="Messages dock" (a11y win too) and
  the panel/window shells carry data-testids.
- lint clean · tsc clean · vitest 445/445 (43 files) · clean prod
  build (dev server killed, .next wiped first).
- Deferred (cut line, in order): toast+sound near dock, "recently
  active" presence state, MutationObserver title fix, full-page draft
  adoption, group creation in dock.

## July 28, 2026 (night 3b) — 🚀 CALENDAR LAUNCHED

Tom set NEXT_PUBLIC_FEATURE_CALENDAR=1 in Vercel (Production); this
commit triggers the fresh build that bakes the flag in. Live for all
users: Calendar tab + four views, event creation, the full invite loop
(pending-slot styling, accept/decline/maybe, tallies), recurring events
with scope editing, the feed mini-calendar widget, reminders (pg_cron
10-minute sweep goes live with this build — its pre-launch
"skipped: flag off" responses flip to real sweeps), Add-to-calendar
downloads and the Google/Outlook subscribe feed. Launch verification:
the unauthenticated /api/calendar/events probe must flip 404 → 401.
Built and verified over one day: migrations 057-059, 60 calendar unit
tests, five E2E suites (36+27+28 API checks), four browser smokes —
all first-run green except two harness-side fixes.

## July 28, 2026 (night 3) — Maintenance sync + CALENDAR LAUNCH PREP

- lint clean · `tsc --noEmit` clean · `vitest` 431 passed (41 files) ·
  `npm ci --dry-run` clean · full clean `npm run build` success, 110
  pages (dev servers stopped, `.next` wiped first).
- Migration state: through 059, ALL run + behaviorally verified
  (059 same night: sync+reminders E2E 28/28; Tom to eyeball cron.job /
  net._http_response per the migration's verification queries).
- **Tom approved LAUNCHING the calendar publicly.** The Vercel CLI's
  env-write was permission-blocked from the agent side, so the flag is
  a manual dashboard step: Vercel → edge-athlete → Settings →
  Environment Variables → add NEXT_PUBLIC_FEATURE_CALENDAR = 1
  (Production; Preview optional). NEXT_PUBLIC_* is build-time-inlined:
  the flag takes effect on the NEXT deployment (the launch commit that
  follows Tom's confirmation triggers a fresh build), NOT retroactively.
  Launch verification probe: GET /api/calendar/events unauthenticated →
  401 = flag baked in and live; 404 = still dark.
- The calendar ships everything from the brief except org invites
  (blocked on organizations existing): views, events, full invite loop,
  recurrence with scope editing, feed widget, reminders (pg_cron
  10-min trigger + daily safety net), Add-to-calendar + subscribe feed.
- Guardian feature remains dark by choice (awaiting Tom's walkthrough).

## July 28, 2026 (night 2) — Calendar EXTERNAL SYNC + REMINDERS built (dark)

**Commits a553798 / e519524 / e8c3778 (+ docs), dark behind the calendar
flag. Stages 5+6 of Tom's calendar brief: "Add to calendar" .ics
downloads, a personal Google/Outlook subscribe feed, and reminders
(default 30 min before, per-event adjustable, in-app notifications).
⚠️ MIGRATION 059 WRITTEN, NOT YET RUN — and it needs a find-replace of
__CRON_SECRET__ with the real CRON_SECRET before running (a guard
refuses unsubstituted runs; do NOT commit the substituted file).**

- **The scheduling problem, solved off-Vercel:** Hobby crons run at most
  once daily (both slots taken), so migration 059 schedules Supabase
  pg_cron + pg_net to hit /api/cron/reminders every 10 minutes with the
  Bearer secret. The pg_cron section is exception-wrapped — if the
  extensions are unavailable the schema still lands and reminders fall
  back to the SAME strict sweep running once daily inside
  /api/cron/daily (idempotent by reminded_at; deliberately never a
  widened variant, which would fire early). Pre-launch the endpoint
  answers {"skipped":"flag off"} with 200 — healthy pg_cron logs.
- **Reminders:** preset leads only (Off/10m/30m default/1h/1d) → the
  sweep is one exact PostgREST query per lead (no per-row interval SQL,
  no RPC), mark-then-insert (a rare miss beats 10-minute spam),
  humanized titles ("Reminder: X starts in 30 minutes"), deep links.
  Per-guest reminder select in the detail modal (organizer included;
  cancelled 409; series occurrences independent, hint shown); changing
  the value clears reminded_at so widening the lead re-reminds once.
- **Add to calendar:** GET /events/[id]/ics — cookie-authed via the
  SAME guest gate (extracted to lib/calendar/detail-server), stable
  UID <id>@edge-athlete, all-day VALUE=DATE with exclusive DTEND in the
  event's zone, recurring occurrences note their series rule in the
  DESCRIPTION. Modal "Add to calendar" link.
- **Subscribe feed:** calendar_feed_tokens capability URLs (sha256 at
  rest, raw shown ONCE, rotate=replace) → cookie-less
  /api/calendar/feed/[token] serving [now−30d, now+183d] non-declined
  events + recently-cancelled as STATUS:CANCELLED (plain VEVENTs — the
  materialized-occurrence model means NO RRULE ever). Toolbar Sync
  modal: create/regenerate w/ confirm, one-time copy,
  treat-like-a-password copy, Google/Outlook subscribe instructions.
- **✅ MIGRATION 059 RUN (Tom, same night, via a secret-substituted copy
  generated OUTSIDE the repo and deleted after) — FULL E2E 28/28 first
  run:** ics auth matrix + escaped/all-day content; feed create →
  rotate → old-token 404/new 200 → cookie-less serving with name +
  refresh hints → declined excluded → cancelled STATUS:CANCELLED;
  reminders: sweep delivered to guest AND organizer with humanized
  titles, second sweep no-op (reminded_at dedup), widened-lead
  re-remind after change, off/preset-400 guards, bearer 401. Browser
  smoke 4/4 (Add-to-calendar link, Remind-me persists across reopen,
  Sync modal one-time URL — screenshot reviewed). 431 unit tests,
  lint/tsc, clean build (110 pages). Remaining for Tom whenever:
  migration 059's verification queries #3-#4 (cron.job row + 200s in
  net._http_response after ~10 min) — the app can't see the cron
  schema, only the SQL editor can.

## July 28, 2026 (evening 3) — Feed calendar widget (dark) — mini calendar + quick view in the sidebar

**Tom's ask: the feed's "Upcoming Events" slot should hold a mini
calendar that expands for a quick view; editing/creating hands off to
the full /calendar page. Smoke 10/10, zero new endpoints or migrations,
dark behind the calendar flag (flag off keeps the old "coming soon"
shell — prod pixel-identical).**

- **FeedCalendarWidget** (sidebar card, replaces the hard-coded shell
  when NEXT_PUBLIC_FEATURE_CALENDAR=1): next-4 upcoming list (category
  dot, date · time, pending invites faded with a violet "needs reply"),
  a "Show calendar" toggle expanding a tiny month grid (today filled,
  event-day dots, prev/next), and tapping a day opens an inline
  quick-view panel of that day's events. Tapping an event opens the
  EXISTING EventDetailModal right in the feed — reading and RSVPing
  happen without leaving; the modal's Edit button in this context
  routes to /calendar?event=<id>, and "+ New event" routes to
  /calendar?new=1 (the calendar page now consumes ?new=1 to auto-open
  the create form, same consumed-param pattern as ?event=). Errors
  degrade to a quiet retry link (LiveNowStrip rule: a sidebar widget
  never breaks the feed). One data fetch (the 42-day month-grid range)
  serves the list, the dots, and the day panels.
- Smoke (two browsers + 390px): pending event listed with needs-reply →
  mini month expand → day panel → in-feed RSVP (marker clears) →
  organizer Edit lands on /calendar with the detail open →
  /calendar?new=1 opens the form → mobile stacked rendering. One
  harness-only fix (wait was too short for the dev-mode refetch).
  Screenshots reviewed. lint / tsc / vitest 415 / clean build (108
  pages) green.

## July 28, 2026 (evening 2) — CALENDAR RECURRENCE BUILT (dark) — series, scope editing, per-occurrence declines

**Commits 860f347 / d64a841 / 7e4d809 (+ docs), dark behind the calendar
flag. Stage 3 of Tom's calendar brief: repeat patterns, the classic
"This event / This and following / Entire series" question,
single-occurrence overrides, series invitations with per-occurrence
decline. ✅ MIGRATION 058 RUN by Tom same evening — API E2E 27/27
(series create/fan-out counts, ONE-notification-per-guest deltas,
series accept + single-occurrence decline, override semantics, scoped
time edit keeping per-occurrence dates, date-move 400, following
cancel + generation stop, cron extension with weekly-parity and
guest-status-copy assertions, scope guards) + browser smoke 14/14
(Repeat UI creates a real biweekly Tue+Thu ×10 series, immutable-rule
note, scope chooser on edit/cancel, respond chooser defaulting to
"All events in the series", series cancel clears the grid; screenshots
reviewed, zero page errors). One harness fix mid-run (cumulative vs
delta notification count — test bug, not code).**

- **Architecture: MATERIALIZED OCCURRENCES.** event_series holds ONLY
  the rule; every occurrence is a real events row with its own guest
  rows — the entire v1 read path (range query, respond, tally, deep
  links, pending styling) is untouched. Per-occurrence decline IS the
  v1 respond endpoint. One cap: 104 occurrences; 'never' series roll a
  ~6-month window the daily cron extends (new phase 3, flag-gated).
- **DST-safe pure core (tests 396→415, all first-run green):**
  zonedWallClockToUtc two-pass offset solver over cached Intl
  formatters — weekly 18:00 New York stays 18:00 local across both DST
  transitions; pinned semantics: fall-back ambiguity → earlier
  instant, spring-forward gap → lands after the gap (2026-03-08 02:30
  NY → 03:30 EDT, fixture-tested). Weekly stepping anchors to the
  FIRST occurrence's week so every-other-week parity survives cron
  resumption (fixture). Monthly-31/Feb-29 skip shorter periods (RFC
  5545). byweekday must include the start day (validator).
- **Scope semantics (API):** PATCH/DELETE scope this|following|series +
  respond scope this|series. Field edits skip overridden occurrences
  (scope=this sets series_override; anchor always included); guest
  changes and CANCELLATION never skip. Scoped time edits keep each
  occurrence's own date via applyWallTime (date moves → 400 "edit just
  this event"). following/series cancel bulk-flips + stops generation
  (ends→'until'); ONE notification per guest for every series-wide
  operation, never per occurrence. Series respond updates all active
  occurrences ({updated_count}). Rule editing post-creation is
  deliberately unsupported (cancel + recreate).
- **Client:** Repeat section in the create form (frequency, "Every [n]
  weeks", day chips with start-day locked, Never/Until/After-N);
  ScopeChooserModal asks the classic question for edit (default: this
  event only), cancel (destructive), and respond (default: ALL events
  — the brief's "invitations cover the series by default"; "Just this
  event" is the per-occurrence decline). Detail modal shows "Repeats
  weekly on Tue, Thu · until Oct 6" ; chips get a repeat glyph.
- Static verification: 415 unit tests, lint/tsc clean, clean build
  (108 pages). Live E2E (series create/fan-out counts, series accept,
  single decline, override semantics, scoped time edit, following
  cancel + one-notification assertions, cron extension with parity +
  status-copy checks) runs the moment 058 is applied.

## July 28, 2026 (later) — CALENDAR v1 BUILT (dark) — views + events + full invite loop

**Commits fa23896 / f308de5 / 4fe5b8a (+ this docs commit), dark behind
NEXT_PUBLIC_FEATURE_CALENDAR (unset everywhere; migration 057 must run
first). Tom's new feature brief: a Google/Outlook-class personal
calendar; approved first build = stages 1+2 (views + one-time events +
the invite loop — "the invite loop is the product"). Custom-built grid
with the already-installed date-fns v4 — ZERO new dependencies.
Recurrence, org invites (orgs don't exist yet), reminders (both Hobby
cron slots taken), and external sync are later stages.**

- **Migration 057 (WRITTEN, NOT YET RUN):** events + event_guests. The
  organizer holds a guest row (role organizer, accepted) so ONE query —
  my guest rows ⋈ active events — serves created+invited; email
  invitees use the exactly-one-of identity CHECK (guardian_invites
  precedent); cancel is a status flip so the guest list survives for
  fan-out and deep links never 404. Four event_* notification types
  (full-list CHECK re-ADD; direct-inserted — create_notification would
  silently drop them). RLS on, zero policies.
- **Pure libs (tests 371→396):** validators mirroring the DB CHECKs
  (all-day must be midnight-in-event-zone both ends — off-by-one bugs
  become 400s, not grid errors), grid math (monthMatrix always 6×7,
  allDayDayLabels = the ONLY all-day date accessor, formatted in the
  EVENT's IANA zone — Tokyo-event/LA-viewer unit-tested), assignLanes
  cluster sweep for Google-style side-by-side overlap, static category
  color map.
- **API:** GET range list (62-day cap, true interval overlap, declined
  excluded, my_status + is_organizer per item); POST create with
  compensating delete on partial guest insert; GET/PATCH/DELETE detail
  (readable by organizer or ANY guest row incl. declined — deep-link
  mind-changing; outsiders get 404, never existence); respond
  (changeable anytime, organizer fixed); invite-search (public + accepted
  follows either direction — /api/search is public-only, which would
  have made private friends uninvitable). Every route 404s flag-off
  (verified live against a flag-less dev server).
- **Client:** /calendar with Month/Week/Day/Agenda (custom Tailwind
  grid; Week/Day share a TimeGridView with sticky all-day row, hour
  gutter, absolute lane-laid blocks, 7am auto-scroll; phones get month
  dots + tap-day→Day view, Week scrolls horizontally). Google/Outlook
  visual convention: pending invites render dashed+faded holding the
  slot; maybe gets a "?"; declined disappears (still reachable via the
  notification deep link to change your mind). EventFormModal =
  quick-create + "More options" (GuestPicker chips: debounced user
  search + invite-by-email rows). EventDetailModal = details with
  viewer-local times (+ event-zone secondary line when zones differ),
  live guest list with status pills, running tally ("3 going · 1 maybe
  · 2 pending"), Yes/Maybe/No, organizer Edit/Cancel. ?event= deep link
  from notifications opens the modal. AppHeader Calendar nav item
  (flag-conditional). Emails for email-invitees only (invite +
  cancellation, event-zone times) — registered guests get in-app
  notifications, no dual-channel spam.
- **Verification — COMPLETE (Tom ran 057 same day):** 396 unit tests,
  lint/tsc clean, clean build (108 pages), flag-off 404s verified live.
  **API E2E 36/36 first run** (invite-search privacy both ways, create
  with 2 profile + 1 email guest, invite notifications with deep links,
  validation 400s, outsider 404 / guest-PATCH 403 / organizer-respond
  403, pending state in range queries, accept→notify→maybe→declined→
  changed-mind-back chain, declined leaves calendar but deep link
  works, live tally, edit fan-out, guest removal (notified, calendar
  emptied, detail 404, organizer row irremovable), all-day midnight
  validation, cancel fan-out + 409s, anon 401). **Browser smoke 10/10**
  (screenshots reviewed): month grid + nav, event created through the
  real modal with a GuestPicker chip, invitee's dashed PENDING chip →
  accept → solid, notification deep link opens the modal, 390px mobile
  month → tap-day → Day view with the event block; view-switcher
  active-state DOM-probed correct. Zero page errors.

NEXT (calendar roadmap): recurrence (series vs occurrence editing), org
invites (needs organizations to exist first), reminders (cron design),
"Add to calendar" ICS + subscribe feed.

## July 28, 2026 (end of session, late) — Maintenance checklist + sync

- lint clean · `tsc --noEmit` clean · `vitest` 371 passed (36 files) ·
  `npm ci --dry-run` clean · full clean `npm run build` success, 105
  pages (dev servers stopped, `.next` wiped first).
- Migration state: through 056, ALL run + behaviorally verified live
  (048–056 = the complete guardian data layer; 056 verified 30/30 with
  service-role append-only probes).
- Deployed through c362904, Vercel green on every push today, prod
  site 200. Guardian feature dark in prod
  (NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES unset); ON in Tom's
  .env.local. This entry is the maintenance-log commit → GitHub →
  Vercel.
- Today's session in one line: guardian feature polish-to-COMPLETE —
  approval-queue screen (1ed9103) → transfer-of-control UI (c4dd446,
  incl. the initiated_by CHECK bug fix) → post-transfer activation +
  review walkthrough (04a74af, incl. the discarded-token fix) →
  hard-delete parity + co-guardian invites + admin orphan tooling
  (0470810 + 8a71243, incl. the consent append-only trigger bug →
  migration 056). Tests 355→371; five E2E suites (16+25+15+30 API
  checks, 9+8+9 browser smoke) all green.
- Untracked in the working tree: AGENTS.md (a Codex-oriented copy of
  CLAUDE.md) — deliberately left uncommitted; Tom's call whether it
  belongs in the repo.
- Awaiting Tom: end-to-end guardian walkthrough (parent → athlete →
  consent → approve at /dashboard/consent → PIN → kid login → post →
  approve at /app/guardian/approvals → transfer via /app/guardian/
  transfers → kid activation link → delete paths + /dashboard/guardians),
  then the flag decision. Also still open from earlier sessions: phone
  pass on the mobile fixes, two-phone golf test, Edge Vitals loop.

## July 28, 2026 (night) — Guardian hard-delete parity + orphan/support tooling SHIPPED — GUARDIAN FEATURE COMPLETE (dark)

**Commits 0470810 + 8a71243, E2E 27/27 + browser smoke 9/9, tests 371,
dark behind the flag (admin routes follow the requireAdmin-only
convention). This was the last guardian item — the feature is now DONE
end to end: create → consent → credentials → approve → transfer →
activation → delete parity → support tooling.**

**✅ MIGRATION 056 RUN + BEHAVIORALLY VERIFIED (Tom ran it July 28,
later): delete-parity E2E now 30/30 — consented child hard-delete
succeeds, consent rows survive with profile_id NULLed (granted +
withdrawn), and the guardian's own subsequent self-delete works (the
guardian_user_id SET NULL path). Service-role probes confirm plain
UPDATE and DELETE on consent_records still raise "append-only" — the
guard is exactly as narrow as designed.** It fixes a REAL schema bug the E2E found: 050's
design has consent rows survive deletion via FK ON DELETE SET NULL, but
the shared append-only trigger blocked that exact UPDATE — so ANY
account with consent rows was UNDELETABLE (even via auth cascade; the
guardian's own later self-delete too, via the guardian_user_id FK). 056
gives consent_records its own guard permitting ONLY the FK-null
transition; plain UPDATEs and DELETEs still raise. Until it runs, the
deletion engine releases the FKs explicitly UP FRONT and aborts cleanly
with nothing deleted (E2E-verified in the pre-056 world; rerun the
harness after 056 for the full consented-delete flow). Transitional
quirk: a pre-056 failed child-delete leaves the just-written
'withdrawn' consent row (needed the live FK), so that child reads
consent=withdrawn without being deleted — resolves once 056 runs.

- **Shared deletion engine (lib/account-deletion.ts)** — one hard-delete
  path for self-serve, guardian child-delete, and admin cleanup. Fixes
  the old route's storage cleanup (wrong buckets: split on
  avatars/post-media while uploads live in 'uploads'; covers never
  cleaned; workout media missed) via storageRefFromUrl (unit-tested,
  consent-evidence denylisted — signed forms survive by design).
- **/api/account/delete is now guardian-aware** (flag-gated preflight,
  BEFORE any deletion): supervised minors 403 (a child who knew their
  password could previously self-delete — policy hole); sole-guardian
  of supervised children 409 naming them (previously: 500 MID-deletion
  on the zero-access trigger for credential-less children — half-deleted
  guardian account — or silent orphaning for credentialed ones);
  co-guardian children allowed + 'revoked' audit rows. DeleteAccountModal
  needed zero changes (it already surfaces data.error).
- **Child hard-delete** — DELETE /api/guardian/athletes/[profileId]:
  guardian-only, supervised-only, type-the-handle server-verified (no
  password — OAuth guardians). Writes 'withdrawn' consent row (snapshot
  copied forward) + 'revoked' audit rows first. Danger-zone card on the
  credentials page (disabled-until-match, consent-retention notice).
- **Co-guardian invites unbroken** — the claim route used to CONSUME a
  guardian_additional token then 410 (burn bug). Now peek-then-typed-
  redeem: preconditions validated before consuming (supervised target /
  not the child / not already guardian / 2-guardian cap), typed redeems
  mean foreign tokens (athlete_activation etc.) are never burned,
  RPC-failure un-consumes. grant_guardian_access RPC finally has a
  caller. Landing page + peek render the "become {name}'s guardian"
  story; new sendCoGuardianInvite email.
- **Admin orphan tooling** — /api/admin/guardian-support: GET lists
  supervised profiles with ZERO guardians (has-login + consent badges);
  invite_guardian → guardian_additional token, returns {inviteUrl,
  emailSent} (link copyable when SMTP off — no silent failure);
  delete_profile → engine. /dashboard/guardians queue page; admin home
  gains a "Queues" section (consent reviews were reachable only by
  typing the URL before).
- E2E (disposable users incl. a disposable admin via ADMIN_EMAILS env
  override on the dev server): self-delete regression with real storage
  files verified gone; sole-guardian 409 with NOTHING partially
  deleted; supervised self-delete 403; wrong-handle 400; non-managed
  403; pre-056 clean abort; orphan manufactured (service-role strip) →
  listed → invited → claimed → granted → resolved; wrong-type claim 410
  token intact; double-claim 410; already-guardian 409 token intact;
  admin delete. Browser: danger-zone flow deletes for real, guardians
  queue renders, co-guardian landing copy. lint / tsc / vitest 371 /
  clean build (105 pages) green.

REMAINING (guardian feature): NOTHING — all migrations (048–056) run
and verified. Awaiting Tom's end-to-end walkthrough, then the flag.

## July 28, 2026 (evening) — Post-transfer activation + review walkthrough SHIPPED (dark)

**Commit 04a74af, API E2E 15/15 + browser smoke 8/8, tests 365, dark.
Closes the last UX gap in the transfer story AND a real hole: the
engine created an athlete_activation token but DISCARDED the raw value
— no email was ever sent and nothing could consume the token, so a new
owner's only way in was guessing to use /forgot-password.**

Per Tom's directive the flow is deliberately minimal — the new owner's
ENTIRE experience is 3 touches:
1. **Email** "Your Edge Athlete account is now yours" (new
   sendAccountActivation, violet branding) with ONE button → the
   activation link. Sent from executeTransfer's rotate_credentials step
   (appUrl threaded cron → runTransferSweep → executeTransfer);
   best-effort behind SMTP env — token row stays the source of truth,
   /forgot-password on the new email is the documented fallback (in the
   email's small print too).
2. **/activate/[token]** — set password (+confirm), automatically
   signed in. POST /api/auth/activate: atomic type-filtered redeem
   (redeemGuardianInvite gained optional inviteType so an activation
   endpoint can never consume other token kinds), password set, stamps
   onboarded_at (guardian-created profiles never onboarded — without
   this the new owner bounces into generic onboarding), returns
   guardianAccess (the athlete's own dual-confirm choice, read from the
   completed profile_transfers row), signs in via the ssr cookie
   adapter. Redeem-before-set: a burned token still leaves the reset
   path — never a lockout. Rate-limited; 400/410/429 guardrails.
3. **One review card** "Your account, your rules": visibility (Private
   preselected) + who-can-message (Nobody preselected, the 4 options
   from MessagingSettings), a gray line on what the former guardian can
   see (view-only / no access), single **Done** → one PUT → hard reload
   into /athlete. NO skip link by design: defaults persist and
   onboarded_at is already stamped server-side, so closing the tab IS
   skipping. Expired/used link → friendly screen with "Reset my
   password" CTA.

**Bug found by the browser smoke (would have shipped broken):** after
Done, client-side router.push('/athlete') bounced to the login page —
the session cookies were set by the activate API mid-page, so the auth
provider's in-memory state was still signed-out. Fix: hard reload
(window.location.href), the same pattern username-login already uses.
Screenshot-verified after the fix: Done lands signed-in on /athlete.

E2E (disposable users, real cron): transfer driven to cooling_off via
the actual APIs, cooling_off_ends_at backdated, GET /api/cron/daily
with Bearer CRON_SECRET → executed:1 with SMTP off (no crash),
supervision_state 'self' + real email + activation token row; planted
raw token → peek valid; short password 400; garbage token 410;
activate 200 (signedIn, guardianAccess viewer, Set-Cookie works);
replay 410; onboarded_at stamped; old PIN 401; review PUT persists.
Browser: password mismatch validation, defaults preselected, Done →
signed-in profile, used-token screen. lint / tsc / vitest 365 / clean
build (103 pages) green.

REMAINING guardian polish: guardian hard-delete parity + orphan/support
tooling (the last item).

## July 28, 2026 (later still) — Transfer-of-control UI SHIPPED (dark) — guardian feature now has a COMPLETE surface

**Commit c4dd446, API E2E 25/25 + browser smoke 9/9 (both first run),
tests 365, dark behind the flag. The Phase-5 state machine was
server-only; now both parties have screens for every step. With this,
every guardian capability has UI: create → consent → credentials →
approve posts → transfer.**

- **/app/transfer/[profileId]** — ONE shared page for BOTH parties,
  keyed by (viewerRole, state) from GET /api/transfers (which already
  returns viewerRole). Neutral URL on purpose: the kid uses it too.
  Screens: start (guardian) / ask-to-take-over (athlete),
  eligible_notified, guardian approval of an athlete request,
  independent-email form, 6-digit OTP entry (inputMode numeric,
  one-time-code autocomplete; "Send a new code" re-submits the same
  email — the server re-issue IS the resend path; "Use a different
  email"), dual confirm with per-side ✓/waiting rows and the
  athlete-only guardian post-role radio (viewer/removed), cooling-off
  countdown + what-happens list + cancel, executing (uncancellable).
  30s poll + refresh-on-tab-focus so "waiting" screens advance; every
  action re-fetches rather than patching local state; 410/409 also
  re-fetch so stale forms collapse. Cancel goes through ConfirmModal.
  Kid-appropriate copy on the athlete side throughout.
- **/app/guardian/transfers** — overview: managed athletes with state
  chips (amber = guardian action needed), rows link into the shared
  page; "Transferred" rows inert. Linked from the AppHeader "Your
  athletes" switcher as "Account transfers".
- **TransferBanner** (root layout, ActingAsBanner pattern, violet):
  supervised athlete with a transfer in flight sees a one-line status
  + "See details" on every screen. Renders null unless flag + session
  + supervision_state='supervised' + active transfer.
- **lib/transfer-ui.ts** — pure chip/countdown/banner-copy helpers
  (10 unit tests; 355→365).
- **Server fixes shipped with it:** (1) REAL BUG — POST /api/transfers
  wrote initiated_by='supervised' but 055's CHECK allows only
  guardian/athlete/system, so the athlete-initiated request 500ed on
  insert; now maps supervised→'athlete' (regression-tested against the
  live DB). (2) GET /api/transfers now also returns guardian_post_role
  so cooling-off shows the athlete's choice. (3) Profile type gains
  supervision_state/dob_locked (loaded all along via select('*'), just
  untyped).
- E2E (disposable guardian/child/stranger vs local dev): full machine
  via the real endpoints (Step-B create → PIN credentials →
  username-login cookies → request → approve → guardian-email 409 →
  fresh email → planted OTP wrong/right → dual confirm both sides →
  cooling_off + guardian_post_role in GET → cancel → restart →
  executing-cancel 409 → terminal 410). Browser smoke (playwright-core
  + system Chrome, 390px viewport): both parties' real screens through
  confirm→cooling_off→cancel-via-modal, banner placement above the
  app header verified from screenshots, zero page errors.
- lint / tsc / vitest 365 / clean build (102 pages) green. Build's
  only warnings are the pre-existing @supabase/realtime-js Edge
  Runtime notes (middleware import trace, untouched by this change).

REMAINING guardian polish: post-transfer review walkthrough, guardian
hard-delete parity + orphan/support tooling, and the athlete_activation
reset email is still a server-side TODO (token row is created; email
not sent — the executing screen tells the athlete to watch their
inbox, which today only holds the OTP mail).

## July 28, 2026 (later) — Guardian approval-queue screen SHIPPED (dark)

**Commit 1ed9103, E2E 16/16 first run, dark behind the flag. Closes the
biggest guardian polish gap: pending posts were only reviewable by
browsing the child's grids while acting-as — now there's a dedicated
queue.**

- **GET /api/guardian/pending-posts** — every pending_approval post
  across ALL the caller's managed athletes (profile_access guardian
  rows), oldest first, with post_media + athlete join. Uses the
  051 partial index (`idx_posts_status_pending`). Flag off → `[]`.
- **/app/guardian/approvals** — queue page in the guardian console
  style (BrandBar, violet). Approve/reject per post via the EXISTING
  `PATCH /api/posts {postId, action}` (which re-verifies the guardian
  row + approve_content per call — listing grants nothing the decision
  endpoint wouldn't). Approved/rejected rows drop from the list
  optimistically; empty state "All caught up." Linked from the "Your
  athletes" section of the AppHeader profile switcher (only when the
  user has managed athletes).
- **Single-post guardian access** — GET /api/posts?postId= now lets
  approve_content holders open their athletes' posts: both the
  pending-status gate and the private-profile/no-follow-edge gate
  accept a guardian. The role lookup is lazy + memoized — it only runs
  when a cheaper gate would otherwise refuse, so the hot path
  (published/public posts) is unchanged. This was the in-code TODO
  ("guardian access arrives with the approval-queue UI").
- E2E (disposable guardian/child/stranger vs local dev, cleaned up):
  athlete creation via the real Step-B API, queue listing/ordering/
  joins, stranger sees empty queue, anon 401, guardian opens pending
  post (200) / stranger 404, stranger approve 403, approve→published +
  DB verified, reject→rejected + DB verified, queue drains, re-approve
  of a published post 400.
- lint / tsc / vitest 355 / clean `npm run build` all green.

REMAINING guardian polish: transfer UI screens (machine still
server-only), post-transfer review walkthrough, guardian hard-delete
parity + orphan/support tooling.

## July 28, 2026 (end of session) — Maintenance checklist + sync

- lint clean · `tsc --noEmit` clean · `vitest` 355 passed (34 files) ·
  `npm ci --dry-run` clean · full clean `npm run build` exit 0 (dev
  servers stopped, `.next` wiped first).
- Migration state: through 055, ALL run + behaviorally verified live
  (048–055 = the complete guardian data layer).
- Deployed through e9f964b, Vercel green, prod site 200. Guardian
  feature dark in prod (NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES unset);
  ON in Tom's .env.local for the local walkthrough. This entry is the
  maintenance-log commit → GitHub → Vercel.
- The July 27–28 session in one line: purple rebrand → launch
  hardening + signup fix → Google OAuth live in prod → guardian
  profiles spec-to-functionally-complete (8 migrations, 5 E2E suites /
  70 scenario checks, tests 255→355).
- Awaiting Tom: local guardian walkthrough (parent → athlete → consent
  → approve at /dashboard/consent → PIN → kid login → post → approve →
  transfer), phone pass on the mobile fixes, Monday's storage-sweep
  dry-run log, two-phone golf test, Edge Vitals loop.

## July 28, 2026 (early) — Guardian profiles: Phase 5 TRANSFER OF CONTROL shipped — feature functionally COMPLETE (dark)

**Commit da7ec6b + migration 055 (RUN + verified), E2E 18/18 on the
first run, tests 355. The last major chapter of the guardian spec: the
age-out transfer state machine. With this, the ENTIRE guardian feature
— data model, enforcement, DOB-gated signup, two-step parent flow,
invites, consent + immutable audit + admin review, PIN login, approval
queue, and transfer — is built, E2E-verified, and dark behind
NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES.**

State machine (lib/transfers.ts + /api/transfers[+/[id]]):
eligible_notified (daily cron flags supervised profiles past their
jurisdiction threshold) → initiated (guardian) / requested (athlete —
NEVER executes; guardian must approve) → credentials_pending (athlete
adds an INDEPENDENT email: rejects every guardian email, every
consent-record snapshot, every existing account — +tag aliases
normalized; 15-min 6-digit OTP via guardian_invites) → dual_confirm
(both parties; the new owner chooses the guardian's post-role
viewer/removed) → cooling_off (7 days, either party cancels one-click;
restart-after-cancel verified) → executing → completed.
Cooling-off is the LAST exit — nothing cancels once executing.

Execution = idempotent 5-step journal (executed_steps; cron resumes
partial runs; 3 failures → 'failed' + support): set real email on the
shadow user → mirror profiles.email → rotate password (THE session
revocation) + issue the app-owned reset token — only after rotation
succeeds, so there is never a lockout window → flip supervised→owner +
guardians→viewer/removed (+audit) → supervision_state='self'.
Post-transfer world verified: old PIN dead, real email live,
athlete_activation reset token issued to the verified contact, roles
exactly owner+viewer. DOB-divergence checked on EVERY transition and
in the cron: mid-flow DOB edit → aborted + dob_locked (verified).

**Combined daily cron:** digest extracted to lib/digest-server (now
skips synthetic @minors.invalid addresses — they bounce) + transfer
sweep (flag/expire-14d-stalls/execute) in ONE /api/cron/daily slot;
vercel.json repointed (Hobby 2-cron cap held). Old digest route kept.

REMAINING (polish, non-blocking): transfer UI screens (machine is
server-only today), dedicated approval-queue screen, post-transfer
review walkthrough, guardian hard-delete parity + orphan/support
tooling.

## July 27, 2026 (later still) — Guardian profiles: Phase 4 supervised login SHIPPED (dark)

**Commit 4bf807f, E2E 11/11 (first full run), tests 355, dark behind
the flag. The child's side of the platform now exists: guardian-issued
username/PIN login, guardian-only recovery, and an approval queue with
teeth. The supervised lifecycle from the original spec is functionally
COMPLETE except transfer-of-control and delete parity.**

- **Credential issuance** (/app/guardian/credentials/[profileId], wired
  from the consent-approved screen): username = the child's handle;
  secret = password (≥6) or a 4–6 digit PIN for younger kids. PIN is
  never stored or used raw — it derives the actual Supabase password
  via HMAC(service-key, profileId:pin) (lib/supervised-credentials.ts),
  so a leaked PIN is useless without the server secret + profile id.
  First issuance creates the supervised self-access row (profile_access
  user_id = profile_id, role='supervised') + audit. Reset = the same
  screen; the password change revokes the child's other sessions
  (Supabase behavior — exactly what a guardian reset should do).
  Recovery is guardian-only BY CONSTRUCTION: the child has no email.
- **Username login** — POST /api/auth/username-login: handle →
  profile MUST be supervision_state='supervised' (everything else
  hard-rejected, so username login can never become a general path;
  E2E-proven with an adult account) → synthetic email → server-side
  password grant with the ssr getAll/setAll cookie adapter (OAuth-
  callback pattern). PIN-shaped secrets try the derived password first,
  then literal. Uniform "Invalid username or password" (no existence
  leaks), rate-limited per ip+username. Login screen accepts
  email-or-username when flagged (type=email relaxed to text).
- **PII username guard** — validateSupervisedHandle blocks full-name
  and name+birth-year handles at athlete creation ("emma2015" refused
  with kid-appropriate copy; "speedy.striker" passes). Unit matrix in
  supervised-credentials.test.ts.
- **Approval queue end-to-end** — supervised self-posts are FORCED to
  status='pending_approval' in posts POST (self-role check); posts
  PATCH gains approve/reject actions gated by
  resolveProfileAction(role, 'approve_content') — supervised authors
  get 403 on self-approve; guardian approve → published, reject →
  rejected. Pending posts stay invisible to the world per the 051/052
  read-surface work.
- E2E (11/11): PII rejection, PIN issue, supervised row, PIN login with
  session cookies, wrong-PIN 401, adult-account 401, forced pending on
  own profile, self-approve 403, approve→published, reject→rejected,
  reset revokes old PIN.

REMAINING (guardian feature): transfer-of-control state machine +
combined daily cron (Hobby 2-cron cap: fold digest + minors scan into
/api/cron/daily), guardian hard-delete parity + orphan/support tooling,
and a dedicated guardian approval-queue screen (pending posts currently
reviewable via the child's grids while acting-as).

## July 27, 2026 (late night) — Guardian profiles: Phase 3b consent + review + guardian posting SHIPPED (dark)

**Commits 7915ab3..a60c7cb, E2E 12/12, tests 348, all dark behind the
flag. The full guardian loop now works end to end: create athlete →
sign + upload consent → admin review → switch into the child → post.**

- **Consent capture (COPPA signed-form method):** lib/consent.ts —
  consent state is derived from the LATEST append-only consent_records
  row (granted → pending_review, review_approved → approved, etc.);
  policy text v1 lives with the code (CONSENT_POLICY_VERSION).
  Guardian-ONLY upload route (owners/supervised/viewers refused):
  photo/PDF ≤10MB → private consent-evidence bucket → audit row with
  method, policy version, jurisdiction/threshold snapshot, guardian
  email snapshot, ip, user agent. /app/guardian/consent/[profileId]
  shows the statement + upload + pending/approved/rejected states;
  wired from the add-athlete success screen.
- **Admin review queue:** GET /api/admin/consent-reviews (requireAdmin)
  — latest-per-profile pending submissions with 600s signed evidence
  URLs; POST approve|reject inserts a NEW append-only row carrying the
  granted row's snapshot forward + reviewed_by. /dashboard/consent page
  renders it. E2E proved the audit property: UPDATE on consent rows
  fails EVEN for the service role (trigger, not RLS).
- **Guardian-posts-as-athlete:** posts POST accepts targetProfileId —
  guardian row re-verified server-side per call, and publishing to a
  supervised profile requires APPROVED consent (403 with a clear
  message before). Post lands owned by the child, status published
  (guardians hold approve_content). CreatePostModal automatically sends
  the acting-as profile from useAuth().activeProfile. Stranger forging
  targetProfileId → 403.
- E2E residue note: consent audit rows persist with SET NULL ids after
  test cleanup — by design (that's the compliance property).

REMAINING: Phase 4 (username/PIN supervised login, guardian credential
issuance/reset, PII handle validation), transfer flow + combined daily
cron, delete parity + support tooling.

## July 27, 2026 (night) — Guardian profiles: Phase 2 complete (with corrective addendum) + Phase 3a guardian console SHIPPED (dark)

**All still dark behind FEATURE_GUARDIAN_PROFILES (env-driven now:
NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES=1 in Tom's .env.local, unset in
Vercel). Migrations 051–054 all RUN + behaviorally verified. Commits
10c59d7..27b1063. Tests 348.**

**Phase 2 UI + corrective addendum.** DOB-gated signup step machine
shipped, then Tom's hands-on test caught THREE defects + spec drift,
all fixed same day (df4e3d9): (1) question order was DOB→role — a
parent entering their child's DOB tripped the minor gate before the
system knew an adult was present; now ROLE FIRST, then branch-worded
DOB ("Your…" vs "Your athlete's…"), still threshold-neutral. (2) The
missing actor guard: /api/signup's actorRole routing table makes
pending_guardian UNREACHABLE for guardians. (3) Registered guardian
email = MATCH not collision (invite email + landing CTA switch to "log
in"). Two-step parent flow restored per spec: Step A = name/email/
password only (null handle/dob) → "add your athlete" handoff.
Resend/typo = re-submit same child email (prior pending + invites
expire, exactly one live). DOB self-service locked out on supervised/
locked profiles (profile PUT strips it). E2E v2 15/15. LESSON: the
build drifted from an explicit spec (two-step parent flow collapsed
into one form) — "restore the two-step structure" was the fix, not a
redesign.

**Decisions locked (Tom's five questions, stated as decisions):** child
accounts are FUNCTIONALLY email-less (synthetic <id>@minors.invalid;
literal nullable is impossible — Supabase auth requires an email — and
unnecessary); child sign-in = handle-as-username + password/PIN via a
supervised-only server route (Phase 4), forgot-password routes to the
guardian; the parent↔child relationship lives EXCLUSIVELY on
profile_access (both directions indexed; child row holds no parent
pointer); switching is in-session with an always-visible acting-as
banner; NO shared email, ever.

**Phase 3a — guardian console core (E2E 14/14):**
- Migrations 053 (create_managed_profile + grant_guardian_access RPCs,
  update_user_handle NULL→value first-set for owner/guardian,
  guardian_invite/athlete_added notification types) + 054 (first-set
  permission fix: 053 checked auth.uid(), which is NULL for the
  service-role client the handles route uses — trusted-bypass is now
  the jwt role claim; anon still blocked).
- POST/GET /api/guardian/athletes: shadow auth identity (synthetic
  email + unknown password, unloginable), create_managed_profile RPC,
  forced minor-safety defaults (private / messaging nobody / supervised
  / dob_locked / jurisdiction snapshot), shadow-user rollback on
  failure. GOTCHA: jsonb_populate_record leaves absent fields NULL and
  INSERT with explicit NULLs BYPASSES column defaults — created_at/
  updated_at must be passed in p_profile (E2E caught the 23502).
- Add-your-athlete page: name/DOB/handle, NO email field, repeatable
  (twins verified — deliberately no name+DOB dedupe anywhere).
- In-session switcher: useAuth gains managedProfiles/activeProfile/
  setActiveProfile (RLS-read via 052 policies, localStorage-persisted);
  AppHeader "Your athletes" section; amber "Acting as {name} — switch
  back to me" banner mounted in the root layout, on every screen.
- Invite claim: POST /api/invites/[token]/claim atomically consumes the
  single-use token → pending consent_pending → Step B prefilled (name/
  DOB via sessionStorage) → creation finalizes approved +
  promoted_profile_id. The parked child_email is DISCARDED by decision.

**Also this block:** migration 052 (RLS defense-in-depth: additive
guardian/supervised/viewer read + guardian write policies — additive so
live policy bodies are never clobbered; posts_select_policy rewritten
with the status='published' arm, columns explicitly qualified re the
new posts.status vs follows.status ambiguity; can_view_profile gains
the profile_access branch; deliberately NO supervised RLS write path —
it would bypass the approval queue via PostgREST). Verified by an RLS
probe suite: 4 disposable role-users hitting PostgREST with their own
JWTs, 14/14.

REMAINING: Phase 3b (consent capture + admin review queue +
approval-queue UI + targetProfileId on content writes), Phase 4
(username/PIN supervised login + guardian credential reset), transfer
flow + combined daily cron, delete parity + support tooling.

## July 27, 2026 (evening) — Guardian profiles: proposal approved, Phases 0–1 + Phase-2 server core SHIPPED (dark)

**PARENT-MANAGED ATHLETE PROFILES — the largest architectural change to
date, approved via a written proposal (5 questions: schema, enforcement,
consent method, transfer state machine, migration plan) before any code.
6 commits 15bfb7f..29f8803, ALL dark behind FEATURE_GUARDIAN_PROFILES=
false — zero behavior change for existing users (tests 281→348).**

**Architecture: shadow auth identity.** profiles.id stays == an
auth.users id forever; guardian-created minors get an admin.createUser
shadow user (synthetic `<uuid>@minors.invalid`, unloginable) that IS the
athlete's future login. Supervised login = real email OTP'd onto the
shadow user; transfer = flip profile_access supervised→owner + password
rotation (the session-revocation mechanism — supabase-js has no
revoke-by-user-id). Profile row NEVER re-parented; all ~45 FK tables +
storage keys stay valid for life.

**THE load-bearing audit finding: 72/85 API routes use the service-role
client — RLS is bypassed on the main HTTP surface.** Authorization today
is 46 hand-written `!== user.id` checks. Therefore the PRIMARY
enforcement layer is app-level: pure `resolveProfileAction` matrix
(src/lib/profile-roles.ts — the proposal's role×action table IS the
48-assertion test fixture) wrapped by `requireProfileRole()` in
auth-server.ts. RLS `has_profile_access()` (SECURITY DEFINER, 035
recursion-safe) is defense-in-depth only. Never accept UI-level or
RLS-only role checks on this feature.

Shipped:
- **Phase 0 — live-schema reconciliation** (probe + Tom's SQL-editor
  dump, recorded in database/docs/PHASE0_GUARDIAN_RECONCILIATION.md):
  on_auth_user_created trigger ALREADY DROPPED live (orphaned
  handle_new_user() remains, inert); follows FKs both → profiles(id)
  (archive's auth.users variant never shipped); all DB-only RPC bodies
  captured. Incidental find: search_profiles has NO visibility filter
  (private profiles' names leak into search — pre-existing, follow-up).
- **048–050 RUN + VERIFIED live** (backfill exact: profiles count ==
  owner self-rows): profile_access (owner/guardian/supervised/viewer,
  zero-access-row DEFERRABLE constraint trigger, ≤2-guardian cap,
  one-self-role partial unique, append-only audit),
  pending_profiles (COPPA data-minimization parking — no auth user
  pre-consent), guardian_invites (app-owned sha256'd single-use tokens,
  NOT PKCE links — parents open invites cross-device), consent_records
  (append-only via raise-trigger — binds even service-role writes) +
  private consent-evidence bucket.
- **Phase-2 server core:** DOB gates in /api/signup AND
  /api/auth/complete-profile (the sole OAuth choke point). Under-
  threshold → park + 422 needsGuardian (no dead end) + branded guardian
  invite email. Jurisdiction from Vercel IP hints (Quebec → CA-QC,
  Law 25 = 14); thresholds in src/lib/config/minors-config.ts
  (US 13 / GDPR per-state / fallback 16), snapshotted immutably.
- **Migration 051 WRITTEN (not yet run):** posts.status
  ('published'|'pending_approval'|'rejected', default published — all
  rows grandfathered) + rewritten get_profile_all/stats/tagged_media +
  get_profile_media_counts (022 force-drop pattern) + search_posts with
  a status predicate (authors see own pending). App-side published-only
  filters on feed/single/explore/search are FLAG-GATED so deploys can
  never race the migration.

REMAINING (each phase independently shippable, per approved plan):
052 RLS template swaps → Phase 2 UI (DOB-first signup step machine,
/invite/[token] landing, complete-profile dob field) → Phase 3 guardian
console + approval queue → Phase 4 supervised login → Phase 5 transfer
+ combined daily cron (Hobby 2-cron cap: merge digest + minors scan)
→ Phase 6 delete parity + support tooling.

## July 27, 2026 (later) — OAuth sprint: Google sign-in LIVE

**GOOGLE OAUTH SHIPPED + VERIFIED IN PROD (6 commits 85e46d3..e469134,
deployed; Tom-tested with his real account).** Sign in with Google on
login + signup; Apple built but parked behind NEXT_PUBLIC_OAUTH_APPLE=1
(needs the $99/yr dev account; its Supabase client-secret JWT expires
≤6 months — set a rotation reminder when configured).

Architecture (provider-agnostic PKCE):
- `lib/oauth.ts` signInWithProvider → provider → Supabase →
  `/auth/callback` Route Handler: code exchange with the ssr
  getAll/setAll cookie adapter (auth-server's getServerClient has NO-OP
  cookie setters — it can never do the exchange), then routes by
  profile state: onboarded → /athlete, not onboarded → /onboarding,
  **no profile → /auth/complete-profile**.
- First-timers get a one-time complete-profile screen: names prefilled
  from user_metadata (`lib/oauth-profile.ts`, pure + tested; Apple only
  sends the name on FIRST auth so the email-local-part fallback is
  load-bearing), email read-only, HandleSelector required.
- `POST /api/auth/complete-profile`: admin-client insert (profiles has
  no RLS INSERT policy), handle set AT CREATION (update_user_handle()
  refuses NULL→value — there is no later path), display_name always set
  (check constraint), email-collision 409, server-side availability
  re-check, idempotent.
- Landing page: session-without-profile now routes to complete-profile
  (previously re-rendered the LOGIN FORM for an authenticated user —
  dead-end); callback ?error= surfaces in the login error box.
- Both provider buttons flag-gated (NEXT_PUBLIC_OAUTH_GOOGLE/APPLE) —
  a visible button that errors is worse than no button.

Verified: tests 266→281; 13/13 automated E2E locally (real
accounts.google.com redirect; simulated first-timer via admin-created
user with Google-shaped metadata + minted ssr cookie: routing, prefill,
handle, DB row incl. avatar_url, idempotency, callback error paths);
prod browser-check (button live, redirects to Google); Tom's real
sign-in exercised the email-collision path — Supabase AUTO-LINKED the
Google identity to his verified-email password account and routed
straight to /athlete (expected behavior, now confirmed empirically).

Google Cloud setup note: OAuth consent screen + credentials are FREE
(no billing account) — initially deferred on a cost misunderstanding.

## July 27, 2026 (end of session) — Maintenance checklist + sync

- lint clean · `tsc --noEmit` clean · `vitest` 266 passed (29 files) ·
  `npm ci --dry-run` clean · full clean `npm run build` exit 0 (dev
  server stopped, `.next` wiped first).
- Migration state: through 047 all confirmed run + verified live.
  No pending migrations.
- Deployed through abda738 (rebrand + launch-hardening sprint + GIF
  picker fixes), Vercel green, prod site 200. Vercel env now complete:
  NEXT_PUBLIC_APP_URL, CRON_SECRET, GIPHY_API_KEY. This entry is the
  maintenance-log commit → GitHub → Vercel.
- Awaiting Tom's phone pass: iOS messages keyboard, equipment
  dropdown, fresh-eyes signup walkthrough, two-phone golf test
  (phases 3-8), Edge Vitals live loop, video trim/cover.

## July 27, 2026 — Purple rebrand + launch-hardening sprint

**PURPLE REBRAND SHIPPED (4 commits 51c1fd7..019a5ad, DEPLOYED).** New
EA-monogram logo (Tom-supplied lockup, de-whited/split/tiled into all
assets via a throwaway Pillow venv) + app-wide blue → violet:

- Assets: `public/logo.png` (lockup), `logo-mark.png`, all 5 PWA/
  favicon PNGs, `src/app/favicon.ico` (replaced the stale
  create-next-app one), and a 1200×630 `og-image.png`.
- Brand color = Tailwind violet (violet-600 `#7c3aed` primary). Tokens
  in globals.css, themeColor, manifest, global-error, email hexes.
- Mechanical sweep `blue-N` → `violet-N` across `src/app` +
  `src/components` (~975 occurrences, 100 files) + 5 stray indigo.
  INTENTIONALLY still blue (do NOT "fix"): golf under-par badges
  (`lib/golf/scoring.ts` — scoring convention), sport/league/equipment
  color-coding maps in `src/lib`, and the blue Training/Practice tag
  chips (runtime-concatenated classes backed by those lib literals,
  which Tailwind needs to keep emitting the utilities).
- New `BrandBar.tsx` (white bar + logo, replaces the 8 copy-pasted
  blue `<h1>` bars on logged-out pages, sr-only h1 kept); AppHeader
  renders the lockup on all 18 logged-in pages + drawer.
- Gotcha for next time: macOS BSD `grep -Z` did NOT NUL-separate for
  xargs -0 (partial sweep, silently) — use a `while read` loop.

**LAUNCH-HARDENING SPRINT SHIPPED (10 commits 28c4bf2..abda738,
DEPLOYED, prod-verified).** Items 2/3/4 from the sprint review; device
tests deferred to Tom's phone session.

- **Signup hardening — the "vanished signup" mystery is almost
  certainly explained:** the error banner rendered ~2000px above the
  submit button (a failed mobile signup looked like nothing happened),
  and an unconfirmed handle aborted submit with no signal. Now: banner
  scrolls into view + role=alert + error duplicated at the button;
  specific unconfirmed-handle message; HandleSelector clears the
  parent's handle on every invalid transition (stale-handle debounce
  race). Server: dropped the listUsers() duplicate scan (first-page-
  only = useless past 50 users), detect Supabase's sanitized
  duplicate-email signUp response (`identities: []`), ROLL BACK the
  orphaned auth user when the profile upsert fails (previously that
  email was permanently blocked), constraint-name error mapping
  (`lib/signup-errors.ts`, pure + tested), Sentry capture on every
  failure branch (path was previously untraceable). Tests 255→266.
- **SEO/email:** og/twitter metadata with metadataBase
  (`NEXT_PUBLIC_APP_URL`, fallback edge-athlete.vercel.app; real
  domain edgeathlete.ca is months out) — prod og:image verified
  absolute; logo headers in contact + digest emails.
- **Storage-sweep cron:** orchestration extracted to
  `lib/storage-sweep-server.ts`; new GET `/api/cron/storage-sweep`
  (CRON_SECRET bearer, fail-closed) on Mondays 06:00 UTC in DRY-RUN
  (`?dryRun=1` in vercel.json — review a run, then drop the param to
  go live). Hobby's 2-cron cap now fully used.
- **ENV DISCOVERY: CRON_SECRET was never set in Vercel** — the daily
  notification-digest cron had been silently 401ing since it shipped.
  Set July 27 (matches .env.local); sweep cron verified live against
  prod with the secret (dry-run: 7 files, 0 orphans). Also fixed:
  Giphy key was in Vercel as `NEXT_PUBLIC_GIPHY_API_KEY` but the route
  reads `GIPHY_API_KEY` — renamed; GIF picker works in prod for the
  first time. `NEXT_PUBLIC_APP_URL` set (needed a cache-off redeploy
  to bake in).
- **Mobile:** messages pages' `h-screen h-[100dvh]` cascade bug —
  h-screen was emitted later in built CSS and WON, so July 18's dvh
  fix never applied → single `h-dvh` + `interactiveWidget:
  resizes-content` (Android) + `--vvh` visualViewport hook (iOS, own
  commit 7edeb8c for easy revert) + `safe-bottom` composer.
  AddEquipmentModal dropdowns: `min(15rem,40vh)` cap + scrollIntoView
  on open + touchstart outside-close.
- **GIF picker follow-ups from Tom's testing:** grid previews were
  Giphy's `fixed_height_still` (frozen) → animated `fixed_height`;
  recents saved pre-fix carried frozen `_s.gif` URLs in localStorage
  forever → rewritten on read; Recent strip capped 3 (mobile) / 6
  (desktop) with a clear gray divider + "Popular" label.

**Verification:** tsc/lint clean, vitest 266 (29 files), full clean
build, prod checks (og tags, cron 401/200+summary, og-image 200,
signup duplicate-email 409). AWAITING TOM'S PHONE PASS: iOS messages
keyboard, equipment dropdown, fresh-eyes signup walkthrough (failures
now visible + Sentry-traced), plus the standing two-phone golf test
and Edge Vitals live loop. Next sprint candidate: OAuth.

## July 27, 2026 (early) — Editor UX polish + maintenance sync

**SCREENSHOT-DRIVEN EDITOR POLISH (6fc0af3, DEPLOYED, prod 200).**
Tom's "flow" feedback was directional, so the pass was evidence-based:
headless-Chrome screenshots of all five editor tools at 390px + 1280px
before AND after. Found + fixed: (1) the video play button anchored to
the flex STAGE, floating in letterbox dead space far from the clip —
now anchored to the video's own box (worst "doesn't flow" offender);
(2) desktop control rows (adjust sliders, crop chips/straighten, trim
timeline+info, cover caption) stretched the full 1280px — all
constrained to centered max-w-xl, mobile untouched (it was already
good); (3) Adjust's stray underlined Reset link → right-aligned pill;
(4) filter strip centers when it fits. Both E2E suites re-passed after
(image tabs 9/9, video flow 7/7 — the video wrapper change didn't
break tap-to-play/trim). METHOD NOTE: for vague UX feedback,
screenshot-first beats guessing — 3 of 4 fixes were visible only in
the captures.

**Maintenance checklist:** lint clean · `tsc --noEmit` clean · `vitest`
255 passed (28 files) · `npm ci --dry-run` clean · full clean build
exit 0 (dev server stopped, `.next` wiped) · migrations current
through 047, none pending · deployed through 6fc0af3, Vercel green,
prod 200 · QA users/posts/files all cleaned up. This entry is the
maintenance-log commit → GitHub → Vercel. Still awaiting Tom's phone
pass on video trim/cover + the polished layouts.

## July 26, 2026 (end of session) — Maintenance checklist + sync

- lint clean · `tsc --noEmit` clean · `vitest` 255 passed (28 files) ·
  `npm ci --dry-run` clean · full clean `npm run build` exit 0 (dev
  server stopped, `.next` wiped first), all routes compile, only the
  documented benign realtime/Edge warning.
- Migration state: through 047 all confirmed run + verified live.
  No pending migrations.
- Deployed through b5a0ff1 (media editor Phases 1+2 + cover photo +
  post-release fixes), Vercel green, prod site 200. This entry is the
  maintenance-log commit → GitHub → Vercel.
- Awaiting Tom's device pass on video trim/cover (phone).

## July 26, 2026 (later still) — MEDIA EDITOR Phase 2: video trim / split / cover frames

**VIDEO EDITING SHIPPED (b5a0ff1, PUSHED + auto-deploying; no
migration).** Videos in the shared editor get Trim + Cover tools:
scrubbable thumbnail-strip timeline, pointer-captured drag handles
(setPointerCapture + touch-action:none — first Pointer Events code in
the repo, drags never scroll), trim-clamped looping preview,
split-at-playhead into two filmstrip assets (each with its own
trim/cover), and a cover-frame picker. Architecture as planned:

- **Trim = exact re-encode to mp4 via mediabunny** (WebCodecs;
  Conversion.init({trim}) with isValid/discardedTracks gate). The
  508KB mediabunny chunk is LAZY — `await import()` only when a trim
  actually runs; first-load JS unchanged (185kB). Exactness over
  keyframe-snapped copying is deliberate: users get the cut they set.
- **Cover frame = plain canvas seek+drawImage** (lib/media/poster.ts)
  — deliberately NOT WebCodecs, so cover selection works on every
  browser. No-WebCodecs browsers see a notice, trim disabled, original
  uploads. Trim failures (odd codecs) also fall back to the original —
  nothing ever breaks a post.
- **post_media.thumbnail_url populated FOR THE FIRST TIME EVER** — the
  composer uploads the cover frame (poster failure never fails the
  post) and sends thumbnailUrl; the server had persisted it since day
  one (posts/route.ts) with no client ever sending it. PostCard videos
  now show a poster instead of a black frame.
- Pure trim/split/thumbnail math in lib/media/video-math.ts, tested
  (242→255). Split respects maxAssets; useEditorSession grew addAsset.

**E2E in headless Chrome (7/7): the harness GENERATED the test video
in-page** (canvas.captureStream + MediaRecorder → webm → setFiles) —
no fixture needed. Flow: attach → thumbnails render → drag trim end
(label updates) → scrub cover → export → publish → thumbnail_url
NON-NULL in the DB. The test immediately caught a real edge case:
MediaRecorder-produced files (screen recordings) report
duration=Infinity until force-seeked to the end once —
ensureSeekableDuration() now handles it in the stage, timeline, and
poster capture. (Same class of file also declines to trim via
mediabunny → clean fallback; phone MP4s carry real metadata.) React
footnote: e.currentTarget is nulled after an event handler returns —
capture it before any await.

Build clean (cold-build benign warning only), lint clean, vitest 255,
npm ci clean. QA post/files/user + dev server cleaned up. The media
editing feature request is now COMPLETE end to end (images + video).

## July 26, 2026 (late night) — MEDIA EDITOR Phase 1 shipped + cover photo + post-release fixes

**IN-APP MEDIA EDITING (5 commits 969c670..13501dc, migration 047,
DEPLOYED + prod-smoke-tested).** One reusable client-side editor
(crop/rotate/straighten via react-easy-crop, brightness/contrast/
saturation + 5 preset filters) wired into ALL TEN image surfaces:
composer (multi-asset filmstrip, Edit-pencil re-edit from
sourceFile+recipe), vitals, workout set media, messages, golf hole
media, equipment, 3 avatar flows collapsed into one AvatarUploader
(real circle crop at last), and the brand-new COVER PHOTO
(profiles.cover_url via 047, /api/upload/cover — avatar route's
pattern minus its bucket-guessing debt, 3:1 banners on both profile
headers, sweeper counts cover/avatar refs). Architecture: editor NEVER
uploads (surfaces keep deferred/immediate timing); live preview = CSS
only; export = one-shot canvas (EXIF baked at decode, 4096px iOS cap,
ctx.filter feature-detect with a unit-tested pixel fallback); GIF/no-op
pass-through originals; HEIC accepted for re-encode (iPhone HEIC
finally uploadable — previously failed only AFTER a full upload);
validation mirrors the server allowlist at pick time everywhere (two
surfaces had NONE). uploadPostMedia() replaced 5 copy-pasted FormData
blocks. New deps (approved): react-easy-crop; mediabunny deferred to
the video phase (WebCodecs — chosen for mobile: hardware encode, no
31MB wasm, no COOP/COEP headers which would break Supabase/Giphy).
Editor lazy via next/dynamic — first-load JS unchanged (185kB). Tests
197→242. Prod smoke: cover route round-trip + replace-cleanup + 401/
400 gates verified live with a disposable user.

**Tom's device pass: editor "worked amazingly" on mobile.** Two issues
→ both fixed, VERIFIED BY DRIVING THE REAL APP headlessly
(playwright-core + system Chrome channel — no browser download; minted
sb-auth-token cookie works on localhost too), then deployed
(da2e8a2 + 1d1e5f5):

- **Desktop localhost: image vanished on editor tab switch.** Object
  URLs were render-owned (useMemo) but revoked in effect cleanup —
  React StrictMode's dev mount→unmount→remount revoked them while the
  memo kept the dead map. First view kept its decoded bitmap; every
  later-mounted view got revoked blob: URLs. Prod has no StrictMode →
  mobile unaffected. Fix: EFFECT-owned URLs (each mount mints, its own
  cleanup revokes). LESSON: object URLs must be effect-owned, never
  render-owned. The fix's one-render empty gap then exposed a
  second bug the headless test caught instantly: react-easy-crop
  mounted with image='' → NaN position math → componentDidUpdate loops
  → "Maximum update depth exceeded" crashing the route — stage now
  renders nothing until the URL exists. Also stabilized [pending]
  array literals in Avatar/CoverPhotoUploader (identity churn revoked
  URLs on parent re-renders). 9/9 headless checks: image intact across
  Crop/Adjust/Filters/back + slider moves, clean cancel, no blob
  errors. (Screenshot artifact worth remembering: transition-colors
  makes the active-tab pill look one-behind in screenshots — timing,
  not a bug.)
- **Mobile: workout set-row weight input "off to the bottom."**
  Reproduced at 360px: page+card padding leaves ~300px; fixed-width
  reps/wt inputs + 3 action buttons can't fit → flex-wrap dropped
  weight under the row beside center-aligned buttons. Fix: reps/wt are
  flex-1 within min/max ranges, unit/delete/set# slimmed, card p-3 on
  mobile, row top-aligned so unavoidable wraps (duration/distance
  modes) stack cleanly. Geometry-asserted at 360/390/640px: one line,
  no overflow.

Build clean ×3 (one cold-build benign realtime warning), lint clean,
vitest 242, npm ci clean. QA users/files cleaned up. Phase 2 (video
trim/split/poster via mediabunny; populates the forever-null
post_media.thumbnail_url) is scoped and ready.

## July 26, 2026 (night) — Set-media lifecycle: post-delete kept clips alive, URL allowlist, prod E2E, orphan sweeper + purge

**Integration review of migration 046 (per-set media)** confirmed the
feature wired end-to-end (validation → both write paths → both read
paths → editor/history/post-card/share-picker, with tests) but surfaced
two real issues, both fixed in d1acd25:

- **Deleting a shared workout post destroyed the workout's clips.** The
  share flow reuses the same storage URLs for the post carousel and
  `workout_sets.media`; `DELETE /api/posts` hard-deleted the files, so
  the workout history + expanded post card silently lost their media.
  The delete now checks whether any `workout_sets.media` entry or
  another post's `post_media` row still references each URL and keeps
  the file if so (or if the check errors — fail-safe toward keeping).
- **Set media accepted any https URL.** Clips render in raw `<video>`/
  `<a>` with no host gate (unlike next/image), so a crafted API call
  could persist third-party URLs every viewer's browser would fetch.
  `validateSetMedia` now allowlists the project Supabase host +
  `*.supabase.co`/`*.supabase.in` + same-origin paths, and rejects
  protocol-relative `//host` URLs the old prefix check let through.

**Production E2E test (scripted, disposable admin-created user):**
minted a real `sb-…-auth-token` cookie via password grant and drove the
live APIs — upload → manual workout with set media → share post →
delete. The fix held (file survived, workout still served its media),
but the control check caught that NORMAL post-media cleanup had
silently died: supabase-js `.contains()` with an **array** arg builds a
Postgres array literal, which 22P02s on a jsonb column, and the
fail-safe then kept every file. Fixed in 57a9ec7 by passing the
containment value as `JSON.stringify([{url}])` — verified both forms
directly against production PostgREST (array → 22P02, string → 200).
LESSON: supabase-js `.contains()` on jsonb needs a JSON *string*; an
array arg means native-array containment. And: a fail-safe that fails
100% of the time looks identical to "working" — always run the
negative control.

**Post-deploy rerun: 9/9.** Shared file survives post deletion, workout
still serves its media, control file genuinely removed — verified via
the storage list API, because the public CDN URL kept serving deleted
files (uploads set cacheControl 3600; a deleted file's public URL can
200 for up to an hour). Never use the public URL as an existence check.

**ORPHAN SWEEPER BUILT (2f76116) + PROD PURGED — the storage-orphan
debt is retired.** `POST /api/admin/storage-sweep` (requireAdmin;
needs ADMIN_EMAILS in Vercel — still unset) walks the whole uploads
bucket and compares against every DB column that can reference it:
post_media media_url+thumbnail_url, group_post_media, messages
.media_url, workout_sets.media jsonb. Dry-run BY DEFAULT — deletion
requires an explicit `{"dryRun": false}`. 48h grace period, because
uploads land BEFORE the row referencing them is written (editor →
debounced snapshot PUT; composer → post create) — a young
unreferenced file may be in flight, and missing created_at is treated
as not-sweepable. Pure logic in lib/storage-sweep.ts (8 tests; 197→
203). Dry-run was replicated read-only against prod first: 42 files,
5 referenced, 37 orphans dating to Sept 2025 (deleted test accounts +
post deletions predating delete-time cleanup). Tom approved; purged
via service role with a saved manifest — post-purge verify: exactly
the 5 referenced files remain, all intact, zero orphans. Future
hygiene: run the endpoint's dry-run occasionally; a vercel.json cron
+ CRON_SECRET check is the follow-up if it should be automatic.

**ADMIN_EMAILS + sweep endpoint VERIFIED LIVE.** Turned out the var
was ALREADY set in Vercel (Tom, ~July 23, Production+Preview, marked
Sensitive) — the "still unset" note was stale. Sensitive vars can't
be read back: `vercel env pull` writes a literal `[sensitive]`
placeholder, which briefly masqueraded as a wrong value — verify
Sensitive vars FUNCTIONALLY, never by comparison. Functional check on
prod: unauthenticated POST /api/admin/storage-sweep → 401; a session
minted for Tom's account via admin generate_link magic-link → 200
dry-run reporting exactly the post-purge state (5 files, 5
referenced, 0 orphans). Vercel CLI side-quests from this: `vercel
link --yes` auto-created a stray empty project named after the DIR
(edge-athlete-main) — deleted; always `--project edge-athlete`. It
also appended a redundant `.env*` to .gitignore (reverted) and a
VERCEL_OIDC_TOKEN line to .env.local (harmless, kept). CLI auth is
cached on this machine (`vercel whoami` works); project now linked.

Remaining debt (reduced): no per-workout total media cap (only
4/set); orphans no longer accumulate silently but still require a
manual sweep trigger (vercel.json cron + CRON_SECRET when wanted).

lint clean · `tsc --noEmit` clean · vitest 197 passed (was 196; new
host-allowlist spec). Test users + files cleaned up from prod after
each run.

## July 26, 2026 (end of day) — Maintenance checklist + sync

- lint clean · `tsc --noEmit` clean · `vitest` 196 passed (21 files) ·
  `npm ci --dry-run` clean · full `npm run build` exit 0 (dev server
  stopped), all routes compile, zero warnings beyond the documented
  benign realtime one.
- Migrations 043–046 all confirmed run + verified live via PostgREST
  (achievements CRUD round-trip; equipment date columns; workout
  session/exercise/set nested round-trip incl. media array + cascade).

## July 26, 2026 — Session log: unified filters, sport-based equipment, Edge Vitals

**Unified profile filters (17e6c77..262c223, migrations 043+044):** the
Media-tab filter treatment became a shared kit (MultiSelectDropdown lifted,
FilterBar extracted, YearSelect) and went across the board. ACHIEVEMENTS
BUILT for real (athlete_achievements + CRUD API + tab UI + modal — replaced
the coming-soon placeholder). Equipment gained user-editable acquired_on/
retired_on ("in bag during year" filtering; audit timestamps untouched).
Vitals got category+year filters (PB/trend scope to the filtered range).
The hardcoded "2024–25 Season" chip became a REAL year selector (stat-lines
+ golf/stats accept ?year=, return years[]; the long-dormant adapter
`season` param finally implemented; sport-card clicks carry the year into
the media filter). getSeasonHighlights' fabricated sample rows deleted.

**SCHEMA DRIFT (044 fix, ee28422):** live athlete_equipment was created
from an OLDER script than the repo DDL — legacy retired_date, NO
added_at/retired_at, so the deployed equipment POST had been silently
broken in prod forever (0 rows). LESSON: for unnumbered/legacy tables,
probe live columns via PostgREST before writing migrations against them.

**Sport-based equipment + always-visible filters (5701147, c6a7a8c):**
per-sport category catalogs in lib/equipment-config (golf/hockey/
volleyball/basketball/soccer/baseball; safe fallback fixed a latent crash
on free-text categories); Add Equipment offers every enabled sport (the
private golf|general union silently coerced everything to golf); sport
filter + sport→category grouping on the tab; API 400s unknown sports.
Filter bars now render on EVERY tab — disabled dropdowns with a tooltip
until data exists (they previously hid, reading as "missing").
vitest.config.ts added (@/ alias → aliased modules testable).

**Polish (ed83c79):** "In bag" → Active/Retired everywhere; Current
Vitals strip atop the Vitals tab (Height/Weight/Age; DOB owner-only,
TZ-safe). BUG: /api/vitals read profiles.birthday (legacy, null) — now
dob||birthday, so age-at-date annotations render for the first time.

**EDGE VITALS (ae4dd16..546b880, migration 045):** Strava×AppleWatch live
workout tracking. workout_sessions/exercises/sets (rows, vitals RLS, lazy
6h auto-end — no cron); exercise catalog (~40, per-exercise input modes,
5 PR-mapped lifts); full-screen editor at /app/workout/[id] with a
timestamp-derived 1s timer, rest indicator, duplicate-last-set, catalog
sheet + custom; durability = draft-on-every-mutation + debounced
single-flight snapshot PUT with a savedAt stale-write guard + keepalive
flush (golf score-entry pattern, snapshot-vs-snapshot resolution);
finish → summary → suggest-and-confirm PR checklist (writes athlete_vitals
source='edge_vitals', linked to the post) → Strava-style share prompt.
Vitals tab branded Edge Vitals: Start Workout / Log Past Workout / resume
banner / Workouts history section. Also fixed: /api/upload/post-media now
derives owner from the session (AddVitalModal's empty userId → "User ID
is required" on vitals-with-media posts).

**Edge Vitals v2 (cb02f65..4c378fa, migration 046):** per-set MEDIA —
camera button on every set row, up to 4 clips/set stored as JSONB inside
the set snapshot (rides the replace-all sync + draft for free); shared
workout posts upgraded from a chip to a compact card (denormalized tiles,
zero fetches while scrolling) with lazy-fetched expandable set-by-set
details incl. clips; ShareStep clip picker → selected set media becomes
the post's normal carousel. Built for profiles holding hundreds of
workouts.

**Perf + localhost (d149913):** middleware matcher excludes /api (routes
self-authenticate; removed a Supabase getUser() round trip from every API
call, dev+prod). Localhost "very slow / needs refresh" root cause: TWO
`next dev` processes — the old one held :3000 while Tom's restart
silently took :3001, both corrupting a shared .next. When localhost
misbehaves: `pgrep -fl "next dev"` FIRST.

Tests 129 → 196 across the day.


- `npm ci --dry-run` clean · lint clean · `tsc --noEmit` clean ·
  `vitest` 129 passed (14 files) · build exit 0, 83 pages (isolated
  worktree — dev server running).
- This entry is the maintenance-log commit → GitHub → Vercel.
- Migrations all confirmed run through 042 (039-042 verified live).

## July 25, 2026 (afternoon → night) — Session log part 2: neutrality, the realtime resurrection, Live Round v2

**Sport-neutral intake (3059913):** onboarding sport multi-select (first
step, max 3, first = primary → profiles.sport as display name; picks seed
sport_settings rows); feed/composer/live-poll follow the athlete's sport;
shared resolveSportKey; Edit Profile "Your sports"; explore's sport filter
finally functional; golf leaks swept (manifest/privacy/terms/icons).
'training' is a post category with no adapter — intake must never offer it.

**Live-scoring lifecycle + streaming (83a8b7a):** 6h quiet auto-end (lazy
effectiveRoundStatus display + persistence on next write/End Round);
"Playing now / Already played" at creation; End Round on the feed card;
useSharedRound became the reusable seam (status callback + retry,
connectionState, group_posts UPDATE binding, 30s poll fallback, minute
tick); feed cards subscribe while live; realtime.setAuth on auth change.

**THE REALTIME RESURRECTION (migrations 038, 041 + two restarts):**
postgres_changes had NEVER delivered a single event in this project's
history. Three stacked causes: (1) tables never in the supabase_realtime
publication (031 unrun; messages/posts/notifications only in archived
scripts — messaging's 30s poll was its entire delivery mechanism);
(2) the Realtime replication slot sat disconnected (active = f) — project
restart reconnects it; (3) RULE: tables added to the publication
mid-session don't stream until the Realtime service reconnects — restart
after every publication change, then re-verify. Debug ladder that cracked
it: broadcast test (service alive?) → service-role subscriber
(publication vs RLS?) → pg_replication_slots.active. Post-041+restart:
message INSERT/UPDATE, notification INSERT, golf scores + status flips
ALL verified arriving in ~1s via the two-client harness. Messaging went
from 30s-poll latency to instant.

**Security hardening (040 + dashboard):** linter remediation verified
against code paths — forgeable notifications INSERT policy dropped,
search_path pinned ×7, bucket listing removed, ~24 definer functions
revoked from API roles; 9 warnings permanently accepted (RLS helper
functions policies evaluate — documented in the migration). Leaked
password protection ON; Postgres upgraded.

**Solo live + pars + one stats pipeline (c7e94c9, migration 039):**
"Playing now" is ONE flow, friends optional — solo live rounds ride the
shared rails; hole_data (real per-hole par/yardage — collected all along,
DISCARDED server-side) stored at creation; totals trigger v3 computes
honest to-par; mirror-on-completion writes real golf_rounds + golf_holes
per participant → trends/handicap/rounds pages/tiles unified into one
pipeline (stats route's shared merge removed as double-count). Live Now
strip (feed) + Explore grid via follow-scoped /api/golf/live-now.

**Live rounds are not feed posts (3c1e9e7):** Tom's model — the feed
hides rounds while isRoundLive (they live in banner/strip/LIVE tab); the
post's created_at is bumped on the one-time completed transition so the
final scorecard arrives fresh. LIVE nav tab (red pulse) → /live page.

**Live Round v2 (f8c91da, migration 042):** par-bug ROOT CAUSE — course
search's history layer (holes:[]) deduped away the static-DB entries
carrying real hole data; history now enriched by name. Score entry shows
"Course · Par 4 · 360 yds"; Go Live setup flow (no caption/media/tags,
red Go Live button); player-switcher chips with persist-before-switch +
green/amber identity headers; hole-tagged photos/videos
(group_post_media.hole_number, POST /api/group-posts/[id]/media,
Round Media section grouped by hole).

**Also:** composer footer hint names actual missing fields (stale hint +
disabled button read as "Post does nothing" — real cause was a stale dev
server; rule: restart dev after heavy multi-file change sessions).

## July 25, 2026 — Maintenance checklist + sync

- `npm ci --dry-run` — clean. `npm run lint` — zero warnings/errors.
- `npx tsc --noEmit` — clean. `npx vitest run` — 97 passed (9 files).
- `npm run build` — exit 0, 81 pages, isolated-worktree build (dev server
  was running). This entry is the maintenance-log commit → GitHub → Vercel.

## July 25, 2026 — Launch-readiness sprint: THREE launch-blocking DB bugs + the silent-failure root cause

The two-phone live-scoring E2E test earned its keep on Phase 1 alone.
Tom's first real shared-round creation "succeeded" in the UI and left
ZERO rows. Unwinding that found four systemic bugs:

**Migrations 035–037 (all run + verified live, commit 7508285):**
- 035: group_posts ↔ group_post_participants RLS policies referenced each
  other (participants' even referenced ITSELF) → "infinite recursion
  detected in policy" (42P17) on the very first insert. The API's atomic
  rollback then erased every attempt without a trace. Shared rounds were
  NEVER creatable against live RLS — dev reads go through the admin
  client (bypasses RLS) and empty tables never evaluate policies, so
  weeks of live-scoring work sat on a feature no real user could start.
  Fixed with SECURITY DEFINER membership helpers
  (is_group_post_creator/participant/organizer).
- 036: archive/old-migrations/fix-utility-functions-schema.sql had
  REWRITTEN handle_updated_at() (the generic updated_at trigger from 001)
  to set NEW.handle_updated_at — a profiles-only column. Every UPDATE on
  group_posts/clubs failed 42703 (all round status transitions dead), and
  every profile edit was inflating the 7-day handle-change rate limit.
- 037: same file broke update_group_post_timestamp() (touch-parent body on
  tables without group_post_id) and calculate_golf_participant_totals()
  (nonexistent columns) — every hole-score insert would have failed.
  Restored to 004 canon, schema-qualified + search_path hardened.
- Verified with a 10-step authenticated diagnostic (create → invite →
  scorecard → feed post → backlink → scores row → hole inserts → trigger
  totals → update): all pass. LESSON: archived "fix" SQL files redefined
  LIVE functions; when a trigger/policy errors weirdly, diff pg_proc
  prosrc against canon.

**Toast fix (ab60d9d):** the reason the UI lied: useToast() was
per-component state, so a toast only rendered if that same component also
rendered a ToastContainer. Pages did; every embedded component
(CreatePostModal's 10+ showError calls, FollowButton, EditPostModal,
GolfScorecardForm…) fired into the void. Store is now module-global
(useSyncExternalStore) + one <GlobalToasts /> in the root layout;
six per-page containers removed; API unchanged — every existing error/
success message became visible at once.

**Sentry verified live end-to-end:** DSN inlined in prod bundle + test
event accepted (HTTP 200) + new-issue email received. Two Vercel gotchas
hit on the way: "Redeploy" reuses build cache (NEXT_PUBLIC_* changes need
the cache checkbox UNCHECKED) and an empty-value env var inlines as "".

**Test account** for 2-phone testing: tom.kazhikkachalil+test@gmail.com
(admin-created; profiles are route-created not trigger-created, and
profiles enforces check_display_name_not_empty). OPEN MYSTERY: Tom's
in-app signup attempt for this account never reached the DB despite
appearing to complete — watch signup closely in the first-run walkthrough.

**Sprint plan agreed (4 sprints):** 1 Launch Readiness (in flight:
Sentry ✓, DB fixes ✓, toast fix ✓; remaining: phone phases 1–8, first-run
walkthrough + signup mystery, deferred mobile items, season chip) →
2 First-100 Funnel (OAuth, OG/meta on public profiles, SMTP/CRON/Upstash,
foursome invites) → 3 Golf Depth (shared-round per-hole stats, trends/
handicap incl. shared, real par, rounds page) → 4 Foundation Hardening
(live-DB audit vs canon, registry merge, dead code, Playwright E2E).

## July 24, 2026 (night) — Launch-readiness sprint 1/4: Sentry error monitoring

First stop of the launch-readiness sprint: real-user errors become visible
(and emailed) instead of vanishing into browser consoles.

- `@sentry/nextjs` 10.68.0 (npm ci --dry-run clean — no peer conflicts).
- Coverage: client (src/instrumentation-client.ts), Node server + Edge
  (sentry.server/edge.config.ts via src/instrumentation.ts register()),
  uncaught route-handler errors (onRequestError), and both error
  boundaries now Sentry.captureException explicitly (boundaries swallow
  errors before global handlers see them).
- **Inert without env**: every init is enabled only when
  NEXT_PUBLIC_SENTRY_DSN is set — local dev and prod behave exactly as
  before until Tom adds the DSN. Source-map upload only with
  SENTRY_AUTH_TOKEN (skipped silently otherwise). sendDefaultPii false
  (athlete data), tracesSampleRate 0.1, no session replay.
- Build verified in an isolated worktree (dev server was running): only
  the pre-existing documented realtime-js/Edge warning remains — parity.
- Manual steps (Tom): create Sentry account/project (Next.js) →
  NEXT_PUBLIC_SENTRY_DSN into Vercel env + .env.local → redeploy. Default
  alert rule emails new issues to the account email
  (tom.kazhikkachalil@gmail.com). Optional: auth token for source maps.

## July 24, 2026 (night) — Maintenance checklist + sync (end of session)

- `npm ci --dry-run` — clean, no peer conflicts.
- `npm run lint` — zero warnings/errors.
- `npx tsc --noEmit` — clean.
- `npx vitest run` — 97 passed (9 files).
- `npm run build` — exit 0, 81 pages, **run in an isolated git worktree**
  because the dev server was up on :3000 (see the .next-corruption lesson
  below — never build into a live dev server's .next again).
- This entry is the maintenance-log commit. Pushed main → GitHub → Vercel.
- Open manual items (Vercel env): Sentry/Upstash/SMTP+CRON, ADMIN_EMAILS.
  GIPHY_API_KEY was ADDED today — GIFs live in prod.

## July 24, 2026 (day → night) — Session log: review fixes, Athlete-page features, cleanup

Compressed log of a long session; details in the commit messages.

**Post-deploy review of the live-scoring commits** (subagent review → every
claim personally verified): 8 real bugs fixed across 3 commits
(1af22fa / 91496f9 / 695bec3). Highlights: solo quick-entry localStorage
draft collision (participantId="" merged one round's typed holes into
another); "final leaderboard" notification could fire early and never again;
shared-round invitees of private creators got 404 + permanently stale
leaderboards; finished players kept seeing the Continue-scoring banner;
first-save race between keepalive flush and foreground save 500'd and
blocked navigation.

**Athlete-page feature (planned + approved):** pinned "Featured" posts
(migration 034: posts.is_pinned/pinned_at; PATCH /api/posts, cap 3;
FeaturedPosts row above the media grid; thumbtack in PostCard) + Sport
Highlights now render for visitors on /athlete/[id] + the write-only manual
season-highlights editor retired (modal/route/pencil deleted; table kept).
Golf tiles now count shared rounds (stats-aggregate extraction) and 9-hole
rounds (Rounds/FIR%/GIR% include them; Last 5 Avg / Best 18 / Putts per
Round stay 18-hole-only). 5f070e2, a3bb2ad, ef532b8.

**Clickable Sport Highlights + deep-link fixes (2360c1a):** sport cards are
real buttons → scroll to media section pre-filtered (sportSpotlight
identity contract) + open that sport's latest post; /feed?post= finally
read (reactive Suspense-wrapped useSearchParams — search pushes while
already on /feed); /athlete/[id]→/athlete self-redirect now carries ?post=;
PostDetailModal moved to the refcounted useBodyScrollLock.

**Account/data cleanup:** all test accounts deleted, one fresh real account
remains; fake round removed; 20 orphaned avatar files purged from storage.
The account-deletion route had three silent no-ops against nonexistent
columns — worst was post_media queried by profile_id, orphaning every
deleted account's media files forever (f78514f). Deleting accounts also
exposed a real-world auth bug: a browser holding a JWT for a deleted user
hung the landing page on "Welcome back!" forever — the app now verifies a
profile-less session against the auth server and drops dead sessions
(9b996e8).

**Ops/lessons:**
- GIF picker "gone" in prod = GIPHY_API_KEY never set in Vercel (code was
  fine; key added, working).
- Localhost error storm ("Cannot read properties of undefined (reading
  'split')" everywhere) = corrupted .next: `npm run build` ran while the
  dev server was up, clobbering its cache. Fix: rm -rf .next + restart.
  **Rule: never build while the dev server is running — check
  `lsof -i :3000` first, or build in a worktree.**

## July 24, 2026 — Live-scoring reliability + group flow (7 phases)

Tom's directive: think through everything that can go wrong during live
scoring — scores must survive every exit path, and groups must be part
of the live experience, not separate. Two Explore agents mapped the
exit-point/persistence gaps and the full group lifecycle; every claim
verified personally; Plan agent designed; product decisions from Tom:
AUTO-CONFIRM invitees, resume banner + smarter modal (no /rounds page).

Biggest discoveries (all fixed):
- ATTESTATION DEAD-END: the confirm/decline UI was never mounted, so
  invitees stayed 'pending' forever → the scores API rejected them and
  FullCard hid them. Only the creator could ever score. (Root cause of
  "groups feel separate".)
- GROUP_SCORECARD_SELECT never selected participants.profile_id but
  every isCurrentUser check compares it → Add/Edit Scores was
  unreachable from feed-loaded cards, period.
- Creation was 3 client calls with non-fatal failures → invisible
  rounds (no feed post), scorecard-less cards that render nothing.
- Prev/Jump swallowed failed saves AND cleared the error; typed holes
  were React-only (no draft/beforeunload anywhere in the repo).

Shipped (one commit per phase, 31e9882..cec6291):
1. Resume at first unscored hole; ALL navigation blocks on failed saves.
2. localStorage draft (48h TTL, per-participant, private-mode safe) +
   keepalive flush on pagehide/visibilitychange. Merge rule: draft
   applies only to holes the server doesn't have. Draft cleared only on
   acknowledged save; flush never clears (refetch reconciles).
3. Refetch scorecard before score entry opens; useSharedRound tracks
   `stale`; amber "Updates paused" chip.
4. Migration 033 (data-only: pending/maybe→confirmed + post_id
   backfill) + auto-confirm on invite + scores gate rejects only
   'declined' + isActiveParticipant() unifies all 9 roster filters +
   the profile_id select fix.
5. Atomic creation: golf_data created server-side inside
   POST /api/group-posts; compensating DELETE + real 500 on any
   partial failure; post_id set at creation. Backward compatible
   (golf_data optional) across the rolling deploy.
6. Creator enters/edits scores for any player (existing API,
   entered_by/scores_confirmed attribution; "entered by organizer"
   hint; modal header names the player).
7. GET /api/golf/live-round (participant-scoped; generic group-posts
   GET leaks all public rounds via RLS) + feed "Continue scoring"
   banner → PostDetailModal with autoOpenScoreEntry (in-place; URL
   deep-link rejected — /athlete/[id] self-redirect drops ?post=).

MIGRATION 033: data-only, idempotent, run whenever — the relaxed gate
handles unmigrated legacy rows either way. Run it to confirm legacy
invitees + backfill post_id for pre-existing rounds.

Tests 59 → 81 (score-entry, draft/merge, isActiveParticipant,
pickLiveRound). tsc/lint/build clean per phase.

DEFERRED: dedicated /rounds page; offline retry queue beyond
keepalive+draft; real per-hole par in to_par (trigger + payload);
dead-code cleanup (attest route, ParticipantAttestationModal, unused
POST /api/golf/scorecards); messaging keyboard device check.

NEEDS DEVICE/2-ACCOUNT TESTING (Tom): mid-round tab-kill → draft
restore; airplane-mode Prev → blocked with error; invitee scores
immediately; creator enters for B, B sees live + attribution; banner
resumes at first unscored hole; completed round → no banner.

## July 24, 2026 — Mobile/UI polish pass (full-app audit, 3 tiers)

Tom called a feature freeze until the app feels polished on mobile+web.
Workflow: 3 read-only audit agents (modals/overlays, feed+chrome,
pages/flows) → every claim personally verified in code → fixes landed
HIGH → MEDIUM → LOW, one clean-build commit per tier.

- HIGH (0ddbdfb): NotificationBell dropdown hung ~74px off the LEFT
  screen edge on phones (near-viewport-wide panel anchored right-0 to a
  bell that has ~90px of header buttons to its right) and horizontally
  scrolled every page — now a fixed centered panel under the header on
  mobile. Toast rebuilt (was max-w-5xl/p-10/text-3xl in a width-less
  centered container with a translate-x-full entrance → transient
  horizontal overflow); now compact max-w-md, slide-down, z-[70].
  Deleted dead NotificationsDropdown.tsx (zero imports, same bug).
- MEDIUM (aa0e8ce): NEW useBodyScrollLock hook (refcounted for stacked
  modals) on all 15 fullscreen modals; date/datetime-local/time/month
  added to the iOS zoom rule; NEW .max-h-modal (dvh+vh fallback) on 19
  modal panels; PostCard name/handle truncation + 44px share/save;
  comment action hit areas; MultiPlayerScorecardGrid header moved out
  of the scroll container (controls were off-screen at 360px); game
  format picker stacks on phones; ConfirmModal/TagPeopleModal/
  SportSelector z-[60] over parent modals; FollowersModal pills +
  PostDetailModal controls to real tap sizes; search bar icon-only
  Filters on phones (input had ~150px typing space); dead "Associated
  Clubs" placeholder removed from prod signup; signup submit sized to
  match login.
- LOW (3525454): optimistic like count (number popped after the heart),
  vitals-badge double inset, skeleton aspect-video, leader-badge shrink
  guard, End Round icon-only at 360px, jump-grid/close/dismiss/checkbox
  tap sizes, PrivateProfileView mobile padding, badge-editor input
  height.

DEFERRED (documented, not fixed blind):
- ~~Messaging composer under the mobile keyboard~~ ADDRESSED July 27:
  the h-[100dvh] "fix" never applied (h-screen won the CSS cascade —
  verified in built stylesheet); replaced with h-dvh, added
  interactiveWidget resizes-content (Android) and a visualViewport
  --vvh handler (iOS). Pending device verification.
- ~~AddEquipmentModal autocomplete dropdowns clip~~ ADDRESSED July 27:
  panels capped to min(15rem,40vh) + scrollIntoView on open + touch
  outside-close. No scroll-container restructuring.
- ~~hover: color states stick on touch app-wide~~ NOT A BUG: Tailwind 4
  gates every hover: variant behind @media (hover:hover) by default —
  verified 99/99 hover rules wrapped in the built CSS. Nothing to fix.
- Golf round page FIR/GIR toggles at 40px — accepted for table density.

tsc/lint/test(59)/build clean per tier. Pushed → Vercel.

## July 23, 2026 — Game formats: Stableford + Match Play (live scoring phase 2b)

⚠️ **DEPLOY ORDER: run migration 032 in Supabase BEFORE pushing this commit.**
The feed's scorecard query now selects golf_scorecard_data.game_format;
PostgREST errors on unknown columns (42703), which would blank every
shared-round scorecard until the column exists. Migration is idempotent,
backfills existing rounds to 'stroke'.

- Migration 032: golf_scorecard_data.game_format TEXT NOT NULL DEFAULT
  'stroke' CHECK (stroke/stableford/match). Formats are pure display/
  scoring strategies over the SAME stored hole scores — no score storage
  changes, so switching format later can't lose data.
- NEW src/lib/golf/formats.ts (the strategy layer the scoring.ts header
  promised): stablefordPoints (standard gross allocation: albatross 5,
  eagle 4, birdie 3, par 2, bogey 1, double+ 0) + calcStablefordTotal;
  calcMatchStatus (head-to-head, only holes BOTH players scored count,
  standard result grammar: "3&2", "1 UP", "All Square", "2 UP thru 14");
  asGameFormat safe-parse (absent/garbage → 'stroke', so pre-migration
  payloads degrade to exactly the old behavior).
- CreatePostModal: Game Format picker (3-button row, stroke default) in
  shared-round details; sent on scorecard create. /api/golf/scorecards
  validates it (400) and omits when absent so the DB default applies.
- SharedRoundQuickView + FullCard: purple format badge (non-stroke only);
  stableford leaderboards rank by points DESC and lead with "N pts"
  (strokes secondary); match play shows a status banner (leader name +
  summary, "N holes remaining" while live) and suppresses the stroke
  leader badge. Match banner only renders with exactly 2 scoring players —
  any other count falls back to stroke display silently.
- 12 new unit tests (allocation table, totals, match grammar incl. early
  close-out, final-hole win, halved, uneven entry). 59 total pass.
- tsc/lint/build clean (only the documented benign realtime-js/Edge
  middleware warning).
## July 23, 2026 — Round lifecycle: in-progress status + LIVE/FINAL badges (live scoring phase 2a)

group_posts.status (schema had it since 004; nothing ever set it past
'pending') now tracks the round's real lifecycle, derived from score
activity — no migration needed, pushed + deployed (0e65fcc).

- NEW src/lib/golf/round-status.ts: resolveRoundStatus pure state machine
  — pending → active on first score activity; → completed when every
  CONFIRMED participant WITH scores has finished all holes (invitees who
  never score can't hold a round open; a full after-the-fact batch goes
  straight to completed and never lingers as LIVE); completed/cancelled
  terminal. advanceRoundStatus applies it via service-role (RLS only lets
  the creator update group_posts, but any participant's save advances the
  round) with a status-guard on the UPDATE against concurrent saves.
- Both score-write routes (per-hole/batch scorecards/[id]/scores + bulk
  participant-scores) call it best-effort after successful saves — same
  pattern as the notification side-effects. The status ride-along means
  the existing Realtime score event → client refresh picks up the new
  status with no extra publication (031 unchanged, group_posts NOT added).
- isRoundLive client guard: active AND round date within ±48h — an
  abandoned 'active' round quietly stops advertising itself as live.
- UI: pulsing red LIVE badge + gray FINAL badge on SharedRoundQuickView
  and FullCard header. Creator-only "End Round" button (escape hatch for
  abandoned rounds) with ConfirmModal + inline error, refreshes through
  the useSharedRound seam. NOTE: pre-existing rounds stay 'pending'
  forever (scores predate the transitions) — they show no badge, same as
  before; only rounds with score activity after this deploy advance.
- PATCH /api/group-posts/[id] status now allowlist-validated (400, was an
  opaque DB CHECK 500).
- 15 new unit tests (state machine + live-window guard).
## July 23, 2026 — Maintenance checklist + sync (post zod-fix)

- `npm ci --dry-run` — clean, no peer conflicts (the Vercel-install-parity
  check now standard after the zod v4/openai failure).
- `npm run lint` — zero warnings/errors.
- `npm run typecheck` — clean (exit 0).
- `npm run test` — 32 passed (3 files: scoring, handicap, validation).
- `npm run build` — exit 0 from a fresh `.next`.
- Working tree already in sync with origin (zod fix 05795fc pushed). This
  entry is the maintenance-log commit. Pushed main → GitHub → Vercel.
- Open optional items (unchanged): Sentry/Upstash/SMTP+CRON env + ADMIN_
  EMAILS in Vercel. Migration 031 already run (live scoring on).
## July 23, 2026 — FIX: Vercel production build failing (zod peer conflict)

Root cause of "failed to get production": the Sprint 6 zod add pulled in
zod v4 (^4.4.3), but openai@4.103.0 (AI features) declares a peer dep of
zod ^3.23.8 (v3). Local `npm install` / `npm run build` tolerate the
mismatch; Vercel builds with `npm ci`, which is STRICT and aborts on the
ERESOLVE conflict → install never completes → build never runs.

- Fix: downgraded zod to ^3.25.76 (v3) — the version openai expects, so
  the conflict disappears at the root. The validation lib uses only
  basic schema API (object/string/boolean/enum/uuid/email/transform/
  pipe/partial/strict/safeParse), all identical in zod 3, so zero code
  changes needed.
- Reproduced Vercel's failing step locally with `npm ci --dry-run`
  (errored before, clean after). package-lock.json regenerated and
  committed IN THIS COMMIT (an out-of-sync lockfile is itself an npm ci
  failure).
- Verified: npm ci clean, tsc clean, 32 tests pass, fresh build exit 0.
- Lesson: after any dependency add, run `npm ci --dry-run` — it catches
  peer conflicts that `npm install` silently resolves but Vercel rejects.
## July 23, 2026 — Maintenance checklist + sync

- `npm run lint` — zero warnings/errors.
- `npm run typecheck` — clean (tsc --noEmit, exit 0).
- `npm run test` — 32 passed (golf scoring + handicap + validation).
- `npm run build` — exit 0 from a fresh `.next`, all routes.
- Working tree already in sync with origin (this session's work —
  roadmap Sprints 1–6, live-scoring foundation + per-hole live entry —
  pushed across prior commits). This entry is the maintenance-log commit.
- Migration 031 (golf_participant_scores → Realtime publication) RUN by
  Tom. Can't confirm from here the way other migrations were verified —
  pg_publication_tables is a pg_catalog table PostgREST doesn't expose
  (PGRST205). Self-check in the Supabase SQL editor: SELECT tablename
  FROM pg_publication_tables WHERE pubname='supabase_realtime' AND
  tablename='golf_participant_scores' → expect one row. Note: the
  ALTER PUBLICATION migration IS the full enablement — no separate
  dashboard Replication toggle needed. Live leaderboard push is now on.
- Optional items still open: Sentry/Upstash/SMTP+CRON env in Vercel,
  ADMIN_EMAILS in Vercel.
- Pushed `main` → GitHub → Vercel auto-deploy.
## July 23, 2026 — Per-hole live-entry UI (live scoring, first feature)

Built on the useSharedRound foundation: scores now persist and stream
hole-by-hole during a round instead of all-at-once at the end.

- ScoreEntryModal gains a LIVE mode (triggered by a new onSaveHole prop):
  each hole is persisted as you advance (Next / jump / Previous / Done /
  close all flush the current hole first via persistHole). Dirty-tracking
  so unchanged holes don't re-POST; per-hole saving/Saved indicators; a
  pulsing "● LIVE" badge; green save-check dots on the jump grid; the
  last-hole button becomes "Done" (holes already saved). Batch mode
  (onSave only) is unchanged — the individual-round quick entry in
  GolfScorecardForm keeps using it.
- The scores API already upserts on (participant, hole) and its trigger
  recalcs totals, so a single-hole POST → golf_participant_scores update
  → Realtime event → co-players' useSharedRound refresh their leaderboard
  LIVE. PostCard's onSaveHole POSTs the one hole; refresh-on-close keeps
  the entrant's own card current.
- Degrades gracefully: without migration 031 / Realtime enabled, per-hole
  SAVE still works — co-players just see updates on next open instead of
  live push.
- tsc/lint/test(32)/build clean. Shared-round score entry is now a live,
  hole-by-hole experience; the leaderboard updates for everyone playing.
## July 23, 2026 — Live-scoring foundation: useSharedRound + Realtime

The seam the group-golf audit called for, and the groundwork for the
live-scoring vision (real-time scores, then game formats on top).

- NEW src/hooks/useSharedRound.ts: single source of truth for a shared
  round's live state. Seeds from the scorecard the feed already loaded
  (no extra mount fetch); subscribes to Supabase Realtime on
  golf_participant_scores (client-side filtered to THIS round's
  participant ids via a ref, so scores entered by ANY player stream in
  live — leaderboard updates for everyone watching, not just the
  entrant); exposes refresh() for imperative post-save updates.
  Subscription gated by `enabled` so the feed doesn't open a channel per
  card (on only while the full card / score entry is open).
- Migration 031: adds golf_participant_scores to the supabase_realtime
  publication (idempotent guard). Realtime respects RLS — the migration-
  004 SELECT policy already scopes score visibility to the round's
  participants/creator, so live events reach exactly the right people;
  non-participant spectators fall back to seeded data + refresh. PENDING:
  run in Supabase. Nothing breaks if unrun — the subscription just never
  fires. Also needs Realtime enabled for the table in the Supabase
  dashboard if not already (same as messages).
- PostCard: replaced the ad-hoc scorecardOverride state with the hook —
  ONE seam now owns shared-round state + live updates + the post-score
  refresh (was a manual refetch). Behavior preserved for the solo case;
  additive live updates for co-players.
- tsc/lint/test(32)/build all clean.
- NEXT for full live scoring (future): per-hole live entry UI during a
  round, game-format strategies (match/stableford) on lib/golf/scoring,
  an in-progress round status + "live" badge. The state/Realtime plumbing
  is now in place for all of it.
## July 23, 2026 — Sprint 6 FINAL: zod input validation (pattern + first routes)

Roadmap's last item. It's explicitly incremental — the risk is a schema
being STRICTER than current behavior and 400'ing valid production traffic,
so I established the pattern well + converted a curated set with behavior
matched exactly, leaving the rest to adopt route-by-route.

- Added zod. NEW src/lib/validation.ts: parseBody(request, schema) →
  {success,data} | {success:false,response:400}; reusable primitives
  (uuid, boundedText, optionalText, emailString). Malformed JSON now
  yields a clean 400 instead of a 500.
- Converted 3 routes, behavior-matched:
  * /api/contact — name/email/message bounds (also drops the manual
    email regex).
  * /api/waitlist — email + userType enum with Club→club normalization
    (verified the schema output equals the old hand-rolled logic).
  * /api/notifications/preferences PATCH — the hand-rolled boolean
    allowlist → a .partial().strict() schema (strict = the same
    mass-assignment guard, now declarative).
- 7 new unit tests (src/lib/__tests__/validation.test.ts) incl. the
  malformed-JSON→400 and strict-rejects-unknown-keys cases. Suite now
  32 tests (25 golf + 7 validation), all green in ~200ms, in CI.
- REMAINING (incremental, documented in validation.ts): the complex
  mutation routes (posts POST, golf round PATCH, messages POST) keep
  their existing thorough manual validation for now — convert as
  touched, using the established pattern. Not converted blindly to
  avoid a big-bang regression.
## July 23, 2026 — Sprint 6 kickoff: first automated tests (golf math)

The project had ZERO tests. Started the test suite with the highest-ROI,
zero-external-dep slice: unit tests for the pure golf math libraries that
the retention engine (trends + handicap) depends on — the exact functions
hand-verified against production data during Sprint 3.

- Added Vitest (dev dep). Scripts: `test` (vitest run), `test:watch`;
  `verify` now = typecheck + lint + test + build.
- CI: test step added between lint and build (runs on every push/PR).
- 25 tests across scoring.ts + handicap.ts, including REGRESSION LOCKS
  for the two bugs the migration/hand-verification caught:
  * classifyScore against real par (the par-4-shadow bug — a 4 on a
    par 5 must classify as birdie, not par).
  * isHandicapEligible rejects mislabeled 9-holers (gross 52 as
    "18 holes" → the round that would've produced a +16.8 "handicap").
  Plus WHS small-sample table cases, the 20-round window, the 54.0 cap,
  and the real prod differentials (-0.3 / 12.2 / 9.5).
- All 25 green in ~140ms; no external services, so CI stays fast/hermetic.

Sprint 6 — migration hygiene + dead-code sweep:
- Migration hygiene: consolidated to ONE migrations dir. Moved stray SQL
  (database-migrations/, supabase/migrations/, 2 root fix-*.sql) into
  database/archive/loose-legacy/ via git mv (history preserved); removed
  the now-empty stray dirs. Added database/MIGRATIONS.md (canonical
  001-030 index + workflow + the migration-022 pg_proc lesson) and a
  loud database/archive/DO_NOT_RUN.md citing the tagging-broke-prod
  incident. Retires the "archived script breaks prod" hazard the surveys
  flagged twice.
- Dead code: deleted CreatePostModalSteps.tsx (imported by NOTHING) and
  EnhancedGolfForm.tsx (its only importer) — a dead parallel golf-entry
  path; active flow is CreatePostModal + GolfScorecardForm. Deleted root
  cruft clear-cache.html + run-sql-fix.html (zero references).
- Starter DNA: package name ai-starter → edge-athlete; README rewritten
  (was Codespaces boilerplate → real project quick-start). (APP_NAME
  "AI Demo App" was already gone from the Sprint 1 .env.example rewrite.)
- Verified unused-ness by grep before every deletion; tsc/lint/test/
  build all clean after.

Sprint 6 — PWA installability baseline:
- app/manifest.ts → /manifest.webmanifest (name, standalone display,
  start_url /feed, blue theme, 192/512 + maskable-512 icons).
- Real PNG icons generated with sharp (Next bundles it) from a
  golf-flag SVG: icon-192/512, apple-touch-icon (180), maskable-512,
  favicon-32. Validated dimensions/format.
- layout.tsx metadata: manifest link, appleWebApp (installable on iOS),
  icon set; themeColor #ffffff → #2563eb so installed browser chrome
  tints to the app blue.
- Installability baseline only — NO service worker / offline scope yet
  (deliberate; that's a separate, larger investment).

Sprint 6 — auth-pattern consolidation:
- The hand-rolled `createServerClient(...)` + cookie-split boilerplate
  was copy-pasted into ~19 route files (the "two ways to authenticate"
  footgun the surveys flagged). Extracted ONE cookie-scoped client
  helper: getServerClient(request) in auth-server.ts; requireAuth now
  builds on it (DRY), plus a getServerAuth() convenience.
- Migrated 18 routes: deleted each local createSupabase[Server]Client
  fn + the @supabase/ssr import, swapped call sites to getServerClient.
  BEHAVIOR-PRESERVING: each route keeps its exact auth-check flow
  (return-based 401) and its RLS-vs-admin query-client choice unchanged
  — this is one correct cookie parser, not a security-model change.
  Verified account/delete (destructive) keeps supabaseAdmin cascade.
- Deleted src/app/api/followers-simple/route.ts — dead (zero callers)
  and the one route using a different cookies() pattern; removing it
  beat migrating it.
- Net: 506 deletions / 100 insertions across 19 files. Zero routes
  now construct createServerClient inline. tsc/lint/test/build clean
  (fresh .next); the one build warning is the documented-benign
  realtime-js/middleware one, unrelated.

## July 23, 2026 — Sprint 5: trust & support (items 1–3)

- Settings → Notifications tab LIVE (was a "Coming Soon" stub): toggle
  groups for the 10 in-app notification types, optimistic updates with
  revert, wired to the allowlisted PATCH that had zero clients since
  bug hunt #2. push/email toggles deliberately OMITTED — those delivery
  channels don't exist yet; no dishonest switches.
- Settings → Security tab LIVE: password change with current-password
  re-auth first (same pattern as DeleteAccountModal), pointer to the
  forgot-password flow.
- /contact page: public form wired to the previously caller-less
  /api/contact (rate-limited endpoint, SMTP-gated).
- /terms + /privacy: plain-language MVP legal pages describing what the
  app ACTUALLY does (Supabase/Vercel processors, visibility controls,
  deletion rights, handicap-is-an-estimate). NOTE: general template —
  real counsel review before large-scale launch.
- Footer links (Terms · Privacy · Contact) on the landing page and in
  the app drawer.

Sprint 5 item 4 — admin-lite:
- requireAdmin REWIRED: was checking a profiles.role column that doesn't
  exist (403'd for EVERYONE, incl. real admins) → now an ADMIN_EMAILS
  env allowlist (documented in .env.example). Right-sized for MVP; a
  roles system can replace it later.
- /dashboard REPLACED (was the legacy orphan with dead no-onClick
  buttons) with an admin console: message-reports triage queue
  (message_reports has been written since migration 019 with NOTHING
  reading it — reports went to a black hole) with status filters +
  reviewing/resolve/dismiss actions, and a user-lookup search. Renders
  a clean "admin access required" for non-admins.
- NEW GET/PATCH /api/admin/reports + GET /api/admin/users, both
  requireAdmin-gated.
- NOTE: needs ADMIN_EMAILS set in Vercel (+ .env.local) to grant access;
  without it /dashboard shows the not-authorized state for everyone.

Sprint 5 stretch — email notification digests:
- Migration 030: notification_preferences.last_digest_at watermark.
  VERIFIED LIVE (after Tom ran it): column present + readable, null on
  both existing rows (correct for a fresh add), zero opted-in users
  (email_enabled false by default). Cron query path functional.
- EmailService.sendNotificationDigest (HTML + text); ALSO hardened the
  pre-existing contact email — it interpolated raw user name/email/
  message into HTML (stored-XSS-in-email). New escapeHtml() helper
  applied there + in the digest.
- GET /api/cron/notification-digest: Bearer CRON_SECRET required (not
  publicly callable — it sends mail); SMTP-not-configured → no-op
  success; per-user try/catch so one failure never stops the batch;
  advances last_digest_at even on 0-new so the window never re-scans;
  batch cap 200/run.
- vercel.json crons: daily 14:00 UTC.
- NotificationSettings: "Daily email digest" opt-in toggle (separate
  Email section; email_enabled already in the PATCH allowlist since
  bug hunt #2; off by default).
- .env.example: CRON_SECRET + NEXT_PUBLIC_APP_URL documented.
- Needs to go live: run migration 030; set CRON_SECRET +
  NEXT_PUBLIC_APP_URL + SMTP_* in Vercel. Without SMTP the whole thing
  is a clean no-op.

Admin-lite (item 4, closes Sprint 5):
- requireAdmin REWIRED: it checked a profiles.role column that doesn't
  exist (always 403'd). Now an ADMIN_EMAILS env allowlist (comma-
  separated, server-only, case-insensitive)

## July 23, 2026 — Sprint 4 kickoff: first-run onboarding

- Migration 029: profiles.onboarded_at + backfill (= created_at) so
  ONLY fresh signups see the wizard. VERIFIED LIVE (after Tom ran it):
  column present, backfill = created_at on both existing profiles,
  zero NULLs remaining. Existing users skip the wizard entirely.
- NEW /onboarding: 3 skippable steps — (1) avatar upload (reuses
  /api/upload/avatar, client-side type/size validation, preview),
  (2) find golfers (reuses ConnectionSuggestions compact), (3) "Log
  your first round" → /feed?create=1 or plain feed. Progress dots,
  back navigation, every screen skippable. Finish/skip stamps
  onboarded_at via PUT /api/profile then refreshes the auth context.
  Race guard: the already-onboarded redirect is suppressed while
  finishing (refreshProfile would otherwise override the destination).
- Landing page redirect: logged-in users route by onboarded_at
  (waits for the profile row — no guessing).
- Feed deep link: /feed?create=1 opens the composer (read via
  window.location in an effect, NOT useSearchParams — the page is
  statically prerendered and must not need a Suspense wrap); param
  cleaned from the URL after opening.

Golf-first empty states:
- Feed empty state: "Your feed starts with a round" + green "Log your
  first round" primary CTA (was generic "Create First Post").
- Rounds list empty state links to /feed?create=1.

Course search — "courses you've played" layer:
- GET /api/golf/courses now merges REAL courses from logged golf_rounds
  ahead of the static-7/API results: requester's own courses first,
  then platform-wide, deduped by name, max 5, rating/slope/par/location
  auto-fill from the most recent round there. No fabricated data —
  improves as the platform grows. selectCourse degrades gracefully
  (history entries have holes: [] → keeps default hole grid).
  Query shape verified live (searching "eagle" surfaces Eagle Creek
  with 70.3/128 auto-fill).

Mobile quick entry:
- ScoreEntryModal gains startingHoleNumber (back-9 rounds label holes
  10-18 correctly, incl. jump grid).
- GolfScorecardForm: "Quick entry" button in the scorecard header opens
  the same hole-by-hole stepper shared rounds use (big tap targets,
  progress bar); maps in/out of holesData (fairway boolean ↔
  hit/left/right/na, GIR, putts). The full table remains for desktop
  preference — one entry UX across individual and shared flows.

## July 23, 2026 — Sprint 3 kickoff: Golf Trends dashboard

- NEW GET /api/golf/trends: chronological per-round series (to_par,
  putts_per_hole, fir/gir pct) + summary aggregates (avg-to-par last 5 /
  all, best round, avg putts/hole, avg FIR/GIR). Stored 0% FIR/GIR
  treated as UNTRACKED (nulls, excluded from charts) — validated against
  prod data where FIR is 0 on every round because nobody tracks
  fairways yet. Filters: holes 9/18, last N (max 200). Privacy-gated.
- NEW TrendLineChart component: plain SVG, zero dependencies (skipped
  recharts — lighter + full spec control). Built per the dataviz skill:
  2px line, 4px markers with surface ring, recessive grid, first/last
  date labels, crosshair + tooltip with full-column hit targets (mouse +
  touch), dashed NEUTRAL 5-round rolling-average overlay (derived
  reference line — direct-labeled + legend + dash pattern, identity
  never color-alone). Palette validator run: green passes all checks;
  gray's chroma-floor flag is intentional (neutral derived overlay, not
  a categorical series).
- NEW /app/sport/golf/trends page: 4 stat tiles (avg to par last 5,
  best round, putts/hole, avg GIR) + 4 single-axis charts (score to par,
  putts/hole, FIR%, GIR% — separate charts, never dual-axis), one
  filter row (all/18/9 × last 10/25/all-time), per-chart and page-level
  empty states, honest footnote about 9-vs-18 comparability. Rounds
  list = the table view (linked).
- Entry points: Trends link on rounds list header + profile Recent
  Activity (golf).
- Verified with REAL prod data through the exact API + chart math:
  9 points, domain -1→+16, rolling avg 5.8→7.0, zero out-of-bounds
  coords. Visual phone check pending (on Tom's list).

Computed handicap slice:
- NEW lib/golf/handicap.ts: WHS-style scoreDifferential + handicapIndex
  (lowest-N-of-20 with the full WHS small-sample table, 54.0 cap),
  formatHandicapIndex (+X.X for plus handicaps). Clearly documented as
  an ESTIMATE (no ESR/PCC/adjusted-gross).
- Data-hygiene guards, PROVEN NECESSARY by prod data: 18-hole gross
  >= 55 (world record) + differential >= -10. Without them, a
  mislabeled 9-hole round (gross 52 stored as 18 holes) produced a
  -15.8 differential → +16.8 "handicap". With guards: only the 3 real
  18-hole rounds qualify → +2.3 estimate (faithful WHS small-sample
  behavior: 3 rounds = lowest 1 diff − 2.0).
- Trends API: handicap computed on its own light fetch (independent of
  page filters, 18-hole-only by definition); handicapSeries = index
  recomputed after each eligible round for the chart.
- Trends page: handicap tile (first position, shows rounds counted) +
  full-width "Handicap index (estimated)" chart (no rolling overlay —
  the index is already smoothed); explainer card when <3 eligible
  rounds telling users to log rating & slope; footnote updated.
- Hand-verified the math against prod rounds (differentials -0.3/12.2/
  9.5 from gross 71@71.4/133, 83@69.5/125, 80@69.5/125).

Shared-round notifications slice (closes the social loop):
- Migration 028: extends notifications type CHECK with 'group_invite' +
  'group_update' (same pattern as 012's new_message). VERIFIED LIVE
  (after Tom ran it): group_invite + group_update inserts 201, bogus
  type still 23514, existing types unaffected, test rows cleaned. The
  shared-round social loop is LIVE.
- NEW lib/golf/group-notifications.ts: notifyGroupInvites (invitees,
  never creator), notifyAttestation (creator hears confirmed/declined/
  maybe), notifyScoresPosted (creator hears scores; when ALL confirmed
  participants have scored → one-time 'leaderboard final' fan-out to
  every confirmed participant, deduped via metadata marker, skipped for
  <2 confirmed). All best-effort; self-notify guards throughout.
- Wired: group-posts POST (invites, with deep-link action_url to the
  feed post — captured its id at creation), attest route (creator
  notify), scorecards/[id]/scores POST (scores + completion). Direct
  inserts (create_notification's gate would drop unknown types).
- Bell + notifications page: golf-ball / trophy icons for the new
  types; text falls back to the server-built titles (014 convention).

## July 23, 2026 — Sprint 2: round detail page is REAL

- NEW /api/golf/rounds/[roundId]: GET (owner or profile-viewable; 404 not
  403 for hidden), PATCH (owner-only hole upsert on round_id+hole_number
  with strict validation, then calculate_round_stats recalc), DELETE
  (owner-only; holes cascade, posts.round_id SET NULL so posts survive).
- Rewrote /app/sport/golf/rounds/[roundId]/page.tsx: replaced the
  hardcoded Math.random() Pebble Beach mock with real data; Edit is now
  INLINE hole editing (score/putts/FIR-cycle/GIR-toggle per row, 40px+
  targets, numeric keyboards) — the seed of future live scoring; Delete
  wired with ConfirmModal; partial-round badge; FIR denominator from
  par>3 holes (was hardcoded /14); conditions row; mobile edge-to-edge
  scroll table; dead /login redirect fixed to /.
- Query shape verified live against production (first real round found
  is a 9-hole Eagle Creek round — partial-round path exercised by real
  data).

Group golf flow — mobile + perf slice (from dedicated audit):
- Mobile: legends + summary rows now wrap at 375px (QuickView, FullCard,
  MultiPlayerScorecardGrid); participant-row badges/scores flex-shrink-0
  protected; tap targets fixed (remove-participant chip, FullCard "Add",
  modal × closes → 44px); ParticipantAttestationModal scrollable
  (had NO max-h — long invites overflowed off-screen); dead "Manage"
  button in QuickView now opens the full card.
- Visual: under-par color standardized to green across all shared-round
  surfaces (was blue in QuickView + leaderboard, green elsewhere).
- Perf: score save no longer window.location.reload()s the entire feed —
  targeted single-post refetch swaps the updated scorecard into local
  state (also the seam live scoring needs); MultiPlayerScorecardGrid +
  PostCard memoized (grid re-rendered on every keystroke of the 2146-line
  modal); shared-round creation steps 2+3 (scorecard + scores) now run
  in PARALLEL after group-post create (was a 3-await waterfall), and
  score-save failures surface a toast instead of silent console.error.

Feed batching + golf domain library slice:
- GET /api/posts list enrichment BATCHED: golf rounds, group scorecards,
  and tagged profiles now fetch as 3 .in() queries for the whole page
  (was up to 3 queries PER POST — a 20-post feed of shared rounds cost
  ~60 round-trips, now 3). Query shapes verified live via PostgREST.
- Single-post branch (?postId=) now enriches group_scorecard too — it
  never did, which would have broken PostCard's targeted refetch after
  score entry (the shape is shared, so feed and refetch agree).
- NEW lib/golf/scoring.ts: holePar/classifyScore/toParLabel/
  toParColorClass/calcPlayerTotals + SCORE_CELL_FILL/RING style maps.
  Single source of truth for scoring math that was duplicated (with
  par-4 hardcodes) across MultiPlayerScorecardGrid, SharedRoundFullCard,
  ScoreEntryModal, and CreatePostModal's preview. This is the foundation
  for future live scoring + game formats (formats = scoring strategies).
- NEW lib/golf/scorecard-transform.ts: GROUP_SCORECARD_SELECT + the
  CompleteGolfScorecard transform, shared by both API branches.
- All 4 consumers migrated. Bonus bug found during migration: the grid
  styled every cell against par 4 (a local `const holePar = 4` shadowed
  real hole data) — cells now classify against actual hole pars; the
  create-preview's to-par now uses real course/manual pars too.

Remaining audit backlog: converge the two scorecard-table
implementations; useSharedRound hook (Realtime seam); RoundTypeBadge/
StatusBadge shared components; "add myself" from auth context; lazy-load
hole_scores on expand (payload trim).

Rounds list page slice:
- NEW GET /api/golf/rounds: paginated round summaries (no hole detail),
  filters (holes 9/18, course ilike sanitized, year), sort, count-exact
  hasMore; own rounds default, others behind canViewProfile.
- NEW /app/sport/golf/rounds page: mobile-first round cards (score +
  to-par via lib/golf/scoring, putts/FIR/GIR chips, partial badge),
  debounced course search with stale-response guard, 9/18 filter,
  newest/oldest toggle, dedup'd load-more; filter-aware empty states.
- Entry point: "View all rounds →" link in profile Recent Activity
  header (golf tab).
- Verified live: 9 real rounds in prod. DATA NOTE: several rounds have
  holes=18 with par 36 and 9-hole-looking scores — users have been
  logging 9-hole rounds through the hardcoded-18 form. Confirms the
  9-hole entry fix as next priority.

Waitlist fix slice (closes Sprint 2):
- Migration 027: waitlist table (email + user_type club/league/fan/
  guest, UNIQUE pair, RLS enabled with NO policies = service-role only).
  VERIFIED LIVE (after Tom ran it): service-role insert 201, duplicate
  23505, CHECK rejects bad types, anon read empty + anon insert 42501
  (RLS holds), test row cleaned up.
- Route actually persists now (was a no-op discarding every lead from
  4 of 5 landing CTAs): normalizes email/type, validates against
  allowlist, duplicate signup = friendly success, non-dup errors 500.
- EmailService.sendWaitlistNotification: best-effort owner email on NEW
  signups when SMTP configured (never fails the request).

9-hole support slice:
- GolfScorecardForm: holeCount/startingHole state UNFROZEN (were
  setterless useStates hardcoding 18/front). New Holes selector
  (18/9) + Front 9 / Back 9 choice for 9-hole rounds. Course par
  auto-adjusts 72<->36 only when it matches the other mode's default
  (custom pars never stomped); activeTab synced so the table filter
  stays valid. Discovery: the rest of the form (12 filter sites, OUT/
  IN/TOTAL labels, actualIndex math, init effect) was ALREADY 9-hole
  and back-9 aware — only the two selectors were frozen.
- Also removed the Math.random() yardage jitter from hole init
  (deterministic placeholder yardages now).

## July 23, 2026 — Roadmap + Sprint 1 kickoff (CI gate, health, env docs)

Strategic assessment completed (3 survey subagents: product completeness,
production readiness, golf depth) → 6-sprint roadmap saved to
docs/ROADMAP_2026-07.md. Headline findings: blind in production (no
monitoring/tests/CI), golf loop doesn't compound (fake round-detail page,
no history list/trends/computed handicap), no password reset, waitlist API
is a no-op discarding 4 of 5 landing CTAs' leads, in-memory rate limiter
non-functional on serverless.

Sprint 1 slice 1 shipped:
- .github/workflows/ci.yml — typecheck + lint + build on push/PR
  (placeholder Supabase env for build; real values stay in Vercel).
- package.json: `typecheck` (tsc --noEmit) + `verify` scripts.
- /api/health — liveness + Supabase round-trip check (200/503) for uptime
  monitors. No auth; exposes only up/down + latency.
- .env.example rewritten — previously omitted ALL required Supabase vars
  (and Giphy) while documenting only optional ones; a fresh deploy
  following it could not boot.

Remaining Sprint 1 (needs Tom's account setup): Sentry (DSN), Upstash
Redis (rate limiting). No-external-deps items still queued: password
reset flow, upload temp/ fix, HSTS/CSP headers, comments/followers
pagination.

Verified: typecheck clean, lint clean, build exit 0 (68 routes now).

Sprint 1 slice 2 — password reset + email-confirmation UX:
- /forgot-password: resetPasswordForEmail with generic always-success
  response (no account-existence probing); rate-limit errors surfaced.
- /reset-password: PKCE code exchange (auto via browser client) with
  PASSWORD_RECOVERY/SIGNED_IN listener + brief session polling; invalid/
  expired-link state with re-request CTA; updateUser(password) →
  redirect to /feed. Handles the opened-in-different-browser PKCE case.
- Login form: "Forgot password?" link; "Email not confirmed" errors now
  detected and offer a one-click supabase.auth.resend — previously users
  with confirmation enabled were stuck at a generic login failure.
- NOTE: Supabase Redirect URLs already wildcard (site/**), which covers
  /reset-password on both prod and localhost.

Verified: typecheck clean, lint clean, build exit 0 (70 routes).

Sprint 1 slice 3 — hardening trio:
- /api/upload: removed the dead temp/ path fallback (files always under
  the authenticated user's prefix); extension now derived from the MIME
  allowlist instead of the client filename (same fix the avatar route
  got July 22).
- vercel.json: HSTS (2y, includeSubDomains), Permissions-Policy
  (camera/mic/geo off), and a Report-Only CSP (self + supabase +
  giphy connect-src; frame-ancestors none). Report-Only = observe
  violations in console before enforcing.
- Unbounded-query caps: /api/comments paginated (default 100, max 200,
  hasMore/nextOffset added — response shape backward compatible);
  /api/followers followers+following branches capped (default 200,
  max 500, limit/offset params).

Sprint 1 remaining: Sentry + Upstash rate limiting (blocked on account
credentials from Tom).

Verified: typecheck clean, lint clean, build exit 0.

## July 22, 2026 — Maintenance checklist + sync (end of session)

- `npm run lint` — zero warnings/errors.
- `npm run build` — exit 0 from a fresh `.next`, 67 routes. The one known
  benign warning (@supabase/realtime-js referencing process.versions in
  the Edge Runtime import trace via @supabase/ssr in middleware) remains
  documented and non-blocking.
- Session totals: migrations 023–026 shipped AND verified live (golf_mode
  dropped, unread RPC created + joined_at floor, tag trigger fixed —
  tagging restored in production); full mobile responsiveness audit fixed
  across HIGH/MEDIUM/LOW; bug hunt #2 (messaging + notifications): 7 HIGH
  + 7 MEDIUM + 14 LOW fixed; bug hunt #3 (posts + profiles): 9 HIGH + 25
  MEDIUM + 17 LOW fixed. ~80 fixes total, each tier verified with
  tsc/lint/build before push.
- Working tree clean, main in sync with origin. This entry is the
  maintenance-log commit. Pushed main → GitHub → Vercel auto-deploy.

## July 22, 2026 — Bug hunt #3 (posts + profiles, 2 subagents): HIGH fixes

9 CONFIRMED HIGHs fixed (4 profiles, 5 posts):

Profiles:
- "Remove Fan" was 100% broken: clients sent followerId but the hardened
  follow API ignores body followerId (session-anchored) → always 400
  "Cannot follow yourself". Added explicit action:'remove_fan' (session
  user must be the FOLLOWED side); both clients updated.
- /api/followers leaked private profiles' full social graph to any
  authenticated user (admin client, no gate) → canViewProfile gate on
  followers/following for non-self profileId.
- Search leaked private profiles' posts (post-level visibility only was
  checked; author visibility never) → author-visibility filter added
  covering both full-text and ILIKE paths (= posts-hunt M8, same bug).
- Public profile weight double-converted: weight_display (already in
  display units) was passed through formatWeightWithUnit (expects kg) —
  150 lbs rendered as "331 lbs". Now raw display like the own-profile page.

Posts:
- GET /api/posts?postId= (the endpoint PostDetailModal/ProfileMediaTabs
  actually use) had NO privacy gate on the admin client — anyone with a
  UUID could read private posts incl. media + hole-by-hole data. Gate now
  mirrors the list branch exactly (own / public+public / accepted
  follower), 404 not 403.
- Editing a post wiped its tagged people: EditPostModal sent `tags`
  (ignored), PUT defaulted taggedProfiles=[] and overwrote. PUT now only
  writes tags when taggedProfiles is explicitly provided; removed the
  modal's misleading category-tags UI (chips vs profile UUIDs — could
  never match, only corrupt).
- Shared-round scores silently discarded: participant-scores insert
  included par/distance_yards columns that don't exist in live
  golf_hole_scores (verified 42703) → columns dropped; failures now
  tracked and all-failed returns 500 instead of success:true.
- Shared golf rounds NEVER appeared in feed: nothing created a posts row
  with group_post_id (live check: group_posts has 0 rows ever). POST
  /api/group-posts now creates the feed post.
- group_scorecard shape mismatch would crash PostCard the moment the
  above fix landed: raw group_posts row shipped where components expect
  CompleteGolfScorecard → GET now transforms ({group_post, golf_data,
  participants:[{participant:{...profile}, scores:{...hole_scores}}]}),
  with a safe default scores object for scoreless participants.

Verified: tsc clean, lint clean, build exit 0. MEDIUM/LOW next.

MEDIUM fixes (same day, 25 items — all CONFIRMED):

Profiles (14):
- /api/profile GET: athlete_id → profile_id on badges/highlights/
  performances (verified live: no athlete_id column anywhere) — public
  profiles can now actually show badges.
- /api/profile GET: non-owner responses also strip birthday/gender/
  postal_code/nickname (PII the UI never shows others).
- /api/profile PUT: strips handle/handle_* /avatar_url from mass-assign;
  derives weight_kg from weight_display+unit (fixes the /u-page weight
  schism); middle_name added to ''→null list.
- EditProfileTabs: fields can now be CLEARED ('' sent instead of
  undefined); handle changes routed through /api/handles/update.
- /api/public/profile: post_media url/type → media_url/media_type (u
  pages showed "No public posts yet" forever); private branch returns
  profileId so "Become a Fan" links to /athlete/<id> (was handle → 500).
- FollowButton: reports server-accurate counts to parent (pending
  request no longer bumps the visible Fans count; cancel can't hit -1).
- FollowersModal: pending requests render "Requested" (includeStatus=
  true param on /api/followers, self only); clicking cancels cleanly;
  private-profile follow no longer shows instant "Unfollow".
- InlineEdit hoisted to module scope w/ context — was redefined every
  render, remounting the popup per keystroke (caret jumped to end);
  editing branch keeps field footprint so sm:absolute anchors to the
  field (popup could render off-screen at document top).
- Request-race guards: athlete/[id] (seq ref), u/[username] (cancelled
  flag), FollowersModal (seq ref).
- Media route pagination computed from RAW pre-filter page (Photos/
  Videos filters used to kill infinite scroll / duplicate tiles).
- Avatar upload: DB-update failure now 500 (+ uploaded file removed);
  old avatar file deleted after successful swap; MIME allowlist (no
  SVG), extension derived from MIME; storage writes via admin client.

Posts (11):
- Feed list now ships saved_posts/saves_count (bookmark tap was
  silently UNSAVING already-saved posts) + profile.handle.
- hasMore computed from raw pre-privacy-filter page (server) + feed
  uses it; Load More in-flight guard + id-dedupe on append.
- display_order: (sortOrder ?? index)+1 — first two media items shared
  order 1 and could render swapped.
- Unpin scoped to ownership-verified post (any post owner could unpin
  comments on other people's posts).
- /api/tags GET: requireAuth + profile/post visibility gates (was fully
  anonymous admin-client tag enumeration incl. private posts).
- Same-day/same-course golf post reuses the round ONLY when it brings
  no new hole data (used to silently rewrite the first post's
  scorecard); round/hole insert failures now abort with 500 (+ round
  cleanup) instead of success-with-lost-scorecard.
- Share deep-links work: /athlete/<id>?post= opens PostDetailModal.
- Toast callbacks useCallback-stable (feed realtime channel was torn
  down/resubscribed every render — events in the gap were dropped).
- Like endpoint: existence + visibility gate (404, no UUID probing, no
  liking unviewable posts).

LOW fixes (same day, 17 items):
- Avatar validation/upload errors now surface via toast (were written to
  an error key nothing renders); social InlineEdits show their "Add ..."
  placeholders (formatSocialHandleDisplay's "—" is truthy).
- Suggestions: dismiss upsert onConflict (re-dismiss 500'd); suggestion
  only dismissed on actual follow (unfollow dismissed it too);
  FollowButton no longer force-redirects to /feed after following.
- Media route limit/offset NaN clamp; follow API 404s missing targets +
  caps message at 200 chars server-side; search full-text athlete
  mapping includes handle.
- EditProfileTabs: handle errors render (errors.handle, was .username);
  bio maxLength=500 enforced.
- handles/check derives currentUserId from the session when present.
- PostDetailModal reads post.likes (API field) — optimistic like state
  was always false in the modal; interface updated.
- UUID validation: GET /api/posts postId/userId, GET /api/comments
  postId (garbage → 400/404 instead of PostgREST 22P02 → 500).
- Comments: reply parent must belong to the same post; DELETE returns
  404 when RLS deleted 0 rows (was false success).
- Post DELETE removes media FILES from storage (best effort, managed
  paths only) — files were orphaned forever.
- scorecards/[id]/scores: entered_by forced to session user (was body-
  forgeable); PUT /api/posts preserves visibility when omitted (default
  'public' would silently flip private posts).
- RecentPosts.tsx deleted (dead code, zero importers, latent infinite-
  refetch loop).

Documented, NOT fixed: athletic-score staleness on own profile
(cosmetic, placeholder metric); NULL-visibility profiles excluded from
search results (safe default).

## July 22, 2026 — Bug hunt #2 (messaging + notifications, 2 subagents): HIGH fixes

7 CONFIRMED HIGHs, all fixed:

Messaging:
- NewConversationModal read `d.conversation.id` but the API returns
  `conversationId` → every new DM/group created server-side but never
  navigated to (modal just closed). Primary entry point broken.
- fans_only messaging permission was INVERTED (checked target-follows-
  sender instead of sender-follows-target): real fans got 403, people the
  target followed could bypass the setting.
- Group creation bypassed blocks + messaging_permission entirely — a
  blocked user could recreate contact via a 2-person "group". Group path
  now enforces the same block/permission rules as DMs (batched queries),
  plus UUID validation of participantIds (used to 500).

Notifications:
- TAGGING BROKEN IN PROD (confirmed live: 42703 'record new has no field
  tags'): archived fix-trigger-functions-schema.sql redefined
  notify_profile_tagged() for the posts table but the trigger fires on
  post_tags → /api/tags 500s; post-create tags silently dropped.
  Migration 025 recreates the function correctly (delegates to
  create_notification; preference-gated via tags_enabled).
- Preferences PATCH passed the raw body to update() on the admin client
  (mass assignment — could transplant rows onto victims). Now allowlisted
  to the 12 boolean columns; no client calls it yet, so zero breakage.
- /app/notifications (the page the bell links to) used a stale API
  contract: offset/unreadOnly params the API ignores → 'Load more'
  duplicated rows forever, default Unread tab showed everything; Accept/
  Decline gated on action_status that's never set; click handlers ignored
  action_url. Fixed by CONSOLIDATION: healthy /notifications page (uses
  the context, correct contracts, navigates via action_url) now lives at
  /app/notifications; /notifications redirects to it. Fixes H2+H3+M3+M5
  in one move with no DB change (the action endpoint accepts NULL
  action_status).

Verified: tsc clean, lint clean, build exit 0. Migration 025 pending
(needs to run in Supabase). MEDIUM/LOW batches next.

MEDIUM fixes (same day, 7 CONFIRMED):
- Deleted-message content no longer shipped in API responses (main list +
  reply previews) — UI hid it but the JSON contained full content.
- Shared-post enrichment now privacy-filtered (admin client bypassed
  posts RLS): owner-profile visibility AND post visibility enforced,
  follower checks cached per request; applied to top-level and
  reply-parent shared posts.
- Reaction broadcasts: receivers recompute `reacted` from the reactors
  list (sender's flags used to overwrite everyone's own-reaction state).
- Conversation list last-messages: per-conversation limit-1 parallel
  queries (unbounded .in() query silently truncated at PostgREST's
  1000-row cap → "No messages yet" on older conversations).
- GroupSettingsModal search: activeParticipants memoized (fresh array
  identity re-triggered the debounce effect in an infinite ~300ms loop).
- markConversationRead reads unread from a conversationsRef (mount-time
  stale closure could underflow the badge, hiding other convos' unread).
- Media captions: image/video messages now render their text content
  (was saved but never displayed anywhere).
- Realtime notifications: INSERT enriches actor profile (was "Someone"
  + generic icon); UPDATE merges instead of replaces (kept actor) and
  decrements the badge on unread→read transitions (cross-tab/page sync).
- Comment likes now render "liked your comment" (comment_id discriminates;
  all likes said "liked your post").
- ChatWindow realtime INSERTs re-sort by created_at (out-of-order fetch
  resolution could misorder messages).

LOW fixes (same day, 14 items):
- Messages GET honors ?limit= (clamped 1-50) — ChatWindow's realtime
  limit=1 fetch used to pull 50 enriched messages per incoming message.
- Message POST validates type against the enum + UUID-shape checks on
  shared_post_id/shared_profile_id/parent_message_id (was 500 via DB
  CHECK); block/unblock UUID-validate blockedId.
- new_message notification fan-out skips blocked pairs (both directions)
  — blocks prevented DM creation but not group-message notifications.
- Participants add: already-active members excluded from the upsert
  (used to demote admins to member and reset joined_at).
- DM dedupe now finds conversations either side left and reactivates
  them (block→unblock or leave used to spawn a parallel duplicate DM).
- Unread counts floored at joined_at (migration 026 + route fallback +
  conversation list) — new group members were charged for full history.
- /messages/[conversationId]: ChatWindow keyed by conversation id.
- ReactionDetails closes via effect (was onClose() during render).
- NewConversationModal search: 300ms debounce + sequence guard.
- Notifications: mark-all-read/clear-all return real counts
  ({count:'exact'}); [id] PATCH validates is_read boolean and clears
  read_at on unread; preferences GET handles the 23505 first-call race.
- Notifications lib: reconnect timer cleared on unmount; refetch on
  SUBSCRIBED closes the fetch→subscribe gap (via ref to avoid channel
  churn); mark-all-read rollback resyncs badge from server instead of
  restoring a possibly-stale snapshot.

MIGRATIONS 025 + 026 VERIFIED LIVE (after Tom ran them):
- 025: the exact post_tags insert that 42703'd now returns 201 and the
  trigger creates a correct notification (type/user/actor/post/title).
- 026: just-joined + never-read participant counts 0 (old logic: 7);
  joined-before-history + never-read counts 7 (correct); state restored
  exactly. Tagging is functional in production again.

Documented, NOT fixed (PLAUSIBLE-only or zero observable effect):
- M9: soft-delete UPDATE events may not reach other participants
  (Realtime RLS behavior — needs runtime verification; refetch corrects).
- M10: MessageInput + TypingIndicator subscribe the same typing: topic on
  one client; Phoenix may close the prior channel (needs runtime verify).
- notif-M6: create_notification's gate has no comment_reply/team_update
  branches — but nothing creates those types anyway; revisit when comment
  reply notifications are actually built.

## July 22, 2026 — Mobile responsiveness audit (3 subagents) + HIGH fixes

Ran three parallel read-only audits: core pages; shared components; nav/
messaging/settings. Foundation verified solid (viewport export with
zoom allowed + viewportFit cover, safe-area helpers, iOS 16px input rule).

HIGH (all fixed):
- /athlete/[id] public profile never got the mobile treatment its sibling
  /athlete (own profile) has — header locked side-by-side (no stacking),
  fixed 192px avatar, 5-col stats grid with no mobile base. At 375px the
  info column had ~87px. Fixed by mirroring own-profile patterns:
  flex-col sm:flex-row, w-32→sm:w-40→lg:w-48 avatar, grid-cols-2
  md:grid-cols-5 (border-l dividers now md:-only), plus flex-wrap on
  name/handle + follow-stats rows, min-w-0 text column, responsive h1.
- ReactionBar add-reaction popover hardcoded left-0 while own messages
  render right-aligned → 288px picker opened off-screen at 375px. Now
  honors the existing align prop (same pattern as ReactionDetails).

MEDIUM (all fixed, same day):
- /athlete own profile: InlineEdit popup now viewport-centered on mobile
  (fixed sm:absolute + max-w clamp; was min-w-[280px] centered over
  ~130px vitals cards, clipping at screen edges); vitals/social sections
  px-4 sm:px-8; social row flex-wrap.
- EditProfileModal badge editor: grid-cols-1 sm:grid-cols-12 (spans made
  sm:-only — col-span-N on a 1-col grid creates implicit columns).
- ScoreEntryModal hole-jump: grid-cols-6 sm:grid-cols-9 (29px→~46px
  touch targets at 375px).
- PostCard caption: break-words (long URLs/hashtags forced horizontal
  scroll of the whole card).
- Notifications page (/notifications) 5-tab bar: overflow-x-auto +
  whitespace-nowrap flex-shrink-0 tabs.
- MessageBubble long-press quick-react row: w-8→w-9 buttons (44px would
  overflow — 9 buttons ≈ 396px > 375px viewport), flex-wrap + max-w
  clamp as guards. MultiSportActivity view/edit/delete icons: p-2.

LOW (fixed, same day):
- PostCard media carousel: touch swipe added (50px threshold; arrows kept).
- SharePostModal + GifPickerModal bottom sheets: .modal-sheet-bottom
  safe-area class; GifPickerModal 70vh→70dvh.
- Emoji pickers (EmojiPickerButton + MessageBubble full picker):
  width min(300px, calc(100vw-2rem)) — no more edge spill.
- Touch-target bumps: MessageInput emoji/GIF/attach p-2.5, send w-11
  (44px); ConversationList new-conversation w-10; ReactionBar chips py-1,
  add-button w-7.
- Copyright year now dynamic (goodbye page said 2025, AppHeader 2026).
- Own-profile h1 text-3xl sm:text-4xl.

Deliberately NOT changed: hover-only thumbnail overlays (u/[username],
ProfileMediaTabs) — both auditors confirmed no info is lost (tiles tap
through to the full post); the only CSS-only "fix" would permanently
darken every thumbnail on mobile.

Well-handled (verified): golf scorecard tables (overflow-x-auto + sticky
columns everywhere), all modals (max-h + inner scroll), messages two-pane
collapse + dvh + composer above keyboard, notification dropdowns
(calc(100vw-1rem) cap), header/drawer at 375px, settings tabs.

Verified: tsc clean, lint clean, build exit 0 (67 routes).

## July 22, 2026 — Migration 023 verified live + migration 024 (unread RPC)

Verified 023 against production Supabase after Tom ran it:
- golf_mode gone (42703 on select), activity_mode serving data.
- Post insert with activity_mode works (test row inserted + deleted).
- RPC smoke test: get_profile_media_counts, calculate_round_stats,
  check_handle_availability, search_posts, search_profiles all pass.

NOTE: 023 was run in Supabase BEFORE the code push (reverse of the documented
order) — brief window where golf-post creation would have 500'd. Closed by
deploying 9c1d8a6; no lasting impact.

Sweep finding → migration 024: get_unread_message_count RPC was called by
/api/messages/unread-count but NEVER defined in any migration. The route's
silent fallback masked it — every unread-badge poll errored (PGRST202) then
ran an N+1 count loop per conversation. 024 creates the RPC (single aggregate,
matches fallback semantics exactly, SECURITY DEFINER + empty search_path,
force-drop-overloads pattern from 022). No code change needed — route already
prefers the RPC.

024 VERIFIED LIVE (after Tom ran it): RPC returns 0 matching manual fallback
count for both real users; back-dated last_read_at → 7 (correct); NULL
last_read_at → 7 (never-read branch correct); original timestamp restored
exactly. Unread-badge endpoint now takes the single-aggregate fast path.

## July 22, 2026 — Drop posts.golf_mode (migration 023)

Completes the schema cleanup started in migration 020. activity_mode has been
live and stable since July 17; the golf_mode rollback window is over.

- Code: removed the golf_mode dual-write from `src/app/api/posts/route.ts`
  (only writer; zero readers). Kept the defensive activity_mode retry —
  harmless and guards against migration-lag ordering mistakes.
- DB: `023_drop_golf_mode.sql` drops the column. No CASCADE — hidden
  dependencies fail loudly. Pre-flight includes a pg_proc scan for live
  function bodies referencing golf_mode (the migration-022 lesson: Postgres
  doesn't block DROP COLUMN on functions; they break at runtime).

ORDER: deploy this code FIRST, then run 023 in Supabase (reverse of 020's
ordering — old code dual-writes the column, so dropping it first would 500
golf post creation).

Verified: lint clean, fresh build exit 0 (67 routes).

## July 17, 2026 — Maintenance checklist + sync

- `npm run lint` — zero warnings/errors.
- `npm run build` — **exit 0**, 67 routes, clean from a fresh `.next`. One
  benign, pre-existing NON-CRITICAL warning remains: `@supabase/realtime-js`
  references `process.versions` (Node API) in the Edge Runtime import trace,
  pulled in transitively by `@supabase/ssr` in `src/middleware.ts` (auth).
  Does not fail the build or deploy; left untouched to avoid destabilizing the
  auth middleware (a documented Next.js + Supabase interaction).
- Working tree already in sync with origin (bug-hunt fixes pushed
  5c31b88..19300f3). This entry is the maintenance-log commit.
- Pushed `main` → GitHub → Vercel auto-deploy.

## July 17, 2026 — Proactive bug hunt (2 subagents) + 9 fixes

Ran two thorough read-only bug-hunt subagents (React components; API routes +
stat-line feature) after the pattern of latent bugs. Triaged + fixed:

HIGH:
- features.ts FEATURE_SPORTS missing basketball/soccer/baseball (my regression
  from the 3-sport add) → their profile highlight cards showed 'Coming Soon'
  despite being fully wired. Now synced to the registry.
- PostCard 'Add scores': POSTed group_post id where the endpoint expects the
  participant id → score entry failed 100%. Now uses scoreEntryParticipantId.
- feed realtime: no dedup (own post rendered twice, React key error) + filter
  was all-public (every stranger's post injected). Now dedups + follow-scoped.

MEDIUM:
- api/posts GET .single() → 500 on missing post (404 branch was dead) → maybeSingle.
- api/posts limit/offset parseInt NaN guard (?limit=abc → 500) → clamped.
- ProfileMediaTabs race: out-of-order responses overwrote the grid → request-seq guard.
- media counts: equipment/vitals badges always 0 (RPC doesn't cover those
  tables) → endpoint now counts them, privacy-gated.

LOW:
- StatLineCard 'Invalid Date' guard; parseInt NaN guards in notifications/
  suggestions/golf-courses routes.

Deliberately NOT fixed (documented): NotificationsDropdown has stale API
contracts but is DEAD CODE (not rendered anywhere — NotificationBell is the
live one); post deep-links (?post=) don't auto-open (UX enhancement, not a
bug). Both are safe to leave.

Verified: each fix tsc+lint clean, build exit 0; equipment/vitals counts +
NaN guard confirmed live. Pushed 5c31b88..d992519.

## July 17, 2026 — Media-counts hotfix RESOLVED

Migration 022 applied + verified live: `get_profile_media_counts` now returns
`{all:4, stats:2, tagged:1}` for the test profile via both the direct RPC and
the production endpoint (HTTP 200, no `game_id` error). Root cause of the
repeated failed applies: a stale/overloaded copy of the function that plain
`CREATE OR REPLACE` wasn't targeting — resolved by a DO block that drops ALL
overloads by name before recreating. These counts are per-profile by design
(media-tab badges on one athlete's profile), which matched the observed
numbers. Console error gone; production clean.

## July 17, 2026 — Hotfix: media-counts 500 (migration 020 fallout)

**Regression from migration 020.** Dropping posts.game_id/match_id/race_id
broke the `get_profile_media_counts()` RPC, whose body still referenced
p.game_id (the 020 audit checked app source, not in-DB function bodies) →
`POST /api/profile/[id]/media` (tab-badge counts) returned 500
("column p.game_id does not exist"). Media items still loaded (the other
three media RPCs were recreated cleanly by migration 018).

Fix (two parts):
- `database/migrations/022_fix_media_counts_dropped_columns.sql` — recreates
  the counts RPC with the stats-media definition = stats_data OR round_id
  (matches the 020 index; stat-line sports flow through stats_data). **User
  must run this in Supabase SQL Editor for real counts.**
- Code resilience (deployed): the counts endpoint now degrades to
  `{all:0,stats:0,tagged:0,degraded:true}` (HTTP 200) on RPC error instead of
  500 — no console error in the gap before 022 is applied.

Verified: only get_profile_media_counts was affected (all/stats/tagged RPCs
tested OK; no views/triggers reference the dropped columns). Endpoint returns
200 degraded locally against the still-broken RPC. Lint + build clean.

## July 17, 2026 — Maintenance & Deploy

Full maintenance checklist run before syncing to production:
- `npm run lint` — zero warnings.
- `npm run build` — clean from a fresh `.next` cache, exit 0, 67 routes.
- Working tree clean; 20 feature/fix commits from this session.
- Pushed `main` → GitHub (`tomkazhikkachalil/edge-athlete`) → Vercel auto-deploy.

Deploying: 7 sports live, Explore page, sport-aware profiles, schema
cleanup (migration 020 applied), and **15 security fixes** (10 HIGH + 2
MEDIUM + 3 RPC private-profile leaks — all verified). See the session detail
below and `docs/SECURITY_AUDIT_2026-07-17.md`.

Post-deploy reminders (not blocking): review + apply
`database/migrations/021_rpc_visibility_hardening.sql` (SQL defense-in-depth
for the RPC leaks already closed at the API layer); composer extraction
deferred (tech-debt, do interactively).

## July 17, 2026 (continued) — Autonomous Build-Out Session

**Mode change:** User granted full autonomous mode — no per-change confirmations; stop only for anything that costs money.

### Migration 020 status — NOT applied (defensive fix shipped)
User ran 020 in the SQL Editor but live verification shows it did not land
(`posts.activity_mode` absent, dead tables still present; Postgres 42703, not
cache lag). Likely causes: wrong project in the dashboard (app uses ref
`htwhmdoiszhhmwuflgci`), the script errored + rolled back, or wrong file
pasted. **Code is now safe either way:** `api/posts` retries the insert once
without `activity_mode` on 42703/PGRST204 (`27a0b25`). **020 still needs to
run — see Pending Actions below.**

### Phase B — Sport dispatch seams (`ceb51ed`)
- PostCard 1030 → 612 lines: inline golf scorecard + stats block extracted
  verbatim to `golf/GolfRoundCard` + `golf/GolfStatsSummaryCard`, dispatched
  via new `SportPostBody` keyed on `sport_key`.
- `SportRegistry`: new `getPrimarySports()` + `TEASER_SPORT_KEYS`;
  `MultiSportActivity`/`MultiSportHighlights` now registry-derived (no
  hardcoded sport lists); activity-row nav generalized to
  `/app/sport/[sport_key]/activity/[id]`.

### Ice hockey + volleyball LIVE end-to-end (`85840a8`)
**Stat-line architecture** — zero DDL: sports whose per-game data fits a stat
line store `{type:'stat_line', sport_key, date, opponent, result, stats}` in
`posts.stats_data`. Single source of truth `src/lib/sports/stat-schemas.ts`;
composer form (`StatLineForm`), feed card (`StatLineCard` via `SportPostBody`),
profile highlights/activity (`StatLinePostAdapter` + `/api/sports/stat-lines`),
and media-tile summaries all derive from it. Adding another stat-line sport =
schema + registry enable. Both sports enabled in `SportRegistry`;
`api/posts` postType allowlist now derives from registry-enabled sports.
Activity detail page renders stat lines (was "coming soon"). The stat-lines
API enforces owner-vs-public visibility (stricter than the golf sibling —
noted as a gap to backport). Full decision record in
`docs/MULTI_SPORT_ROADMAP.md`.

### Explore page (`ae1902a`)
New `/explore` + `/api/explore`: browse-first discovery — sport filter chips
(registry-derived), responsive athlete grid, recent public activity. Public-
only server-side (posts by private-visibility authors excluded). Added to
AppHeader nav. Queries validated live against Supabase.

### Pending Actions (user)
1. ~~Run migration 020~~ ✅ **APPLIED + VERIFIED** (second attempt, July 17):
   dead columns/tables gone, `activity_mode` backfilled 17/17 posts, zero
   mismatches. `golf_mode` retained until 021 as designed.
2. **Push to deploy** when ready — all work is committed locally on `main`;
   nothing has been pushed.

### SECURITY — full API auth audit + 12 fixes (subagent-driven)
Systematic sweep of all 67 API routes found the IDOR/leak class widespread.
Fixed 10 HIGH + 2 MEDIUM:
- HIGH (`b340147`,`ec30cec`,`efabbeb`): profile GET/PUT, golf/stats,
  performances POST+DELETE, season-highlights, follow, posts/like,
  upload/avatar, upload/post-media DELETE, equipment GET — all were
  RLS-bypassing admin client + no auth (IDOR writes/deletes + private-data
  reads). Now require auth, derive actor from session, ownership/privacy
  checks. All 8 batch endpoints verified 401 unauth via local prod server.
- MEDIUM: vitals GET (public profile leaked private training posts → now
  visibility-filtered for non-owners); ai/text + ai/image (unauthenticated
  PAID OpenAI proxy → now require auth). Verified 401.
- MEDIUM batch: suggestions (auth+ownership), upload temp (auth), follow/stats
  (session viewer), posts/[id] (private-post gate), vitals training-posts,
  ai/text + ai/image (paid-proxy auth). All verified 401/gated.
- **RPC verification found 3 MORE real leaks** (behavioral test vs the live
  private profile): search_profiles, search_by_handle, and get_profile_*_media
  all returned PRIVATE profiles to anonymous users (name, avatar, handle,
  media). Closed at the API layer (`bd1de44`) — verified private-closed +
  public-still-works for anon. Defense-in-depth SQL hardening templated in
  `database/migrations/021_rpc_visibility_hardening.sql` (needs review — RPC
  bodies aren't in the repo). Full record: `docs/SECURITY_AUDIT_2026-07-17.md`.
- **Net security: 15 holes closed** (10 HIGH + 2 MEDIUM + 3 RPC leaks).

### Sport-aware public profile + /api/profile security fix
- `/api/public/profile` + `u/[username]`: golf-only stats card → generic
  `sportStats {label, tiles}` (golf: rounds/avg/best; stat-line sports:
  games + top stat totals from PUBLIC posts). (`d4cf9f6`)
- **Security (`b340147`):** `/api/profile` GET+PUT had no auth — PUT could
  update any profile by id (IDOR), GET leaked full PII (email/phone/GPA/
  SAT/DOB) for any id. Now require auth + ownership; PUT strips
  id/email/timestamps + validates user_type; GET privacy-shapes
  server-side (owner=full, viewer=minus-contact, blocked=minimal).
  Verified 401 on both unauth'd endpoints via local prod server.

### 3 more sports — basketball, soccer, baseball (`e998698`) → 7 total
Stat-line architecture validated: 3 sports added with zero DDL, no
component changes. New `profileTiles` (count/sum/avg) + `computeProfileTile`
fix profile-tile aggregation (PPG/RPG now correct per-game means, not
broken sums). Live-verified basketball averages via REST round-trip.

### Verification discipline
Ice hockey + basketball verified end-to-end against LIVE data (insert via
REST → read back → run through real type-guard/schema/aggregation logic →
delete test data → confirm DB restored). Not just build-green.

**End-of-session verification:** `npx tsc --noEmit` clean; `npm run lint`
zero warnings; `npm run build` exit 0 — 67 routes. 11 commits ahead of
origin (unpushed). 7 sports live: golf (deep tables), ice hockey,
volleyball, basketball, soccer, baseball (stat-line), + training.

---

## July 17, 2026

### Session Restart — Verification, Backup, Multi-Sport Audit + Schema Cleanup (Phase A)

**Housekeeping:**
- Verified repo clean + in sync with origin; lint zero warnings; fresh production build exit 0.
- Confirmed migration 019 (messaging polish) **was applied** to Supabase — `message_reports` table and `messages.edited_at` verified live. Completed the flagged follow-up: restored `edited_at` to the messages SELECT in `GET /api/messages/[conversationId]` (without it, the "edited" indicator was lost on page reload). Committed as `0db7d7b`.
- Full project backup created at `~/Desktop/edge-athlete-backup-2026-07-17` (12 MB, excludes node_modules/.next, includes git history + .env.local). User confirmed Supabase backups in place.

**Multi-sport audit (code via subagent sweep + DB via live PostgREST inspection):**
- DB reality: 43 tables, only 6 hold data (posts 17, profiles 2, golf_rounds 9, golf_holes 108, clubs 4, privacy_settings 2).
- `posts` coupling: `golf_mode` (write-only — set in one place, read by nothing), `round_id` (live, 10 posts), `game_id`/`match_id`/`race_id` (0 rows ever, 0 code refs — speculative columns from archived "future sports" migration).
- 5 dead tables: 0 rows AND 0 code refs (`athlete_season_highlights`, `athlete_performances`, `athlete_socials`, `hockey_game_data`, `volleyball_match_data`).
- `sport_settings`: schema correct (profile_id + sport_key + JSONB), fully generic API route — but written only by EditProfileTabs' golf tab and read by no rendering code → 0 rows.
- Adapter pattern governs only profile highlights + activity table; post pipeline, PostCard scorecard (~340 inline lines), composer, 5 read APIs, equipment all bypass it. Full findings + sport-#2 work list captured in **`docs/MULTI_SPORT_ROADMAP.md`** (new).

**Phase A implemented (user-approved, including destructive drops):**
- New migration `database/migrations/020_schema_cleanup_multisport.sql`:
  - A1: recreate `idx_posts_stats_media` without dead columns; drop `game_id`/`match_id`/`race_id` + their indexes.
  - A2: drop the 5 dead tables (verified 0 rows; verification queries embedded in the file).
  - A3: add `posts.activity_mode` (no CHECK — per-sport vocabulary scoped by `sport_key`), backfill from `golf_mode`, deprecation COMMENTs on both columns. `golf_mode` kept one release for rollback; drop scheduled for 021+.
- `src/app/api/posts/route.ts`: dual-writes `activity_mode` + `golf_mode` (`'round_recap'`) on golf posts; type updated with deprecation note.

**Verified:** lint zero warnings; production build exit 0.

**Pending action (user): run `020_schema_cleanup_multisport.sql` in Supabase SQL Editor BEFORE pushing/deploying** — the insert path now writes `activity_mode`, which fails if the column doesn't exist. Verification queries are at the bottom of the migration file.

**Next planned:** Phase B seams — extract PostCard golf scorecard to `components/golf/`, move `formatGolfStatsSummary` into GolfAdapter, consolidate the two sport registries, derive MultiSport components from `getEnabledSports()`. Then either Messaging Phase 2 or mobile pass.

---

## May 24, 2026

### Messaging Polish Phase 1 + Resilience Fixes + GIF-Reaction Refactor

Multi-iteration session covering three discrete pieces of work, all in the messaging stack. End-of-session: `npm run lint` zero warnings, `npm run build` exit 0 (incremental cache).

**Part 1 — Phase 1 messaging polish (edit, report, reactor popover, recents):**
- New migration `database/migrations/019_messaging_polish.sql` — adds `messages.edited_at` (nullable) and a new `message_reports` table (`id`, `message_id`, `reported_profile_id`, `reporter_id`, `conversation_id`, `reason` CHECK across spam/harassment/hateful/sexual/violence/other, `details`, `status` CHECK across open/reviewing/resolved/dismissed, `created_at`). RLS uses the project-standard wrapped `(select auth.uid())` form and reuses the existing `is_conversation_participant()` SECURITY DEFINER helper. Indexes on `(status, created_at desc)`, `reporter_id`, `reported_profile_id`.
- New API route `PATCH /api/messages/[conversationId]/messages/[messageId]` — sender-only edit, ≤15 min from `created_at`, text-only, not deleted; updates `content` + `edited_at`. Co-located in the same file as the existing DELETE handler.
- New API route `POST /api/messages/reports` — accepts message-level or profile-level reports; resolves `conversation_id` + `reported_profile_id` from the target message server-side rather than trusting the client; rejects self-reports.
- `GET /api/messages/[conversationId]` — reactions aggregation now populates a `reactors` array per emoji so the "who reacted" popover can render without a follow-up GET.
- POST reactions toggle — same reactor enrichment so cross-user realtime broadcasts carry the same shape.
- New `src/components/messages/ReactionDetails.tsx` — popover listing reactors (avatar + display name), emoji tabs, outside-click + Escape close.
- New `src/components/messages/EditMessageInline.tsx` — inline textarea swap, Enter saves / Esc cancels, server-mirror 15-min/text-only gating.
- New `src/components/messages/ReportMessageModal.tsx` — radio reasons + optional details, submit toast confirmation, body-scroll lock while open.
- `src/components/messages/MessageBubble.tsx` — Edit (own text <15 min) + Report (others') entries in the action menu; "edited" suffix near timestamp; swaps to `EditMessageInline` in edit mode; action menu always visible so Report is reachable on every incoming message.
- `src/components/messages/ReactionBar.tsx` — chips now expose a long-press / right-click → `ReactionDetails` popover (preserves click-to-toggle); the "+" picker shows a "Recent" emoji strip (last 16, MRU) backed by `localStorage` key `ea:msg:recentEmojis`; exports `rememberRecentEmoji` for the bubble's quick-react surfaces to share.
- `src/components/GifPicker.tsx` — Recent GIFs strip (last 12) backed by `localStorage` key `ea:msg:recentGifs`; promoted on selection from trending OR search results.
- `src/app/globals.css` — `ea-reaction-pop` keyframe (180ms scale bounce) and `ea-edit-pulse` (600ms soft shadow); both respect the existing `prefers-reduced-motion` block.
- `src/types/messages.ts` — `AggregatedReaction.reactors?: ParticipantProfile[]` and `Message.edited_at?: string | null`. Both optional → no breaking change for older payloads.

**Part 2 — Resilience fixes during Phase 1 verification:**
- `GET /api/messages/[conversationId]` defensive: `edited_at` removed from the messages SELECT so the route keeps working on databases where migration 019 hasn't yet been applied (the column will flow through via the realtime postgres_changes payload once the migration is in place). Reactor profiles are fetched via a separate `SELECT … FROM profiles WHERE id IN (…)` query instead of an FK-name-based embed — eliminates dependency on PostgREST schema-cache constraint names. Same defensive pattern applied to the reactions toggle endpoint.
- `src/lib/notifications.tsx` — added `isNotificationAPISupported()` guard at module scope; wrapped the realtime Notification constructor call in try/catch; replaced the unguarded `typeof window` check before `Notification.requestPermission()` with the new helper and `.catch()` for silent rejection. Root cause of "Something went wrong" screen on first load + every page nav was an unguarded `Notification.permission` access inside the realtime callback that threw `ReferenceError` in runtimes where the global `Notification` constructor is absent (older iOS Safari, in-app browsers, some embedded WebViews); the throw escaped to the route error boundary.
- `src/app/error.tsx` + `src/app/global-error.tsx` — surfaces `error.message` (truncated to 280 chars, monospace inline panel) in dev only (`NODE_ENV !== 'production'`). Future regressions diagnose themselves instead of hiding behind generic copy. Production still shows the polished "Something went wrong" card.

**Part 3 — GIF reactions render as standalone replies (not stacked under parent):**

Previously, GIF reactions used a separate `GifReactionBubble` component anchored to the *parent message's* side of the chat regardless of who sent the GIF — meaning the user's own GIF reactions appeared on the *other person's* side. Fixed by flattening GIF reactions into the main message stream so they render through `MessageBubble` with normal `isOwn` alignment plus a `QuotedReply` preview.

- `GET /api/messages/[conversationId]` — dropped the `.neq('type', 'gif_reaction')` filter from the messages SELECT; deleted the separate `gifReactionsResult` fetch and the `gifReactionsByParent` nesting; deleted the per-GIF-reaction emoji-attach loop. GIF reactions now flow through the same `reply_to` resolution as text replies (the existing `uniqueParentIds` block already covers any message with `parent_message_id`). The legacy `gif_reactions` field is intentionally omitted from the response payload. Also dropped `.neq('type', 'gif_reaction')` from the unread-count query — GIF reactions are real replies and should count toward the badge.
- `src/components/messages/MessageBubble.tsx` — new render case for `type === 'gif_reaction'` that renders the GIF media as a rounded image bubble; the existing `QuotedReply` block handles the parent reference. Deleted the `<GifReactionBubble>` block. Pruned unused props (`currentUserId`) and dead local state (`gifReactions = message.gif_reactions || []`).
- `src/components/messages/ChatWindow.tsx` — collapsed the realtime INSERT `if (gif_reaction) { … } return;` branch; flattened the optimistic-send in `handleGifReactSelect` to a plain prepend (with dedupe guard); simplified `updateMessageReactions`, `setMessageReactions`, the `reaction_update` broadcast handler, and `handleMessageEdited` to top-level searches only (no more nested gif_reactions lookups). Removed the `currentUserId={currentUserId}` prop from the `<MessageBubble>` call site.
- `src/components/messages/GifReactionBubble.tsx` — deleted. No remaining importers.
- Follow-up fix: `handleGifReactSelect` synthesizes `reply_to` client-side from the parent message in local state before prepending — matches the existing `handleSend` enrichment for text replies. Without this, the optimistic GIF reply rendered without the quoted preview (the POST endpoint returns the raw row only).

**Behaviour summary after the refactor:**
- Own text reply → right-side bubble + `QuotedReply` preview above (unchanged).
- Own GIF reply → right-side bubble + `QuotedReply` preview above (new).
- Their text/GIF reply → left-side bubble + `QuotedReply` preview above.
- Emoji reactions → still chips attached to the original bubble (unchanged).
- Realtime: incoming GIF replies arrive via the same fetch-full-and-prepend path as any other message — `reply_to` server-populated, no special handling.

**Verified:** `npm run lint` zero warnings. `npm run build` exit 0. New routes appear in route table: `/api/messages/reports`, PATCH on `/api/messages/[conversationId]/messages/[messageId]`. Net source delta: 5 new files, 7 modified, 1 deleted.

**Pending action (user):** apply `019_messaging_polish.sql` against Supabase. Until then, edit + report endpoints return 500 (defensive GET still works). Once applied, Phase 2 (per-message delivery + read receipts, online presence) is the next planned chunk per the messaging roadmap.

---

## May 23, 2026

### Production Maintenance Pass + Multi-Sport / Multi-Year Filter

Multi-iteration session covering four discrete pieces of work: foundation cleanup, mobile responsiveness, styling-system consolidation, performance code-splitting, and a new Sport + Year filter on Profile Media tabs. Build verified clean from a fresh `.next` cache at end of session.

**Part 1 — Foundation fixes:**
- `src/app/globals.css`: dropped dead `font-family: Arial` body override that was shadowing the next/font Inter applied via `layout.tsx`; removed unreferenced `--font-geist-*` vars; added `text-rendering`, font smoothing, and `-webkit-tap-highlight-color: transparent`
- `vercel.json`: removed no-op pass-through rewrite (`/(.*)` → `/$1`)
- Single `console.log` in `api/account/delete/route.ts` audited and kept (operational log for a destructive admin action)

**Part 2 — Mobile responsiveness:**
- `NotificationsDropdown.tsx` + `NotificationBell.tsx`: `w-96` was overflowing 375px-wide phones; switched to `w-[calc(100vw-1rem)] sm:w-96 max-w-[24rem]`
- `AppHeader.tsx`: added `safe-top safe-x` to the sticky header (the layout's `viewportFit: 'cover'` meant content was extending under the iOS notch); mobile drawer gained `safe-top safe-bottom`, widened to `w-72 max-w-[85vw]`, close-button hit area bumped to 44px via `p-2 -m-2`
- `globals.css`: new `.safe-top` / `.safe-bottom` / `.safe-x` / `.safe-y` utility classes for `env(safe-area-inset-*)` padding; mobile-only `input { font-size: 16px }` to prevent iOS auto-zoom on focus
- 23 modal dialogs left as-is — they already use `w-full max-w-X` patterns that adapt to phone widths; rewriting all of them to bottom-sheets was too risky for "don't break anything"

**Part 3 — Styling consolidation (modern, future-proof):**
- `globals.css` `@theme inline`: added semantic tokens — `--color-brand`, `--color-brand-hover`, `--color-brand-soft`, `--color-surface`, `--color-surface-muted`, `--color-border`, `--color-muted`, `--color-success`, `--color-danger`, `--color-warning`; radius scale (`--radius-sm` through `--radius-2xl`); z-index scale (`--z-sticky` through `--z-toast`)
- Global `:focus-visible` outline for keyboard-nav accessibility; `::selection` brand-color tint; `@media (prefers-reduced-motion: reduce)` block to disable animations for users with motion sensitivity
- Tokens are additive — no existing classes changed, so nothing visually drifted. Future code can use `text-brand` / `bg-surface-muted` etc.

**Part 4 — Performance code-split:**
- `next/dynamic` (with `ssr: false`) applied to heavy modals across `/feed`, `/athlete`, `/settings`, `/notifications` — `CreatePostModal` (2113 LOC), `EditProfileTabs` (1091 LOC), `EditPostModal`, `SeasonHighlightsModal`, `PerformanceModal`, `FollowersModal`
- First Load JS impact:
  - `/feed`: 225 kB → 195 kB (−30 kB / −13%)
  - `/athlete`: 257 kB → 249 kB (−8 kB)
  - `/settings`: 182 kB → 173 kB (−9 kB)
  - `/notifications`: 179 kB → 170 kB (−9 kB)

**Part 5 — Multi-Sport + Multi-Year filter on Profile Media tabs:**
- New migration `database/migrations/018_profile_media_sport_year_filters.sql` — drops + recreates `get_profile_all_media`, `get_profile_stats_media`, `get_profile_tagged_media` with two new optional array params (`filter_sport_keys TEXT[]`, `filter_years INT[]`). NULL = no filter. `get_profile_media_counts` intentionally untouched so tab badges stay stable when filters are active.
- New component `src/components/SportYearFilter.tsx` — controlled multi-select dropdowns with checkbox popovers, inline search (case-insensitive substring on label), `Escape` clears search then closes, outside-click closes, "Clear selection" per dropdown. Both dropdowns auto-focus search input on open.
- `src/app/api/profile/[profileId]/media/route.ts`:
  - GET handler parses `sportKeys` / `years` CSV query params and validates years against `1900 < n < 2200`
  - RPC payload is **conditional**: filter args only sent when non-empty so the call still resolves against the old 4-arg function signature when no filter is active (defensive degradation pre-migration)
  - Error log includes a migration-018 hint when filter args are present and the call fails
- `src/components/ProfileMediaTabs.tsx`:
  - State for `selectedSports` / `selectedYears` + URL param plumbing in `fetchMedia`
  - Dropdowns get static catalogs — `getAllSports()` from `sports-config.ts` sorted alphabetically, and years 2026 → 2000 generated at module load (auto-extends as years pass). The user wants the platform to feel multi-sport / multi-year regardless of the current athlete's post history.
  - Items count restyled from muted gray text to a brand-tinted pill (`bg-blue-50 text-blue-700 font-semibold` rounded-full)
  - New always-visible filter status row between filter row and items list — two states: "No filters applied" (muted, button disabled) when nothing selected; "N active filter(s)" + active "× Clear all filters" (blue, hover state) when filters present. Renders only on Media / Stats / Tagged tabs.

**Migration runbook:**
- `018_profile_media_sport_year_filters.sql` ran against Supabase mid-session. Verification: `SELECT proname, pronargs FROM pg_proc WHERE proname LIKE 'get_profile_%media'` returns `pronargs = 6` for all three.

**Memory hygiene:**
- 9 modified files + 2 new files this session; commit grouped into three logical commits (maintenance pass, filter feature, DEVLOG) per the "single git revert" preference.

**Verified:** `npm run lint` zero warnings; `npm run build` exit 0 from a fresh `.next` cache (63 static pages, middleware 70 kB, shared First Load JS 102 kB).

---

## May 5, 2026

### Codebase Audit — Low-Risk Polish

Full-app scan (routes, components, lib, API) to identify safe improvements. Audit found 8 issues; implemented 2 fixes that carry zero behavioral risk.

**Fix 1 — Remove debug text from followers page (`src/app/app/followers/page.tsx`):**
- Removed visible `Debug: {followers.length} fans in state` paragraph that rendered in the empty-state UI in production
- Replaced raw red error div (`Missing follower data for ID: ...`) with a silent `return null` — gracefully skips malformed entries instead of exposing internal state to users

**Fix 2 — Enable Next.js image optimization (`src/components/LazyImage.tsx`):**
- Removed `unoptimized={true}` that was forcing all images to bypass Next.js optimization
- `next.config` already declares `remotePatterns` for `**.supabase.co` and `**.supabase.in`, plus `formats: ['image/webp', 'image/avif']` and a 1-year cache TTL
- Net effect: all user/avatar/post images now get automatic WebP/AVIF conversion, responsive sizing, and CDN caching — zero code changes needed elsewhere

**Not changed (documented for future PRs):**
- ~380 console statements (needs selective per-file approach)
- Duplicate formatters across `formatters.ts`, `athleteService.ts`, `profile-display.ts`, `name-resolver.ts` (different signatures; needs dedicated consolidation PR)
- PostCard.tsx at 1030 lines (decomposition risks breaking state/refs)
- z-index inconsistencies across modals (needs all-modal stacking test)

**Verified:** `npm run build` exit 0, `npm run lint` zero warnings.

---

## May 4, 2026

### AbortController + P1 Silent-Catch Sweep

Two-part observability + stability pass.

**Part 1 — `AbortController` guard for MessagesProvider auto-fetches (`src/lib/messages.tsx`):**
After April 29's silent-catch fix, the post-login `TypeError: Failed to fetch` surfaced loudly in production. Inspection confirmed `/api/messages` was healthy — the error was an aborted fetch racing with the post-login redirect to `/athlete`. The fix adds an `AbortController` to the user-change effect so:
- `fetchConversations` and `refreshUnreadCount` accept an optional `AbortSignal` and pass it to `fetch`.
- The catch blocks treat `AbortError` as silent (intentional cancel) and keep logging every other failure loudly.
- The 30-second poll uses per-poll controllers so a stale abort never kills future polls.
- `Promise.all().finally()` only flips loading off if the controller wasn't aborted, preventing a stale effect's cleanup from stomping a fresh effect's loading state.

**Part 2 — P1 silent-catch sweep across user-facing pages and components:**
Replaced ~70 silent `} catch { /* ignore */ }` blocks across 42 files with `console.error('<context>:', e)` plus `else { console.error(...) }` for non-OK response branches that were previously swallowed. Same proven pattern from April 29's ChatWindow + MessagesProvider work. No happy-path changes; UI behavior identical except errors now surface to DevTools console + Vercel runtime logs for diagnosis.

**Pages updated (13 catches across 9 files):**
- `feed/page.tsx`, `app/followers/page.tsx`, `app/notifications/page.tsx`, `athlete/page.tsx`, `athlete/[id]/page.tsx`, `athlete/saved/page.tsx`, `u/[username]/page.tsx`, `app/sport/[sport_key]/activity/[id]/page.tsx`, `app/sport/golf/rounds/[roundId]/page.tsx`

**NotificationsProvider (`src/lib/notifications.tsx`, 6 catches):**
- Provider runs on every page for logged-in users. `refreshUnreadCount`, `fetchNotifications`, `markAsRead`, `markAllAsRead`, `deleteNotification`, `clearAll` now log specific context and preserve all existing optimistic-update rollback logic.

**Components updated (~50 catches across 31 files):**
- High-traffic: `CommentSection.tsx` (6), `FollowersModal.tsx` (4), `NotificationsDropdown.tsx` (3), `CreatePostModal.tsx` (3), `ProfileMediaTabs.tsx` (3), `SharePostModal.tsx` (2), `ConnectionSuggestions.tsx` (2), `TagPeopleModal.tsx` (2), `EquipmentSection.tsx` (2), `RecentPosts.tsx` (2), `ParticipantAttestationModal.tsx` (2)
- Single-catch: `PostCard.tsx`, `EditPostModal.tsx`, `EditProfileModal.tsx`, `FollowButton.tsx`, `VitalsTab.tsx`, `MultiSportHighlights.tsx`, `GolfScorecardForm.tsx`, `SearchBar.tsx`, `AdvancedSearchBar.tsx`, `GifPicker.tsx`, `HandleSelector.tsx`, `WaitlistPopup.tsx`, `PerformanceModal.tsx`, `MultiSportActivity.tsx`, `TaggedPosts.tsx`, `SeasonHighlightsModal.tsx`, `NewConversationModal.tsx`, `GroupSettingsModal.tsx`, `DeleteAccountModal.tsx`, `MessagingSettings.tsx`, `PrivacySettings.tsx`

**API route (`src/app/api/golf/participant-scores/route.ts`, 1 catch):**
- Outer try/catch was returning a 500 with no server-side log; now logs `console.error('POST /api/golf/participant-scores error:', e)` before returning the 500.

**Intentionally NOT modified (kept silent for documented reasons):**
- `lib/formatters.ts`, `lib/handle-validation.ts`, `lib/vitals-config.ts` — pure parsing/validation helpers where the catch is the documented "return false / return default" fallback path. Modifying these would change behavior, not just observability.
- `lib/golf-course-service.ts`, `lib/sports/adapters/GolfAdapter.ts`, `lib/email-service.ts` — service-layer fallback patterns.
- `lib/auth.tsx` (2 catches) — auth-refresh paths with intentional silent failover.
- `api/vitals/route.ts:24`, `api/posts/route.ts:400` — intentional optional-auth (`try { requireAuth } catch { currentUserId = null; }`) — control flow, not silent error swallowing.
- `api/search/route.ts` (3 catches) — intentional control flow that throws `'Fallback to ILIKE'` and catches to trigger fallback search; well-commented.
- `SharePostModal.tsx` `handleCopyLink` and `handleNativeShare` catches — fallback to manual copy / user-cancelled-share are expected paths, not failures.
- `followers/page.tsx:72` inner JSON-parse catch — intentional rethrow to convert parse-failure into a meaningful Error message.

**Commits in this pass:**
- `95b8461` — fix: AbortController guard for MessagesProvider auto-fetches
- `ae58286` — fix: P1 silent-catch sweep across pages, components, API
- `2b4ae3b` — docs: Add pasteable SQL runbook companion for migrations 014-017

**Verified:** `npm run build` exit 0 (63 static pages), `npm run lint` zero warnings.

**Net effect:** ~70 previously-invisible failures now surface to DevTools console + Vercel runtime logs with file/handler context. Zero behavioral changes on happy paths. UI feedback (toasts/error banners) unchanged where it already existed.

### Database migrations 014–017 — confirmed applied to Supabase

Tom ran the full `RUNBOOK_014-017.sql` against the production Supabase project and confirmed the at-a-glance status query returns `m014_applied | m015_applied | m016_applied | m017_applied = t | t | t | t`.

Latently-broken features now functional in production:
- **014** — notifications display real first/last names instead of falling back to handle-style `full_name`
- **015** — `posts.likes_count` / `posts.comments_count` stay in sync with row counts (one-time recount cleared any existing drift)
- **016** — comment pinning UI works end-to-end (post owner can pin one comment per post)
- **017** — emoji + GIF reactions in chat no longer 500 (the `message_reactions` row inserts and `parent_message_id` FK both now valid)

Recommended manual smoke tests in production:
- Send an emoji reaction to a chat message, then reload — reaction persists
- Send a GIF as a reaction — GIF nests under parent message and persists
- Pin a comment as the post owner — pinned comment renders at top with thumbtack icon
- Like a post, then unlike — count updates correctly without drift

---

## April 29, 2026

### Mobile-Readiness + Production-Stability Pass

Two-commit pass focused on getting Edge Athlete cleanly Vercel-deployable on mobile, removing silent failure modes, and adding a recoverable error UI for real-world conditions (flaky networks, content blockers, cache mismatches).

**Self-hosted Font Awesome (`src/app/layout.tsx`):**
- Replaced CDN `<link>` (`cdnjs.cloudflare.com/.../font-awesome`) with local `@fortawesome/fontawesome-free` package import
- Eliminates dependency on external CDN that can be blocked or fail on mobile networks; 456 icons now ship from app's own origin
- Added explicit `viewport` export (`width: device-width`, `initialScale: 1`, `maximumScale: 5`, `viewportFit: 'cover'`, `themeColor: #ffffff`) so iOS notched devices honor safe areas

**React Error Boundaries (`src/app/error.tsx`, `src/app/global-error.tsx`):**
- Added Next.js route-level + global error boundaries
- Failed renders now show a recoverable "Something went wrong / Try again / Go home" card instead of a white screen
- "Go home" uses `window.location.assign('/')` (full reload) to escape any broken router state
- Caught the cache-mismatch issue immediately in production after deploy — confirmed working as designed

**ChatWindow silent-catch sweep (`src/components/messages/ChatWindow.tsx`):**
- Replaced 7 silent `} catch { /* ignore */ }` blocks with `console.error` + non-OK response handling across `loadOlderMessages`, `handleDeleteMessage`, `handleToggleReaction`, `handleGifReactSelect`, `handleMuteToggle`, `handleLeave`, `handleBlock`
- Reaction toggle now snapshots prior reactions before optimistic mutation and reverts on failure or non-2xx response — UI no longer permanently desyncs from server when network fails
- Fixed React `exhaustive-deps` lint warning (added `setMessageReactions`, `updateMessageReactions` to callback deps)

**MessagesProvider silent-catch sweep (`src/lib/messages.tsx`):**
- Same fix pattern applied to `refreshUnreadCount`, `fetchConversations`, `markConversationRead`
- Provider runs on every page for logged-in users; previously these failures were invisible

**iOS Safari URL-bar fix (`src/app/messages/page.tsx`, `src/app/messages/[conversationId]/page.tsx`):**
- Added `h-[100dvh]` alongside `h-screen` on the two messages pages
- Modern browsers use dynamic viewport height (`dvh`) which tracks the actual visible area as Safari's URL bar shrinks/expands; older browsers ignore the unit and fall back to `h-screen`
- Fixes chat input being clipped under the URL bar on scroll

**Cosmetic mobile fixes:**
- `src/app/goodbye/page.tsx`: replaced `fa-wave-pulse` (Font Awesome Pro, not in free package) with `fa-circle-check`
- `src/app/athlete/page.tsx`: inline-edit popover `min-w-[300px]` → `min-w-[280px]` so it fits 320px-wide screens with margin

**Migration runbook (`database/migrations/RUNBOOK_014-017.md`):**
- New 430-line reference document for applying migrations 014–017 to Supabase
- Per-migration: goal, pre-check SQL, apply step, post-check SQL, optional smoke test
- At-a-glance status query at top to see which of the four are applied at any time
- Rollback notes per migration
- Most user-impacting: 017 (`message_reactions` schema needed for emoji/GIF reactions UI already shipped in production)

**Commits shipped (auto-deployed to Vercel):**
- `b957f94` — Self-host Font Awesome, add error boundaries, surface chat errors
- `e341203` — Mobile-readiness pass — viewport, dvh, messages provider

**Verified:** `npm run build` exit 0 (63 static pages), `npm run lint` zero warnings.

**Pending Tom's action (DB-side, not blockers for code):**
- Apply migrations 014–017 to Supabase using the new runbook
- Most urgent: 017 (without it, the already-shipped reactions feature 500s in production)

**Deferred for separate session (P1 silent-catch sweep):**
- ~25 more silent catches across `feed/`, `followers/`, `notifications/`, `athlete/saved/`, server-side API routes (`posts`, `vitals`, `search`)

---

## April 12, 2026

### Flat Chat Flow — Replace Threaded Replies with Linear Conversation

Replaced the Reddit-style threaded reply timeline (vertical lines, dots, nested ThreadItem components) with a compact single-line "replying to" reference bar. Replies now render as a natural flat chat stream instead of structured nested threads.

**QuotedReply rewrite (`src/components/messages/QuotedReply.tsx`):**
- Replaced ~280-line timeline renderer with ~75-line compact reference bar
- Removed ThreadItem, SharedPostCompact, SharedProfileCompact sub-components
- Single clickable row: `border-l-2` accent + optional thumbnail + "SenderName: snippet"
- Type-aware snippets: text (60 chars), Photo, Video, GIF, post captions, profile names
- Own messages: `bg-blue-700/30 border-blue-300`; others: `bg-gray-100 border-gray-400`
- Click still scrolls to and highlights the original message

**Ancestor chain removal (full stack):**
- `MessageBubble.tsx`: Removed `replyChain`/`currentUserId` props from QuotedReply call
- `ChatWindow.tsx`: Removed `ancestorChain` construction in `handleSend`
- `route.ts` (messages API): Removed ancestor walk loop (0-4 sequential DB queries per page load), `parent_message_id` from parent query/map, `reply_chain` from response
- `types/messages.ts`: Removed `reply_chain` field from `Message` interface

**What stays:** `reply_to` (immediate parent reference), `parent_message_id` (reply targeting), all reaction systems (emoji, GIF), reply button + reply mode, scroll-to-message, rich shared_post/shared_profile data on `reply_to`.

---

## April 11, 2026 (Session 2)

### Threaded Comments with Pinning & Smart Sort

Rebuilt the comment system into a full threaded conversation layer — replies nest under parents, post owners can pin a comment, and the sort order surfaces the best content first.

**CommentSection rewrite (`src/components/CommentSection.tsx`):**
- `useMemo` organizes comments into root comments and a `repliesByParent` map
- Sort order: pinned first → most liked → chronological
- Replies sorted chronologically within each parent thread
- Reply form per comment with emoji + GIF pickers
- Pinned comments show amber thumbtack icon + "Pinned" label
- Pin button visible only to the post owner on root-level comments
- 32px avatars for root comments, 24px for replies, indented with left border

**Comments API (`src/app/api/comments/route.ts`):**
- GET: Sort updated to `is_pinned DESC → likes_count DESC → created_at ASC`
- POST: Now counts actual rows via admin client and syncs `posts.comments_count`
- DELETE: Fetches `post_id` before deletion, recounts, syncs cached column
- New PATCH handler: Pin/unpin comments (post owner only, one pinned per post)

**Migration (`016_comment_pinning.sql`):**
- `is_pinned BOOLEAN DEFAULT FALSE` column on `post_comments`
- Partial index on `post_id WHERE is_pinned = TRUE`

---

### In-App Post Sharing (Message-First)

Made internal messaging the primary share destination. Tapping Share on a post opens a modal with contacts front and center; external options are secondary.

**New file (`src/components/SharePostModal.tsx`):**
- Fetches conversations from `GET /api/messages` on open
- Frequent contacts row: first 8 DM conversations as horizontal scrollable avatars
- Full conversation list with search (client-side filter by name)
- Multi-send: `sent` Set tracks which conversations received the post
- Sends `{ type: 'shared_post', shared_post_id }` to existing message API
- Secondary section: Copy Link + native Web Share API

**PostCard changes (`src/components/PostCard.tsx`):**
- `handleShare` replaced clipboard/Web Share with `setShowShareModal(true)`
- Comment icon now opens comment section and scrolls to it (`useRef` + `scrollIntoView`)
- `commentSectionOpen` state controls CommentSection visibility
- CommentSection receives `postOwnerId` and `isOpen` props

---

### Like & Comment Count Accuracy

Fixed inconsistent like/comment counts by making the API the single source of truth.

**Like API (`src/app/api/posts/like/route.ts`):**
- After like/unlike: counts actual rows from `post_likes` table
- Syncs `posts.likes_count` cached column with true count

**Comments API:** Same pattern — POST and DELETE both recount and sync.

**Database triggers (`015_fix_like_comment_count_triggers.sql`):**
- `update_post_likes_count()` trigger on INSERT/DELETE on `post_likes`
- `update_post_comments_count()` trigger on INSERT/DELETE on `post_comments`
- One-time recount of all existing posts
- All references fully schema-qualified (`public.posts`, `public.post_likes`, etc.)

---

### Trigger Schema Qualification Fix

Fixed PostgreSQL trigger functions that used `SET search_path = ''` but referenced tables and functions without `public.` prefix, causing likes and comments to silently fail.

**Migration (`014_fix_notification_actor_name.sql`):**
- Fixed 7 trigger functions: `notify_post_like`, `notify_post_comment`, `notify_new_follower`, `notify_follow_request`, `notify_follow_request_accepted`, `notify_mention`, `notify_shared_post`
- All now use `public.posts`, `public.get_actor_display_name()`, `public.create_notification()`

---

### Security & Stability Fixes

**Search API (`src/app/api/search/route.ts`):**
- Added `sanitizeForFilter()` to prevent PostgREST injection via search terms

**Messages API (`src/app/api/messages/route.ts`):**
- UUID validation on participant IDs
- Fixed DM lookup to check both participant orderings
- Parallel unread count queries

**Vitals API (`src/app/api/vitals/route.ts`):**
- NaN/Infinity validation on numeric inputs

**Vitals config (`src/lib/vitals-config.ts`):**
- `parseTimeToSeconds` bounds validation and `Math.floor` fix

**AddVitalModal (`src/components/AddVitalModal.tsx`):**
- `parseTimeToSeconds` format parameter fix

**Notifications (`src/lib/notifications.tsx`):**
- Extracted shared `getNotificationText()` function used by `NotificationBell`, notifications page, and app notifications page

**Other cleanup:**
- Removed dead `MobileNav.tsx` component
- Removed duplicate Messages button from `AppHeader`
- Fixed `TypingIndicator` `useRef` cleanup
- Fixed feed pagination (>= 20 instead of === 20)

---

## April 11, 2026

### MVP Messaging System

Built a full real-time messaging layer — DMs, group chats, rich media sharing, typing indicators, and unread badges.

**Database (`012_messaging.sql`):**
- 5 new tables: `conversations`, `conversation_participants`, `messages`, `message_reactions`, `user_blocks`
- `messaging_permission` column on `profiles` (`everyone` / `fans_only` / `mutual_fans` / `nobody`)
- `is_conversation_participant()` SECURITY DEFINER helper powers all RLS policies
- Trigger auto-bumps `conversations.updated_at` on every new message
- Extended `notifications` type CHECK to include `new_message`

**API (10 new routes):**
- `GET/POST /api/messages` — list conversations, create DM or group (respects messaging permission)
- `GET /api/messages/unread-count` — aggregate unread badge count
- `GET /api/messages/[conversationId]` — cursor-paginated message history + participants
- `POST /api/messages/[conversationId]/messages` — send message, fan-out notifications
- `PATCH /api/messages/[conversationId]/read` — mark conversation read
- `PATCH /api/messages/[conversationId]` — update group name / avatar / mute
- `POST/DELETE /api/messages/[conversationId]/participants` — add/remove members
- `DELETE /api/messages/[conversationId]/messages/[messageId]` — soft-delete
- `POST /api/messages/block` — block user + close DM

**New files:**
- `src/lib/messages.tsx` — `MessagesProvider` with per-conversation Realtime subscriptions + 30s poll fallback
- `src/types/messages.ts` — full TypeScript types for all messaging entities
- `src/components/messages/` — `ConversationList`, `ConversationItem`, `ChatWindow` (flex-col-reverse + IntersectionObserver infinite scroll), `MessageBubble` (5 types + soft-delete), `MessageInput` (auto-resize textarea + file attach), `TypingIndicator` (broadcast channel, 3s auto-clear), `SharedPostPreview`, `SharedProfilePreview`, `NewConversationModal`, `GroupSettingsModal`, `MessagesBell`
- `src/components/settings/MessagingSettings.tsx` — 4-option permission radio cards
- `src/app/messages/page.tsx` — desktop split-pane (`?c=` param), mobile full-width list
- `src/app/messages/[conversationId]/page.tsx` — mobile-primary, redirects to `?c=` on desktop

**Modified:** `AppHeader`, `MobileNav`, `settings/page.tsx`, `layout.tsx`

---

### Emoji + GIF Picker

Added emoji and GIF support to the message composer and post comment input.

**New files:**
- `src/components/EmojiPickerButton.tsx` — lazy-loaded picker, opens upward, inserts Unicode at cursor
- `src/components/GifPicker.tsx` — debounced Giphy search, trending on open, 2-column grid, GIPHY attribution
- `src/app/api/gifs/search/route.ts` — server-side Giphy proxy (API key never exposed to browser)
- `database/migrations/013_comment_gif.sql` — adds `gif_url TEXT` column to `post_comments`

**Modified:**
- `MessageInput` — emoji + GIF buttons; GIFs use CDN URL directly, no upload needed
- `CommentSection` — emoji + GIF toolbar; GIF-only comments supported; renders inline
- `POST /api/comments` — accepts and persists `gif_url`
- `Comment` interface — `content` made nullable; `gif_url?: string | null` added

**DB fix:** `post_comments.content` dropped `NOT NULL` constraint to allow GIF-only comments.

---

## April 8, 2026

### Vitals Tracking — Full Feature Build

Built the complete Vitals tab on athlete profiles for long-term physical development tracking. Every entry is an immutable historical record. No overwriting — only appending.

**New files:**
- `database/migrations/010_vitals_tracking.sql` — `athlete_vitals` table with append-only RLS (no UPDATE/DELETE policies), `source` column for future wearable integrations
- `src/lib/vitals-config.ts` — 4 categories, 18 metrics, time parsing/formatting utilities, progression helpers
- `src/app/api/vitals/route.ts` — GET (vitals + training posts + athlete birthday) and POST (always inserts, never updates)
- `src/components/AddVitalModal.tsx` — Category/metric selection, time format handling (mm:ss and decimal seconds), back-datable date input
- `src/components/VitalsTab.tsx` — Metric cards with current value, personal best, first recorded + age context, progression delta, years tracked, trend arrow; inline history grouped by year; training activity feed

**Modified:**
- `src/components/ProfileMediaTabs.tsx` — Replaced vitals "coming soon" with live `VitalsTab`
- `src/lib/sports/SportRegistry.ts` — Added `training` as an enabled sport
- `src/lib/config/sports-config.ts` — Added training icon, color, and Tailwind classes

---

### Vitals Media — Metric + Post Feature

Extended the Vitals system so athletes can optionally attach photos or video when logging a vital, making a bench press PR or sprint clip shareable as a visual post while keeping the structured time-series record clean.

**Architecture:** `athlete_vitals` remains the source of truth. A vital entry can optionally link to a `posts` row via `linked_post_id`. Linked posts use `sport_key='training'` and appear in the Training Activity feed automatically.

**Transactional safety:** The three-step flow (upload media → create post → create vital) handles all failure modes explicitly. If the vital insert fails after the post is created, the orphaned post is deleted automatically.

**Changes:**
- `database/migrations/011_vitals_linked_post.sql` — Nullable `linked_post_id` FK with `ON DELETE SET NULL` and sparse index
- `POST /api/posts` — Now accepts `'training'` as a valid `postType` and an optional `stats_data` field for non-golf posts
- `POST /api/vitals` — Accepts and persists optional `linked_post_id`
- `AddVitalModal` — Mode toggle: "Metric only" (quick entry) vs "Add media" (caption + media upload + visibility). Same 5MB/4-file/image+video rules as `CreatePostModal`.
- `PostCard` — Violet dumbbell badge for posts with `stats_data.type='vitals_entry'` showing metric label + value
- `VitalsTab` — Camera icon on history entries with a linked post; clicking opens the post in `PostDetailModal` inline

---

## April 7, 2026

### Feed & Login Cleanup
Removed all placeholder/fake UI that was misleading for early users.

**Feed page (`src/app/feed/page.tsx`):**
- Removed fake Stories section (hardcoded "Athlete 1–6" placeholders)
- Removed Explore Reels placeholder grid
- Replaced Upcoming Events with honest empty state ("coming soon")
- Replaced Your Teams with Your Club empty state ("coming soon")
- Wired Photo/Video, Stats, Achievement quick-action buttons to open the create post modal (were styled but had no `onClick` handlers)

**Login page (`src/app/page.tsx`):**
- Removed Google, Facebook, Apple OAuth buttons — they had no click handlers and did nothing on press. Email/password login is the primary auth method for the MVP.

---

### Mobile App Crash Fix
Fixed a crash that prevented the app from loading on mobile devices entirely.

**Root Cause:** `src/app/layout.tsx` loaded Tailwind CSS from CDN via `<script async>`, followed by an inline script setting `tailwind.config = {...}`. On slow mobile connections, the CDN script hadn't loaded when the inline script ran, causing `ReferenceError: tailwind is not defined` — crashing the entire React tree.

**Fix:** Removed both scripts. Tailwind CSS 4 is already fully compiled at build time via `@tailwindcss/postcss` — the CDN script was redundant.

---

### Black Media Images Fix (Tailwind CSS v3 → v4 Migration)
Fixed all media images appearing as solid black squares in post feeds and the profile media grid.

**Root Cause (two layers):**

1. **`LazyImage` component** used an IntersectionObserver + `opacity-0` initial state. If `onLoad` was slow, images stayed invisible on top of the `bg-black` media container in `PostCard`.

2. **Tailwind CSS v3 → v4 breaking change** — `bg-opacity-*` utilities were removed in Tailwind CSS 4. After removing the CDN v3 script, every `bg-black bg-opacity-0` rendered as solid black at full opacity. The media grid overlay (`absolute inset-0 bg-black bg-opacity-0`) was a black sheet covering every image. This also broke all modal backdrops, carousel buttons, and hover overlays across the entire app.

**Fixes:**
- `LazyImage`: Replaced IntersectionObserver + opacity trick with a gray skeleton overlay (`z-10`) that sits on top while the image loads. Image always renders so `onLoad` fires reliably.
- `PostCard`: Changed media container from `bg-black` → `bg-gray-100` (neutral fallback).
- Global: Replaced all `bg-opacity-*` / `hover:bg-opacity-*` / `group-hover:bg-opacity-*` with Tailwind v4 slash syntax (`bg-black/50`, `hover:bg-black/70`, etc.) across **25 files**.

---

## April 3, 2026

### Build-Breaking Fix: Module-Level Supabase Clients
Fixed production build failures caused by Supabase clients being created at module scope in API routes. During static analysis, Next.js evaluates module-level code where environment variables aren't available, causing `supabaseUrl is required` errors.

**Root Cause:** 26 API route files created Supabase admin clients (`createClient(...)`) at the top of the file outside request handlers.

**Fix:**
- Added `getSupabaseAdmin()` lazy factory function to `src/lib/auth-server.ts`
- Moved all Supabase client creation inside request handler `try` blocks
- Replaced module-level env var constants with inline `process.env` references

**Files Changed (27):**
- `src/lib/auth-server.ts` — Added `getSupabaseAdmin()` helper
- 26 API routes under `src/app/api/` — Moved client init into handlers

### Golf Stats Endpoint Fix
Fixed `/api/golf/stats` returning 500 errors due to querying a non-existent `total_score` column.

**Fix:** Removed `total_score` from the SELECT query and all calculation references in `src/app/api/golf/stats/route.ts`. The correct column is `gross_score`.

### Notification Routes Auth Fix
Fixed all notification API routes returning 500 instead of 401 for unauthenticated requests.

**Root Cause:** `requireAuth()` throws a `Response` object on auth failure, but catch blocks didn't check for it, wrapping the 401 as a generic 500.

**Fix:** Added `if (error instanceof Response) return error;` to catch blocks in 7 handlers across 5 files:
- `notifications/route.ts` (GET, DELETE)
- `notifications/unread-count/route.ts` (GET)
- `notifications/preferences/route.ts` (GET, PATCH)
- `notifications/mark-all-read/route.ts` (PATCH)
- `notifications/[id]/route.ts` (PATCH, DELETE)
- `notifications/[id]/action/route.ts` (POST)

**Verification:**
- Build: Passing (57 pages, 54 API routes, 0 errors)
- Lint: No warnings or errors
- All 22 database tables accessible
- All notification endpoints return 401 for unauthenticated requests

---

## January 8, 2026

### Mobile Navigation Fix
Fixed non-functional buttons in the mobile navigation drawer:

**Before:** "Explore" and "Fans" buttons had no click handlers
**After:** Replaced with working navigation links:
- **Saved Posts** → `/athlete/saved`
- **Notifications** → `/app/notifications`

**File Changed:** `src/components/MobileNav.tsx`

---

### Connection Suggestions Feature Fix
Fixed the "People you may know" suggestions feature which was failing due to SQL issues:

**Root Cause:**
- Multiple versions of `generate_connection_suggestions` function with different return types
- Missing `connection_suggestions` table for dismiss functionality
- RPC function parameter names mismatch between API and database

**Changes Made:**

1. **Created comprehensive migration:** `database/migrations/fix-suggestions-feature-complete.sql`
   - Creates `connection_suggestions` table with proper schema
   - Adds RLS policies for the new table
   - Drops all old function versions
   - Creates corrected `generate_connection_suggestions` function
   - Adds proper indexes for performance

2. **Improved API route:** `src/app/api/suggestions/route.ts`
   - Added TypeScript interface for `ConnectionSuggestion`
   - Fixed RPC parameter names (`p_user_profile_id`, `p_suggestion_limit`)
   - Improved fallback logic to exclude already-followed profiles
   - Better error logging with structured error details
   - Created Supabase client per-request instead of module level

**To Apply:**
Run the migration in Supabase SQL Editor:
```
database/migrations/fix-suggestions-feature-complete.sql
```

**Database Schema Alignment:**
Also fixed `src/app/api/public/profile/route.ts` and `src/lib/supabase.ts`:
- Removed `position` and `team` from profile queries (not in current DB schema)
- Fixed golf rounds query to use `gross_score` instead of `total_score`

---

## December 10, 2025

### Fan Terminology Update
Replaced all "Follow/Following/Followers" terminology with fan-based wording across the entire UI:

| Old Term | New Term |
|----------|----------|
| Follow | Become a Fan |
| Following (status) | You're a Fan |
| Following (list) | Fan Of |
| Followers | Fans |
| Follow request | Fan request |
| Unfollow | Unfollow (kept) |
| Remove Follower | Remove Fan |

**Files Updated (14 total):**
- `src/components/FollowButton.tsx`
- `src/components/FollowersModal.tsx`
- `src/components/PrivateProfileView.tsx`
- `src/components/NotificationsDropdown.tsx`
- `src/components/EditProfileTabs.tsx`
- `src/components/AppHeader.tsx`
- `src/components/MobileNav.tsx`
- `src/components/settings/AccountSettings.tsx`
- `src/app/athlete/page.tsx`
- `src/app/athlete/[id]/page.tsx`
- `src/app/u/[username]/page.tsx`
- `src/app/notifications/page.tsx`
- `src/app/app/notifications/page.tsx`
- `src/app/app/followers/page.tsx`

### Enhanced Fans Modal
Implemented bidirectional relationship management in the Fans modal:

**On Your Own Profile (Fans List):**
- See all your fans with profile photo, name, sport/school
- "Become a Fan" button to follow them back
- "Unfollow" button if already following
- "Remove Fan" button to remove them from your fans
- All buttons always visible (no hover menus)

**On Another User's Profile (Fans List):**
- Discover fans of that athlete
- "Become a Fan" / "Unfollow" buttons for each person
- No "Remove Fan" button (owner-only privilege)

**Button Styles:**
- **Become a Fan**: Blue background (`bg-blue-600`)
- **Unfollow**: Gray background (`bg-gray-200`)
- **Remove Fan**: Red text on light red (`text-red-600 bg-red-50`)

---

## Project Status

**Build:** Passing (63 static pages, 0 errors)
**Lint:** No warnings or errors
**Deployment:** Vercel (auto-deploy on push to main)
**Last Verified:** April 11, 2026

---

## Tech Stack
- Next.js 15.5.7 (App Router)
- React 19
- Supabase (Auth, Database, Storage)
- TypeScript (strict mode)
- Tailwind CSS 4

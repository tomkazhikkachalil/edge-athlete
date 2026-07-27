# Development Log

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

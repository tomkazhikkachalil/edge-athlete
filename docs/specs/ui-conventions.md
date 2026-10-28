# UI conventions: navigation, web and mobile parity, the browser floor, design system

> Moved verbatim from CLAUDE.md on Oct 13 2026 (the long form; the short form is in CLAUDE.md).

## 🧭 Navigation Conventions

**No screen may be a dead end.** Every screen, modal, and flow needs a visible way back: signed-in users to `/feed`, signed-out users to the sign-in page. Never require the user to edit the URL. Audited and enforced July 2026 — these rules are the reason it holds:

- **The login form lives at `/`. There is no real `/login` page** — `src/app/(app)/login/page.tsx` only redirects there. Never `router.push('/login')`.
- **`BrandBar` carries the exit for standalone pages** (auth, guardian, onboarding, legal). It renders an auth-aware escape link; **the logo is intentionally NOT a link** — don't "fix" that. It hides itself on `/`, during auth boot, and via `hideEscape` for genuinely modal steps (a transfer mid-execution). `/auth/complete-profile` uses `hideEscape` plus its own sign-out link, because `/` bounces profile-less sessions straight back to it.
- **`src/app/(app)/not-found.tsx` is the catch-all 404.** Without it Next.js renders a bare page with no links at all.
- **`AppHeader` has three branches** — auth-booting (logo-only shell, prevents a flash), signed-out (Log in + Sign up, and deliberately **no** notification/message bells, which would poll protected endpoints), and authenticated. Public pages (`/explore`, `/u/[username]`) depend on the signed-out branch; the login page's "Explore as Guest" button makes `/explore` a genuine anonymous surface.
- **Check `initialAuthCheckComplete` before `!user`.** The reverse order flashes "Sign In Required" at signed-in users on refresh.
- **Discarding unsaved input requires confirmation.** Use `useDirtyClose` (`src/hooks/useDirtyClose.ts`) with `ConfirmModal` and `COPY.FORMS.DISCARD_*`: every X / Cancel / backdrop path calls `requestClose`; closes that follow a successful save call the raw close directly (never confirm after a save). `ConfirmModal` accepts `overlayZClass` for callers stacked above `z-[60]`.
- **A menu entry opens its thing WHERE YOU ARE — never a trip to another page first.** Edit Profile is ONE pop-up mounted at the app root (`src/components/EditProfileHost.tsx`, Oct 2 2026): `useEditProfile().open(tab?)` opens it over the current page, a route change closes it, and it is fetched on first use (`preload()` when a menu that offers it opens). A page mounts its own `EditProfileTabs` only when it needs more than that — the profile page (it reloads its own data and owns `?edit=sport`) and the guardian's athlete page (`targetProfileId`). Never `router.push('/athlete')` as "edit profile": that was the bug (the header did it on every page that had not mounted the editor).
- **A "Back" button is `backOr(router, fallback)` (`src/lib/nav-back.ts`), never a bare `router.back()`.** A page opened cold — the installed app has no browser Back button, Android opens our links inside it, and a link in a new tab is the same case — has no history, and `router.back()` there does nothing. Each site names its natural parent (Oct 2 2026).
- **Order destructive multi-step flows so backing out is safe** — e.g. equipment replacement retires the old item only *after* the new one exists, never before.

---

## 📱 Web & Mobile Ship Together

**A feature or fix is not complete until it works at phone width as well as desktop.**
There is no separate mobile app: "mobile" means small-viewport rendering of the same
pages, so parity is a verification duty, not a porting task. Standing rule (Tom,
Aug 2026), prompted by the Training redesign shipping "invisible" on phones — the
components were identical at every width, but the Training tab sat off-screen in the
profile tab scroller and `/u/` (where most profile links land) had no Training at all.
The lessons generalize:

- **Every round's verification includes a phone-width (~375px) pass of the touched
  surfaces** — alongside `npm run verify`, before calling the work done.
- **Reachability is part of parity.** A surface that renders fine at 375px but sits
  behind an overflow-hidden scroller, a hover-only affordance, or a desktop-only
  entry point has NOT shipped on mobile. Check the path to the feature, not just
  the feature.
- **Route parity matters as much as viewport parity.** The same content often has
  two routes (`/athlete/[id]` vs `/u/[username]`); a redesign that lands on one and
  not the other reads as "missing on mobile" because phones arrive via different
  links. When redesigning a surface, grep for every route that renders that data.
- **Give important tabs/sections a deep link** (`?tab=…`) so they are addressable
  from navigation, tests, and shares regardless of viewport.
- e2e runs default to 1280×800 (`playwright.config.ts`); specs tagged `@mobile` run
  in THREE phone projects — `mobile` (Chromium at 390×844, emulation OFF: the honest
  layout ruler), `webkit-mobile` (the same specs on WebKit — every iPhone browser,
  Chrome included, is WebKit) and `android` (Chromium as a Pixel 7: the Android user
  agent, touch, DPR 2.6, 412×915, emulation ON — what a Pixel / Samsung / any Android
  phone presents; Oct 9 2026) — add one for any surface whose phone behavior matters.
  The three are a developer-side cost only (≈2.5 min each on this Mac and in CI's
  smoke job); nothing ships to a phone. **HEIC (Oct 9 2026):** a Samsung's
  high-efficiency photo reaches Chrome as HEIC (sometimes with an empty type);
  `decode.ts` tries the browser first and, only when both native decoders fail
  AND `heic-brand.ts` says HEIF, fetches the WebAssembly decoder
  (`heic-decode.ts`, `import('libheif-js/wasm-bundle')` — dynamic, nowhere else;
  LGPL-3.0 as a separately loaded module) — a JPEG phone and every iPhone never
  download it. The server never sees HEIC; 3GP video stays refused by decision. **Never run the whole `@mobile` set in ONE
  invocation against staging** (177 specs ≈ 1.4 h; the free tier degrades and the
  late specs time out) — run it by area, one project at a time. A spec's locator
  must survive the header's always-mounted drawer (`Create Event`, the child's name):
  scope to the `form`.

### The browser floor is a rule, not a framework default (Sep 2026)

**The app must run on every device people actually carry** (Tom: "iOS, Android,
Google, etc."). `package.json` `browserslist` is the floor — **iOS 15 / Safari 15,
Chrome/Firefox/Edge 100, Samsung 16** — and `scripts/check-browser-syntax.mjs`
(`npm run check:syntax`, the last step of `npm run verify`) parses every built
client chunk and fails on **syntax** the floor cannot parse AND on **runtime
methods** it cannot call (`toSpliced`, `findLast`, `AbortSignal.timeout`,
`Object.groupBy`… — the denylist is `scripts/browser-floor-rules.mjs`). Why both:
Next.js 16's own default is Safari 16.4+, and when we upgraded nothing said so — the
framework runtime and Sentry shipped class static blocks into every page, an older
iPhone could not parse the app at all (every tap dead, every browser on that phone),
and every desktop check stayed green for a month. The same day the parse failure was
fixed, a `toSpliced` in `AppHeader` — valid syntax, missing method — threw on every
page with the header on the same phone; a syntax check cannot see that class. Do
not raise the floor without a DEVLOG entry; when adding an API newer than iOS 15,
feature-detect it (`typeof x.m === 'function'`, `x.m || fallback` — shapes the gate
recognises) or install it. Globals the FRAMEWORK calls bare (`structuredClone`) are
installed by the blocking head script in `src/lib/floor-polyfills.ts`. The gate also
runs against a directory of downloaded chunks (`node scripts/check-browser-syntax.mjs
<dir>`) — the post-merge prod check.

### Strict Spacing Rhythm
- **12px** (`space-micro`) - Label-to-value, icon-to-text
- **24px** (`space-base`) - Intra-section gaps
- **48px** (`space-section`) - Section gutters

**As practised** (measured Oct 2 2026 across the feed, Settings, events, the org
page and the profile tabs): heading → card `mb-3` / `mb-4` (12–16px); a filter or
chip row → its content 16–24px; card ↔ card 16–24px; sections inside a tab
`space-y-8`. Nothing leaves 0px between two bordered blocks.

**A shared block carries its own spacing — never its parent's.** `FilterBar` used
to return two bare rows and lean on a `space-y-6` host; the Stats tab's host had
none, so the controls sat flush on the status strip and the strip flush on the
grid. A fragment that needs its host to space its insides is a bug waiting for
the next host. `e2e/profile-spacing.spec.ts` holds the RENDERED gap
(`e2e/helpers/layout.ts`) on every tab that uses the bar, on both profile routes.

### Typography Scale
- **H1:** 32px
- **H2:** 24px
- **H3:** 18px
- **Body:** 16px
- **Label:** 14px
- **Chip:** 12px

**Touch screens: every text control is 16 px** (`globals.css`, the iOS
focus-zoom guard — `(max-width: 640px), (pointer: coarse)`, every `input`
that takes text, `textarea`, `select`; unlayered so it beats `text-sm`).
iOS zooms into a focused field under 16 px. An auto-focus that can land
OUTSIDE a tap (a field inside a lazily loaded chunk — the sport picker) focuses
only behind `(hover: hover) and (pointer: fine)`; on a phone the screen opens
at normal size with no keyboard (Oct 22 2026, Tom's cold-open zoom report).
Page zoom is never disabled (`maximumScale: 5`). `input-zoom-guard.test.ts`
pins the rule and lists every `autoFocus` site.

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

## The Create menu (Create menu redesign, Oct 13 2026, zero DDL)

Tom's spec: ONE Create menu — the header button, the phone drawer's "Create" row, and therefore the feed and the profile (the header is on both) all open `src/components/CreateSheet.tsx`, the house `LargerWindow`. Four doors in this order, each with a one-line description and its own Font Awesome icon:

1. **Post** (`fa-pen`, `data-create-post`) — a General post with no sport fields: the page's own composer (`onCreatePost`), else the feed's `?create=1` handoff. The feed's "Create a post" pill and the profile's My Media "Create Post" button are direct Post doors and stay.
2. **Sport** (`fa-medal`, `data-create-sport`) — the composer with the **Select Sport** picker already open (`CreatePostModal` prop `openSportPicker`; `AppHeader onCreateSport`, else `/feed?create=1&pick=sport`). Since Oct 27 2026 the picker is search first — Favourites, then All Sports alphabetical, no "General Post" option (see "The sport picker" below). Picking golf lands in the golf section with "Playing now" → Go Live creates the round; a stat-line sport gets its stats form; closing the picker without a pick leaves a General post — the Oct 10 "posts start General" rule keeps this as its ONE explicit door; a chosen sport is cleared with the composer's "Remove sport" link, never from the picker. There is no standalone sport screen (Tom's choice, Oct 13).
3. **Event** (`fa-flag-checkered`, `data-create-event`) — the wizard at `/sports/events/new`, as before.
4. **Record Activity** (`fa-stopwatch`, `data-create-record-activity`) — a SECOND STEP in the same window (`data-create-step="record"`, Back = `data-create-back`): **Start a workout** (`fa-dumbbell`, `data-create-workout`) and **Record activity** (`fa-person-walking`, `data-create-recording`). The icons are the resume pill's (`PILL_KIND_ICON`).

**One start path.** `src/hooks/useStartWorkout.ts` is the ONE way a live workout starts — lifted verbatim from Training: `POST /api/workouts { mode: 'live', routineId? }`, 409 → resume the session in progress, `refreshDrafts()` so the pill and the Drafts count learn it, `/app/workout/<id>`; with saved routines `open()` shows `StartWorkoutSheet` (the caller renders it — Training and the header both do). Training's Start Workout and Create → Start a workout call the same hook, so the screen, the timer, the autosave, the resume pill and the summary are identical by construction (`e2e/activities-doors.spec.ts` proves it). Record activity is `router.push('/activities/record')` in both places. `sessions-pill.test.ts` holds the hook to `refreshDrafts()`.

**Import Activity is gone** (PR 1 of the redesign): no door, no page, no `.FIT` route, no copy — see `activities.md` (Oct 13 2026).

## The sport picker: search first, favourites per account (Oct 27 2026, migration 285)

Tom's spec: *"Replace the current sport picker with a cleaner, search-first flow modeled on professional apps. Remove 'General Post', remove any pre-selection, and add a favourites system for quick access … Favourites are stored per user account, not per device, so they follow the user across logins."* His four decisions when asked: **no toast** (a gold star is its own confirmation — the Oct 15 rule; an error card only when the save fails); the way back to a General post is a **"Remove sport"** link under the composer's Post Type row, never in the picker; the **Oct 22 focus rule stays** (the search focuses on a fine pointer only; a phone opens the list with no keyboard); **both of the spec's additions kept** (un-favourite by tapping the gold star; account storage).

- **The screen** (`src/components/SportSelector.tsx`, still the `z-[60]` overlay with the "Select Sport" heading): top to bottom the search (`data-sport-search`, 16 px, the Oct 22 focus block verbatim), **Favourites** (`data-sport-favourites`, only once the account has one), **All Sports** alphabetical by display name, a locked "Coming soon" row for a sport that is off. The query filters BOTH sections; both empty says "No sports found". No "General Post", nothing pre-selected, no footer: a new post already starts General (Oct 10) and closing without a pick leaves it so. `partitionSports` in `src/lib/sports/favourite-sports.ts` is the ONE rule for the two lists.
- **The row:** one `li` (`data-sport-row=<key>`) holding two SIBLING buttons, never nested. The row button is named by the sport only (the icon and the lock are `aria-hidden`); a tap picks the sport and closes. The star button (`ea-icon-btn`, the 44 px ring; `data-sport-favourite=<key>`, `aria-pressed`) is named **"Add to favourites" / "Remove from favourites"** — never the sport's name — with `aria-describedby` pointing at the name span, so `getByRole('button', { name: /golf/i })` finds exactly ONE button in every spec (header-create's phone test counts it). A locked row, or a viewer whose own profile is not loaded, gets a spacer instead of a star. Gold is the `--star` token (`text-star`; light `#f59e0b`, dark `#fbbf24` — the light warning foreground is brown, not gold).
- **The storage** (285): `profiles.favourite_sports jsonb`, a JSON array of registry keys on the ACCOUNT's own row — owner-only (`OWNER_ONLY_FIELDS` strips it from `GET /api/profile`), NULLed on departure. NOT `sport_settings`: a row there declares the sport on the profile (`computeActiveSports`), and pins (263) are public presentation. Read only through `sanitizeFavouriteSports` (known keys, deduped, sorted — canonical bytes; junk is `[]`); written only by `favourites-server.ts writeFavouriteSports` behind `PATCH /api/settings/favourite-sports` (the whole list, `requireAuth`, the `favourite-sports` bucket 120/h, `private, no-store`). A favourite of a sport that is later switched off stays stored and hidden.
- **The save** (`src/hooks/useFavouriteSports.ts`): reads `useAuth().profile` — the account, never a guardian-managed `activeProfile`; applies at once, persists one save at a time (`serial-queue.ts`, the theme-prefs shape), rolls back only if no newer tap landed, `showError('Could not save favourite')`. The device copy lives at module level because the picker unmounts on every pick and the profile is not re-fetched after a save; it stands until the server value actually changes, and never while a save is in flight or inside the 10 s grace after one.
- **The composer:** `selectedSport` is gone from the picker; the Post Type row still reads "General Post / Text, photos, and hashtags" for a General post and, for a chosen sport, carries the `data-post-type-clear` "Remove sport" link beneath it (a sibling of the row).
- **Pinned by:** `favourite-sports.test.ts` (the rules), `sport-picker-rows.test.ts` (the row contract, the token, the owner-only field, no notice), `input-zoom-guard.test.ts` (the focus rule), `e2e/sport-favourites.spec.ts` (desktop + `@mobile`, on Rowing — the one sport no other spec searches; cleans the shared QA account's favourites after).

## Vitals is Training; Edit Profile's Vitals is Body Metrics (Oct 14 2026, zero DDL)

Tom: the name no longer fit — the section is where workouts and activities are logged. The profile tab is **Training** (key `training`; `?tab=vitals` and `?tab=activities` are aliases, so every old link keeps working — `VITALS_TAB_ALIAS` / `ACTIVITIES_TAB_ALIAS` in `ProfileMediaTabs`, the same two in the `/u/` parser), its code is `TrainingTab.tsx` + `src/components/training/*` + `src/lib/training/*` + `training-privacy*.ts`, its dialect scope is `.tr-scope` (the `.tr-*` motion classes; the two shadow levels unchanged), its hooks `data-training-*`. The measurements (height, weight, grad year) are **Body Metrics**: `body-metrics-config.ts`, `AddBodyMetricModal`, `BodyMetricTrendChart`, Edit Profile tab `body_metrics` ("Save Body Metrics"). **What never renames:** the database (`athlete_vitals`, `profiles.vitals_privacy`), the API (`/api/vitals*`, `/api/settings/vitals-privacy`), the payload fields (`counts.vitals`, `data.vitals`, `vitalsPrivacy`, `currentVitals`, the stored type `vitals_entry`, the media token) — `src/lib/__tests__/training-rename.test.ts` allows exactly those forms and nothing else.

## Feedback: a visible result is its own confirmation (Oct 15 2026, zero DDL)

Tom (fix 1 of his seven): *"The green banner that drops from the top after routine actions such as saving or posting is distracting. Remove it for anything that succeeds. The result on screen is confirmation enough. Keep messages only for errors and for actions the user cannot see the result of, such as a report being sent. Those should be small, quiet and dismiss on their own."*

- **The surface** (`src/components/Toast.tsx`) offers exactly three calls: `showError(title, message?)` — the card, `role="alert"`, 6 s, dismissible; `showNotice(title, message?)` — the quiet pill, one line, no icon, `role="status"`, 3 s (`NOTICE_MS`), tap to dismiss early; `showUndo(title, onUndo, message?)` — a notice with the one action, 8 s. **`showSuccess`, `showInfo` and `showWarning` no longer exist.** `src/lib/__tests__/toast-policy.test.ts` pins all of it: no component may call them, and a notice stays a status within four seconds.
- **The rule for a new call:** can the user see the result where they are? Then nothing. A save re-renders the form, a post appears, a row changes, a thing is deleted from the list — no toast. A notice is for a result that is NOT on this screen: an invite, a reminder or a challenge sent to someone else; a request that a manager or guardian must approve; something copied to the clipboard; a site published elsewhere; a badge earned in the background; where a thing went that the screen cannot show (a result hidden rather than deleted, a password change that signed other devices out, a routine saved for next time).
- **The sweep (PR 5 of the Oct 14 seven):** 157 success calls across 70 files — ~115 removed, ~45 turned into notices (every one of them a result off this screen), five info calls turned into notices, the two Undos kept. The e2e specs that read a removed toast now read the visible result or the request that made it; the ones that read a kept notice read `role="status"`.

## Explanatory text collapses behind an (i) (Oct 28 2026, zero DDL)

Tom's spec (pasted, refined): *"Reduce visual clutter by hiding descriptive or instructional text by default. Where a screen currently shows a block of text that explains what the screen is or what the user is looking at, replace it with an info button that reveals the text on demand."* His four calls on the audit: a one-line subtitle under a page's h1 that only restates the title is **deleted**, not hidden; the borderline blocks (promo-card bodies, long toggle captions, guardian-page intros) go behind the (i) too; the site editor's repeated "nothing goes live until you publish" gets its own (i) on every panel; **always collapsed**, nothing remembered.

- **What qualifies:** copy that describes the window, the section or the feature in front of the user — a paragraph or multi-line block that explains what the screen is for, describes what is already visible, or is onboarding-style. **What never does:** user content, labels, placeholders, buttons, errors and validation, empty-state prompts, a confirmation body that names what is lost, a consequence caption on an option or a switch, format instructions, a warning, legal or consent text, anything a person must read to complete an action. A short one-line caption that genuinely helps may stay.
- **ONE component, `src/components/SectionInfo.tsx`** (`'use client'`): `SectionInfo` owns the heading row — the heading, the (i) glued to it (`gap-1`), an optional `trailing` action pushed right (`ml-auto`), then the panel below; the old paragraph's `mb-*` moves to its `className` so the heading never moves when the text opens. Headings a row cannot own (a two-column header, a toggle's label, a card title) use `useInfoDisclosure(label)` → `[wrapRef, d]` with `InfoButton` / `InfoPanel`. The button: `aria-expanded`, `aria-controls` → the panel's `useId`, `aria-label="More information about {section}"`, the house `fa-circle-info`, `ea-interactive`, `text-muted` closed / `text-brand-fg` open. The panel: always mounted, `hidden` when closed (so `aria-controls` resolves and the `ea-dropdown-in` fade replays), `text-sm text-tertiary` — the paragraph's old look; several `<p>` carry multi-sentence copy (an old "Note" box becomes the second paragraph of the section above it; the box, its `<h4>Note</h4>` and the standalone glyph are gone).
- **ONE dismiss hook:** `usePopoverDismiss(wrapRef, open, close)` on the wrapper that holds BOTH the button and the panel — a tap on the open text keeps it open, the button's click toggles, any other press or Escape closes. No listener of its own; pass the one ref object, never an array literal (it is in the hook's deps).
- **A REAL 44 px target** (`h-11 w-11`, `-my-2 -mx-2.5`; `dense` = `-my-3` for a text-sm label row), never the `after:` extender: the Settings shell and the site editor's canvases are `overflow-hidden`, where an extender is clipped with no visual warning (the CLIPPING RULE in `globals.css`). The negative margins overlap neighbours invisibly — never place the (i) directly against another button.
- **Never in `src/app/(public)`** or `src/components/contests/ContestPage.tsx` (server components only): their captions stay. `public/offline.html` (static HTML) stays.
- **Pinned by** `src/lib/__tests__/section-info.test.ts` (the source: the hook, collapsed on load, no storage, the disclosure attributes, the glyph and classes, no `after:` / `focus:`; no Note box under `src/components/settings/`; nothing server-only imports it) and `e2e/section-info.spec.ts` (@mobile, Settings → Privacy: named, collapsed on load, inline between the heading and the first option, outside tap and Escape close it, a 44 px box whose corner `elementFromPoint` resolves to the button).
- **The ledger** of every screen and block (moved, deleted or kept, with the reason) is the Oct 28 2026 devlog entry — the review deliverable Tom asked for. Program: PR 1 the component + Settings; PR 2 profile, feed cards, page h1 deletions, recorder, workouts, golf; PR 3 the org console; PR 4 the site editor and the guardian pages.

## Light and dark on every phone: the page themes itself (Oct 15 2026, zero DDL)

Reported: light mode looked wrong on Android, right on iPhone. Android browsers have a FORCED dark mode (Chrome "Darken websites" / Auto Dark Theme, Samsung Internet's dark mode) that repaints any page that does not say it has its own dark theme — on a dark-OS phone it darkened our LIGHT theme, because the light block said plain `color-scheme: light` ("light only, darken me"). iOS Safari never forces dark.

- **The rule:** the root's scheme is `only light` / `only dark` (`globals.css`, both blocks; a `[data-theme="light"]` site island inherits it) — Chrome's documented opt-out. Both root layouts render `<meta name="color-scheme" content="light dark">` (`viewport.colorScheme`) — the signal Samsung Internet reads. `public/offline.html` does the same. Never "fix" forced dark with `filter: invert` tricks.
- **Three signals, because browsers differ** (Oct 15 follow-up — the reporter was on Samsung Internet; Chrome worked): the `only` root schemes (Chrome), the `color-scheme` meta (Samsung's declaration), and a REAL `@media (prefers-color-scheme: dark)` rule (`:root { --ea-os-scheme: dark }`) — Samsung keeps a site's look only if it finds dark styles there, and ours are keyed to `data-theme`. The variable is a marker: nothing reads it, ever. `src/lib/__tests__/theme-signals.test.ts` pins all three.
- **Native controls wear the theme:** checkboxes, radios and ranges take `accent-color: var(--control-accent)` from BOTH theme blocks (violet-600 light, violet-500 dark — 4.07:1 on the dark surface where violet-600 is 3.03:1); without it Android paints them its own teal. Per element, `accent-control`; never `accent-violet-*` (the always-dark media editor keeps its own). Text inputs, selects and textareas need nothing: Tailwind's preflight makes them transparent over the themed surface.
- **Colour that bypasses the theme** (the Oct 15 sweep): a raw gray utility on themed chrome takes a dark twin APPENDED (`text-gray-300 dark:text-faint` — light stays byte-identical) or swaps to the token whose light value is the same hex (`text-gray-500` → `text-muted`, `bg-/border-gray-400` → `bg-/border-faint`). Surfaces that paint themselves outside the stylesheet read the theme themselves: `global-error.tsx` (it replaces the root layout) reads the `ea-theme-resolved` cookie; Leaflet's own chrome has dark overrides at the end of `globals.css` (the tiles stay light — a dark basemap is its own decision). Deliberately light in both: org logo plates (`OrgHero`), the site-gallery thumbnail (a miniature page).
- **Known limit:** Samsung Internet's dark mode can still override some sites whatever the page says (Samsung DevRel: no developer bypass); the user-side switch is Labs → "Use website dark theme".
- **Pinned by** `e2e/android-forced-dark.spec.ts` (@mobile, Chromium projects): Chromium's own force-dark switch on a dark-OS Pixel 7 with the theme pinned light; forced dark acts at PAINT time (computed styles never change), so it reads the screenshot's mean brightness — 30 before the fix, light after.

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
Aug 2026), prompted by the Vitals redesign shipping "invisible" on phones — the
components were identical at every width, but the Vitals tab sat off-screen in the
profile tab scroller and `/u/` (where most profile links land) had no Vitals at all.
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
2. **Sport** (`fa-medal`, `data-create-sport`) — the composer with the **Select Sport** picker already open (`CreatePostModal` prop `openSportPicker`; `AppHeader onCreateSport`, else `/feed?create=1&pick=sport`). Picking golf lands in the golf section with "Playing now" → Go Live creates the round; a stat-line sport gets its stats form; closing the picker leaves a General post — the Oct 10 "posts start General" rule keeps this as its ONE explicit door. There is no standalone sport screen (Tom's choice, Oct 13).
3. **Event** (`fa-flag-checkered`, `data-create-event`) — the wizard at `/sports/events/new`, as before.
4. **Record Activity** (`fa-stopwatch`, `data-create-record-activity`) — a SECOND STEP in the same window (`data-create-step="record"`, Back = `data-create-back`): **Start a workout** (`fa-dumbbell`, `data-create-workout`) and **Record activity** (`fa-person-walking`, `data-create-recording`). The icons are the resume pill's (`PILL_KIND_ICON`).

**One start path.** `src/hooks/useStartWorkout.ts` is the ONE way a live workout starts — lifted verbatim from Vitals: `POST /api/workouts { mode: 'live', routineId? }`, 409 → resume the session in progress, `refreshDrafts()` so the pill and the Drafts count learn it, `/app/workout/<id>`; with saved routines `open()` shows `StartWorkoutSheet` (the caller renders it — Vitals and the header both do). Vitals' Start Workout and Create → Start a workout call the same hook, so the screen, the timer, the autosave, the resume pill and the summary are identical by construction (`e2e/activities-doors.spec.ts` proves it). Record activity is `router.push('/activities/record')` in both places. `sessions-pill.test.ts` holds the hook to `refreshDrafts()`.

**Import Activity is gone** (PR 1 of the redesign): no door, no page, no `.FIT` route, no copy — see `activities.md` (Oct 13 2026).

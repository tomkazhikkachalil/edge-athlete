# Edge Athlete — what comes after the fix round (Oct 2 2026)

Tom's direction, Oct 2 2026. The July roadmap (`ROADMAP_2026-07.md`) got the
product to launch; this is the short list of what is decided for AFTER the
post-launch fix round. It records decisions and their order, not designs — each
item is planned properly when it starts.

## Where we are

The web app is the product, and it is phone-first: every screen ships at phone
width alongside desktop (CLAUDE.md "Web & Mobile Ship Together"). Tom: "we're in
a good place with the web friendly mobile app." Production is live behind the
launch gate while the fix round runs, one issue at a time.

## 1. Install the web app on a phone — BUILT (Oct 2 2026, "Download the app")

**Status:** the Download button shipped — the account menu ("Get the app"),
Settings → Account, a one-time card on the feed on phones and tablets, and a
line on the sign-in page. Android and desktop Chromium install in one tap;
an iPhone is shown the three taps (Share → Add to Home Screen → Add), because
Apple gives a website no install API; another app's browser is told to open
Safari / Chrome first. Every invitation leaves once the app is installed.
`docs/specs/install-and-push.md` convention 31 has the rules; DEVLOG Oct 2 2026 the record.

**Still open here, each its own later round:** an offline shell and push
notifications (both need a service worker, and `worker-src 'self'` in
`buildCsp` before one can register; iOS allows web push only for an INSTALLED
web app), an iOS splash image, and a QR code on the desktop guide (needs a
dependency). Tom's own phone is the proof no test can give — "Continue with
Google" inside the installed iPhone app is the one thing to try and report.

What this section said before the build:

The site already has what a phone needs to install it: a web manifest
(`src/app/manifest.webmanifest/route.ts` — standalone, themed, the icons), so
"Add to Home Screen" works today on an iPhone and Android offers Install.

What is missing is making it OBVIOUS and good:
- an Install prompt / a "how to add it to your Home Screen" line (iPhone has
  no install button — it is Share → Add to Home Screen, and people need telling);
- a check of the installed experience at phone width (the tab bar, the safe
  areas, sign-in surviving a relaunch);
- later, if wanted: an offline shell and push notifications (iOS allows web push
  only for an INSTALLED web app).

No store, no fee, no review. This is the bridge until item 2.

## 2. Official store apps — Apple App Store and Google Play

Decided: Edge Athlete will have a real iPhone app and a real Android app.
Not started; a program of its own, after the fix round.

- **Stage 1 — the companion app (each store):** the existing site inside a
  native app, plus what only a native app can do — reading the phone's health
  store (Apple Health on iPhone, Health Connect on Android) and push
  notifications. This is what makes a watch workout arrive by itself, free, for
  the athlete.
- **Stage 2 — record from the wrist:** a watch app that starts Edge Athlete
  things (a Training workout, a golf round, an event) — sport-specific recording
  the stock fitness apps do not do. **Superseded in part on Oct 4 2026 (Live
  Activities):** the web app now IS a run / ride / walk recorder
  (`/activities/record` — foreground, screen on, a map, segments, photos; see
  `docs/ACTIVITIES.md` "Recording live"). What stays native: recording with
  the screen OFF or the app in the background, a real step count from the
  health store, and the watch itself.
- **Scheduled (Tom, Oct 9 2026): before the launch gate opens to the general
  public** (the site is live but gated). **iPhone first.** Its first feature is
  recording with the phone locked — walk, run, hike and ride only (golf and the
  other sports stay foreground). The web recorder already tells the athlete so.
  Prerequisites found that day: this Mac has no Xcode (command-line tools
  only), no CocoaPods, Java, Android SDK or Homebrew; 37 GB free, 8 GB memory.
  Tom installs Xcode from the Mac App Store (~15–20 GB) and enrols in the Apple
  Developer Program to run beyond 7-day test builds. Still to decide: how the
  app holds the site — recommended, the live site inside a Capacitor shell with
  the free community background-geolocation plugin feeding the existing
  recorder (`src/lib/activities/gps-filter.ts`), since the app's server routes
  cannot be bundled.
- **Decided (Tom, Oct 22 2026): the shell is Capacitor with native
  background location for the recorder, and the native app does NOT gate the
  public opening** — the web app opens the doors first and the iPhone app
  follows. Until then outdoor recording relies on the screen wake lock the
  web recorder already holds (`RecordingEngineHost`). The prerequisites and
  costs below stand; the start date is set by the go-public date.
- **Costs to plan for:** Apple Developer Program US$99 / year, Google Play
  US$25 once; a Mac with Xcode, a real iPhone and Watch to test on; App Store
  and Play review; a third surface to keep working beside web and phone-width
  web.

### Sized Oct 22 2026 — and deferred until the go-public date is set

Tom asked what the native apps would cost and whether to build them now, while
many web updates are still pending. The review (read-only, the whole tree):

**How the app is held.** 148 pages and 476 API routes over server components —
nothing can be bundled, so the shell loads the live site (Capacitor
`server.url = https://edgeathlete.ca`). The WebView's origin IS the site, so the
`@supabase/ssr` cookie session, the launch gate, CSP and `public/sw.js` keep
working (iOS needs `WKAppBoundDomains` = edgeathlete.ca for the worker). Web
changes ship instantly without a store release; only native-plugin changes
need a submission. Camera inputs, `getUserMedia`, HEIC/WASM, direct-to-storage
uploads, Leaflet and the IndexedDB drafts work in a WebView as they are.

**What breaks or goes missing inside the shell (six, all verified in code):**

1. `src/lib/install/platform.ts` reads a UA without `Safari/` as `ios-in-app`,
   so the shell would be told "open this in Safari" and the push UI would hide
   — a `native` mode is needed (small).
2. Google refuses sign-in inside a WebView (`disallowed_useragent`) and the
   PKCE verifier lives in the WebView's cookies (`src/lib/oauth.ts`, the
   callback route names the failure) — native Google + Apple sign-in through
   `signInWithIdToken`, new on the web side; Apple's rule 4.8 makes Sign in
   with Apple mandatory once Google is offered (medium).
3. WKWebView has NO Web Push — without native push the iPhone app would get
   fewer notifications than the installed web app, so APNs (and FCM for
   Android) are v1: a `kind` on `push_subscriptions` (one migration), a
   second branch in `src/lib/push/send-server.ts`, taps that deep-link into
   the WebView (medium).
4. Locked-phone recording, the reason for the app: `useWatchPosition`
   (`src/lib/activities/record/geolocation.ts`) is the only location wrapper
   — a source interface, the background-geolocation plugin feeding the same
   `GeoFix` stream into `gps-filter.ts`, "Always" permission strings, an
   Android foreground-service notification (medium, plus real walks).
5. 30 `target="_blank"` links, `mailto:`/`tel:`, the `.ics` downloads — a
   WebView navigates in place; the Browser / FileOpener plugins (small).
6. Deep links — Universal Links + App Links (`/.well-known/`) so shared links
   and notification taps open the app (small).

**Store risks that are not code:** Apple rule 4.2 rejects an app that is
"just a website" — v1 must carry at least two of background recording, native
push and health reading; a PERSONAL Google Play account must run a 14-day
closed test with 12 testers before production (an organisation account skips
it); 1–3 days of review per iOS submission.

**The estimate** (this project's PRs; calendar time at the current cadence;
Tom's hands-on time apart):

| Workstream — iPhone v1 | PRs | Tom's time |
| --- | --- | --- |
| 0. Tooling, Apple enrolment, a `native/` Capacitor project | 1 | Xcode, enrolment (1–7 days wait), certificates ≈ 1 day |
| 1. Shell: `server.url`, UA token, `native` install mode, app-bound domains, external links, safe areas, Android back | 2–3 | device checks |
| 2. Native Google + Apple sign-in → `signInWithIdToken`; Services ID, OAuth client IDs | 2 | consoles ≈ ½ day |
| 3. Background recording: source interface, plugin, permissions, start-screen copy | 2–3 | 3–5 real walks / rides |
| 4. Native push: migration, APNs branch, native registration, tap → deep link | 2–3 | APNs key |
| 5. Universal Links + store readiness: icons, splash, screenshots, privacy labels, listing, first review | 1–2 | ≈ 1 day + the review wait |
| **iPhone v1** | **10–14 PRs, ~3–4 weeks with the waits** | **≈ 3–5 days spread** |
| Android after the iPhone (same plugins, FCM, Play listing; Health Connect later) | 5–7 PRs, ~1.5–2 weeks (+14 days on a personal Play account) | Android Studio, a test phone, listing ≈ 1 day |
| Stage 1 health-store reading (Apple Health / Health Connect → `importActivity`) | 3–4 PRs | permissions, test workouts |

**The standing cost:** a third surface — every maintenance round gains a
manual device pass on the shell (Playwright cannot drive a WebView) ≈ half a
day; any plugin or OS change is a store re-submission; two more credential
sets to keep alive.

**The call: not now.** (1) The app does not gate the opening (decision above)
and none of LAUNCH_RUNBOOK §0's seven blocking items is native. (2) The
installed web app already gives the icon, full screen, push on iOS 16.4+ and
Android, the camera and screen-on GPS; the native app closes three gaps —
locked-phone recording, the watch / health store, a store listing. (3) Every
pending web update would pay for it: screenshots re-shot, a device pass per
round. (4) The waits that cost calendar time cost no code — they can run now.

**Start trigger (whichever first):** the go-public date is set, or the first
real user asks for locked-phone recording or a watch import. Order unchanged:
iPhone → Android → health store → watch.

**What to do meanwhile, no PR:** Tom enrols in the Apple Developer Program,
opens the Google Play account as an ORGANISATION (skips the closed test) and
installs Xcode when disk allows. Optional, inside normal rounds and only if
cheap that day: the `native` install mode (one rule + test) and the
location-source interface in the recorder (pure refactor). Neither is owed.

**Tom, Oct 22 2026 (later that day): "let's plan to do this within the next
few months."** The window is set: the native round starts within the next
few months, after the web updates in hand, on the trigger above — iPhone
first, then Android.

## 3. Watch and app connections — BUILT, PAUSED, hidden in production

Fix round part 3 (#1027–#1032, migration 247) built Connected apps: Settings →
Connected apps, the Apple Watch upload link, Polar. **Tom paused it on Oct 2
2026** — the free Apple Watch route needs a paid third-party app, and the right
answer is our own app (item 2). So:

- **Hidden in production:** `NEXT_PUBLIC_FEATURE_CONNECTED_APPS` is off there.
  No tab, no entry points, no owner's setup panel.
- **Kept and tested:** the code, migration 247 and its table stay; the flag is
  on in CI's smoke build, in Preview and locally, so it keeps passing its tests.
- **Still live for everyone:** activities inside Training, recorded live on the
  phone. The file import (`.fit` / `.gpx` / `.tcx`) was live too until
  **Oct 13 2026**, when Tom removed it with the Create menu redesign — nothing
  in the product promises an import until the native app delivers the watch.
- **Dropped for now:** the Polar client, the Wahoo / COROS / Suunto
  applications, the real-device Apple Watch test. `docs/CONNECTIONS_APPLICATIONS.md`
  keeps the text for the day they are wanted.
- **To resume:** set the flag in Vercel → Production and build. Stage 1 of
  item 2 is expected to feed the SAME pipeline (`importActivity`, the duplicate
  rule, `activity_connections`) — the native app becomes one more source.

`docs/ACTIVITIES.md` → "Connected apps" is the technical reference.

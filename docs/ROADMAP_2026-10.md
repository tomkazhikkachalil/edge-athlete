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
CLAUDE.md convention 31 has the rules; DEVLOG Oct 2 2026 the record.

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
  things (a Vitals workout, a golf round, an event) — sport-specific recording
  the stock fitness apps do not do. **Superseded in part on Oct 4 2026 (Live
  Activities):** the web app now IS a run / ride / walk recorder
  (`/activities/record` — foreground, screen on, a map, segments, photos; see
  `docs/ACTIVITIES.md` "Recording live"). What stays native: recording with
  the screen OFF or the app in the background, a real step count from the
  health store, and the watch itself.
- **Costs to plan for:** Apple Developer Program US$99 / year, Google Play
  US$25 once; a Mac with Xcode, a real iPhone and Watch to test on; App Store
  and Play review; a third surface to keep working beside web and phone-width
  web.

## 3. Watch and app connections — BUILT, PAUSED, hidden in production

Fix round part 3 (#1027–#1032, migration 247) built Connected apps: Settings →
Connected apps, the Apple Watch upload link, Polar. **Tom paused it on Oct 2
2026** — the free Apple Watch route needs a paid third-party app, and the right
answer is our own app (item 2). So:

- **Hidden in production:** `NEXT_PUBLIC_FEATURE_CONNECTED_APPS` is off there.
  No tab, no entry points, no owner's setup panel.
- **Kept and tested:** the code, migration 247 and its table stay; the flag is
  on in CI's smoke build, in Preview and locally, so it keeps passing its tests.
- **Still live for everyone:** activities inside Vitals and the file import
  (`.fit` / `.gpx` / `.tcx`) — those are not part of the pause.
- **Dropped for now:** the Polar client, the Wahoo / COROS / Suunto
  applications, the real-device Apple Watch test. `docs/CONNECTIONS_APPLICATIONS.md`
  keeps the text for the day they are wanted.
- **To resume:** set the flag in Vercel → Production and build. Stage 1 of
  item 2 is expected to feed the SAME pipeline (`importActivity`, the duplicate
  rule, `activity_connections`) — the native app becomes one more source.

`docs/ACTIVITIES.md` → "Connected apps" is the technical reference.

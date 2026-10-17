# Browser support: every browser a customer uses works the same

> Read the devlog entries named here (`docs/devlog.md`, Oct 15–17 2026) before changing the browser harness or anything it guards.

## Convention 46 — Every browser works the same; we feature-detect, never sniff, and a blocker never decides what works (every-browser round, Oct 16–17 2026, zero DDL)

Two reports in two days came from browsers our tests did not run: **Samsung Internet** repainting light mode with its forced dark (Oct 15, #1197–#1200), and **Brave for Android**, where changing the profile cover failed (Oct 16). The rule since then:

**The browsers.** Chrome (Android, desktop), Safari and every iOS browser (all WebKit), Samsung Internet, **Brave** (Chromium + Shields), **Firefox**, Edge. The floor is iOS 15 / Chrome 100 / Firefox 100 (`browserslist`, `npm run check:syntax`).

**What each Playwright project proves** (`playwright.config.ts`):

| Project | Engine | Answers |
| --- | --- | --- |
| `desktop` | Chromium 1280 | the large screen |
| `mobile` | Chromium 390 | phone width, fake camera |
| `webkit-mobile` | WebKit (iPhone) | Safari and every iOS browser |
| `android` | Chromium, Pixel 7 | Chrome for Android; Samsung via `android-forced-dark.spec.ts` |
| `brave-android` | Pixel 7 + Shields (`e2e/helpers/brave.ts`) | Brave's default lists block and hide; canvas farbling; no `navigator.connection`; push refuses to subscribe |
| `firefox-mobile` | Gecko 390 × 844, touch | Firefox |

Every spec imports `test` from `e2e/helpers/test.ts` (pinned by `e2e-imports.test.ts`) so the Brave fixture reaches every context. `@mobile` specs run in all five phone projects — by area, one project at a time, paced against staging (staging is the free tier: a long unpaced sweep starves it).

**The rules.**

- **Feature-detect; never read the user agent.** Brave is `navigator.brave`; push support is the APIs and the permission; nothing branches on a browser's name.
- **No first-party path a blocker would block.** `npm run check:blocklists` runs every `src/app/api` route, `/o/` image, `/api/media/`, the worker, the manifest and the icons — and every UI class and `data-*` hook — through Brave's own list set and fails on a match. It needs the network, so it is in the maintenance checklist, not CI. Error reports go through our own `/api/relay` (Sentry `tunnelRoute`), because the lists block Sentry's ingest host and `/monitoring`.
- **A browser's refusal is named, not retried.** Brave Android refuses a push subscription unless "Use Google services for push messaging" is on: `enablePush` returns `refused`, the card names the toggle and snoozes.
- **Forced dark is opted out** (`color-scheme: only light` while the app is light; the Samsung marker rule) — `android-forced-dark.spec.ts`.
- **One request stays under Vercel's 4.5 MB.** The profile photo route carries the render and, only while they fit 4 MB, the kept original (`photo-recipe.ts` `keepSourceAsIs`, `sourceFitsRequest`); every other media byte goes direct to storage.
- **Nothing covers a control.** A fixed pill with nothing tappable in it lets taps through (`OfflineBanner`, Oct 17).

**What simulation cannot prove:** a bug inside Brave's own Chromium build, a list we do not load, a real device's camera. Sentry through the relay is the backstop; a user report gets the Shields-off test (lion icon → Shields down for edgeathlete.ca) to tell blocking from anything else.

# Connected apps — the provider applications (Oct 1 2026)

Settings → Connected apps lists seven sources. Two are built (the Apple Watch
upload link and Polar). Three more open to us only after the provider reviews
an application — **those are Tom's to send**, because each one binds the
company to the provider's agreement. This file is the checklist and the text
to paste. `docs/ACTIVITIES.md` → "Connected apps" is the technical reference.

What every application will ask, with our answers:

| They ask | Our answer |
|---|---|
| Product | **Edge Athlete** — a multi-sport athlete network: profiles, performance stats and training history ("Vitals"), teams, clubs and leagues. Web app at `https://edgeathlete.ca` (mobile-first; no native app yet). |
| What we do with the data | Read-only. A workout the athlete records appears in THEIR Vitals (training history, weekly totals, streak). It is shown to the people who can already see their profile, and reaches the feed only when the athlete taps Share. |
| Data we request | Completed workouts / activities only: the summary and the FIT file (time, distance, heart rate, GPS route). No sleep, no daily health metrics, no write access. |
| Consent | The athlete connects from Settings and is told, before leaving for the provider, that workouts will appear in their Vitals where people who can see their profile can see them. Disconnect is one tap; it revokes at the provider and deletes the token. |
| Privacy | The route's first and last 200 m are hidden from everyone but the athlete; a supervised (under-age) athlete cannot connect at all; "Only me" per activity; account deletion removes activities and GPS streams. |
| Security | Provider tokens are encrypted at rest (AES-256-GCM, key outside the database); webhooks are verified by signature; no token ever reaches a browser. |
| Attribution | Every activity is credited to its source in plain words ("Recorded with …"), no logo unless the provider grants one. |
| Scale today | Honest: **pre-launch** — the site is live behind an invitation gate. Say so; do not inflate. |
| Company | *Tom fills in: legal name, country (Canada), a contact email, a technical contact.* |

URLs to register (the routes follow Polar's shape and are built when access is granted):

- OAuth redirect: `https://edgeathlete.ca/api/connections/<provider>/callback`
- Webhook: `https://edgeathlete.ca/api/webhooks/<provider>`
- Privacy policy: `https://edgeathlete.ca/privacy` · Terms: `https://edgeathlete.ca/terms`

## Wahoo — Cloud API

- **Where:** the Wahoo Developer Portal → My Apps → "Add a new app" (<https://developers.wahooligan.com/cloud>).
- **How it works:** a **Sandbox** app is self-serve and works at once with a very low rate limit (25 requests / 5 min). A **Production** app is a SEPARATE application reviewed by Wahoo — a sandbox app cannot be converted. Submit both: sandbox to build against, production for athletes.
- **Scopes to request:** `user_read`, `workouts_read`, `offline_data` (the last one is what makes the `workout_summary` webhook fire).
- **Paste as the description:**

  > Edge Athlete is a multi-sport athlete network (edgeathlete.ca). Athletes keep their training history in a section called Vitals. We would like athletes who ride or run with Wahoo devices to connect their Wahoo account once, so each completed workout appears in their own Vitals automatically. We read completed workout summaries and their FIT files only (via the workout_summary webhook and the workouts endpoints); we do not write to Wahoo. Workouts are shown to people who can already see the athlete's profile and are shared to the feed only when the athlete chooses. Athletes can disconnect at any time, which deauthorizes the app and deletes the token. Tokens are encrypted at rest; start and end of every GPS route are hidden from other users.

## COROS — Partner API

- **Where:** "Submit an API Application" (<https://support.coros.com/hc/en-us/articles/17085887816340-Submit-an-API-Application>), then email `api@coros.com` with company details, a technical contact and the OAuth redirect URI.
- **What to expect:** the Partner API (multi-user OAuth, workout push, FIT download) is described as for platforms **with an established user base**. Pre-launch, a refusal or a "come back later" is likely — apply anyway, it costs nothing, and ask what threshold they use.
- **Worth knowing:** COROS also documents a no-approval route for apps that connect to a user's data over OAuth ("Build on COROS MCP", <https://support.coros.com/hc/en-us/articles/53181619102996-Build-on-COROS-MCP>). I have not verified that it delivers workout FIT files to a server the way the Partner API does; if the Partner application stalls, that is the next thing to test.
- **Paste as the description:** the Wahoo paragraph above, with "COROS watches" and "workout summary push and getWorkoutDetailFit".

## Suunto — Partner Program (Cloud API)

- **Where:** the partner application form linked from <https://us.suunto.com/pages/welcome-partners>; on acceptance (they say within two weeks) you sign Suunto's API agreement and receive access to <https://apizone.suunto.com>.
- **What they ask:** company / organization (access is for companies and organizations, commercial or not — **not personal use**), what you are building, and **the names and emails of each developer** who needs API Zone access.
- **Paste as the description:** the Wahoo paragraph above, with "Suunto watches" and "workout notifications and FIT download through the Suunto Cloud API".

## Closed for now — nothing to send

- **Garmin** (Connect Developer Program): not admitting new developers at the moment. Check <https://developer.garmin.com/gc-developer-program/> periodically; the application is a business form.
- **Fitbit / Pixel Watch:** the Fitbit Web API is being switched off (Oct 30 2026) and Google is not onboarding new projects to its replacement yet.
- **Strava:** left out by decision — its API agreement allows an athlete's data to be shown only to that athlete.

Until one of these opens, those athletes use the file import (every watch exports a `.fit`), which lands in Vitals the same way.

## Polar — already self-serve (for the record)

No application: create a client at <https://admin.polaraccesslink.com>, which accepts the Polar API License Agreement (22 Aug 2025). The terms to know before accepting — they are Tom's call:

- **2.2** — the client may not be used "in creating a service similar to or competing with Polar Ecosystem" and its "primary purpose … shall be extending and improving the Member's experience". Edge Athlete shows an athlete's Polar workouts in their training history; whether a training-history section reads as "similar to" Polar Flow is a judgment, not a technical question.
- **3.1.1** — data goes to others only with the member's explicit permission → the consent line on the Polar card.
- **3.1.5** — credit Polar as the source wherever the data is shown → "Recorded with Polar".
- **7.4** — no Polar logo or product names without written consent → the credit is plain words.
- **3.3** — on the member's request, stop access, revoke and delete the token → Disconnect does all three.
- **8.3** — Polar may suspend access at any time, for any reason.

The setup steps are on the admin dashboard ("Connected apps — Polar setup").

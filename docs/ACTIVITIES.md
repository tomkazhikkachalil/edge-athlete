# Activities — imported GPS activities (Activities program, Sep 29 2026)

Runs, rides, hikes and other activities an athlete's watch or app recorded.
Phase 1 imports **files** (.FIT / .GPX / .TCX). Every device can export one,
and no provider approvals are needed. Later providers (Strava, Google Health,
Garmin) plug in as **adapters** that produce the same normalized shape.
Nothing downstream of that shape ever learns a provider's format.

Migration **245** is the only DDL. The code lives in `src/lib/activities/`
(pure unless named `-server`), `src/components/activities/`, the routes under
`src/app/api/activities/` and `src/app/api/profile/[profileId]/activities/`,
and the pages `/activities/import` and `/activities/[id]`.

## Tom's decisions (Sep 29 2026)

- **Phase 1 is file import only.** Strava, Google Health (Fitbit / Pixel) and Garmin come in later rounds.
- **Apple Watch uses file export for now** (HealthFit and similar). A companion iOS app is deferred.
- **Route privacy.** Everyone except the owner sees the route with its **first and last ~200 m trimmed**. On a **supervised** athlete, only the athlete and their guardians see the map; everyone else gets the stats and charts with no position at all.
- **The feed is the athlete's choice.** Imports land in the athlete's Vitals, and the athlete taps **Share to feed**.
- **Activities are part of Vitals (Oct 1 2026).** They were their own profile tab; see "Inside Vitals" below.
- **FIT decoding uses Garmin's official `@garmin/fitsdk`**, server-side only (see the license note below).

## The entity

`activities` (245, posture A: RLS on, no policies, service role only) holds one row per activity per athlete.

- **An activity is NOT a sport.** `activity_type` is its own list (`catalog.ts` ≡ 245's CHECK, pinned by a test): run, trail_run, walk, hike, ride, mountain_bike, swim, row, ski, climb, other. It follows the training → post-category precedent, and nothing writes `athlete_performances` in phase 1. Bridging activities into the dataset (e.g. a run's times for recruiting) is a separate decision: it would need a `source_table` value, a `natural_key` prefix and a vocabulary.
- **The dedupe key** is `UNIQUE (profile_id, source, external_id)`. For a file, `external_id = start:<unix seconds>`, because an athlete cannot start two activities in the same second. The same run exported as .FIT and as .GPX is therefore **one** activity, and a re-import refreshes it.
- **Totals** (`elapsed_s`, `moving_s`, `distance_m`, `elev_gain_m`, …) are computed by the **server** from the points. A device's own total is kept only when it agrees with the points (distance ±15%, ascent 0.5–2× + 50 m).
- **`route_preview`** is an encoded polyline (≤ 200 points) stored **already trimmed**, so every reader of it is safe by default.
- **`stream_path`** points at the full stream: gzipped columnar JSON in the private `uploads` bucket at `activities/<profile>/<id>.json.gz` (≤ 2,000 samples). It lives in storage, not rows, so the table stays small at tens of millions of activities.
- **`post_id`** (SET NULL) is the feed post. **`only_me`** is the per-activity "Only me".
- **`occurred_on`** is the LOCAL date: the file's own UTC offset (FIT `local_timestamp`) first, then the uploader's IANA zone, then UTC.

## The pipeline

```
.GPX/.TCX ──browser──▶ parse-gpx / parse-tcx ──▶ NormalizedActivity ──toWire──▶ POST /api/activities ──┐
.FIT ──raw upload──▶ POST /api/activities/fit ──▶ parse-fit-server ──▶ NormalizedActivity ─────────────┤
(later) Strava / Google Health / Garmin webhook ──▶ provider adapter ──▶ NormalizedActivity ───────────┤
                                                                                                      ▼
                        write-server.importActivity: cleanPoints → summarize → implausibility
                        → buildStream (storage FIRST) → upsert the row (the dedupe key)
```

- **GPX/TCX are parsed in the browser.** A long ride's XML can exceed Vercel's 4.5 MB request cap, and the compact payload (`wire.ts`, ≤ 10,000 samples) is well under 1.5 MB. The parsers are regex scanners (`xml-scan.ts`, with no DOMParser and no entity or DTD resolution), so they run in node too.
- **A FIT is uploaded raw** (≤ 4 MB; a long ride is a few hundred KB) and decoded on the server.
- **The server never trusts client totals.** `wire-schema.ts` refuses misaligned columns, a lone latitude and extra keys.
- **Refusals name the fix:** "faster than a run can go — pick that type and try again", "longer than 48 hours", "not a real date", "a planned route, not a recorded activity".
- **`cleanPoints`** drops the FIX (never the sample) of a GPS jump faster than 3× the type's top speed.

### The FIT SDK license: never on a client

`@garmin/fitsdk`'s license (the FIT Protocol License) treats the SDK as
Garmin's confidential information and forbids making it available to third
parties. A browser bundle would ship its source to every visitor, so:
- it is imported **only** from `-server.ts` modules, which a test in `visibility.test.ts` enforces;
- `.FIT` goes to `POST /api/activities/fit`;
- the PR 4 check confirmed zero client chunks contain it.

## Who sees what: the ONE gate, then the projection

`read-server.ts resolveActivityAccess(admin, viewerId, profileId)` is the gate for every reader (the page, the tab, the counts, the share):

| Viewer | Result |
|---|---|
| the athlete, or a guardian of the athlete | `owner` |
| a departed athlete's page, a block / mute either way | refused (the same 404 as not-found) |
| signed in | `canViewProfile` (public, an accepted follower, an access row) |
| signed out | a public profile only |
| anyone else, looking at a SUPERVISED athlete | `supervised_viewer` |
| anyone else | `viewer` |

"Only me" is the owner's alone. `visibility.ts` then decides WHAT each audience receives, and the projection IS the access rule (tests serialise each one):
- **owner:** everything, including the controls. The storage path never leaves the server.
- **viewer:** `trimStream`, so positions within 200 m of either end become null. The other columns stay, because a chart reveals no place.
- **supervised_viewer:** no `lat` / `lng` key anywhere, and no preview.

Every response is `private, no-store`, since it is viewer-dependent (the edge-cache trap).

## Inside Vitals (Oct 1 2026)

Tom: the watch integration "was supposed to be a part of the Vitals app". Until
then Vitals counted one thing — a completed gym workout — and an imported run
moved no weekly bar, no streak, no active day.

- **One session shape.** `src/lib/vitals/session-math.ts` `VitalsSession` is a
  completed workout or an activity; `sessionsWeeklySummary`, `sessionsStreakWeeks`,
  `sessionsActiveDays` and `sessionsWeeklyBars` are the ONE week rule. The
  workout-only helpers (`weeklySummary`, `streakWeeks`, `activeDaysThisWeek`,
  `weeklyBars`) delegate to them. `src/lib/vitals/sessions.ts mergeSessions` is
  what `VitalsTab` renders from.
- **The read.** `GET /api/profile/[profileId]/activities?sessions=1` answers the
  last year as `{ id, type, name, startedAt, elapsedS, movingS, distanceM }` —
  no route, no heart rate. The page form (the Activities section's list) is
  unchanged.
- **Vitals privacy applies to the LISTING.** An athlete who hides Vitals, or its
  Workouts aspect, hides both forms of that read from everyone but themselves and
  their guardians (`hidden: true`). A single activity's page keeps the activity
  gate alone, so a post the athlete shared still opens.
- **The tab is gone; the link is not.** `?tab=activities` (the import page, the
  activity screen and shared links use it) opens Vitals at its Activities section
  on both profile routes (`ProfileMediaTabs.tsx parseProfileTab`, `u/[username]`).
- **A shared activity is a training post** (`post_category: 'training'`, set by
  the posts route), so it lists under Vitals → Training Activity like a shared
  workout.

## Share to feed

The page posts `POST /api/posts` with `stats_data {type:'activity', activity_id}`. That is a **request**:
- `share-server.ts` rebuilds the card from the author's own row (the trimmed preview, or no route for a supervised author), and refuses "Only me" and an already-shared activity by name.
- The activity links back through a compare-and-set, and the loser of a race deletes its own post.
- A supervised author's post goes to guardian approval like any other.
- The feed renders `ActivityPostCard` from the stored payload: a line drawing (`route-svg.ts`, no Leaflet) plus the numbers.

## The routes

| Route | Gate | Notes |
|---|---|---|
| `POST /api/activities` | write gate · `activity-import` bucket (60/h) · acting gate | GPX/TCX payload; 201 new / 200 `duplicate: true` |
| `POST /api/activities/fit` | same | multipart: `file`, `tz`, `type?`, `targetProfileId?` |
| `GET /api/activities/[id]` | the one gate | the detail projection + the athlete's name / handle |
| `PATCH` / `DELETE /api/activities/[id]` | owner audience | name, type, Only me (refused while on the feed); delete takes the stream and the post |
| `GET /api/profile/[profileId]/activities` | the one gate, then the Vitals privacy aspect for a viewer | keyset list (a strict ISO timestamp + uuid cursor), count, 12 weeks of totals; `?sessions=1` = the Vitals week maths' read |

| `GET /api/connections` | session (own rows) | one entry per provider; `supported`, `ready`, `supervised` |
| `DELETE /api/connections/[provider]` | session · `connection-write` bucket | the row goes, the activities stay; not write-gated on purpose |
| `POST /api/connections/upload-link` | write gate · `connection-write` bucket · not supervised | mint or replace; the URL is returned once |
| `POST /api/activities/inbound/[token]` | the token · write gate on its account · `activity-inbound` (IP) + `activity-inbound-link` buckets | no session by design; bridge JSON or a raw file |

| `GET /api/connections/polar/start` · `/callback` | session · write gate · not supervised · signed state | navigations; always end in a redirect to Settings |
| `POST /api/webhooks/polar` | Polar's signature | no session; 404 while Polar is not configured |
| `GET` / `POST /api/admin/connections/polar-webhook` | admin | setup status; create the webhook (the key is shown once) |

The import routes, the link's mint, the inbound route and Polar's two connect routes are on THE write-gate list (`write-gate.test.ts`, `docs/SUPPORT.md`).

## Lifecycle and retention

- **Deleting an activity** removes the post, then the row, then the stream object. A failed object remove is logged; it cannot leave a row pointing at nothing.
- **Account deletion:** `activities.profile_id` is classified `goes`. The engine collects every stream path up front and removes them with the person's other storage, so a location trace leaves with the person.
- **The storage sweep never touches `activities/`** (`PROTECTED_PREFIXES`). Streams leave only through the two paths above, and the QA teardown removes a QA athlete's streams.
- **Retention:** an activity lives until the athlete deletes it or leaves (HARDENING B5: owner-controlled personal data, no timed purge).

## Connected apps (Oct 1 2026, mig 247)

Tom: *"You're supposed to connect permanently so anything you do with your smart watch will then populate on the app … you connect to the applications in settings."* A **connection** is a watch or an app the athlete links ONCE in Settings → Connected apps (`/settings?tab=connections`); every workout it records then arrives by itself, lands in Vitals, and is shared only when the athlete taps Share.

**The table.** `activity_connections` (247, posture A): one row per athlete per source — `provider`, `status` (`active | revoked | error`), `provider_user_id` (how a webhook finds the row), `secret_ciphertext` (the OAuth tokens, sealed by the app), `token_hash` (the personal upload link, sha256 — the calendar feed token's shape), `connected_at`, `last_sync_at`, `last_error`. Classified `goes`; the deletion engine removes it by name. Disconnecting **deletes the row**; the activities it delivered stay — they are the athlete's.

**The vocabulary** (`catalog.ts ACTIVITY_SOURCES` ≡ 247's `activities_source_check`; `connections.ts CONNECTION_PROVIDERS` ≡ the provider CHECK = the sources without `file`; all pinned by test): `file`, `upload_link`, `polar`, `wahoo`, `coros`, `suunto`, `garmin`, `google_health`. Being named connects nothing — `PROVIDER_DEFS[provider].stage` says where each stands, and a card offers Connect only when it is `live`:

| Source | What it is | Stage (Oct 1 2026) |
|---|---|---|
| `upload_link` | Apple Watch: a bridge app on the iPhone posts each workout to the athlete's personal upload link (Apple has no web or server API). | **live** |
| `polar` | Polar AccessLink: self-serve OAuth, webhooks, FIT download. | **live** once the deployment holds Polar's client id + secret and the sealing key; until then the card reads "Coming soon" |
| `wahoo` · `coros` · `suunto` | Open after the provider's own review. | applying |
| `garmin` · `google_health` | Closed to new developers for now (Garmin's programme is paused; the Fitbit Web API switches off Oct 30 2026 and Google is not onboarding new projects to its replacement). | closed |
| Strava | **Left out (Tom).** Its API agreement (effective Jun 1 2026) lets an athlete's data be shown only to that athlete, kept at most seven days, and never combined into our dataset — a permanent Vitals history and a shareable post are not possible under it. | — |

**The rules, each with its owner:**
- **No response ever carries a secret.** `connections-server.ts` is the ONE reader and writer; its reader names the five display columns; `connections.ts projectConnections` builds the screen's entry key by key (a test serialises a too-wide row).
- **Provider tokens are sealed** by `src/lib/crypto/secret-box-server.ts` (AES-256-GCM; `CONNECTIONS_ENC_KEY`, 32 random bytes in base64, plus `CONNECTIONS_ENC_KEY_PREVIOUS` during a rotation). The row and column are bound as additional data, so a box copied to another row does not open. **No key → sealing throws and opening answers null** — a connection is refused, never stored in the clear. Staging and production hold DIFFERENT keys.
- **One activity, however many times it arrives** (`dedupe.ts`, applied by `importActivity`): the same source delivering the same id refreshes the row (the 245 rule); ANY delivery whose start is within 60 s of an activity the athlete already has, with a duration within 10%, IS that activity — the row keeps the identity of whoever delivered it first and its data is replaced only when the newcomer is richer (it has the route, or the heart rate, the first lacked).
- **A supervised athlete cannot hold a connection** (the calendar feed link's rule: a standing delivery nobody in the guardian console can see). A guardian still imports files. A guardian connecting on an athlete's behalf is a later decision.
- **Disconnect is not behind the moderation write gate** — withdrawing a standing delivery is always allowed.
- **`NEXT_PUBLIC_FEATURE_CONNECTED_APPS`** is a SURFACE switch (the tab and its two entry points: the Vitals Activities section and the import screen). The routes answer for themselves: `GET /api/connections` says `supported` (247 has run), `ready` (the key is set) and `supervised`.

### The personal upload link (the Apple Watch path)

Apple has no web or server API for Health data, so something must run on the iPhone. Tom's route is a third-party bridge app — **Health Auto Export** — whose "REST API" automation POSTs each workout as JSON to a URL the athlete pastes in. That URL is their **personal upload link**:

- **Mint / replace**: `POST /api/connections/upload-link` (write-gated; refused for a supervised account). The raw token (256 random bits) is returned ONCE as `…/api/activities/inbound/<token>?tz=<their zone>`; only its sha256 is stored. Calling it again REPLACES the hash (`rotated: true`) — the old link stops at once; the connection's history stays.
- **Deliver**: `POST /api/activities/inbound/[token]` — **no session by design** (a phone's automation has none; the route is in `PUBLIC_ROUTES` with its reason). The token is the authorization; an unknown, replaced, malformed or supervised link is ONE 404; a limited / suspended / banned account is refused by the write gate applied to the account the token names; an IP bucket (before the lookup) and a per-link bucket (after it) bound the cost.
- **What it takes** (`inbound-server.ts readInbound` — the body is SNIFFED, never trusted to its Content-Type): the bridge app's workout JSON (`adapters/health-export.ts` — v2, and v1's `lat` / `lon` / `qty` shapes), or a raw `.fit` / `.gpx` / `.tcx` (also as the first file of a multipart form — a Shortcut or a script can send the file a watch exports).
- **The adapter is pure and never guesses**: a timestamp without an offset is refused (a guessed zone moves the workout by hours); Apple's workout NAMES map through an explicit list (a "Stair Climbing" is not a climb) and anything unknown is `other`, which Vitals still counts as a session; unknown units are dropped; the route is the timeline and each fix takes the nearest heart-rate sample; with no route the heart rate is the timeline; a bare workout is its start and end. `NormalizedActivity.format` is null (it never was a file).
- **Every delivery goes through the ONE writer** as `source: 'upload_link'` with the workout's own id — the server recomputes the totals, refuses the implausible, trims a viewer's route, and the duplicate rule keeps one activity however often the app re-sends it (or the athlete imports the same file by hand).
- **The answer**: `200 { received, imported, duplicates, refused, skipped }` whenever the body was READ (a bridge app retries a non-2xx, and an implausible workout will not improve on a retry); `413 / 415 / 422` when the body itself is not something the link takes — that marks the connection `error` with the reason, and the next good delivery heals it. A read delivery stamps `last_sync_at`, even an empty one.
- **Honest limits, said on the card**: the bridge app is another company's and may charge for automations; iOS lets it read Health data only while the iPhone is unlocked, so a workout arrives the next time the phone is used. No QR code: it would need a new dependency (none without approval) — the athlete opens Settings on the iPhone and taps Copy.

### Polar (AccessLink v3)

Read from Polar's own pages on Oct 1 2026 (the API reference; the API License Agreement of 22 Aug 2025 — `docs/CONNECTIONS_APPLICATIONS.md` lists the clauses that matter and which are Tom's call).

- **Configuration** (`providers/polar-server.ts polarConfig`): `POLAR_CLIENT_ID`, `POLAR_CLIENT_SECRET`, `POLAR_WEBHOOK_SECRET`. Without the first two every Polar route answers "not available" and `GET /api/connections` reports Polar as unconfigured (`projectConnections(rows, { unconfigured })` → "Coming soon"). `POLAR_MOCK_BASE` points the three hosts at the e2e stand-in and is IGNORED when `VERCEL_ENV=production`.
- **Connect** — two navigations, never a fetch: `GET /api/connections/polar/start` (session; not supervised; the write gate) redirects to Polar with a SIGNED `state` (`oauth-state-server.ts`: names the account and the provider, ten minutes, key derived from `CONNECTIONS_ENC_KEY`); `GET /api/connections/polar/callback` verifies it — a code can never be attached to someone else's session — exchanges the code, registers the user with AccessLink, seals the token into the row (`connectProvider`; one Polar account feeds ONE athlete — the unique on `(provider, provider_user_id)` answers `connect_error=taken`), and runs the FIRST SYNC (ten exercises now, the rest daily). Both end in `/settings?tab=connections&connected=polar` or `&connect_error=<reason>` (`CONNECT_ERRORS` holds the words).
- **The webhook** — `POST /api/webhooks/polar`. THE SIGNATURE IS THE GATE: `Polar-Webhook-Signature` = HMAC-SHA256 of the raw body under the key Polar returned when the webhook was created, compared in constant time. The creation PING is answered without one (it arrives before the key exists) and does nothing. The exercise is fetched from OUR configured base by id — never from the payload's `url`; ids must match `POLAR_ID_RE` before they reach a URL. A signed event is always a 200 (Polar deactivates a webhook that keeps failing). No rate bucket by design (an unsigned body costs one HMAC and no I/O).
- **One exercise, one path** (`polar-sync-server.ts importPolarExercise`): its FIT → `parseFit` → `importActivity({ source: 'polar', externalId })`; no FIT (a session with no samples) → `polarSummaryToActivity` (start from the local time + its offset, never a guessed zone). A 401 from Polar = the athlete withdrew consent there → `markRevoked` (status `revoked`, the sealed token cleared; the card says "Connect again").
- **The daily net** — `runPolarSync` in `/api/cron/daily`: each active connection's last 30 days (all Polar keeps), skipping the ids already imported, five new per athlete per run.
- **Disconnect** de-registers the user at Polar (which revokes the token there) and deletes our row — the agreement's 3.3.
- **The credit** (3.1.5): `sourceCredit(source)` → "Recorded with Polar" on the activity page, the list row and the feed card; the name alone on a Recent sessions row. Plain words, no logo (7.4).
- **The consent** (3.1.1): `PROVIDER_CONSENT` is shown on the card BEFORE the athlete leaves for Polar.
- **The owner's setup** is a dashboard panel ("Connected apps — Polar setup", `GET` / `POST /api/admin/connections/polar-webhook`): the callback URL to register, whether the credentials are set, and "Create the webhook" — Polar returns the signature key once; the panel hands it to the owner and stores nothing.

**Adding a provider** is now: an adapter from its payload to a `NormalizedActivity` (FIT deliveries reuse `parse-fit-server.ts`); its connect / callback / webhook routes writing through `connections-server.ts` and `importActivity({ source, externalId })` with the provider's own id; `stage: 'live'` in `PROVIDER_DEFS`; its attribution wherever its brand rules ask. Read the provider's current agreement FIRST — a term that forbids showing an activity to followers stops the adapter (Strava's did).

## Not in phase 1 (decided)

- `athlete_performances` rows;
- `athlete_vitals` writes (resting HR, VO₂ max);
- the calendar overlay;
- a `/r/` share card;
- custom privacy zones (only the fixed 200 m trim);
- an iOS companion app.

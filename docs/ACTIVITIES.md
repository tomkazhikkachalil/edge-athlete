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
- **The feed is the athlete's choice.** Imports land on the profile's Activities tab, and the athlete taps **Share to feed**.
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
| `GET /api/profile/[profileId]/activities` | the one gate | keyset list (a strict ISO timestamp + uuid cursor), count, 12 weeks of totals |

Both import routes are on THE write-gate list (`write-gate.test.ts`, `docs/SUPPORT.md`).

## Lifecycle and retention

- **Deleting an activity** removes the post, then the row, then the stream object. A failed object remove is logged; it cannot leave a row pointing at nothing.
- **Account deletion:** `activities.profile_id` is classified `goes`. The engine collects every stream path up front and removes them with the person's other storage, so a location trace leaves with the person.
- **The storage sweep never touches `activities/`** (`PROTECTED_PREFIXES`). Streams leave only through the two paths above, and the QA teardown removes a QA athlete's streams.
- **Retention:** an activity lives until the athlete deletes it or leaves (HARDENING B5: owner-controlled personal data, no timed purge).

## Adding a provider (the seam)

1. **A connection table** for the provider's tokens, encrypted at rest (the app has no at-rest encryption helper yet, so build one; OAuth refresh tokens must be recoverable, unlike the hashed calendar feed tokens). Classify it `goes`.
2. **An adapter** from the provider's payload to a `NormalizedActivity`. FIT deliveries (Garmin) reuse `parse-fit-server.ts`.
3. **Widen `activities_source_check`** (a migration) and write through `importActivity` with the provider's own `external_id`. Cross-source dedupe (the same run from Strava and from a file) is a decision for that round.
4. **Strava's API agreement** forbids showing one athlete's Strava data to other users. Strava-sourced rows must be **owner-only** at the projection (a `source` term in `visibility.ts`), and "Share to feed" must be refused for them.
5. **Google Health API**, not the retired Fitbit Web API. **Garmin:** the Connect Developer Program (business approval).

## Not in phase 1 (decided)

- `athlete_performances` rows;
- `athlete_vitals` writes (resting HR, VO₂ max);
- the calendar overlay;
- a `/r/` share card;
- custom privacy zones (only the fixed 200 m trim);
- an iOS companion app.

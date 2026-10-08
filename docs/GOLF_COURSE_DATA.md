# Golf course data — where it comes from, what it costs, and how it degrades

The reference for the golf catalog (`golf_courses`), its providers, the
hole geometry and green outlines, the elevation profile, and the probes
that watch them. Written with the **Golf course flow fixes** program
(Oct 7 2026, CLAUDE.md convention 35); the near-me / hole-header program
(convention 34) is the layer underneath; the **map sweep** (Oct 8 2026,
convention 36, migration 255) is the layer on top — "The sweep" below.

## Sources and attribution

| Source | What it gives | Key | Budget key (per day) | Attribution |
| --- | --- | --- | --- | --- |
| `seed` (migration 100) | 7 courses with full tee sheets | — | — | — |
| OpenStreetMap (bulk import, `osm`) | 29k courses with coordinates; **hole lines** (`golf=hole` ways), **green outlines** (`golf=green`), numbered **tees and fairways** (`golf=tee` / `golf=fairway` + `ref`) and the named course boundaries, through Overpass | — | `overpass` 200 (the lazy path) · `sweep-overpass` 1,500 (the sweep, its own key) | "© OpenStreetMap contributors" (ODbL) wherever the lines render |
| OpenGolfAPI (`opengolfapi`) | tee sheets, ratings, descriptions (CC BY-SA, the attribution line rides the description) | `OPENGOLFAPI_KEY` | `opengolfapi` | the description's own line |
| GolfCourseAPI (`golfcourseapi`) | tee sheets, ratings; `/v1/proximity` on Pro (coordinates) | `GOLF_COURSE_API_KEY` + `GOLF_COURSE_API_PLAN` | `golfcourseapi` (`GOLF_PROVIDER_DAILY_BUDGET`), `golfcourseapi-proximity` | — |
| Nominatim | coordinate refinement, reverse geocoding | — | `nominatim` | OSM's |
| **Terrain Tiles** (AWS Open Data / Mapzen) | **elevation**, free, no key — 3DEP 10 m (US), CDEM (Canada), SRTM 30 m elsewhere | — | `terrain-tiles` 400 (the lazy path) · `sweep-terrain` 3,000 (the sweep's elevation phase) — one hit per course per 30 days | see below |
| Open-Meteo Elevation (commercial host) | elevation, 90 m — the **fallback** when the tiles cannot be reached | `OPEN_METEO_API_KEY` | `open-meteo` 100 | — |

**Terrain Tiles credit (required by the data licence):** *Elevation: Terrain
Tiles (Mapzen / AWS Open Data) — 3DEP (USGS), CDEM (Natural Resources
Canada), SRTM (NASA), EU-DEM, GMTED2010, ETOPO1 and others; see
https://github.com/tilezen/joerd/blob/master/docs/attribution.md.* The
tiles are read from `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
at zoom 14; Terrarium encoding `metres = R·256 + G + B/256 − 32768`.

Every provider spends through `consumeProviderBudget` (`course-catalog.ts`,
`rate_limit_hit`); a refused budget never stamps anything.

## Hydration (the tee sheet)

A provider row arrives THIN (identity only). It is filled by ONE detail
call — `hydrateCourseDetailed` — from two doors: `GET /api/golf/courses?id=`
(a composer selection, the search field's pick, the info card at open) and,
since H1, `?holes=1` (the live page, the preview card) through `hydrationDue`
(a provider source, thin, not attempted within `HYDRATE_TTL_MS` = 7 days).
`hydrated_at` records the ATTEMPT, whatever came back.

Every hydration ends in a named **outcome** (`HydrationOutcome`):

| Outcome | Meaning | Logged |
| --- | --- | --- |
| `ok` | holes with yardage written | — |
| `fresh` | attempted within 7 days | — |
| `not_applicable` | a seed or OSM row (nothing to ask) | — |
| `not_configured` | the provider's key is not set | console |
| `budget_refused` | the daily cap | **Sentry warning** |
| `provider_null` | 2xx with no course in the body | console |
| `no_tees` | a detail with no tee boxes | console |
| `no_yardage_for_tee` | holes came back but no hole carries a yardage (GolfCourseAPI fills per-hole yardage only from tee boxes whose hole count matches the reference box) | console |
| `http_<n>` | the provider's status (`5xx` → **Sentry warning**, `404` console) | — |
| `timeout` / `network` | transport | **Sentry warning** |

The sheet the API serves (`getCourseSheet` → `sheetFromRow`) carries
`source` and `partial` (`no_holes` · `no_yardage` · null); the summary card
(M3) turns those into "Not fully mapped · No hole-by-hole data" and the
composer's picker says "No hole data from the provider yet" for a stamped
thin row.

**Runbook — unstamp rows that were stamped thin** (a provider that failed
on a bad day; the SQL editor on production):

```sql
UPDATE golf_courses
SET hydrated_at = NULL
WHERE external_source IN ('opengolfapi', 'golfcourseapi')
  AND (hole_data IS NULL OR jsonb_array_length(hole_data) = 0);
```

## Hole geometry and green outlines

`golf_courses.hole_geometry` (+ `hole_geometry_at`, migration 102) caches
ONE answer per course for 30 days — from the lazy fetch on the first map
open, or from the sweep (below): the `golf=hole` ways (tee → green
polylines with `ref` and `par`), the named `leisure=golf_course` boundaries
that untangle multi-course facilities, the `golf=green` outlines (G2), and
the numbered `golf=tee` / `golf=fairway` points (map sweep PR 5). The
stored shape (every older shape parses identically):

```json
{ "holes": [{ "hole": 1, "par": 4, "line": [[lat, lng], …] }],   // may be [] when greens or sections carry the course
  "source": "osm",
  "greens": [{ "hole": 1, "ring": [[lat, lng], …] }],             // hole: null = an unnumbered green (tier 5 only)
  "sections": [{ "label": "A", "holes": [...], "greens": [...] }], // ≥ 2 pickable loops — nothing drawn until a pick
  "derived": "features" }                                           // the lines were drawn from tees and greens
```

### The five tiers — ONE pipeline, two callers

`hole-geometry.ts resolveCourseTiers(payload, course, sections)` is the
order every answer is read in; the lazy path and the sweep both run it
(`map-sweep.test.ts` pins that the same payload gives the same bytes).
First non-null wins; every refusal is honest — **a wrong overlay is worse
than none**, so each tier's refusal cases are pinned on real captures
(`src/lib/golf/__tests__/fixtures/overpass-*.json`).

| Tier | What it reads | Result | Refuses when |
| --- | --- | --- | --- |
| 1 strict lines | the `golf=hole` ways inside the course's **claims scope** (`scopeHoleWays`: its own named boundary's majority → own ∪ the ways no OTHER boundary claims within 150 m → `unclaimed` within 800 m when no boundary is its own → everything when none exists) | `holes` 9 / 18 numbered 1..n | duplicate refs, a short set, a neighbour's polygon owns the ways (Glen Mar — Canadian G&CC's) |
| 2 labelled sections | a club's scoped ways split into loops and bound to its section rows on POSITIVE OSM evidence only — a section-named sub-boundary, or section-named hole ways (`sectionTokens`) | the club's section rows each get their nine, written to their own rows | no or duplicate evidence for a loop (never a guess) |
| 3 unlabelled loops | clean loops with no label (`clusterHoleLoops`: refs contiguous from 1, multiplicity non-increasing, loops close at a multiple of 9, final loops ∈ {9, 18}) | `sections` lettered by the compass bearing of each loop's first tee — **pickable nines** (Emerald Links A / B / C); PROMOTED to `holes` when the catalog says 18 and exactly one loop is an 18 | a near-tie between two loops at a shared tee (Royal Ottawa's 18 + West Nine) |
| 4 feature-derived | numbered `golf=tee` / `fairway` / `green` (`hole-features.ts deriveHoleGeometry`: back tee → the fairway's centre when it lies along the chord → the green's centroid; 60–800 yd) | `holes` + `greens` with `derived: 'features'` ("Mapped from tees and greens" under the chip; Amberwood) | under 9 uniquely numbered greens; a ref naming two greens far apart of comparable size |
| 5 greens-only | ≥ 9 `golf=green` rings, numbered or not | `holes: []` + `greens` (`hole: null` when unnumbered) — the **nearest-green rangefinder** (Greensmere, 38 rings) | fewer than 9 rings |

A green is ASSIGNED to a line by its `ref` first (within 120 m of the
line's end), containment second, the nearest ring within 40 m third. The
elevation sampler reads `holes` only — a sections or greens-only geometry
has no profile (null, stamped).

- A green is ASSIGNED to a hole by the line's END: the ring containing it
  wins (several → the nearest centroid), else the nearest ring within
  `GREEN_ASSIGN_M` 40 m; a double green may serve two holes; a hole with
  nothing is absent. Nothing is ever a fake pin.
- `greens` is ALWAYS written — `[]` when OSM has no outlines (the stamp). A
  geometry cached before G2 has no key and is refetched ONCE on the next
  `?holes=1` through the ordinary path (budget refused → the old geometry
  served, nothing stamped; transport failure → the old geometry; success →
  written with the key). A null geometry keeps its own TTL.
- Every "to green" number stands on `greenPoint(line, green?)`: the
  outline's centroid when the hole carries one (OSM lines are hand-drawn
  and routinely stop at the front edge), else the line's last point. From a
  fix with an outline the live line also carries the FRONT and BACK edges
  (`greenDistances`, `green.ts`) — "F 182 · C 196 · B 207" on the pill, the
  chip and the scorer's row C; never while standing on the green.
- The round's `hole_data` yardage trims the drawn line to the tee in play
  (`trimLineToYards`); an UNKNOWN yardage stays unknown since H2 (the old
  `?? 400` default cut real holes short).

## Elevation and "plays like"

`golf_courses.hole_elevation` (+ `_at`, migration 254): ten samples along
each hole line (`sampleHoleLine`), metres, 30 days, recomputed when the
geometry is newer. Providers in order (`fetchElevationsAny`): **Terrain
Tiles first** (each z14 tile a course spans is fetched once, 1–4 per course,
decoded with `sharp` server-side), **Open-Meteo second** only when its key
is set AND the tiles failed at the transport level. The rule of thumb
(`playsLikeYards`): +1 yd per yard uphill, −2/3 yd per yard downhill; every
number wears "≈". `source` is `terrain-tiles` or `open-meteo`.

## The sweep (convention 36, migration 255)

Nothing waited for a map open after Oct 8 2026: the sweep asks
OpenStreetMap for EVERY course, one half-degree cell at a time, and keeps
the answers fresh.

- **Cells** (`map-sweep.ts`): `c05:<lat0>:<lng0>` is a 0.5° box's
  south-west corner (`cellKeyFor`); the planner (`planSweepCells`) reads
  every catalog course with coordinates (never a `qa-e2e` fixture) into
  `golf_map_sweep_cells` with a tier — 0 the Ottawa box or any cell with a
  recorded round, 1 Canada, 2 US · GB · IE · AU, 3 the rest — and upserts the
  PLAN columns only, so a cell's state survives a re-plan.
- **One regional query** per cell (`overpassCellQuery`: the lazy query's
  selectors over the box plus a cos-scaled 0.03° margin, `[timeout:20]`
  inside a 22 s request), filtered per course to the elements within
  1,500 m by SEGMENT distance (`elementsNear` — Overpass's `around`
  semantics), then `resolveCourseTiers`. The answer is written exactly as
  the lazy path writes it: `hole_geometry` + `hole_geometry_at`, nulls
  stamped; a transport failure stamps NOTHING.
- **Guards:** the Overpass envelope (`isOverpassAnswer` — a throttling
  mirror's 21-byte stub 200 is transport), a partial answer, the
  **empty-answer regression** (a cell that had mapped courses and now
  answers nothing is a bad mirror day, never a vanished course), the mirror
  ladder with persisted cooldowns (a 429 cools a mirror 15 min, a 5xx
  5 min; `GOLF_SWEEP_OVERPASS_MIRRORS` overrides the list), and the
  **elevation re-attest** (unchanged lines + a prior profile → the profile's
  stamp moves with the geometry's; a re-sweep never invalidates the
  profiles).
- **The state machine:** `golf_map_sweep_claim(n, lease)` claims cells
  `FOR UPDATE SKIP LOCKED` with a 120 s lease (the cron tick and the
  dashboard's loop may overlap); a cell is `done` for 28 days (two before
  the lazy 30 lapse), or parked `pending` with `attempts + 1` and a backoff
  of 5 → 15 → 45 → 120 → 360 min — three failures in a row are a Sentry
  warning (`[map-sweep]`).
- **Budgets** (`DEFAULT_BUDGETS`): `sweep-overpass` 1,500 cells a day (≈ 15 %
  of Overpass's fair use at one request in flight with 3 s gaps; the whole
  world in ~3 days, ~160 cells a day at steady state) and `sweep-terrain`
  3,000 courses a day — their OWN keys, so the sweep never starves a live
  map open.
- **Doors:** the dashboard panel **Course map sweep** (`GolfMapSweepPanel`:
  the progress, Next up, Plan cells dry → live, Dry run a batch, Run a
  batch behind the confirm, Run until done with Stop, Sweep one cell) over
  `GET` / `POST /api/admin/golf-map-sweep` (`{phase: plan | geometry |
  elevation | hydration, cells 1–6, courses 1–50, rows 1–20, cellKey,
  dryRun}` — **dry run by default**); the schedule `POST
  /api/cron/golf-map-sweep` (`CRON_SECRET`), pg_cron `golf-map-sweep` every
  two minutes on production (staging schedules nothing): re-plan when the
  plan is a day old → 4 cells → the elevation phase with the time left → 3
  provider hydrations, each phase in its own try/catch.

**Runbook — a fresh database or a new region:** run migration 255 (the
cells, the meta, the two RPCs, the index, the job); on the dashboard, Plan
cells (dry — read the tier histogram — then live); Sweep one cell on the
place you care about (Ottawa is `c05:45.0:-76.0` and `c05:45.0:-75.5`);
Run until done for the geometry phase while watching Sentry for
`[map-sweep]`; let the schedule carry the rest. To re-sweep one cell
before its 28 days: `UPDATE golf_map_sweep_cells SET next_due_at = now()
WHERE cell_key = '…'`. A mirror that misbehaves for a day cools itself
down; to drop one for good, set `GOLF_SWEEP_OVERPASS_MIRRORS` without it
and redeploy.

## The map and the chip (convention 35)

- **Follow me** is explicit (`map-follow.ts`): decided ONCE on the first fix
  after tracking starts — on within 1.5 km of the course pin or any hole's
  tee / green, off elsewhere — then the toggle's. Only the PAN is gated; the
  watcher, the marker and the pill run on. A drag or a hole fit pauses it;
  Re-center turns it on.
- The chip walks the ROUND's holes (`roundHoleNumbers`), with or without a
  line each; "Not mapped yet" under a hole with none; "First hole" re-fits
  the starting hole.
- The summary card (`course-summary.ts`): hole count, par, one total per tee
  (null when any hole lacks a yardage — never a partial sum), the course
  overview thumbnail, and "Not fully mapped" naming each gap.

## Probes

| Spec | Where | What it holds |
| --- | --- | --- |
| `e2e/catalog-health.spec.ts` | **prod only** (`npm run test:e2e:prod -- catalog-health`) | the six seeded courses with sheets (`KNOWN_GOOD_SHEETS` — Ottawa Hunt is a split club whose sheets live on its section rows) keep 18-hole tee sheets with a yardage on every hole; `KNOWN_GOOD_GEOMETRY` (Eagle Creek) keeps 18 cached lines |
| `e2e/live-rangefinder.spec.ts` | prod only | a phone walks Eagle Creek's hole 1; accepts the trio once the course gains outlines |
| `e2e/course-greens.spec.ts` | staging + prod (self-seeded) | outlines ride `?holes=1`; a stamped geometry is never refetched |
| `e2e/course-elevation.spec.ts` | staging + prod | the sheet's `source` / `partial`; `?elevation=1` writes a profile from the real tiles |
| `e2e/gps-hole-flag.spec.ts` | staging + prod (@mobile) | the flag on the centre, the trio, the follow states, the first-hole control |
| `e2e/gps-unmapped-course.spec.ts` | staging + prod (@mobile) | a course with hole data and no lines browses hole by hole and never pans |
| `e2e/course-preview.spec.ts` | staging + prod (@mobile) | the summary card and "Not fully mapped" |
| `e2e/gps-nine-picker.spec.ts` | staging + prod (@mobile) | a seeded three-nine geometry: nothing drawn until a pick or a clear tee; the pick survives a reload |
| `e2e/admin-golf-map-sweep.spec.ts` | staging + prod (needs `E2E_ADMIN_EMAIL`; skips pre-255) | the gate, the plan, a dry batch stamps nothing, a live one-cell run in the Atlantic ends `done` with three "no coverage" stamps OR `pending` with one attempt and nothing stamped, the panel renders |

**Staging holds ZERO `golf_courses` rows** — every golf spec that needs a
course self-seeds (`external_source 'qa-e2e'`; the sweep spec's rows are
`seed` + `qa-sweep-…` because the planner must see them — both classes are
swept by the teardown's backstop and `scripts/staging-sweep.mjs`). Two seeding rules: a fresh
`hole_geometry_at` stops the Overpass fetch (a null geometry included), a
fresh `hydrated_at` stops a provider / Nominatim attempt; and since G2 a
seeded `hole_geometry` needs `greens: []`.

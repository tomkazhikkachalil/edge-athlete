# Golf course data — where it comes from, what it costs, and how it degrades

The reference for the golf catalog (`golf_courses`), its providers, the
hole geometry and green outlines, the elevation profile, and the probes
that watch them. Written with the **Golf course flow fixes** program
(Oct 7 2026, CLAUDE.md convention 35); the near-me / hole-header program
(convention 34) is the layer underneath.

## Sources and attribution

| Source | What it gives | Key | Budget key (per day) | Attribution |
| --- | --- | --- | --- | --- |
| `seed` (migration 100) | 7 courses with full tee sheets | — | — | — |
| OpenStreetMap (bulk import, `osm`) | 29k courses with coordinates; **hole lines** (`golf=hole` ways) and **green outlines** (`golf=green`) through Overpass | — | `overpass` 200 | "© OpenStreetMap contributors" (ODbL) wherever the lines render |
| OpenGolfAPI (`opengolfapi`) | tee sheets, ratings, descriptions (CC BY-SA, the attribution line rides the description) | `OPENGOLFAPI_KEY` | `opengolfapi` | the description's own line |
| GolfCourseAPI (`golfcourseapi`) | tee sheets, ratings; `/v1/proximity` on Pro (coordinates) | `GOLF_COURSE_API_KEY` + `GOLF_COURSE_API_PLAN` | `golfcourseapi` (`GOLF_PROVIDER_DAILY_BUDGET`), `golfcourseapi-proximity` | — |
| Nominatim | coordinate refinement, reverse geocoding | — | `nominatim` | OSM's |
| **Terrain Tiles** (AWS Open Data / Mapzen) | **elevation**, free, no key — 3DEP 10 m (US), CDEM (Canada), SRTM 30 m elsewhere | — | `terrain-tiles` 400 (one per course per 30 days) | see below |
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
ONE Overpass answer per course for 30 days: the `golf=hole` ways (tee →
green polylines with `ref` and `par`), the named `leisure=golf_course`
boundaries that untangle multi-course facilities, and — since G2 — the
`golf=green` outlines. The stored shape:

```json
{ "holes": [{ "hole": 1, "par": 4, "line": [[lat, lng], …] }],
  "source": "osm",
  "greens": [{ "hole": 1, "ring": [[lat, lng], …] }] }
```

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

**Staging holds ZERO `golf_courses` rows** — every golf spec that needs a
course self-seeds (`external_source 'qa-e2e'`). Two seeding rules: a fresh
`hole_geometry_at` stops the Overpass fetch (a null geometry included), a
fresh `hydrated_at` stops a provider / Nominatim attempt; and since G2 a
seeded `hole_geometry` needs `greens: []`.

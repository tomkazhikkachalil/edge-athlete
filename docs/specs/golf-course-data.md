# Golf course data: near me, elevation, hole detail, course flow, the map sweep

> Moved verbatim from CLAUDE.md "Key Conventions" on Oct 13 2026. Convention numbers are kept because code comments and docs cite them. Read the devlog entries each convention names (`docs/devlog.md`) before changing the code it describes.

## Convention 34 — The golf course near you, and the hole in front of you (Golf near-me + elevation + hole-detail program, Oct 7 2026; plan `~/.claude/plans/pasted-content-id-5f99-ve-noticed-soft-lemon.md`)

**The golf course near you, and the hole in front of you (Golf near-me +
elevation + hole-detail program, Oct 7 2026; plan
`~/.claude/plans/pasted-content-id-5f99-ve-noticed-soft-lemon.md`)** — Tom:
leverage GolfCourseAPI v1.3.0's `/v1/proximity`, a hole-by-hole screen with
"much more details", and "slope to help athletes make informed decisions on
their shots" (= ELEVATION, a plays-like distance — not the slope rating);
"do not break anything". **PR A — proximity, wired and DORMANT:**
`course-catalog.ts proximitySearch` is the "near me" provider touchpoint
(thin rows WITH coordinates — the FIRST GolfCourseAPI payload that carries
any; search and detail never did). It runs only from the route's `near=`
branch with NO typed text (the no-keystroke rule) and behind four
fail-closed gates in order: the plan (`GOLF_COURSE_API_PLAN` ∈ free | pro |
enterprise, default free — `proximityAllowed()` is a pure env check, so
Free never even touches a budget RPC; the endpoint is Pro and up), a per-
cell daily memo (`proximityCellKey`, 0.05° ≈ 5 km, through the same
`rate_limit_hit` machinery — `hitBudget`), its own cap
(`golfcourseapi-proximity`, `GOLF_PROXIMITY_DAILY_BUDGET` || 500), then the
shared `golfcourseapi` cap (raise `GOLF_PROVIDER_DAILY_BUDGET` on Pro). A row
the catalog already holds by id gains a coordinate ONLY when it has none
(`coordFillDecision`: fill | keep | disagree — a stored pin is never moved;
it may be Nominatim-refined) and never goes back through `upsertThinRows`
(a coord row would match itself in the 2 km box). The response carries
`providerNearby`. Our own catalog (29k OSM courses with coords, the RPC's
`near=`) answers "near me" either way. **PR B — Near me in the composer:**
`src/lib/geo/request-position.ts requestPosition()` is the ONE one-shot
device fix (on a TAP only — with ONE exception since Oct 28 2026: the golf
round's course step runs it on entry when `geolocationGranted()` says the
device has ALREADY granted location, Playing now + outdoor, nothing typed;
never a prompt on arrival — Convention 53; Explore's course search and the
composer share it; the recorder and the rangefinder keep their `watchPosition` streams);
`src/lib/golf/near-me.ts` (pure) holds `NEAR_RADIUS_KM` 50, `nearbyOffer`
(the nearest course with coordinates within 1 km — the RPC's `distanceKm`
first, else the haversine) and `formatKm`. The composer's "Near me"
(`data-course-near-me`, `aria-pressed`) re-asks the picker with
`q=''&near=&radius=50` (sorted by distance, km chips `data-course-km`); it
is one-shot — typing ends it. While starting a LIVE round (never an
already-played one) the dropdown's first row is "Playing at X? · 0.3 km"
(`data-course-nearby-offer`) → the ordinary `selectCourse` path. **Staging
holds ZERO `golf_courses` rows** (the catalog is production-only): every
golf spec that needs a course self-seeds (`external_source 'qa-e2e'`), and
`explore-course-search.spec.ts` is effectively unrunnable (anonymous +
catalog) — not a regression signal. **PR C — elevation (migration 254,
the program's ONLY DDL):** `golf_courses.hole_elevation` jsonb
`{holes:[{hole, pts, elev(metres)}], sampled:'line10', source:'open-meteo'}`
+ `hole_elevation_at` — its OWN columns (the geometry writer overwrites
`hole_geometry` wholesale; the geometry path is untouched). `elevation.ts`
is pure (`sampleHoleLine` 10 points per hole, tee and green kept;
`playsLikeYards` +1 yd per yd uphill, −2/3 downhill; `riseToGreen` in
METRES at the nearest sample — `hole-detail.ts` converts once;
`formatRise`; `parseStoredElevation`). `elevation-server.ts` fetches
Open-Meteo through its COMMERCIAL host only, gated on `OPEN_METEO_API_KEY`
(no key → the cache or null, nothing stamped), ≤100 coordinates per
request (18 × 10 = 2 requests per course per 30 days), budget key
`open-meteo` (100/day); a null answer is stamped (102's rule), a transport
failure never; a profile older than its geometry is recomputed
(`elevationFresh`). `?id=&holes=1` answers `{geometry, elevation, sheet}`
— the CACHED profile and the row's tee sheet (`getCourseSheet`: hole_data +
ratings, NO hydration) — one call for the map and the scorer; `?elevation=1`
computes. Pre-254 a missing column (42703) is "no elevation". **PR D —
the plumbing (no visible change):** `src/lib/golf/hole-detail.ts` is the
ONE set of rules the map chip and the scorer's header share —
`holeHeaderFacts` (the par / stroke-index / yardage ladder: the round's
`hole_data` → the catalog sheet on the tee in play with the white/blue/any
fallback → the drawn line flagged approximate; a catalog handicap of 0 is
unknown), `teeSheetForHole` (hardest first, the tee in play first of all),
`liveLine` (from a fix: `greenDistanceYards` + the rise read there; from
the tee: the card's yards else the line; `playsLike` only with a profile —
the rise converted to yards HERE, once), `runningToPar` (skips
`strokes === null`), `groupScoresForHole` (the others, first names, "You").
`hole-svg.ts holeDiagramWithPoint` projects the player in the LINE's own
frame (null outside the box) — the thumbnail path, no Leaflet. The round's
`hole_data` is typed with `handicap?` everywhere it is spelled and the
composer's `deriveCourseHoles` carries it (the route always accepted it).
The map's ONE `watchPosition` (`CourseMapInner`) PUBLISHES every fix and
the stop through `onFix` — the scorer never prompts for location. **PR E —
the hole header** (`src/components/golf/HoleHeader.tsx`, mounted in
`ScoreEntryModal` in place of the old "Hole N · course · Par P · Y yds"
line): row A the big "Hole N" (the e2e idiom `/^Hole N\b/` stays strict —
row B starts at "Par") + a 56 px SVG thumbnail (`data-hole-thumb`,
`holeDiagramWithPoint`, tee · green · you; its handler IS the Map pill's,
`goToMap`: save first, close, hand the page the hole); row B
`data-hole-facts` "Par 4 · HCP 11 · 388 yds · White ▾" (the tee chip
`data-hole-tee-toggle` opens the INLINE `data-hole-tees` list — never a
z-layer; the `div[class*="z-[60]"]` scope stays the one overlay); row C
`data-hole-plays-like` = `gps | tee` ("196 yds to green · plays like ≈203
(↑ 7 yd)" from the map's published fix, "Tee → green 388 yds · …" without;
plays-like only with a profile; the row only with a line); row D
`data-hole-group` "You E thru 6 · Sam 5" (`toParLabel` / `toParColorClass`
— the house SEMANTIC COLOUR); the totals strip gains "To par"
(`data-scorer-to-par`). Every new modal prop (`teeInPlay`, `teeSheet`,
`holeLines`, `holeElevation`, `fix`, `group`) is optional — the composer's
batch stepper and the feed card render as before. The live page fetches
`?holes=1` on the first Map open OR scorer open (`holeDetail` =
`{geometry, elevation, sheet, courseId}`; a two-nine combo keeps elevation
and sheet null), asks `?elevation=1` ONCE when the profile is missing, and
passes `playerFix` from `onFix`. No `whitespace-nowrap` in the header
block; `live-hole-detail.spec.ts` holds 375 and 320. **PR F — the map
chip speaks the same line** (`data-chip-plays-like`, its own line below
`sm`). **The program's two switches, each optional and independent, are
Tom's:** `GOLF_COURSE_API_PLAN=pro` + a raised `GOLF_PROVIDER_DAILY_BUDGET`
in Vercel after the GolfCourseAPI upgrade (proximity lights up);
`OPEN_METEO_API_KEY` after the Open-Meteo subscription (elevation lights
up — until then no plays-like shows anywhere, and nothing else changes).
Migration 254 runs on prod whenever; the code reads a missing column as
"no elevation". Read DEVLOG Oct 7 2026 PR A–F before touching any of it.

## Convention 35 — The course flow: the green is a shape, elevation is free, every door hydrates, Follow is a toggle, the course has a summary (Golf course flow fixes, Oct 7 2026, #1103–#1110, ZERO DDL — `docs/GOLF_COURSE_DATA.md` is the reference)

**The course flow: the green is a shape, elevation is free, every door
hydrates, Follow is a toggle, the course has a summary (Golf course flow
fixes, Oct 7 2026, #1103–#1110, ZERO DDL — `docs/GOLF_COURSE_DATA.md` is
the reference)** — Tom's spec after convention 34; his answers: no
elevation subscription ("not yet"), the "slope calculator" IS the
elevation plays-like, pins come from the MAP DATA. **Greens (G1–G3):**
`src/lib/golf/green.ts` is the pure leaf (`Ring`, `pointInRing`,
`YDS_PER_KM`, `ringCentroid`, `greenDistances` → front / centre / back);
the Overpass fetch also asks for `golf=green` and `hole_geometry` carries
`greens: [{hole, ring}]` — assigned by the line END (containment, else
within 40 m), ALWAYS written (`[]` is the stamp), a pre-G2 cache refetched
ONCE through the ordinary path, `parseStoredHoleGeometry` keeps an absent
key absent; `greenPoint(line, green?)` (the centroid, else the line end)
is THE point every "to green" number and the flag stand on; `LiveLine`
carries `front` / `back` (a fix + an outline, never on the green);
`HoleLine.green?` is a runtime carrier the live page attaches. **Free
elevation (T1–T2):** `terrain-tiles.ts` (pure z14 maths, Terrarium) +
`fetchElevationsTerrain` (each tile once, `sharp` injectable) — **Terrain
Tiles FIRST, Open-Meteo only behind its key when the tiles fail**
(`fetchElevationsAny`); budget key `terrain-tiles`; `source` widens; the
attribution line lives in the doc. **Coverage (H1–H2):** `fetchJsonResult`
keeps the status; `hydrateCourseDetailed` names every outcome
(`HydrationOutcome` — operational ones through `reportRouteWarning`, a
Sentry WARNING; data gaps console-only); `hydrationDue` lets `?holes=1`
hydrate a thin provider row; `sheetFromRow` carries `source` + `partial`;
`deriveCourseHoles` is pure in `holes.ts` and an unknown yardage STAYS
unknown (the `?? 400` trimmed real holes). **The map (M1–M2):**
`map-follow.ts` — Follow decided ONCE on the first fix (on within 1.5 km
of the pin or any tee / green), the toggle `data-map-follow` (undecided |
on | paused | off), only the PAN gated, Re-center turns it on, the column
`CONTROL_COLUMN_H` 312; the chip walks `roundHoleNumbers` with or without
lines ("Not mapped yet"); the "First hole" pill (`fitNonce`; its text is
NEVER "Hole N" — the chip's strict e2e idiom); `greenLabel` /
`playsLikeShort` / `chipDistanceLines` are the ONE spelling on the pill
(`data-rangefinder-pill`, prop `elevation`), the chip (`data-chip-to-green`)
and row C — with a fix the LIVE distance, never the card's yards. **The
summary (M3):** `course-summary.ts` (`courseSummary` — a tee's total is
null when any hole lacks it; `mappingGaps` — no claim before the lines
were asked for) + `CourseSummaryCard`, hosted FIRST by `CourseInfoCard`,
which now hydrates at card-open (`?holes=1` ungated, `?id=` for a row
without its sheet). **Probes:** `catalog-health.spec` (prod only — the six
seeded courses WITH sheets keep them, `KNOWN_GOOD_GEOMETRY` its lines);
every golf spec self-seeds with `greens: []`, a fresh `hole_geometry_at`
and a fresh `hydrated_at`. Read DEVLOG Oct 7 2026 G1–P1 first.

## Convention 36 — Every course OSM can map IS mapped, by a sweep, through ONE pipeline whose every refusal is honest (Golf map sweep, Oct 8 2026, #1111–#1117, mig 255 the ONLY DDL — `docs/GOLF_COURSE_DATA.md` "The five tiers" and "The sweep" are the reference)

**Every course OSM can map IS mapped, by a sweep, through ONE pipeline
whose every refusal is honest (Golf map sweep, Oct 8 2026, #1111–#1117,
mig 255 the ONLY DDL — `docs/GOLF_COURSE_DATA.md` "The five tiers" and
"The sweep" are the reference)** — Tom: "take a sweep to ensure we have
all the courses possibly mapped — not the lazy route"; his picks:
unnamed clean nines are PICKABLE (letters, never a guessed name; nothing
drawn before a pick or a clear tee), a greens-only course gets
NEAREST-GREEN distances (never a fake line). **One pipeline:**
`hole-geometry.ts resolveCourseTiers` is THE order (strict lines over
the boundary CLAIMS scope → labelled sections → unlabelled loops →
feature-derived lines → greens-only); the lazy path and the sweep both
run it and `map-sweep.test.ts` pins the same bytes for the same payload.
`scopeHoleWays` is the one scoping decision (a neighbour's polygon
EXCLUDES its holes; a course's own sloppy polygon never vetoes it; no
boundary → the unclaimed ways within 800 m); `clusterHoleLoops` is a
multiplicity table (18 + 9 clusters; a near-tie is a null); `hole-
features.ts` draws a line only from ≥ 9 uniquely numbered greens;
`assignGreens` is ref-first. **The stored shape grew without DDL:**
`holes` may be `[]` iff `greens` or `sections` carry the course;
`greens[].hole` may be null; `sections` (≥ 2, `label`); `derived:
'features'` — `parseStoredHoleGeometry` is the one reader and the
`'greens' in` refetch-once rule stands. `hole-loops.ts` (pure) answers
the live page's three questions (`pickLoop` — 150 m and a 2× rival;
`geometryForRound`; `pickerRows`; the pick in `localStorage
golf:loops:<groupPostId>`); `liveLine` gained `kind: 'nearest'`.
**The sweep (255):** `map-sweep.ts` (pure cells, the regional query,
SEGMENT-distance filtering, the planner, the backoff) +
`map-sweep-server.ts` (claim → time guard → `sweep-overpass` budget →
the mirror ladder with persisted cooldowns → the envelope / partial /
EMPTY-ANSWER REGRESSION guards → the pipeline → stamps in chunks of 8
with the elevation RE-ATTEST → done +28 d, or parked with backoff and
ZERO course writes); `golf_map_sweep_claim` leases `FOR UPDATE SKIP
LOCKED`; a transport failure NEVER stamps; `isOverpassAnswer` makes a
stub 200 transport. Doors: the dashboard **Course map sweep** panel over
`POST /api/admin/golf-map-sweep` (dry run by DEFAULT) and pg_cron
`golf-map-sweep` every 2 min → `/api/cron/golf-map-sweep`. e2e: a
spec's `finally` is `cleanup()` — database steps first, each in its own
try/catch, the browser last; the teardown backstop sweeps `qa-e2e` and
`seed` + `qa-sweep-…` rows older than an hour. Read DEVLOG Oct 8 2026
PR 1–7 first.

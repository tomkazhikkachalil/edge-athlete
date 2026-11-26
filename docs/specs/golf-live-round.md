# The live golf round: the scoring card and the map view

Tom's doc "live golf round, scoring card and map view" (Nov 25 2026). The two screens a player uses during a live round, in the mechanical dialect (`.ea-mech`, `ui-conventions.md`). Three PRs: #1630 (migration 320), #1631 (the card), #1632 (the map).

The data underneath (hole lines, greens, elevation, "plays like", the one position watcher) is `golf-course-data.md`, Conventions 34 to 36. Its paragraph on the old hole header (PR E) describes what this replaced.

## Tom's decisions (Nov 25 2026)

1. **Each penalty stores its own strokes** (migration 320). Never added to the score.
2. **The tee control stays a viewer.** It lists each tee's yards and rating for the hole; it changes and saves nothing. The tee in play is the one chosen at setup.
3. **"Finish round" on the last hole saves and closes**, as Done did. The round still ends when every card is full, or by the owner's own Finish round button (with its confirmation).

## What did not change

- **Penalty strokes are not part of the score.** The golfer enters TOTAL strokes; a penalty is a description (078's note, repeated in 320). No total reads `penalty_strokes`.
- **When a hole reaches the server:** on leaving it (Next, Previous, a jump key, a player tab, the map preview, the X) and by the page-hide flush. No save on a keystroke. The localStorage draft (`ea:golf-draft:v1:{participantId}`) still protects typed input.
- **Who sees the player tabs:** the round's creator, as the switcher was.
- **The map's behaviour:** one `watchPosition`, started by a tap or an existing grant; the position never leaves the device; follow, the target (a tap on the map), layers, hole navigation.
- **`NumberWheel`** stays for the event group card (`GroupScoreCard`) and the workout timers. `GroupScoreCard` is not part of this.

## The scoring card (`ScoreEntryModal` + `src/components/golf/scoring/`)

**The rules are pure** (`src/lib/golf/score-card.ts`, `score-dial.ts`, `player-colour.ts`, `penalties.ts`), each pinned by a test.

- **A hole opens on par and 2 putts** (`shownScore`), FIR and GIR off.
- **Recorded = it has strokes** (the one signal all of golf uses for "played"). A hole becomes recorded when the player changes strokes or putts (both numbers are written at once: `withStrokes`, `withPutts`), taps either number (`confirmedScore`), or taps Next. A hole that was only looked at is not recorded: no check mark, in no total, and it cannot carry a round to `completed` by being paged through. A player tab, Previous, a jump key and the X record nothing new.
- **Putts never exceed strokes** (the scores API refuses it): lowering the strokes pulls the putts down.
- **The dial** (`StrokesDial`): 270°, 0 strokes at −135°, DOUBLE PAR at +135°, so par is at the top; one tick per stroke; above double par the arc stays full and the number counts on to 15. Pointer events with capture on the dial, `touch-action: none`; `role="slider"`; arrows step it, a typed digit sets it, a tap on the number confirms.
- **Names and tones:** Eagle (−2 or better, great) · Birdie, Par (good) · Bogey (text) · Double (warn) · Triple and "+n" (bad). Putts: 0 or 1 great, 2 good, 3 danger, 4+ bad.
- **Penalties:** the entry takes the action row's place (type from `PENALTY_TYPES`, strokes 1 to 9, Add, Cancel); each penalty is a row with its strokes; the badge is their sum (`totalPenaltyStrokes`). Stored as two aligned arrays, `penalties` and `penalty_strokes` (NULL = one each); ONE writer keeps them paired (`hole-writes.ts` `holeRow`: a write that names the types always sets their strokes). Every save names `penalties`, `[]` included, so removing the last one clears it on the server.
- **Player colours:** new (none existed). By place in the round, creator first: `#8B5CF6`, `#4DA3FF`, `#2DD4BF`, then five more; never green, gold, yellow, orange or red (a test checks the hues).
- **Totals** count recorded holes only: THRU n/holes, TO PAR ("--" before any hole), STROKES, PUTTS.
- **Next** reads "Hole N" (the next hole's number); on the last hole "Finish round" (live), "Done" (a completed round being edited), "Save Scores" (batch mode).
- **Photo and Video** open the phone's own chooser (camera or library): the inputs carry no `capture`. Library is gone.
- **The map preview** (`HoleMapPreviewInner`): a still Leaflet map of the hole (no drag, zoom, controls or pointer events), loaded lazily; the tile around it is the button (`data-hole-thumb`) and runs `goToMap` (save, close, open the map on the hole). A hole without a line looks at the course; a course without coordinates has no preview.
- **Layout:** a full screen on a phone; a 430 px dialog from 640 px; 800 px in two columns from 900 px (`.ea-mech-scorecard`, `.ea-mech-scorecard-grid`). The top line, the tabs and the footer stay; the middle scrolls only when it does not fit.

**Hooks:** `data-score-card`, `data-hole-number`, `data-hole-facts` / `data-hole-readout`, `data-hole-tee-toggle`, `data-hole-tees`, `data-hole-plays-like`, `data-hole-thumb`, `data-hole-group`, `data-strokes-dial` (+ `-plus`, `-minus`), `data-dial-confirm`, `data-putts-capsule`, `data-stat-lamp`, `data-scorer-action`, `data-penalty-entry` / `-type` / `-strokes` / `-add` / `-row` / `-badge`, `data-scorer-total`, `data-scorer-to-par`, `data-hole-key` (+ `data-recorded`), `data-scorer-player`, `data-scorer-status`, `data-scorer-next`, `data-scorer-previous`. In e2e use `e2e/helpers/score-card.ts`.

## The map view (`live/[groupPostId]/page.tsx` + `CourseMapInner` in overlay mode)

- **Top bar:** Back, the LIVE / Final badge (`RoundBadge scope="live"`), Scorecard | Map as `role="tab"` keys.
- **Hole plate** (glass): ‹ ›, Hole, Par ("Par est." when estimated), Yds, Plays. "Hole N" is one sr-only string (the e2e idiom `/^Hole N\b/` holds).
- **Control capsule:** layers · my position · follow me (while tracking) · re-center (when the map has moved off the player) · set target. **Zoom capsule:** our own keys; Leaflet's zoom and attribution controls are off in overlay mode only. A zoom key goes through `stepZoom`: Leaflet drops a zoom asked for while the last one is animating, so taps made mid-animation are added up and applied at `zoomend` (never call `map.zoomIn()` from a key).
- **Set target** shows whether a target is set; a tap clears it, or opens the info panel when there is none. Setting one is still a tap on the map.
- **Info key:** the two hints ("Tap the map to set a target." / "Your position stays on your device. It is never uploaded.") are in its panel, not on the map.
- **Bottom bar:** First hole · "Score hole N" · Info. **Credit strip:** the tile layer's own credit and links, the hole lines' and Leaflet's; it scrolls sideways on a phone, never an ellipsis.
- **Kept as glass, though the doc does not draw them:** the distance-to-green pill and the map notes (under the plate), the target pill (above the bar, so it cannot cover the flag), the nine picker, the location error.
- **Marks:** line of play (white 6, route colour 3.5, round caps), tee marker (26 px disc, mono number), flag (red pennant), player (13 px dot, 30 px halo). Each has a data hook (`data-tee-marker`, `data-green-flag`, `data-player-dot`): a test never finds a mark by its colour.
- **Where each part sits** is in `globals.css` (`.live-map-*`), in px, with a `max-height: 480px` form for a phone on its side (the capsules lie down).

## Proven on

The size ladder (`e2e/helpers/fit-ladder.ts`: 320 → 2560 px, landscape, tablets, enlarged text) through `live-fit.spec.ts` (five card states) and `live-map-look.spec.ts` (three map states), on `desktop`, `mobile`, `webkit-mobile`, `firefox-mobile`, `android` and `brave-android`. Behaviour: `live-score-card.spec.ts`, `penalty-strokes.spec.ts`, the four GPS specs, `live-scoring-group`, `group-round-layout`, `live-hole-detail`.

**Open:** a look on real phones (the dial drag and the map keys first). The map preview draws tiles in a 64 px crop without a visible credit line: the credits are on the map it opens and in the tile's `title`. If a provider's terms need a visible credit on the crop itself, the fallback is the old line drawing.

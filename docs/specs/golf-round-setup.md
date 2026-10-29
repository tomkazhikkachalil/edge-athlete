# The golf round setup as steps

> Added Oct 28 2026 (the golf round as steps, zero DDL). Read the devlog entry "October 28, 2026 — The golf round setup as steps" before changing any of it.

## Convention 53 — A golf round is set up in steps; every input the form had keeps its place; the frame is StepFlow and the list follows the first step

**Tom's spec (Oct 28 2026):** replace the one long golf round form with a step-by-step flow; every existing input, option and behaviour stays, only the way through them changes; back and forward never lose an answer; every step shows where you are; later sports reuse the frame. The review found eighteen things the form did that the spec did not name (rating/slope, the custom course's par & yardage, the multi-course club chooser, the worldwide search, the info card, Score Entry, the post's story, the draft review landing, the date↔mode flip, what is actually required, …) and four places it changed behaviour while saying it did not; Tom's four decisions are below.

**The door is unchanged.** Golf is still the composer's sport slot (`SPORT_COMPOSER_EXTRAS`, `GolfComposerSection`): Create → Sport → Golf, `/feed?create=1&sport=golf` (Log a round, the onboarding CTA), the Get Started card, General post → Golf in the picker — every one opens step 1. There is no standalone sport screen (Tom, Oct 13). Above the frame the sport row is ONE line while the steps run (`data-post-type-compact`, Oct 29 2026 — the big Post Type card took a third of a phone screen): the sport's name with **Change** (the picker) and **Remove sport**, the way back to a General post.

**The frame is `StepFlow`** (`src/components/StepFlow.tsx`, Program D's shell; `SportSetupFlow` was the first user). It gained three optional props for this program, all defaulting to the old frame: `refusal` (why Next is grey, beside the button — `data-step-refusal`), `finishTone="live"` (the red Go Live) and `busyLabel`. The finish honours `canAdvance` too. The composer's own footer, tags, hashtags, Tag People and the audience switch stay off while golf is the post type (the golf submit never sent them; the already-played round decides its feed on the draft review): the step footer is the ONE set of buttons, and the header's X is the close (`useDirtyClose` + `ConfirmModal`, as before).

**The list follows the first step** (`src/lib/golf/round-steps.ts`, zero imports; `round-steps.test.ts` pins every row):

| Mode | Steps |
| --- | --- |
| Playing now · Outdoor (the defaults) | Round type · Course · Game format · Conditions · Players · **Start** (Go Live) |
| Playing now · Indoor | Round type · Course · Game format · Players · Start |
| Already played · Outdoor | Round type · Course · Game format · Conditions · Players · **Scores** · **Create** (Create Post) |
| Already played · Indoor | Round type · Course · Game format · Players · Scores · Create |

The step is held by ID (`GolfComposerValue.stepId`, riding the crash draft so a restore lands where it was); an id the new list lacks starts over at step 1 (`roundStepIndex`). Conditions, Players and Scores are skippable — nothing on them was ever required. **Only the course step (and the finish) refuses Next**, for the two fields the form always required: a course (`REFUSAL_COURSE`) and, for an already-played round, the date (`REFUSAL_DATE`). Weather, temperature and wind carried asterisks on the form but were never enforced; the asterisks are gone.

**Tom's four decisions (Oct 28 2026):**
1. **Step 1 keeps today's defaults** — Playing now + Outdoor pre-selected, Next available at once (the spec's "nothing pre-selected" was dropped).
2. **Near me on the course step runs on entry only when location is ALREADY granted** — `geolocationGranted()` (`src/lib/geo/request-position.ts`, feature-detected over `navigator.permissions.query`; false for prompt, denied, no API, a throw) and only while Playing now + outdoor with nothing typed or picked; then the same one-shot `requestPosition()` the Near me tap runs, so "Playing at X? · km" is the first row without a tap. Never a prompt on arrival; indoor and already-played never auto-run; the Near me button stands exactly as before otherwise. Convention 34's "on a TAP only" gains this one exception.
3. **The date is locked to today while Playing now** — the date control shows only for an already-played round (default today, `max` today); choosing Playing now sets today (`roundDateForMode`). The form's past-date → Already-played flip is retired.
4. **A Scores step for Already played only** — the multi-player grid and the hole-by-hole Quick entry (`ScoreEntryModal` batch mode), as the form had them. Playing now has no scores step: scores are entered on the live page. Finish → create → `/athlete/drafts/[postId]` → Post, as before (Convention 33).

**What each step holds (every control the form had, moved verbatim):**
- **Round type** (`RoundTypeStep`): "Golf" (and "for {athlete}" when a guardian composes), Playing now / Already played with the mode's help line, Outdoor / Indoor. Indoor clears weather, temperature and wind (the form used to submit values entered before the switch).
- **Course**: the date (already played only); the search field with catalog browse on focus, typeahead, the km chips, "Search all courses worldwide" (the only provider trigger), the unavailable row, attribution, Escape closing the dropdown first; Near me; the "Playing at X?" offer (live only); the selected-course badge; the multi-course club chooser and the two-nine "Pick your back nine"; `CourseInfoCard`; the custom-course notice; Tees (outdoor only — a catalog course's real tees hardest first, **each named with its yardage and rating / slope** (`teeChoiceLabel` over `courseSummary`, Oct 29 2026: "White · 6,412 yds · 71.2 / 128", a part only when the course knows it), else the five colours as names; a pick re-fills rating/slope and yardages); Course Rating / Slope Rating (once a course is named; auto-filled, editable); the custom course's Par & Yardage table.
- **Game format** (`FormatStep`): Stroke Play / Stableford / Match Play and the two help lines.
- **Conditions** (`ConditionsStep`, outdoor only, skippable): weather, temperature (°F), wind — optional, said so.
- **Players**: the card as it was — Add Others (`TagPeopleModal`), chips with Remove, the creator always on the card and always inserted server-side; a removed player loses their score row.
- **Scores** (already played only): the Score Entry card — Quick entry + `MultiPlayerScorecardGrid`.
- **Start / Create**: a summary (`data-round-summary-row=…`: course, date, round type, format, tee, conditions, players), the mode's line; for an already-played round the composer's media + caption block (`finishSlot`) and a Preview button; the footer's finish is Go Live (red, pulsing) or Create Post. `onFinish` IS the composer's `handleSubmit`: `submitSharedRound` and `afterCreatePath` are untouched and the request body is the same.

**Unchanged by design:** no 9/18 or Front/Back picker (derived at submit from the holes scored); `isValid` = course + date; `isDirty` as before (a seeded row is not work); the crash draft (`ea:composer-draft:v1`) carries the golf value while dirty, now with the step; the hole-range and creator-row render-phase syncs.

**Pinned by:** `round-steps.test.ts` (the four lists, skippable, index fallback, the refusals, the date rule, the labels), `step-flow.test.ts` (the refusal line, the finish's `canAdvance`, the tones), `request-position.test.ts` (granted only); e2e `golf-quick-entry.spec.ts` (the already-played walk to the draft review with the creator's row and the refusal; the defaults, the indoor list and the clean close; **Playing now to Go Live through the UI** — the first spec to; the phone Quick entry walk with no overflow on any step), `composer-near-me.spec.ts` (the course step's auto-run where the Permissions API answers granted, the tap elsewhere), `header-create`, `composer-default-general`, `sport-favourites`, `dropdown-visibility` (the frame is the door; the course field is step 2).

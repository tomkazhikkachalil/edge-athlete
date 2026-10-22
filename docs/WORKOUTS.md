# Workouts — the model, the screen, what counts

The workout screen program (Oct 12 2026, PRs #1159–#1163, migration 260) made the
live workout a place with a clock you control, groups of exercises done for rounds,
a rest timer and a stopwatch, and a summary that reaches the stats. This is the
reference; `DEVLOG.md` (Oct 12 2026, PR 1–5) is the record. Tom's ground rule:
**a workout saved before this opens, displays and counts exactly as it did.**

## The model (migration 260 — the program's only DDL)

`workout_sessions` → `workout_exercises` → `workout_sets` (045), with:

| Column | Meaning |
| --- | --- |
| `workout_sessions.timed` (default true) | The clock runs. `false` → `duration_seconds` is NULL at finish; Training counts the session with no minutes; the post carries no duration. |
| `workout_sessions.paused_seconds` / `paused_at` | The clock's pauses — SERVER facts (a reload, another device, the resume pill and the 7-day sweep read one clock). Only an active session is paused; every finish writes `paused_at` NULL. |
| `workout_exercises.client_id` (NOT NULL, default `gen_random_uuid()`, UNIQUE per session) | The STABLE exercise id. Every save is a whole-snapshot replace (256: delete + reinsert), so the row id is re-minted each save; the editor mints `client_id` once and the replace CARRIES it. The clip stash, the cards' keys and a rename hang on it. |
| `workout_sets.media` (jsonb, 046) | The set's clips, written where they were taken (Convention 37). **On the post a clip belongs to the EXERCISE** (Oct 22 2026): `exerciseMedia` / `roundMedia` (`src/lib/workouts/collage.ts`) gather a card's clips for ONE strip (`ExerciseMediaStrip`) at read time — no column moved, every existing post regroups by itself. |
| `workout_exercises.group_id` / `group_kind` (`superset` \| `circuit`) / `group_rounds` (1..10) | A group is the exercises sharing `group_id`, consecutive by position; kind and rounds are repeated on every member; a member's SETS are its rounds. All three set or all three NULL. The rounds cap is the routines' `target_sets` cap. |
| `workout_sets.rest_seconds` | The rest taken BEFORE this set (the rest timer). Never "data": a rest-only row is not a set. |
| `workout_routine_exercises.group_*` | A routine keeps its groups (Tom). Starting one mints fresh exercise ids and one fresh group id per group. |

There is NO session-level rest column: review-mode edits change sets without
re-finishing, so a Σ written at finish would drift; Σ rest is derived from the sets
(`computeSummary`) by every reader, which already loads them.

**One chain, every site:** `src/lib/workouts/entries.ts` (types + `validateEntriesPayload`),
`serialize.ts`, the RPC `replace_workout_entries`, the pre-256 fallback in the entries
route, `insertSessionEntries` in the workouts route (manual POST, routine start),
`routines.ts` and the calendar's routine snapshot. A field added anywhere is added to
all of them or it is silently dropped.

## The rules (pure, each with its test)

- **Ids:** `validateEntriesPayload` mints an absent `clientId` (an old client, an old
  draft, a routine) and requires a uuid, unique in the snapshot, when present (a
  duplicate would be a 23505 inside the replace — a 500 that wedges the autosave).
- **Groups are HEALED, never refused** (`entries.ts healGroups`): a singleton is
  ungrouped, members are made consecutive at the first's place, the kind is the
  first's, rounds = max(declared, the longest member) capped at 10, every member padded
  with empty sets — never truncated. A 400 is for type errors only: the editor's
  debounced sync re-sends the same snapshot forever on a 400. `groups.ts` is the
  editor's side of the same rules (make / add / remove / ungroup / rounds set, add,
  delete — group-wide — / rounds completed / the current round); every shape it
  produces validates with nothing to heal.
- **The clock** (`timing.ts`): `workoutElapsedS` excludes closed pauses and stands
  while paused; `finishDuration` ends never before an open pause (the reopen prompt's
  Finish sends the last activity, which may predate the pause — a naive formula
  inflated the duration), excludes the open pause, and is NULL when untimed; the
  finish PATCH and the 7-day sweep's `abandonFinalizeFields` both use it. Pause and
  resume are compare-and-set PATCHes stamped with the CLIENT's clock (`at`), which
  also moves `last_activity_at` — the entries PUT's stale guard compares the client's
  `savedAt` to it, so a server `now()` would make a lagging phone's saves stale.
- **Rest and the stopwatch** (`rest.ts`): a rest runs until a set is marked complete
  (the set takes the seconds) or is stopped by hand and HELD for the next completed
  set; the target is a device preference (`timer-prefs.ts`) with a gentle alert (brand
  colour, `haptic()` where the phone can — an iPhone does not vibrate from a web app —
  one toast). The stopwatch accumulates runs; Save to set writes whole seconds into
  the current set's `durationSeconds` (the last-edited exercise's first empty set, else
  a duration exercise's, else the first empty anywhere). Both live under their own
  device key (`timers-store.ts`) so a reload keeps them; neither touches the clock.

## The screen (`src/components/workouts/`)

**Starting one (Oct 13 2026; the start screen Oct 20 2026 — Program E2):** `src/hooks/useStartWorkout.ts` is the ONE start path — Training's Start Workout, the header's Create → Record Activity → Start a workout and the recorder's Strength training all call its `open()`, which is the START SCREEN `/app/workout/start` (`WorkoutStartScreen`: the title, the routine — an empty workout or a saved one — "Time this workout" remembered on the device (`TIMED_DEFAULT_KEY`), what will be recorded, a banner with Resume when one is in progress). **Nothing is written before its Start** — no draft, no row; the Start tap is the one `POST /api/workouts { mode: 'live', routineId?, title?, timed? }` (`timed` validated before any state check), 409 → resume, `refreshDrafts()`, `/app/workout/<id>`. The old routine picker sheet is gone. A new door calls the hook; it never POSTs on its own.

`WorkoutEditorScreen` (the sticky header: the title, the house `ActionMenu` with Hide
timer · Don't time this workout · Discard; `LiveClock` with Start/Pause beside it;
only a FAILED save shows a label), `ExerciseCard` (rename in place through its menu;
grouped mode: rows R1 · R2 …, a deleted row is the round across the group), `ExerciseGroupCard`
("Round N of R", the rounds stepper, Add round; **rounds as a swipe, Oct 13 2026** —
in SWIPE view, the default, the members sit on ONE slide per round through
`RoundsTrack`, each an `ExerciseCard` rendering only that round's row
(`grouped.onlyRound`); the header names the slide in view; completing the round in
view advances to the next; "Copy previous round" fills an empty round from the one
before; the menu's List view is the Oct 12 rendering — a device preference,
`timer-prefs.ts readGroupView`, like the one-time "Swipe to move between rounds"
hint), `RoundsTrack` (the ONE carousel: `snap-x snap-mandatory`, the index controlled
by its host, programmatic moves set `scrollLeft` — never `scrollIntoView` — smooth
unless the device prefers reduced motion, no `touch-action` so the page still scrolls
vertically from a touch on a round, slides out of view `inert`), `GroupDetailCard`
(a finished workout's group in the post AND the history card: "Circuit · 4 rounds ·
1,200 lbs" over the rounds' track, a tap expands every round), `AddExerciseSheet`
(one pick, or several for a superset / circuit), `WorkoutControls` (the bottom bar:
Rest, the target chip, Stopwatch with Save to set; the screen owns its bottom edge —
`/app/workout/` hides the tab bar; **the bar publishes its height as
`--ea-workout-bar-h`** and the editor's `.ea-bar-clearance` follows it, so the open
stopwatch panel — always mounted, animating `max-height` — takes its own space
instead of covering the Add buttons), `FinishFlow` (the summary — Tom's questionnaire — then **Preview and post**).

**The finish flow (Training fixes PR 4, Oct 21 2026):** Finish records (`status = 'completed'`)
and pushes `?step=summary`; Continue pushes `?step=preview`; the URL is the phase, so Back and
Forward move one step and a reload keeps it (`finish-draft.ts stepFromSearch`; `?share=1` is the
preview's alias). Post or Done (`PATCH { decided: true }`) is the DECISION (`share_decided_at`);
until then the workout is UNPOSTED — in the owner's Training with a "Finish posting" tag, hidden
from visitors, and offered by the pill, the reopen prompt, Drafts and the start screen. What only
the screen knew (the step, the caption, the confirmed records, the clips' order) lives on the
device under `ea:workout-finish:v1:<id>` until Post, Done or Delete. `useStartWorkout` replaces the
start screen with the editor, so Back never offers a new workout over an unposted one.

## What counts where

- **Training weekly minutes** = `sessionSeconds`: the stored duration (total time minus
  pauses; rest is inside it), `0` for an untimed workout — checked FIRST, so a NULL
  duration never falls back to wall-clock (Tom's call: comparable with every older
  workout).
- **The summary** (`computeSummary`): sets with data, volume (total and per exercise),
  Σ rest / its count / the average, the groups with rounds completed (a round counts
  when EVERY member's set has data). `buildWorkoutStatsData` adds `rest_seconds`,
  `active_seconds` (duration − rest), `avg_rest_seconds`, `groups` and
  `per_exercise_volume_lbs` ONLY when present and omits `duration_seconds` when
  untimed — an older workout's post keeps its shape byte-identical (pinned).
- **Progression** (`dashboard.ts progressionKey`) keys on `exerciseKey ?? name`: a
  catalog exercise keeps its key through a rename; a renamed CUSTOM exercise starts a
  new line under its new name.

## Traps recorded

- `resolveEntries` lets the server win over a localStorage draft after ANY session
  UPDATE (`updated_at`) — a pause from a second device drops the first device's
  offline edits on reload; a widening of the existing rule (every live PUT already
  bumps it), recorded, not fixed.
- The e2e specs read the clock by `[data-live-clock]` (not the first `span.tabular-nums`
  — the bar's numbers would shadow it) and dismiss the reopen prompt before tapping
  anything under its backdrop.

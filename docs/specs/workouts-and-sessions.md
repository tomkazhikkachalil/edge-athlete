# Workouts and sessions: capture, the resume pill, the workout screen

> Moved verbatim from CLAUDE.md "Key Conventions" on Oct 13 2026. Convention numbers are kept because code comments and docs cite them. Read the devlog entries each convention names (`docs/devlog.md`) before changing the code it describes.

## Convention 37 — A workout clip is a tile the instant the camera hands it back; the set carries it until it is stored (Workout capture round, Oct 8 2026, zero DDL)

**A workout clip is a tile the instant the camera hands it back; the
set carries it until it is stored (Workout capture round, Oct 8 2026,
zero DDL)** — Tom: a capture during a Training workout "kicked me out of the
workout and the capture did not complete" (iOS throws the page away while
the native camera is up — the Sep 3 2026 rounds; nothing in the app
navigates). Capture v2's rule now holds on the set row: `planPickAttach`
decides (a camera capture and a library VIDEO attach at once; a library
photo and a HEIC open the editor first), NOTHING heavy runs between the
hand-back and the tile, and the editor is the tile's pencil. A clip that
is not yet uploaded lives IN the set's media as `{ url: 'pending:<localId>' }`
(`src/lib/workouts/set-media-pending.ts`, zero imports — the draft
persists it for free and it moves with its set), its bytes in IndexedDB
`ea-workout-media` (`media-stash.ts` — an **ArrayBuffer, never a Blob**:
WebKit refused Blob records on Sep 3; fail-open; the draft's 48 h) **with
the clip's PLACE** (`place: { exerciseName, setNumber }` — the stash is the
durable record of "a clip was attached HERE"; when the stripped snapshot
landed before a reload and the server copy won without the entry, the
resume puts it back with `reattachPendingMedia`), the upload in the
screen's ONE queue (`useSetMediaUploads`: one at a time — never
`Promise.all` — finds the entry by URL when it lands, resumes from the
stash on mount, a failed clip is a Retry tile and a toast, never a
dropped clip). **Every entries PUT body goes through
`stripPendingMedia`**; Finish / Save / Done `settle()` the queue first and
stop on a failed clip by name. The tile's `data-set-media-state` is
`pending | failed | stored`. e2e: `e2e/workout-capture.spec.ts`
(`@mobile`) holds the complete route, reloads, and watches the upload
land by itself. **The review step (PR 2, Oct 9):** the share screen's
clips are an ordered LIST — the selection is clip URLs in CAROUSEL order
(`src/lib/workouts/share-media.ts`, zero imports: `toggleShare` /
`moveShare` / `replaceShareUrl` / `pruneShareOrder` / `shareList`), never
indices; Edit opens the SAME editor the set rows use and Done writes the
new URL INTO THE SET (`replaceMediaAt` → `mutate` → the entries PUT; the
post shows the edited clip because the set holds it — no second copy);
Remove asks through `ConfirmModal` naming the set. `data-share-clip` /
`data-share-position` are the hooks; `e2e/workout-review.spec.ts`. **The
page (PR 3):** the signed-out bounce is `/?next=/app/workout/<id>` (never
a bare `/`), the load is ONE per (user id, workout) and a failed re-read
never replaces a loaded editor, and the one-second tick lives in
`LiveClock` — never in the screen's state. **The entries PUT's stale-write
guard is LIVE-only** (`entries-stale.ts`): a completed session's
`last_activity_at` is its END time (a manual log can put it in the
future), so review-mode edits are never guarded and never move it. **The
replace is ONE transaction serialized per session (mig 256,
`replace_workout_entries`, FOR UPDATE on the session row; the route
falls back to the three-call path on 42883 pre-256)** — two PUTs in
flight (the debounced save + a reload's keepalive flush) used to both
pass the guard and both reinsert, every exercise twice;
`e2e/workout-entries-race.spec.ts` is the pin. Read DEVLOG Oct 8–9 2026
(Workout capture PR 1–4) first.

## Convention 41 — A session is a place you can always get back to (Resume pill program, Oct 12 2026, #1155–#1157, mig 259 the ONLY DDL)

**A session is a place you can always get back to (Resume pill program,
Oct 12 2026, #1155–#1157, mig 259 the ONLY DDL)** — Tom's spec: resume an
in-progress workout, activity or round from anywhere. His decisions: the
7-day sweep KEEPS the Oct 6 rule (finish as played when anything was
recorded, discard only the empty — the spec's "deleted" is not adopted);
the recording engine lives at the app ROOT; recordings stay DEVICE-ONLY
(no server mirror, no reminder for them); the reopen prompt stays beside
the pill. **The pill** (`src/components/sessions/ResumePill.tsx`,
root-mounted; rules pure in `src/lib/sessions/pill.ts`): while a workout
or a round is in progress (or a recording on THIS phone), one pill on
every signed-in page the tab bar knows — never on a session's own screen
(`sessions/paths.ts isSessionScreen`, the ONE list `reopenSkipsPath`
shares) — the kind, a clock DERIVED from `DraftItem.clockStartAt` (a
round's `created_at`, a workout's `started_at`, a recording's start plus
its pauses; never counted), one metric ("Thru 2/9", "5 sets", the live
distance); `sessions/progress-store.ts` is how the session's screen
publishes the live number; every door that starts or ends a session calls
`refreshDrafts()`. `z-[35]`; `.ea-resume-pill` sits over `--ea-tabbar-h`
(which already carries the inset — the custom property's fallback is the
inset itself). **The engine** (`RecordingProvider` in the `(app)` layout,
`RecordingEngineHost` a `next/dynamic` headless chunk mounted only when a
recording exists or starts, `engine-store.ts` → `useRecording()`): the
GPS watch, the wake lock, the device store (EVERY fix written; the open
batch rewritten, closed at 10), the photo uploads — leaving the recorder
changes nothing; the page is a VIEW. `recording.ts restoreRecording`:
away ≤ `GAP_ENDS_RECORDING_MS` (12 h) → still recording, the time away a
GAP (a note on the screen, a dashed bridge on the map — `route-gaps.ts`);
longer → paused where last known. 7-day retention is ONE number everywhere
(`session-retention.test.ts`). **The reminder** (`sessions/abandon-
reminder*.ts`, `session_reminder` — mig 259): the daily cron, the day
BEFORE the sweeps, bells the round's creator / the workout's owner once
(deduped on the bell's metadata) saying which will happen. Read DEVLOG
Oct 12 2026 PR 1–3 first.

## Convention 42 — A workout has a clock you control, groups done for rounds, a rest timer and a stopwatch, and nothing saved before it changes (Workout screen program, Oct 12 2026, #1159–#1163, mig 260 the ONLY DDL — runs on BOTH databases BEFORE PR 1 deploys: the insert paths name its columns)

**A workout has a clock you control, groups done for rounds, a rest timer
and a stopwatch, and nothing saved before it changes (Workout screen
program, Oct 12 2026, #1159–#1163, mig 260 the ONLY DDL — runs on BOTH
databases BEFORE PR 1 deploys: the insert paths name its columns)** — Tom's
spec and decisions: routines KEEP groups; "Hide timer" is remembered per
person on the device; Training weekly minutes stay total time minus pauses
(rest inside; an untimed workout counts as a session with no minutes).
`docs/WORKOUTS.md` is the reference. The invariants: **every save is a
whole-snapshot replace** (256) so the STABLE id is the editor's
`client_id` (NOT NULL default, UNIQUE per session; the RPC CARRIES the
client's; absent is minted, present must be a uuid and unique — a duplicate
is a 500 that wedges the autosave); **groups are HEALED, never refused**
(`entries.ts healGroups`, mirrored by `groups.ts` — a 400 is for type
errors only, the debounced sync re-sends forever); a member's sets ARE its
rounds; **pauses are SERVER facts stamped with the CLIENT's clock**
(`timing.ts`; the stale guard reads `last_activity_at`); the finish ends
never before an open pause and is NULL when untimed — and `sessionSeconds`
checks `timed === false` FIRST; **rest lives on the SET** (`rest_seconds`,
never data, no session Σ column — derived); the stopwatch writes the set's
`durationSeconds`; the timers persist under their own device key; the
screen owns its bottom edge (`/app/workout/` hides the tab bar);
`buildWorkoutStatsData` adds its new keys ONLY when present and omits
`duration_seconds` when untimed (an old post's shape is pinned
byte-identical). Specs read the clock by `[data-live-clock]`. Read DEVLOG
Oct 12 2026 PR 1–5 first. **Two fixes from Tom's phone (Oct 13 2026, zero
DDL):** the bottom bar PUBLISHES its measured height (`--ea-workout-bar-h`,
the `TabBar` recipe) and the editor's `.ea-bar-clearance` follows it with a
transition — the stopwatch panel is always mounted and animates
`max-height`, so it takes its own space and never covers the Add buttons;
and **a group's rounds are a horizontal stack**: `RoundsTrack` is the ONE
carousel (the live card AND the post's `GroupDetailCard`; `snap-x`, the
index controlled by the host, programmatic moves set `scrollLeft` — never
`scrollIntoView` — smooth unless reduced motion, behind a `programmatic`
ref; NO `touch-action` on the track — the effective value is the
intersection down the chain, `pan-x` would stop the page scrolling from a
touch on a round; out-of-view slides `inert`), the rules pure in
`rounds-view.ts` (a round is complete when every member MARKED it; the
auto-advance fires on the false → true edge of the round IN VIEW only),
`groups.ts copyRound` copies values never media / completion / rest, the
view (`swipe` default | `list`) and the one-time hint are device
preferences in `timer-prefs.ts`. A spec that logs rounds by row index asks
for LIST view in `addInitScript` (`workout-groups.spec`).

### Oct 16 2026 — Strength training is the Workout: records for every exercise, effort (activities details A10)

- **Strength is not an activity type** (Tom approved, Oct 16): the recorder's picker carries a **Strength training** tile in its Indoor group that opens the Workout (`useStartWorkout` — its routines sheet when there are routines). A second set-and-rep logger would record one session twice. Hidden while a guardian acts for an athlete (workouts are the athlete's own).
- **Records for every exercise** (`src/lib/workouts/prs.ts`, pure): heaviest weight, best estimated 1-rep max (Epley, sets of 1–12 reps), most reps in an unweighted set, best session volume — **derived from the sets, never stored**. An exercise is one lift by its catalog key, else its name. A session's records are its bests that beat EVERY earlier completed session's (`GET /api/workouts/prs?exclude=<id>`, owner-only, `private, no-store`); a first-ever lift is a baseline, never a record. The summary shows them ("New PRs"), a shared post carries them; the five-lift body-metric confirm stays as it was.
- **Effort 1–10** on the summary (`EffortChips`, the activities' one control) → `workout_sessions.effort` (265) through the PATCH, saved as tapped.
- **Units:** a workout reads in the unit most of its weighted sets were logged in (`workoutUnit`; lbs on a tie — the app's spelling); Training's **Personal records** card (own profile) reads in the unit most of the athlete's sets use.

### Oct 16 2026 — Training load (activities details A11)

- **Load = minutes × effort** (session-RPE), per session (`loadOf` in `src/lib/training/session-math.ts`): the effort is 265's `activities.effort` / `workout_sessions.effort`, carried into `TrainingSession.effort` by both feeds (`fromActivity`, `workoutToSession`). **A session nobody rated adds no load — never imputed**; every week carries `rated` beside `workouts`.
- **Shown:** Training's hero reads "Load 1,240 · 6 of 8 rated" under the week's stats (or, with none rated, how to make one count); the Weekly activity overlay switches between Sessions and Load and each week's row adds its load.

### Oct 17 2026 — Names you can edit and read; the screen stays on (Training fixes PR 1)

- **Rename keeps the name.** The exercise rename field opens holding the current name with the cursor at its end (`placeCaretAtEnd`, `src/lib/workouts/name-field.ts`) — never a select-all that re-runs per keystroke (it made each letter replace the last). The workout title field is labelled "Workout title".
- **A long name ends in "…"; a tap shows it whole** (`ExerciseName.tsx`): it is a button only while cut (`isTruncated`); a second tap or a tap anywhere else closes it; a name that fits does not react. Used on the workout card, the finish summary, the routine editor (and, from PR 2, the posted workout); never inside another button (the stopwatch's set picker keeps its plain line).
- **The screen stays on through every session** — one hook, `useWakeLock` in `src/lib/device/wake-lock.ts` (the controller in `wake-lock-controller.ts` is node-tested): the recorder's engine (activities, sport sessions, the round timer) and the live workout (`mode === 'live' && phase === 'editing'`, paused included). Asked again each time the page returns (an old lock released first, a stale "released" ignored); Finish, discard or leaving lets the screen sleep. Only the automatic timeout is stopped; no lock in the browser = the session runs as before.

### Oct 17 2026 — A posted workout's images (Training fixes PR 2)

- **One renderer** for a finished workout's details: `WorkoutDetailItems.tsx`, used by the feed post (`WorkoutPostCard`) and the Training history card (`WorkoutCard`) — they cannot disagree.
- **A single exercise is one bordered card** (the circuit card's style), a row per set — `Set N · line` on the left, that set's images on the right: one alone, several as a stack with "+N" (`SetImageStack`, `stackBadge`). A superset / circuit keeps its swipeable card (`GroupDetailCard`) with each round's images UNDER the round, inside the card; the expanded list reads round by round.
- **A tap opens the app's viewer, never a new window** (Tom: the old link opened a bare image page; in the installed app it could not be closed). One `MediaLightbox` per workout, portalled to the body (above the post detail modal; Escape closes only it), walking every image in reading order (`workoutCollageItems`, `src/lib/workouts/collage.ts`): singles set by set, groups round by round; captions "Bench Press · Set 3" / "Circuit · Round 1 · Squat".
- Capture is unchanged: an image belongs to its set (Convention 37).

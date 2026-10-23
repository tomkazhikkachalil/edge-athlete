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
WebKit refused Blob records on Sep 3; fail-open; the draft's 7 days) **with
the clip's PLACE** (`place: { exerciseClientId, exerciseName, setNumber }` —
the stash is the durable record of "a clip was attached HERE"; when the stripped snapshot
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

### Oct 21 2026 — A posted workout is edited from its post; the post follows (Training fixes PR 5, zero DDL)

- The owner's post menu offers **Edit workout** on a `workout_session` post (`PostOwnerMenu` `edit-workout` → `/app/workout/<id>`, review mode). **The post's `stats_data` follows the session:** an entries PUT or a title PATCH on a completed session with a post rebuilds it on the server (`post-stats.ts workoutPostStatsFromSession`, pure, the confirmed records kept; `post-stats-server.ts refreshWorkoutPostStats`, owner-checked, best-effort). Never taken from the client after posting. Pinned by `workout-post-stats.test.ts`, `e2e/workout-posted-edit.spec.ts`.

### Oct 21 2026 — Never lose a finished workout; the steps are the URL; Back and Forward move one step (Training fixes PR 4, zero DDL)

Tom's items 6–8 for workouts. **Finish is the record, Post or Done is the decision:** `PATCH { finish }` sets `status = 'completed'` and nothing else about sharing; `PATCH { decided: true }` (Done) or `{ postId }` (Post) stamps `share_decided_at`; `DELETE` removes the row. **Unposted** = completed, no post, undecided: the owner's draft — it stands in the owner's Training with the amber **Finish posting** tag (`WorkoutCard`, `data-workout-finish-posting`), a visitor never sees it (`GET /api/workouts` non-owner filter `share_decided_at IS NOT NULL`; `GET /api/workouts/[id]` 404), and it is surfaced until Post, Done or Delete: `buildDraftsList` lists it as `state: 'draft'` with `href: /app/workout/<id>?step=preview` and no clock (`workoutStepHref`); the Drafts row offers Finish posting / Delete (confirm); `pickReopenCandidate` and `pickPillSession(inProgress, drafts)` fall back to it ("A finished workout is waiting to be posted." / the pill's metric "Finish posting", no elapsed); the start screen's banner (`data-workout-start-unposted`) offers Finish posting before "Start another". **The steps are the URL** (`src/lib/workouts/finish-draft.ts stepFromSearch`): `?step=summary` (the questionnaire — effort, the records to confirm, Save as routine, **Edit workout**), `?step=preview` (**Preview and post**: the feed's own `PostCard` `inReview` over the would-be post, the feed switch, the caption, the clips, **Post** / **Done**, **Edit** one step back, **Delete** with the confirm "Delete this workout? This can't be undone."), nothing = the editor; `?share=1` is the preview's alias. The page's `StepParamReader` reports it three-way and the editor mounts once it is known and is never un-mounted later; every step change is `router.push` of the same route — Back and Forward move one step; after Finish the editor derives `effectiveMode` (a finished live session is in review at once); `useStartWorkout` REPLACES the start screen with the editor; Post, Done and Delete leave by `replace`; a DECIDED workout (posted or Done) has no steps — an old `?step=` history entry opens the editor, never a second Post. **The device remembers** the step, the caption, the confirmed record keys and the clips' order (`ea:workout-finish:v1:<id>`, 7 days, fail-open; written on every change, read on mount — a fresh landing with no step goes to the remembered step else the preview; cleared by Post, Done, Delete). A completed session recomputes both record lists on mount. Pinned by `workout-finish-steps.test.ts`, `e2e/workout-drafts.spec.ts`, `reopen-prompt`, `workout-review`, `workout-start`.
### Oct 21 2026 — A custom rest target, saved as a preset (Training fixes PR 3)

> **Superseded by "Oct 22 2026 — The rest timer" below:** the built-in five and the modal sheet are gone; the wheels, the saved list and its rules stand.

- The rest target sheet shows the built-in five (`REST_TARGET_PRESETS_S`) and the athlete's saved presets together, ascending, then Off and **Custom…** — two wheels (golf's `NumberWheel` with `step` / `format`: Minutes 0–10, Seconds by five), **Use** sets the target, **Save as preset** keeps it on the device (`timer-prefs.ts REST_PRESETS_KEY`, a JSON list; the rules pure in `rest.ts`: 5 s–1 h whole seconds, at most six saved, newest first, never a built-in; a saved chip carries a remove). The target itself stays `REST_TARGET_KEY`. Pinned by `workout-rest.test.ts`, `wheel.test.ts`, `e2e/workout-rest-stopwatch.spec.ts`.

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

> **Superseded by "Oct 22 2026 — One bubble per exercise; a clip belongs to the exercise" below:** the row-per-set layout, the per-set stack and the Oct 21 uniform set bubbles are gone; the viewer, the portal and "never a new window" stand.

- **One renderer** for a finished workout's details: `WorkoutDetailItems.tsx`, used by the feed post (`WorkoutPostCard`) and the Training history card (`WorkoutCard`) — they cannot disagree.
- **A single exercise is one bordered card** (the circuit card's style), a row per set — `Set N · line` on the left, that set's images on the right: one alone, several as a stack with "+N" (`SetImageStack`, `stackBadge`). A superset / circuit keeps its swipeable card (`GroupDetailCard`) with each round's images UNDER the round, inside the card; the expanded list reads round by round.
- **A tap opens the app's viewer, never a new window** (Tom: the old link opened a bare image page; in the installed app it could not be closed). One `MediaLightbox` per workout, portalled to the body (above the post detail modal; Escape closes only it), walking every image in reading order (`workoutCollageItems`, `src/lib/workouts/collage.ts`): singles set by set, groups round by round; captions "Bench Press · Set 3" / "Circuit · Round 1 · Squat".
- Capture is unchanged: an image belongs to its set (Convention 37).
- **Oct 21 2026 (Training fixes PR 1):** every set is a BUBBLE; in an exercise with any media every bubble is the thumb's height (64 px — one thumb size everywhere) with that set's stack at its right and an empty slot on a set without media, so the sets stack with one gap whether or not a set has a photo; a round's member lines follow the same rule. The fill inside an expanded post is the page background (`bg-canvas`); the header, the violet cards and bubbles and the Hide details bar stay purple. An untimed workout shows NO time: two tiles on the post and on the finish summary (`data-summary-duration` is on the grid).

### Oct 19 2026 — Finish is the decision; "Keep private" is gone; Hide from my profile (Convention 50, mig 269)

> **Superseded in part by Training fixes PR 4 (Oct 21 2026):** Finish is the RECORD, Post or Done is the DECISION — see the Oct 21 section. The Hide pair, the Drafts page's lack of a "Ready to post" bucket for a DECIDED workout, and `e2e/feed-toggle` stand.

A finished workout is never a draft: the `finish` branch of `PATCH /api/workouts/[id]` stamps `share_decided_at` (253's "Ready to post" bucket and `keepPrivate` are gone; the Drafts list and `DraftRow` no longer know a finished workout). The share step's two cards are the one switch, "Post to feed" (kind `workout`, remembered on the device): ON posts; OFF is **Done** — records the PRs, then `/athlete?tab=training`, nothing written. The owner's later Hide is the page menu's "Hide from my profile" / "Show on my profile" → `PATCH { hidden: boolean }` → `workout_sessions.profile_hidden_at` (241's shape): `GET /api/workouts` skips a hidden session for a visitor, `GET /api/workouts/[id]` answers 404 to one; the owner always has it. `e2e/workout-drafts` and `feed-toggle` pin it.

### Oct 20 2026 — The Workout's set-up step: `/app/workout/start` (Program E2, zero DDL)

Tom (the flow changes, item 5): the Workout gets the set-up step too — nothing starts until Start. **A route, not a sheet:** `/app/workout/start` (`src/components/workouts/WorkoutStartScreen.tsx`) is where every door lands — Training's Start Workout, Create → Record Activity → Start a workout, the recorder's Strength training (`useStartWorkout.open()` is `router.push('/app/workout/start')`; `StartWorkoutSheet` is deleted). The screen: a title (placeholder = the routine's name), the routine as radios (Empty workout + Your routines — the hook's `/api/workout-routines` read), **"Time this workout"** (default from `TIMED_DEFAULT_KEY`, remembered on Start — the "Hide timer" precedent), the records line, an in-progress banner from `useDrafts().inProgress` with Resume, and a fixed `data-workout-start` CTA always in the viewport. **Nothing is written before Start** — no draft, no row; the Start tap is the one `POST /api/workouts { mode: 'live', routineId?, title?, timed? }` (the live branch validates `timed` BEFORE any state check and writes 260's column on the insert, so `started_at = now` is truly the start); 409 → the same toast + the open session; success → `refreshDrafts()` + `/app/workout/<id>`. The `eventId` branch is untouched. Pinned by `workout-start.test.ts`, `e2e/workout-start.spec.ts` (@mobile: the start screen with no row, a reload leaves nothing, untimed + titled → the row; the in-progress banner; the API's `timed` 400 / true), `activities-doors` (`throughPicker` taps the start screen's Start), `header-create` (Start a workout → the route), `workout-prs` (Strength training → the route → Start).

### Oct 22 2026 — One bubble per exercise; a clip belongs to the exercise (Training: three changes, #1278 + PR 2)

> Supersedes the Oct 17 "a row per set, that set's images on the right" and the Oct 21 "uniform set bubbles" bullets above. Capture (Convention 37) is unchanged.

Tom's three changes, refined Oct 22 2026:

- **Training → Start offers Workout or Activity.** The header's one **Start** (and the empty state's "Start your first session") opens `StartSessionSheet` (`LargerWindow`, `data-larger-window="start-session"`): **Workout** → `/app/workout/start` (nothing written before its Start, the Oct 20 rule); **Activity** → `/activities/record`. The rows are `StartSessionRows`, the SAME pair the Create sheet's Record Activity step shows, so the two doors cannot differ (`workout-start.test` pins it). The separate "Record Activity" pill is gone; its hook `data-training-record-activity` sits on the sheet's Activity row (`activities-doors.spec`). Activities were already in Training — Recent sessions, the week, the streak and the bars count both kinds (`mergeSessions`, `session-math.ts`), and an activity shared "as training" is a `post_category='training'` post in the Training Activity grid; the diary footer now says "and activities".
- **One outer bubble per exercise, one inner bubble for all its sets.** `WorkoutDetailItems` draws a single exercise as ONE light violet card (`data-post-exercise-card`) holding its name and everything for it, with ONE deeper bubble inside (`data-post-sets-bubble={sets}`) holding every set as a LINE (`data-post-set-row={n}`: "Set N · line") — never a bubble or a border per set. A superset / circuit is one outer card with ONE inner bubble per round (`GroupDetailCard`, `data-post-round-bubble={k}`: each member's "name · line"), the rounds still a `RoundsTrack` swipe. Both bubbles follow the host's tone (the history card is neutral; the group card used to hardcode violet).
- **A clip belongs to the exercise, not a set.** The exercise's clips — every set's, set by set (`exerciseMedia`, `src/lib/workouts/collage.ts`; a round's across its members, `roundMedia`) — are ONE strip at the inner bubble's right (`ExerciseMediaStrip`, `data-post-exercise-media={count}`): 64 px tiles, one on a phone with "+N", up to three from `sm:` with "+N" on the last (`moreBadge`), never taller than one tile. **A bubble grows only with more sets, never for media** (`min-h-16` keeps a one-set bubble the tile's height). The viewer walks the workout as before (set by set = exercise order; groups round by round) and its captions name the exercise — "Bench Press", "Circuit · Round 1 · Squat" — never a set. The review step's rows read "Bench Press · clip 2" (`clipOrdinals`) and the remove confirm "deleted from Bench Press". **Storage is unchanged** (`workout_sets.media`, mig 046; the stash place keeps `{ exerciseClientId, exerciseName, setNumber }`; `replaceMediaAt` / `removeMediaAt` still work by position), so every existing post regroups at read time — zero DDL. The live editor's per-set tiles (capture, retry, edit) stay.
- Pins: `workout-collage.test` (helpers, captions, the layout's source), `workout-set-posters.test`, `e2e/workout-post-media.spec` (one bubble, 3 lines, a 4-clip strip, phone 1 tile "+3" / desktop 3 tiles "+1", Bench's bubble = Deadlift's, Curl's = 64 px, the circuit per round, the viewer), `workout-capture`, `workout-review`, `workout-rounds-swipe`.

### Oct 22 2026 — The rest timer: phases and colours, the total beside the clock, the picker panel; rest is personal (Rest timer round, #1283 + #1284)

> Supersedes the Oct 21 "A custom rest target, saved as a preset" bullet above (the built-in five and the modal sheet are gone) and Convention 42's "turns the number brand at the target".

Tom's three items, refined Oct 22 2026, and his two decisions: **Off** = rests are still timed and counted, with no target and no colour changes; **total rest is personal** — shown during the workout and in the athlete's own metrics, never on what others see.

- **The clock has no rest of its own.** `LiveClock` used to draw "Rest m:ss" = the seconds since the LAST COMPLETED SET (`lastCompletedMs`) — a counter unrelated to the bar's Rest timer that appeared whenever any set was marked complete (the stopwatch's Save to set included) and read as "a rest counter next to the clock, seemingly at random". Deleted. The bar's Rest timer is the one rest.
- **The rest's colour is its phase** (`rest.ts` `restPhase`, `data-workout-rest-phase`): **running** (purple, `bg-brand`) from the moment the rest starts — never red at the start; **warning** (yellow, `bg-amber-400`) when the target is `REST_WARN_S` = 5 s away; **reached** (red) at the target; **overdue** (red, `animate-pulse`) from `REST_OVERDUE_S` = 5 s after; the tap that ends the rest resets everything (`idle`, the bordered button, "Rest m:ss · next set"). With the target Off the rest is `running` throughout. The once-per-rest buzz + toast at the target stays.
- **A held rest is banked, never dropped** (`RestTimer.bankedS`): a rest ended by hand and followed by another rest before a set was completed joins the next completed set's `restSeconds` (`restForCompletedSet` = own + banked) and the total; `parseTimers` reads a device written before the bank as 0.
- **The total rest beside the clock** (`data-workout-rest-total`, the editor; `restTotalS` = Σ `set.restSeconds` + banked + held): appears when a rest ends and climbs with each later rest; a running rest is not in it until it ends; shown timed, untimed and timer-hidden alike (rest is timed in every case).
- **Rest never reaches a public surface:** the post's extras line keeps only the groups (`WorkoutPostCard`), the tiles' stats line (`stats-summary.ts`) has no rest, a visitor's Training diary card has no " · rest"; the owner's diary card and the Finish summary (`data-summary-rest`) keep it; `stats_data.rest_seconds` / `avg_rest_seconds` / `active_seconds` are still written (the athlete's own metrics).
- **The rest picker is a panel, not a sheet** (#1284): the Target chip (and the Rest long-press) opens an inline panel like the stopwatch's — always mounted, `transition-[max-height,opacity]`, `inert` when closed, `data-workout-rest-target-open` / `-panel`; opening it closes the stopwatch panel and vice versa, and the bar's measured height drives `.ea-bar-clearance` as before. It opens on the two wheels (Minutes 0–10, Seconds by five; `data-workout-rest-custom-value`), then **Use for this workout** (`-custom-use`) · **Save as preset** (`-custom-save`, saves AND uses), then **Your presets** — the saved chips only, ascending (`data-workout-rest-preset={s}`, `-saved="true"`, a remove `-preset-remove`; "Save a time above to keep it here" when none) — and **Off** (`data-workout-rest-preset="off"`). **There are no built-in presets** (`REST_TARGET_PRESETS_S` is gone; `addRestPreset` keeps every valid time, 5 s–1 h, at most six, newest first). The target stays `REST_TARGET_KEY`, the list `REST_PRESETS_KEY`.
- Pinned by `workout-rest.test.ts` (the phases at every boundary, the bank, the total, the old-device parse, the panel's source, the public-surface rule), `e2e/workout-rest-stopwatch.spec.ts` (a 7 s target through the four phases, the tap → idle, the total appearing and climbing, Off purple throughout, one Rest in the clock's row; the panel: wheels → Use / Save → a chip that survives a reload → remove → Off; the clearance with the panel open; the mutual close).

### Oct 23 2026 — The stopwatch: the 3-2-1 lead-in, count-down mode with the bell, the rest interplay, longest-hold records (Stopwatch additions, #1287 + #1288)

Tom's seven, kept on top of everything the stopwatch did (Start/Stop/Reset, the target set and its picker, Save to set, surviving a reload, never touching the workout clock):

- **A 3-2-1 lead-in** (`STOPWATCH_LEAD_IN_MS`, on unless switched off — `STOPWATCH_LEAD_IN_KEY`, the panel's `3·2·1 on/off` switch, `data-workout-stopwatch-leadin`): the Start tap puts `runningSince` at the lead-in's END, so the lead-in never counts; the panel and the bar's button show 3, 2, 1 (`data-workout-stopwatch-leadin-left`); a stop during it cancels it.
- **Count up or down** (`Stopwatch.mode`, `data-workout-stopwatch-mode`; the count-down's target `targetMs`, 5 s–10 min, set with the rest picker's wheels — `data-workout-stopwatch-target-time` opens `data-workout-stopwatch-target-wheels`; both remembered on the device, `STOPWATCH_MODE_KEY` / `STOPWATCH_TARGET_KEY`, and carried on the session's timers while a time runs). The clock shows the time left (`stopwatchDisplayS`); at zero the stopwatch **stops itself at exactly the target** (`stopwatchSettle`, once per run) with the round timer's bell (`armBell()` in the Start tap — sound needs a gesture — then `ringBell('end')`), a buzz and a notice; **Save to set records the time actually held** (the target when it ran out, less when stopped early). The tick is a quarter second while the stopwatch runs.
- **The bar's button carries the live time** while the panel is closed (`data-workout-stopwatch-button-time`; it always did — pinned) and **the screen stays awake** for the whole live workout (the editor's `useWakeLock(effectiveMode === 'live' && phase === 'editing')`, the one mode the bar mounts in — pinned).
- **The rest interplay:** starting the stopwatch ends a running rest the way a tap does (held for the next completed set); after Save to set a rest starts when a rest target is set — never when Off.
- **Longest-hold records** (#1288): `PrKind 'duration'` ("Longest hold") on the A10 system — `bestsOf` reads `durationSeconds` for an exercise whose catalog entry is `inputMode 'duration'` outside the cardio category (plank, stretching, yoga, foam rolling — the holds; never a machine, never a distance exercise); `foldBests` / `newPRs` / `formatPr` ("2:10") take the kind; `GET /api/workouts/prs` returns `duration`; the Training tab's `ExerciseRecords` gains the **Longest** column and lists a hold-only exercise. The live editor fetches the athlete's bests once when a live session mounts (`historyBests`) and the bar compares each Save to set with the exercise's previous longest (`isLongerThanBest`): a **New PR** pill in the stopwatch panel (`data-workout-stopwatch-pr`) and a notice; the first-ever hold reads "Longest so far" (a baseline, not a record). The Finish summary's "New PRs" block and the post's ribbon list it as they do lifts.
- **The target set is never "none" while the workout has a set** (Oct 23 2026, Tom: a lift-only workout read "Every set is filled" and the stopwatch was dead until a plank appeared): `stopwatchTarget` takes the first set WITHOUT DATA (the exercise touched last → a duration exercise → anywhere), then the first NOT-COMPLETED set in the same order, then the last set of the exercise touched last, else the last set of the last exercise; null only with no sets ("Add an exercise first"). A filled set takes the time as its own duration, its reps and weight kept; the chooser lists every set with what it holds.
- Pinned by `workout-rest.test.ts` (the lead-in, the settle, the display, the store round-trip, the bar's source), `workout-prs.test.ts` (the duration kind), `e2e/workout-rest-stopwatch.spec.ts` (the lead-in on the panel and the bar, a 3 s hold, no auto-rest with Off; a 0:05 count-down by the wheels stopping itself, Save = 5 s, the auto-rest with a target; stopped early = the time held), `e2e/workout-prs.spec.ts` (a plank 1:30 last week, 2:10 today → the pill, the Finish block, the Longest column). The bell and the buzz are proven only on a phone.

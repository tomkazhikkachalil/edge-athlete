# Media: capture, upload, video

> Moved verbatim from CLAUDE.md "Key Conventions" on Oct 13 2026. Convention numbers are kept because code comments and docs cite them. Read the devlog entries each convention names (`docs/devlog.md`) before changing the code it describes.

## Convention 8 — Media capture attaches first (Capture v2, Sep 2026)

**Media capture attaches first (Capture v2, Sep 2026)** — in the composer a
camera capture becomes a tile immediately; the editor is the tile's pencil,
never a gate. Nothing heavy (decode, thumbnails, container parse, re-mux)
may run between the camera's hand-back and the tile. Video metadata is
scrubbed **server-side** in `/api/upload/post-media`; the client JPEG strip
keeps the Orientation tag. See `src/lib/media/capture-attach.ts` and DEVLOG
Sep 3 2026 round 11 before touching the capture path.
**Uploads go DIRECT to storage (Oct 4 2026):** `uploadPostMedia` is
intent → a signed PUT from the device to Supabase Storage → complete
(`src/lib/media/upload-rules.ts`); a Vercel function refuses a body over
4.5 MB on every plan, so NO route may ever take a media file as its body.
`MAX_UPLOAD_BYTES` is the one cap and tracks the Supabase project limit.

## Convention 43 — A video is a poster first, media never looks broken, and the iPhone's clip is converted by a worker (Video posters + never-broken media program, Oct 13 2026, #1167–#1176, migs 261 · 262 — `docs/MEDIA.md` is the reference)

**A video is a poster first, media never looks broken, and the iPhone's clip
is converted by a worker (Video posters + never-broken media program, Oct 13
2026, #1167–#1176, migs 261 · 262 — `docs/MEDIA.md` is the reference)** —
Tom: videos showed as "a black rectangle with a play button"; "media should
never appear broken at any stage"; an iPhone's HEVC clip must play on
Android and desktop. His decisions: the transcode runs SERVER-SIDE on a
Vercel function (ffmpeg), the blur placeholder is a STORED ThumbHash. The
invariants: **ONE video renderer** `src/components/media/VideoFrame.tsx`
(the poster first — nothing fetched before a tap; a local `blob:` previews
itself; no poster = the branded placeholder, never a `<video>` the browser
may not decode; `playable` mounts the element on the tap; states `pending |
failed | processing`; the codec rule through `playback.ts canPlayCodec` —
a processing clip THIS device decodes plays now, a ready clip it cannot is
"This video can't play on this device"; `data-video-frame` the hook; the
raw `<video>` allowlist is `video-frame.test.ts`). **ONE upload queue**
`src/lib/media/upload-queue.ts` (a pure reducer with a generation per item;
two chains — uploads strictly one at a time, device work (resize, poster,
blur) on its own; `network | offline` failures retry on reconnect,
`refused | too-large` stay tap-only; the ArrayBuffer stash; `settle()`
waits for the device chain too, so a blur enqueued from `onStored` is in
the post) — the composer uploads FROM ATTACH (`settle()` at Post; a failed
Post loses nothing), Edit post, the workouts (`useSetMediaUploads` is an
adapter; `SetMedia {url, type, thumbnailUrl?, blurHash?}` — the sweep
collector reads `thumbnailUrl` or every workout poster is deleted), the
activity page and the recorder ride it. **The poster rule** `poster-plan.ts
posterTimeFor` (1 s; a short clip's midpoint); the editor's Cover tool takes
a FRAME or a library PHOTO (`VideoRecipe.poster {kind:'photo'}`, a session
File — never in a recipe that persists; the photo wins over the frame).
**The blur** `blur.ts` (ThumbHash, `blur_hash` 8..64; `BlurBox` paints the
average colour then the picture; computed on the device after the tile,
never on the attach path; `isBlurHash` at every writer). **The worker**
(261: `codec`, `processing_at`, `blur_hash`, `transcode_source_url` on
`post_media` + `activity_media`; `media_jobs` posture A with ONE open job
per target — a PARTIAL unique index, so the enqueue reads the open set
first, never `on_conflict`; `media_jobs_claim` FOR UPDATE SKIP LOCKED):
`media-jobs.ts` the pure rules (the planner — one job per row, the heaviest
kind; the ffmpeg rungs with `format=yuv420p`; the 2 / 10 min ladder then
failed; the time guard + SIGKILL deadline), `process-server.ts` the runner
with injectable deps (reuse by `source_path`; ONE row update guarded on the
job's `media_url`; parks write nothing; the third failure clears
`processing_at` — the original plays where it was and is NEVER deleted:
`transcode_source_url` is in `URL_SOURCE_COLUMNS` and the deletion scan;
never `source_url` — the deferred-original PATCH owns that). The doors:
`POST /api/cron/media-jobs` (answers 202 at once, works through
`waitUntil`; pg_cron `media-jobs` every minute on production — 262, the
`urgent-emails` detector, staging schedules nothing), `GET|POST
/api/admin/media-jobs` (dry run by default), the dashboard **Media jobs**
panel (the backfill's door). `ffmpeg-static@5.3.0` is external and traced
into the two routes ONLY. **`processing` end to end:** `complete` answers
the codec the server READ; the post stores `codec` + `processing_at` ONLY
for hevc while the worker is on (`MEDIA_JOBS=0` is the kill switch); every
media writer enqueues (the post insert, the activity media insert, the
three mirrors — best-effort); every reader emits `codec` + `processing`,
never the timestamp; the card polls a FRESH post for ≤ 3 min
(`useProcessingRefresh`). Daily hygiene clears a day-old `processing_at`
with no open job. e2e: `video-poster`, `composer-upload`,
`activity-photos`, `workout-capture`, `media-processing` (`@mobile`),
`admin-media-jobs` (desktop, `E2E_ADMIN_EMAIL`; the fixture
`e2e/fixtures/clip-h264.mp4` is made by ffmpeg-static). Read DEVLOG Oct 13
2026 PR 1–9 first.

## Photo → editor speed (Oct 15 2026, zero DDL)

Tom: *"improve the speed from when a photo is taken to when it's uploaded for edit, same rule for when the user selects a photo, there seems to be a delay."* The trace (every awaited step from the pick or the shutter to the editor's stage) and what changed:

- **The editor's code loads before the pick.** `warmEditorChunk()` (`src/components/media-editor/index.tsx`, the one export; it was a private copy in `ExerciseCard`) runs when the composer opens and when a profile-photo uploader mounts (its door, onboarding's photo step), so a pick no longer waits for the chunk behind "Opening editor…".
- **The stage never paints a frame empty.** `useEditorSession` mints the object URLs in a LAYOUT effect: the same commit, before the first paint. It stays effect-owned (the StrictMode rule in the file). The free-crop stage's `<img>` decodes with `decoding="async"`.
- **The upload queue steps aside.** `UploadQueue.holdDevice()` holds the DEVICE chain (the post-time resize, a blur grab) while the composer's editor is open — a task not yet started waits, one running finishes; holds nest; `destroy()` frees any waiter. An edit replaces the resized bytes anyway.
- **The profile original is prepared while the person edits.** The ≤2048 px kept original (`prepareProfileSource`) starts 1.5 s after the pick and Done awaits the work under way; it used to start only after Done. Cancel drops a start not yet made.
- **The measure:** `e2e/photo-open-timing.spec.ts` (@mobile) — a 4032 × 3024 JPEG, a fresh context, Chromium at 4× CPU on a phone connection (150 ms RTT, ~1.6 Mbps), a 1.5 s picker moment, the clock from the file arriving to the stage showing the picture. It records the numbers as annotations and fails only past 15 s.
- **What is left is the decode itself:** the same flow with a 400 px image is ~350 ms; a 12 MP photo adds ~600 ms at 4× CPU, the browser decoding the full-resolution original for the crop stage. A ≤2048 preview proxy would cut it, but crop coordinates live in the source's pixel space and iOS 15 has no decode-time downscale — a decision, not done here.
- **A HEIC shows on the stage everywhere** (PR 3, Oct 15 2026). Chromium cannot paint a HEIC `<img>`, so on Android Chrome the crop stage stayed black until Done (the WebAssembly decoder ran only at export). `useEditorSession` now converts a HEIF candidate to a JPEG for the session ONLY when the native decode fails, swapping the asset's file under the same id; the stage says "Preparing photo…" (`data-editor-preparing`) meanwhile. Safari, which decodes HEIC itself, pays one probe decode and nothing else. `heic-photo.spec` waits for the stage to show the picture — it timed out at 60 s on android before the fix.
- **A selfie saves the way it was seen** (Tom, Oct 15 2026). The in-app camera's front-camera preview was mirrored by CSS but the still was not; the still is now drawn mirrored too (the iPhone camera's default). A clip is recorded as the stream gives it. The camera asks for 1080p (the old "up to 4K" comment was wrong).

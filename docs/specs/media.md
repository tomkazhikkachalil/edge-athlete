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

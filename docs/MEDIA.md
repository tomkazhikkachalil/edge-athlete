# Media — posters, the upload queue, the blur, and the worker

**The reference for the video posters + never-broken media program (Oct 13 2026, PRs 1–9; migrations 261 · 262).** Tom's spec: every video shows a real frame, never a black box; media never looks broken while it uploads; an iPhone's clip plays on Android and desktop. The code is the truth — this names the rules and where each lives.

## The principles

1. **A video is a poster first.** Nothing is fetched from a video before a tap. The poster is a stored image beside the clip (`post_media.thumbnail_url`, `activity_media.thumbnail_url`, `SetMedia.thumbnailUrl`); no poster = a branded placeholder with a play glyph, never a `<video>` the browser may not decode.
2. **The local file shows at once; the upload follows.** A capture is a tile the instant the device hands it back (Capture v2, convention 8); the upload starts there, its progress on the tile, a failure a Retry that keeps the file.
3. **The device computes what it can; the server does the rest.** The poster (~1 s in), the blur hash and the resize are device work on the queue's device chain. The transcode (HEVC → H.264) and a poster the device could not grab are the worker's.
4. **Readers say what they know, never when.** `codec`, `processing` (a boolean), `blur_hash` ride every media read; `processing_at` never leaves the server.
5. **Nothing is lost.** The pre-transcode original is kept forever (`transcode_source_url`); a failed job clears `processing_at` so the original plays where it was; a mirrored copy reuses the outputs.

## ONE video renderer — `src/components/media/VideoFrame.tsx`

Every surface renders this (`video-frame.test.ts` sweeps every other `<video` out of the tree; the raw element stays only in `MediaLightbox`, `InAppCamera`, the editor, and two server-only public pages). Props: `src`, `poster`, `blurHash`, `codec`, `state: ready | pending | failed | processing`, `progress`, `durationSeconds`, `playable`, `controls`, `fit`, `compact`, the callbacks. `data-video-frame` is the hook: `poster | placeholder | preview | processing | unplayable | pending | failed | playing`.

- **The codec rule** (`src/lib/media/playback.ts canPlayCodec` — `canPlayType`, feature-detected): a `processing` clip THIS device decodes is READY and plays (Safari, a hardware-HEVC Android); one it cannot shows the poster and "Processing…"; a READY clip the device cannot decode is the still and "This video can't play on this device".
- **The poster rule** (`poster-plan.ts posterTimeFor`): one second in; a clip under two seconds its midpoint; unknown → 1.0. `planPosterRetry`: a timeout retries once after the main upload; a decode failure goes to the worker.
- `MediaTile`'s video branch delegates here; `BlurBox` paints under the still.

## ONE upload queue — `src/lib/media/upload-queue.ts` + `useMediaUploadQueue`

A pure reducer (`QueueItem` with a `generation` per item; a stale event is a no-op) and a runtime with **two chains**: `uploadChain` (strictly one at a time) and `deviceChain` (the resize, the poster grab, the blur). The online rule: `network | offline` failures retry on reconnect; `refused | too-large` stay tap-only. The stash is the ArrayBuffer-never-Blob IndexedDB (`openMediaStash`), session-keyed. `settle()` is what Post waits on — and it waits for the device chain too, so work enqueued INSIDE the upload task (`onStored`: a photo's blur) is done before the post is built. Hosts: the composer (`keepStashedAfterUpload` for the reload offer), Edit post, the workouts (`useSetMediaUploads` adapter), the activity page, the recorder (one queue per recording).

## The blur — `src/lib/media/blur.ts`

A stored ThumbHash (`blur_hash`, base64 8..64 — 261's CHECK). Device: `blurHashFromBlob` (≤ 100 px canvas, 2 s). Server: the worker for older media. `BlurBox` paints the average colour at once and the 32 px picture over it.

## The worker — `src/lib/media/media-jobs.ts` (pure) + `process-server.ts`

- **Jobs** (`media_jobs`, posture A): one open job per target (a partial unique index — PostgREST's `on_conflict` cannot name it, so the enqueue reads the open set first); kind `video | poster | blur | probe`; `queued → running → done | parked | failed | skipped`.
- **The planner:** hevc → `video`; a `.mov` with no codec → `probe`; no poster → `poster`; no blur → `blur`. One job per row, the heaviest kind; the runner fills everything missing while it holds the bytes.
- **ffmpeg** (`ffmpeg-static@5.3.0`, external, traced into the two routes only; `FFMPEG_PATH` overrides): libx264 `veryfast` crf 23 ≤ 720p (attempt 1) / `ultrafast` ≤ 540p (after); `format=yuv420p` (iPhone HDR is 10-bit); `-c:a copy` for aac; `-map_metadata -1`; `+faststart`; `-t 180`. The poster at `posterSeekFor`; sharp JPEG q82 ≤ 1280 + a 100 px RGBA → thumbhash.
- **The tick** (240 s budget on a 300 s function): claim (videos first, a running cap, a lease; one video while ≥ 200 s remain, then up to 20 light jobs) → reuse by `source_path` → `/tmp` → transcode → poster + blur from the PLAYABLE file → uploads beside the source → ONE row update guarded on the job's `media_url`. A transport failure or the deadline PARKS (2 / 10 min; no row change); the third failure → `failed` + `processing_at` cleared; a gone target → `skipped`.
- **Doors:** `POST /api/cron/media-jobs` (`CRON_SECRET`; answers 202 at once, works through `waitUntil`; 409 pre-261) — pg_cron `media-jobs` every minute on production (262; staging schedules nothing); `GET|POST /api/admin/media-jobs` (dry run by default: `plan` the backfill, `run` a tick here, `retry` the failed); the dashboard **Media jobs** panel.
- **Enqueue from the writers:** `POST /api/posts`, `POST /api/activities/[id]/media`, the three `post_media` mirrors (`origin 'mirror'`). The backfill is the panel's "Plan backfill" → "Enqueue" (older rows without `processing_at` — they stay playable where they are; the swap arrives silently; blur-only rows behind a toggle).
- **Hygiene** (a daily-cron phase): a row "processing" for a day with no open job stops saying so; done jobs older than 30 days go.
- **Env:** `MEDIA_JOBS=0` (the kill switch — the worker stops AND no new row reads "processing"), `MEDIA_JOBS_MAX_RUNNING` (default 2), `FFMPEG_PATH`.

## `processing` end to end

The upload's `complete` answers the codec the server READ (mediabunny) with the dims and duration; the post stores `codec` and `processing_at` ONLY for hevc while the worker is on. The card polls the single-post read every 15 s for ≤ 3 min on a post under ten minutes old (`useProcessingRefresh`); everything older refreshes on the next load. The composer's tile says "Will process after posting".

## Formats and what stays out

- Phones hand pages JPEG; HEIC decodes on the device (`decode.ts`, the lazy wasm decoder). 3GP stays refused by decision.
- HDR tone mapping is v2 (an HDR clip looks flatter after the transcode).
- Posters for `sport_event_media` / `group_post_media` / a workout's jsonb videos come through their `post_media` mirror only — their own tiles are v2.
- The HEVC path is proven from a real iPhone on production; the e2e fixture is H.264 (`e2e/fixtures/clip-h264.mp4`, made by ffmpeg-static).

## Cost (Vercel Hobby, one vCPU)

A 3-minute HEVC ≈ 2–2.5 Active-CPU minutes; a poster or blur 1–3 CPU-s. Hobby's included CPU covers roughly a hundred such videos a month; a timeout parks the job and the original stays playable.

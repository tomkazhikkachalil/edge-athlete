# Videos — the program (Nov 4 2026)

Convention 57 (`docs/specs/videos.md`) is the rule; this is the plan. Tom's direction: **a full game, a tournament, a broadcast is a YouTube link, never an upload**, and "any area where you can upload videos should have the YouTube integration — in phases."

## Phase 1 — the link (shipped on the `feat/videos-phase1` branch, migration 296; staging only until Tom's word)

Profile, org, sport event and contest; the Create menu's Full game door; the composer's too-long hint; highlights as playback cues; no third-party script, no YouTube Data API, zero CSP change. The record is the Nov 4 2026 devlog entry.

## Phase 1b — every upload surface gets the link path (built Nov 5 2026, migration 297; the branch `feat/videos-places`)

The same `videos` row with three more nullable places (`group_post_id`, `activity_id`, `workout_session_id`; the one-place CHECK over five), a "Full game" door beside each surface's capture inputs, and the place's own manager as the attach rule — `docs/specs/videos.md` "Phase 1b" holds the rules:

- the golf round — the round card's Media tab (`RoundVideos`), the door for the creator or a confirmed participant;
- the sport event's live page — the broadcast beside the live stats (`EventLiveVideos`, read-only, silent at zero);
- activities — the screen's Videos section after Photos, the owner's door beside the capture buttons;
- workouts — the review header's door, the card's strip once expanded (owner only to attach; the workouts rule to see);
- messages — a YouTube link in a text message is a click-to-play poster under the bubble (a preview, never a row; `t=` honoured);
- the public org site — the `video_list` tile over the org's published rows, gallery-gated, an `<iframe srcdoc>` poster (no script, no CSP change).

Not in 1b: a per-exercise link (`ExerciseCard`) — a workout's recording is one link per session, since exercise rows are replaced on every save; the feed's `WorkoutPostCard` count (a later round, through `stats_data`).

## Phase 2 — native short-video reliability (shipped Nov 5 2026, zero DDL; the branch `feat/videos-phase2`)

The native path already uploaded direct to storage (intent → PUT → complete; Vercel bodies are 4.5 MB). Phase 2 made it survive a phone's connection: a clip longer than one chunk (6 MB) travels **resumable** (tus against Supabase's signed endpoint with the intent's own token — the same host, zero CSP change; proven on staging Nov 5 by a node probe before a line of client code), a retry or a reload continues from the last acknowledged chunk (`resume-store.ts`), and a tile's X **cancels** the bytes in flight (one AbortController per upload in the queue). The **50 MB cap is ONE module** (`upload-rules.ts`; pinned equal to the bucket's limit and swept for stray literals — two were folded: the contest media door and the composer's line). **Quality is defined before any cap is raised:** `TRANSCODE_TARGETS` in `media-jobs.ts` (H.264 High 4.0, 8-bit 4:2:0, ≤ 30 fps, AAC 128k, 720p then 540p, 180 s) is what the ffmpeg command is built from; `docs/MEDIA.md` "Quality targets and the cap" names the three steps a raise takes (targets → budget → bucket → constant). Convention 43 amended; the record is the Nov 5 2026 devlog entry.

## Phase 3 — the YouTube account connection and direct uploads

- Google OAuth, Authorization Code + PKCE; scopes incrementally — `youtube.upload` only when uploading, `youtube.readonly` only for channel import.
- A `youtube_connections` table: per profile and per org; the org's connection is a channel OWNER's grant, never an app role — `manage_video` lets a manager link and mark, never upload to a channel they did not connect. Tokens sealed server-side (the `activity_connections` precedent); never a service key or long-lived secret in the client.
- The upload goes device → YouTube (resumable), never through Edge Athlete / Vercel; the form carries title, description and public / private / unlisted; the channel's eligibility is checked before a long upload starts.
- Disconnect / revoke; the privacy page and the terms gain their sentences (`legal-pages.test.ts` demands every processor); `duration_ms` and the thumbnail backfilled from the Data API.

## Phase 4 — live streaming

Its own design document, never merged into the link MVP: YouTube Live or a dedicated provider; broadcast creation, RTMP / encoder ingest, scheduling against sport events, a live status on the Live Now strip, the archive becoming a `videos` row, post-game markers. A live broadcast has different requirements from an uploaded VOD — eligibility, ingest, lifecycle — and is decided on its own.

## Upgrade paths noted

- Seeking without a remount: the IFrame Player API (`www.youtube.com/iframe_api`) is a third-party script; under the nonce policy a trusted script may inject it, under the static policy it is blocked. Load it only on `/videos/*` (never on the static-CSP path) and only after a tap, if the remount ever reads as rough.
- The duration badge on cards waits for Phase 3's Data API read (or a typed value).

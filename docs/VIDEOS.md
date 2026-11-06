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

## Phase 3 — the YouTube account connection and direct uploads (shipped Nov 5 2026, migration 298, #1402; OFF until the Google Cloud OAuth client exists)

The Polar connection's shape (Convention 30) with what it lacked: Google OAuth, Authorization Code + **PKCE** (the verifier in an httpOnly cookie for ten minutes, S256 on the consent URL), the **signed state** naming the account, the owner and the scope, **scopes incremental** (`youtube.readonly` at connect — the channel and its uploads; `youtube.upload` only when the first upload asks), a **refresh** (access tokens live an hour; the sealed secret holds the refresh token, the access token and its expiry; `invalid_grant` marks the row revoked and the card says "reconnect"). `youtube_connections` (298): per profile XOR org, the org's connection is the channel OWNER's grant (`connected_by_user_id`) — managers link its uploads, only the connector uploads to it. The device → YouTube upload: the server opens the resumable session with the token, the device PUTs 8 MB chunks to `www.googleapis.com` with the connector's own hour-long access token (the ONE thing a browser ever holds; never the refresh token), a 308 + Range resumes a dropped chunk, the id becomes a `videos` row like any link; `connect-src` gains that one host. Disconnect revokes at Google (best effort) and deletes the row; the videos stay. `duration_ms` is read back through `POST /api/videos/[id]/refresh` (the video page's "Refresh from YouTube"). The privacy page and the terms gain their sentences. Everything is proven against a stand-in Google (`e2e/helpers/youtube-mock.ts`); a real channel is Tom's to prove once the OAuth client exists — **while the consent screen is in Testing, refresh tokens expire after 7 days** (the "reconnect" state covers it) until the app is verified for the sensitive upload scope. The record is the Nov 5 2026 devlog entry; the rules are `docs/specs/videos.md` "Phase 3".

## Phase 4 — live streaming

Its own design document, never merged into the link MVP: YouTube Live or a dedicated provider; broadcast creation, RTMP / encoder ingest, scheduling against sport events, a live status on the Live Now strip, the archive becoming a `videos` row, post-game markers. A live broadcast has different requirements from an uploaded VOD — eligibility, ingest, lifecycle — and is decided on its own.

## Upgrade paths noted

- Seeking without a remount: the IFrame Player API (`www.youtube.com/iframe_api`) is a third-party script; under the nonce policy a trusted script may inject it, under the static policy it is blocked. Load it only on `/videos/*` (never on the static-CSP path) and only after a tap, if the remount ever reads as rough.
- The duration badge on cards waits for Phase 3's Data API read (or a typed value).

# Videos — the program (Nov 4 2026)

Convention 57 (`docs/specs/videos.md`) is the rule; this is the plan. Tom's direction: **a full game, a tournament, a broadcast is a YouTube link, never an upload**, and "any area where you can upload videos should have the YouTube integration — in phases."

## Phase 1 — the link (shipped on the `feat/videos-phase1` branch, migration 296; staging only until Tom's word)

Profile, org, sport event and contest; the Create menu's Full game door; the composer's too-long hint; highlights as playback cues; no third-party script, no YouTube Data API, zero CSP change. The record is the Nov 4 2026 devlog entry.

## Phase 1b — every upload surface gets the link path

One PR each, the same `videos` row, a "Full game" door beside the capture inputs, a nullable context column only where a surface needs one:

- the golf round (`RoundMediaManager`) — a round's broadcast; the place is the round's `group_post_id`;
- activities and workouts (`ActivityScreen`, `ExerciseCard`) — a session's recording;
- messages (`MessageInput`) — a link PREVIEW (the parser + the poster), not a video row;
- the org site's gallery (the public server tree) — a read-only videos widget over the same table; no `SectionInfo`, no client components there;
- the sport event's live page — the broadcast beside the live leaderboard.

## Phase 2 — native short-video reliability

The native path already uploads direct to storage (intent → PUT → complete, Oct 2026; Vercel bodies are 4.5 MB). What remains: resumable TUS uploads through Supabase's TUS endpoint; progress, retry and cancel in `upload-queue.ts`; the 50 MB cap in ONE module (`upload-rules.ts`) that the client, the server and the bucket all read; and "quality" defined as codec / bitrate / transcode targets in `media-jobs.ts` BEFORE any cap is raised — a 200 MB cap is not "highest quality" until those are written.

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

# Videos — Phase 4: live (the design, Nov 5 2026)

The Videos program's fourth phase is live streaming. `docs/VIDEOS.md` keeps it apart from the link MVP on purpose: a live broadcast has an eligibility, an ingest and a lifecycle an uploaded game never has. This document decides what Edge Athlete does about live, in what order, and what it refuses. The rule it serves is Convention 57: a long video lives on YouTube; Edge Athlete links it, places it where it belongs and marks it. Nothing here re-hosts a byte.

## The three decisions for Tom

1. **A YouTube Data API key for public reads** (`YOUTUBE_API_KEY`, server-only, the same Google Cloud project as the OAuth client). Without it the live state of a video can only be read with a connected channel's token, so a game linked by a parent from a league's broadcast would never show LIVE. With it any public video's live state is one unit of a 10,000-unit daily quota. Recommended: yes, now.
2. **Phase 4a first** — link an existing or scheduled YouTube broadcast and make the app know it is live. No new consent, no new scope, one small migration. Recommended: build now.
3. **Phase 4b** — create the broadcast from Edge Athlete (the event's "Schedule a broadcast"), which needs a THIRD incremental scope (`youtube.force-ssl`, sensitive) and therefore Google's verification of the app first. Recommended: design now (below), build after verification, Tom's word.

Not on the table: a dedicated live provider (Mux, Cloudflare Stream, IVS). It would make Edge Athlete the host, against the program's first rule, at a per-minute cost, for an ingest problem YouTube already solves on every phone and laptop. The only reason to revisit is YouTube's own eligibility blocking real clubs; see "Eligibility".

## What YouTube gives us (verified Nov 5 2026)

- **A live broadcast is a video with the same 11-character id before, during and after.** `youtube.com/live/<id>` and `watch?v=<id>` are the same thing; the embed frame is the same frame; when the stream ends YouTube keeps the recording under the same id. The archive IS the row — no copy, no second row, no "becoming".
- **`videos.list` with `part=snippet,liveStreamingDetails`** says what state it is in: `snippet.liveBroadcastContent` is `upcoming`, `live` or `none`; `liveStreamingDetails` carries `scheduledStartTime`, `actualStartTime`, `actualEndTime` and `concurrentViewers` while live. One quota unit per call, public videos readable with an API key, private ones only with the owner's token.
- **Creating a broadcast** (`liveBroadcasts.insert` + a stream from `liveStreams`) needs the `youtube` or `youtube.force-ssl` scope. The response holds the RTMP ingest address and the stream key; the channel owner streams to it with OBS, the YouTube app or any encoder. YouTube's own auto-start/auto-stop moves the broadcast from `ready` to `live` to `complete` when bytes arrive and stop. Errors name the eligibility (`liveStreamingNotEnabled`, `livePermissionBlocked`).
- **Eligibility is the channel's, not ours.** Live must be enabled once on the channel (up to 24 hours), the phone number verified, no live restrictions in 90 days. From a computer or an encoder there is no subscriber minimum; **from the YouTube mobile app the channel needs 50 subscribers.** A browser cannot push RTMP, so Edge Athlete never captures a live stream itself; it hands the person the key and the door.

Sources: YouTube Help "Live stream on mobile" (support.google.com/youtube/answer/9228390), the Data API references for `liveBroadcasts.insert` and the quota table (developers.google.com/youtube/v3).

## Phase 4a — a linked broadcast the app knows is live

### The model (migration 299, additive)

Five nullable columns on `videos`, the Phase 1b pattern, no new table:

| column | meaning |
| --- | --- |
| `live_status text` | `none` (default) \| `upcoming` \| `live` \| `ended`; a CHECK |
| `scheduled_start_at timestamptz` | YouTube's `scheduledStartTime` |
| `live_started_at timestamptz` | `actualStartTime` — the zero of every live marker |
| `live_ended_at timestamptz` | `actualEndTime` |
| `live_checked_at timestamptz` | when the state was last read; the refresh's own lock |

One partial index `videos_live_idx ON videos (live_status, scheduled_start_at) WHERE live_status IN ('upcoming','live')` — the Live Now read and the sweep of stale states. Reversal: drop the five columns and the index. `provider` stays `youtube`: a broadcast is a YouTube video.

### The one writer: `src/lib/videos/videos-live-server.ts`

- `readLiveState(videoId, { token? })` → `videos.list` with the connection's token when the owner has one (private broadcasts included), else the API key, else "unknown" (the feature degrades to Phase 1 behaviour, never an error).
- `refreshLiveState(admin, video)`: a conditional UPDATE `… WHERE id = $1 AND (live_checked_at IS NULL OR live_checked_at < now() - ttl)` claims the refresh; zero rows means another request did it — no in-process lock, no job, honest under Fluid Compute's shared instances. The TTL by state: `live` 45 s; `upcoming` within an hour 60 s, further out 10 min; `ended` / `none` never (the archive's `duration_ms` is written on the transition to `ended`, the Phase 3 refresh's code path).
- **Reader-driven, never a cron.** The video page, the cards' list and the Live Now strip call `refreshLiveState` for the rows they are about to show whose TTL has passed. A broadcast nobody looks at costs nothing; a broadcast a hundred people watch costs one unit a minute. Worst case against the quota: 10,000 units = 166 broadcast-hours of continuous watching a day; the quota's exhaustion (403 `quotaExceeded`) leaves `live_status` as it was and `live_checked_at` touched, so the app keeps showing its last truth and stops asking for ten minutes.
- `markNow(video, label)`: a highlight at `now − live_started_at` (the existing `video_highlights` row; `meta.live = true`), refused unless `live_status = 'live'`.

### The link flow

`parseYouTubeLink` already accepts `youtube.com/live/<id>`. Creating the row reads the state once (the first refresh) so an upcoming broadcast shows its date the moment it is linked, and the Add a full game step says "This is a live broadcast scheduled for Sat 2 pm" instead of asking for highlights. Nothing else in the flow changes.

### The surfaces

- **The card** (`VideoCards`): a LIVE pill (red, `aria-label="Live now"`) or an UPCOMING line with the scheduled time, from the row — never a fetch from the card.
- **The video page** (`VideoScreen`): the same frame (YouTube plays the live stream in it); while live, the highlight composer's time field has a "Now" button (`markNow`); after the end the markers are ordinary highlights of the archive, their `start_ms` already right because the zero was `actualStartTime`.
- **Live Now** (`LiveNowStrip`, `/live`, the pulse): a third list, "Broadcasts", from `GET /api/videos/live-now` — published rows with `live_status = 'live'` the viewer may see under the Phase 1 owner rule (own, followed profiles, an org they can see), newest start first, capped at 10; the pulse's `liveNow.total` gains their count so the Live dot lights. The event live page's strip (`EventLiveVideos`) sorts the live one first.
- **The public org site's `video_list` tile**: the LIVE pill when the org's own broadcast is live (ISR: the tile's revalidate is the site's; the pill may lag a minute — acceptable, stated).

### Zero new consent, zero CSP change

The server reads Google; the browser still only ever talks to youtube-nocookie.com for the frame. `YOUTUBE_API_KEY` is server-only and absent means "no live state" (the same rule as every optional key).

### Proof plan

The stand-in Google (`e2e/helpers/youtube-mock.ts`) answers `videos.list` with `liveBroadcastContent` and `liveStreamingDetails` per video id and lets the spec flip a video from upcoming → live → none with `actualEndTime`. Spec `videos-live.spec.ts`: link an upcoming broadcast → the card's UPCOMING line; flip to live → the LIVE pill, the strip's Broadcasts row, the pulse count, "Now" marks a highlight at the right offset; flip to ended → `ended`, `duration_ms` filled, the highlight still seeks the archive; the quota 403 leaves the state alone. Unit: the TTL rule, the claim-UPDATE's predicate, `markNow`'s arithmetic, the status CHECK text.

### Build order (one PR each, zero DDL after the first)

A. Migration 299 + the writer + the link flow's first read + the card and page (LIVE / UPCOMING, "Now"). B. Live Now + the pulse + the event strip's order + the public tile's pill. C. Docs, the spec's Phase 4 section, the e2e. Staging first; 299 on production by Tom the day A merges; baseline@299.

## Phase 4b — the broadcast created from Edge Athlete (after Google's verification)

**Status (Nov 5 2026): built** — the door on `/videos/new`'s Link step, `POST /api/videos/youtube/broadcast`, the `live` scope (`youtube.force-ssl`), the key once, the eligibility words; ON for the OAuth app's test users, everyone after verification. The record is the devlog entry; the rules are `docs/specs/videos.md` Phase 4b.

For a club or a league that owns its channel: on an event's Videos tab, "Schedule a broadcast" (the `manage_video` grant, the connector's own account — the Phase 3 rule, only the person whose Google it is). The server asks for the third incremental scope `youtube.force-ssl` when missing (the Phase 3 "Allow uploads" door, same cookie, same signed state), then `liveBroadcasts.insert` (title = the event's name, `scheduledStartTime` = the round's date and a chosen time, privacy chosen as for uploads, `enableAutoStart/enableAutoStop`), `liveStreams.insert` (or the channel's reusable default stream) and `liveBroadcasts.bind`. The row is created as `upcoming` with the broadcast's id; the stream key and RTMP address are shown ONCE in a sheet with Copy buttons and two doors — "Open the YouTube app" (the mobile deep link) and "I'll use OBS" — and are never stored on our side (the person can re-read them from YouTube Studio). From there Phase 4a does everything: the state, the strip, the markers, the archive.

Eligibility errors become the card's words: `liveStreamingNotEnabled` → "Turn on live streaming in YouTube Studio first (it takes up to a day)"; `livePermissionBlocked` → "YouTube is not letting this channel stream right now". The 50-subscriber rule for the mobile app is stated on the sheet, not enforced by us.

Owed before 4b can be ON: Google's verification of the app for `youtube.upload` AND `youtube.force-ssl` (one submission, both scopes). Until then the scope can be tested with the test users only.

## Non-goals (deliberate)

A dedicated streaming provider; WebRTC or RTMP capture in the browser or the app; live chat; DVR controls; multistreaming; 24/7 streams; monetisation; a "stream from Edge Athlete" button that pretends to capture; polling by cron; storing a stream key.

## Open questions settled here (not asked)

- The archive is the same row (YouTube keeps the id) — no "becoming a `videos` row", that sentence in `docs/VIDEOS.md` is now moot.
- Live markers are highlights with `meta.live = true`; no second table.
- The pulse counts broadcasts in `liveNow.total`, not in a fourth number; the strip is the one place that separates them.
- Quota is spent by viewers, not by a clock; exhaustion is silent and self-healing.

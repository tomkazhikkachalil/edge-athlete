# Feed and posts: likes and impact, drafts, profile cover, posting audience

> Moved verbatim from CLAUDE.md "Key Conventions" on Oct 13 2026. Convention numbers are kept because code comments and docs cite them. Read the devlog entries each convention names (`docs/devlog.md`) before changing the code it describes.

## Convention 32 — Likes you can trust, and impact everyone can see (likes round, Oct 4 2026, #1081 + mig 252)

**Likes you can trust, and impact everyone can see (likes round, Oct 4 2026,
#1081 + mig 252)** — Tom: the count must be accurate; a heart must agree on
every surface; "an impact so you know 1000 ppl viewed your post." **The
TRIGGER adds or subtracts one; the nightly recount is the accuracy rule; a
route READS** (amended Oct 25 and Oct 26 2026, scale fix 4 and migration
277): the triggers on `post_likes`, `post_comments` (published only — a
status change moves the count by one) and `comment_likes` keep
`posts.likes_count`, `posts.comments_count` and `post_comments.likes_count`
by ±1 inside the write's own statement; `counters_recount()` corrects every
drifted row — once in 277 and every night from `/api/cron/daily`
(`src/lib/counters/recount-server.ts`), reporting how many it touched;
`POST /api/posts/like`, `POST /api/comments/like` and `POST`/`DELETE
/api/comments` READ the column and return it — they never count the rows nor
write the column (`counter-writes.test.ts`). History: until Oct 25 the routes
recounted and wrote too (two O(likes) counts and two `posts` writes per
like); until Oct 26 the triggers themselves recounted the whole set; a reader embeds only the
VIEWER's own like row (`.eq('likes.profile_id', viewer)` — PostgREST caps a
full embed at 1000, which emptied hearts on popular posts). **One liked truth
per tab** — `src/lib/likes/store.ts`: every like the viewer performs and every
read that resolved THEM (both `GET /api/posts` envelopes carry `viewer`) is
remembered; `PostCard` seeds its heart with `likedFor` (the store first, the
row second); `onLike(postId, nextLiked)` carries the card's intent — a parent
never re-derives it. The single-post GET is `private, no-store`. A heart that
is only a COUNT (the grid tile, `/u/`) is an OUTLINE. **The rhythm classes
(`gap-base`, `px-base`, …) are plain CSS** — `sm:gap-base` is silently dead;
use `sm:gap-6`; `spacing-variants.test.ts` forbids the pattern. **Impact**
(`docs/ANALYTICS.md` "Post impact"): `posts.views_count` / `plays_count`,
seen by everyone, one per person per post per UTC day from a hashed daily
mark (`post_view_marks`, posture A, pruned at 2 days) — never who; the
author's own looks never count; `POST /api/posts/views` answers 204 whatever
happens; `useViewBeacon` (half on screen for 1 s) and the video's 3 s are the
only sources; `bump_post_views` is the ONE writer of the counters.

## Convention 33 — Finish and Post are two actions; nothing is ever auto-posted (Drafts round, Oct 6 2026, mig 253 the ONLY DDL — PR 1 of 5)

**Finish and Post are two actions; nothing is ever auto-posted (Drafts
round, Oct 6 2026, mig 253 the ONLY DDL — PR 1 of 5)** — Tom: a golf round
started and abandoned partway showed up on the feed and the profile. A
recorded thing is **In progress** (reopen → Resume / Finish / Discard), then
a **Draft** (Finish → a review screen; autosaved; the private Drafts area),
then **Posted** (an explicit Post). `draft` is a POST STATUS (the 223 / 241
pattern): every published-only reader skips it for free, and the OWNER
arms EXCLUDE it by name — the feed's both arms (`posts/route.ts`,
`status.neq.draft` / `status.not.in.(profile_hidden,draft)`) and the five
profile RPCs' `viewer_id = p.profile_id` arm (253 re-declares
`get_profile_{tagged,stats,statements,all}_media` + `get_profile_media_counts`
verbatim with `AND p.status <> 'draft'`; `drafts-readers.test.ts` pins all
of it). A round's post is born `draft` (`POST /api/group-posts`), readable by
its owner, their guardian and the round's PLAYERS (`GET /api/posts?postId`
— the live page's "View post" and the invite bell), by nobody else. **ONE
writer of draft → published: `src/lib/posts/publish-server.ts
publishDraftPost`** (409 `round_not_finished` until `group_posts.status =
'completed'`; guarded on `status = 'draft'`; stamps `created_at = now()` so
the post lands at the top of the feed WHEN POSTED — the completion-time
bump in `advanceRoundStatus` and the End Round PATCH is gone; an event
round's lifecycle keeps its own, event rounds never draft); the door is
`PATCH /api/posts {postId, action: 'post'}` behind the owner /
`write_content` gate. The feed's JavaScript round filter is DELETED —
status is the one rule for every list. A draft card has no like / comment /
share / save row and sends no view beacon. The supervised carve-out STAYS
(Tom, Oct 6): a supervised athlete's Post publishes directly. After Finish
the RECORD is live (the mirror, the handicap, round history, Training, the
dataset); only the social post waits. e2e: `e2e/helpers/drafts.ts
finishAndPost` / `postDraft` — a spec that wants a round on the feed or a
grid finishes AND posts it; `round-lifecycle.spec.ts` is the pin.
**The Drafts area (PR 2):** `src/lib/drafts/list.ts` (pure, zero imports)
is the ONE list — rounds in progress (`pending | active`: Resume; the
creator also Finish / Discard), drafts (`completed` + a `draft` post,
the CREATOR's only — one post per round), workouts in progress, the
recording on THIS phone (added client-side from IndexedDB); event rounds
never. `drafts/server.ts readDrafts` reads the person's OWN participant
rows (never the public group_posts listing); `GET /api/drafts` is
`private, no-store` (`?profileId` for a `write_content` guardian);
`useDrafts` is ONE fetch per page load shared by the header, the page
and (PR 4) the reopen prompt — every door that acts calls
`refreshDrafts()`. Routes `/athlete/drafts` (list) and
`/athlete/drafts/[postId]` (the REVIEW screen: the draft's card, notes
= `posts.caption` saved as you type, who can see it, Post / Keep as
draft / Delete through the results delete rule; a round still in
progress shows Resume + Finish) — static siblings of `/athlete/[id]`,
no new root slug. `draftReviewHref` is the one spelling (`round-route.ts`
re-exports it as `draftReviewPath`): the composer lands an already-played
round there (`afterCreatePath`), the creator's live page "View post" /
End Round landing goes there, the card's banner links there. Doors:
the header dropdown AND the drawer (with the count).
**The lifecycle (PR 3): nothing finishes at read time.** `round-finish.ts
finishRound` is the ONE Finish writer (guarded `pending | active →
completed`, then the mirror and the media; never the post) — the creator's
"Finish round" (PATCH `status: 'completed'`, offered once someone has
scored; a scoreless round is discarded), the Drafts list and the reopen
prompt all go through it; the score routes keep `advanceRoundStatus`
(every card full → completed) and mirror after it. The 6 h quiet rule,
`effectiveRoundStatus` and `isAbandonedPendingRound` are GONE: every
reader reads the STORED status; `isRoundLive` keeps its ±48 h date window
(the LIVE strip and badge mean "played now"); `pickLiveRound` (the resume
path, the prompt's source) is status-only — an in-progress round is in
progress however old. The daily sweep (`round-sweep.ts`, the ONE place an
untouched round is settled) applies `abandonedRoundAction` —
`ABANDON_AFTER_MS` = 7 days: an ACTIVE round untouched since its last
score is FINISHED as played (the record written, the post still a draft);
a PENDING round untouched since creation is DISCARDED (nothing was
recorded; the results delete cascade); an event's round never. Pinned:
the sweep never writes `posts.status`.
**The reopen prompt (PR 4):** `src/components/drafts/ReopenPromptHost.tsx`
is mounted ONCE in the `(app)` root layout (beside the install host):
once per app open (`sessionStorage ea:reopen-prompt:v1:<userId>`), after
the server list (`useDrafts().loaded`) AND the phone (IndexedDB) answered,
it asks about the ONE most recently touched in-progress thing
(`pickReopenCandidate`) — Resume / Finish / Discard / Not now — and
never over the thing itself (`reopen.ts reopenSkipsPath`: `/live/*`, the
recorder, the workout editor, the Drafts area). `reopenActions` is the
pure rule: a scored round's creator gets all three (Finish → the review
screen), a scoreless one Resume + Discard, a playing partner Resume only,
a workout Finish → `/app/workout/[id]?share=1`, a recording Finish →
`/activities/record?finish=1` (the recorder's offer has Finish too). It
REPLACES the feed's "Live round at …" banner and the Training workout
banner — one door at the top of every page, Drafts the second (the
device-local `RecordingResumeBanner` stays).
**Workouts (PR 5) follow the same rule:** the 6 h lazy auto-complete is
GONE (`effectiveSessionStatus` / `finalizeStaleActives` deleted; a
second live start answers 409 with the open one, however old);
`workouts/status.ts` holds `ABANDON_AFTER_MS` (7 d), `isAbandonedSession`
and `abandonFinalizeFields`, read ONLY by the daily `runWorkoutSweep`
(`workouts/sweep-server.ts`, after the round sweep) — an abandoned live
session is finished as it stands, `share_decided_at` NULL. **The share
decision is a fact (253):** `PATCH /api/workouts/[id]` stamps
`share_decided_at` on `postId` AND on `keepPrivate: true` (the editor's
Keep private sends it); a completed session with no post and no decision
is a DRAFT (`list.ts isWorkoutDraft`, only sessions ended on or after
`WORKOUT_DRAFTS_SINCE` = Oct 6 2026 — earlier ones never had a decision
recorded and are history), listed under Ready to post with Share
(`/app/workout/[id]?share=1`) and Keep private.

## Convention 38 — Every profile card opens with the cover and the picture half over its edge (Oct 9 2026, zero DDL)

**Every profile card opens with the cover and the picture half over its
edge (Oct 9 2026, zero DDL)** — `src/components/profile/
ProfileCoverHeader.tsx` on the owner's `/athlete` AND both viewer routes
(`/athlete/[id]`, `/u/[username]`): a 3:1 banner, the avatar row pulled up
by exactly half the avatar (`size` picks the per-breakpoint margin — change
the avatar size and the map together), controls on the photo through
`overlay`. Tom REJECTED a whole-card photo under a translucent panel (#1132)
and a photo ending below the avatar (#1133) — don't bring either back.
`e2e/profile-cover-card.spec.ts` is the pin.

## Convention 39 — Who sees a post is the ACCOUNT's call; per item only Post it or Only me (Posting round, Oct 9 2026, zero DDL)

> **Amended by Convention 50 (Oct 19 2026, migration 269):** "Only me" is gone. The account still decides who sees a post; the one per-item choice is now the feed SWITCH — "Post to feed" on / off. `PostChoicePicker` is deleted; `FeedToggle` is the control. Everything below about "never a per-post followers-only control" stands.

**Who sees a post is the ACCOUNT's call; per item only Post it or Only me
(Posting round, Oct 9 2026, zero DDL)** — Tom: a public account means anyone
sees what you post, a private one your approved fans; the only per-item
choice is Post it or Only me (not on the feed; an activity stays in Training,
a workout in your training history). **Never a per-post "followers only"
control.** `src/lib/posts/audience.ts` + `COPY.AUDIENCE` are the words;
`PostChoicePicker` (the two cards — the recorder's review, the workout
share) and `AccountAudienceLine` (the one-liner — the composer, Edit post,
a draft's review, an activity's later share) the only UI. Posts are written
`POST_VISIBILITY` ('public') and the feed's rule applies the account;
an edit never changes visibility; pre-Oct 9 followers-only posts keep it.
One post by its id follows the feed's rule (`posts/read-gate.ts
canReadPost`). Finish on the recorder is ONE review (`FinishSheet`): Only me
rides the create call (`onlyMe`), posting is `activities/share-client.ts
postActivity`. Read DEVLOG Oct 9 2026 (Posting PR 1–3) first.

## Convention 50 — Sports are the profile's (Media + Stats), training is Training's, and the feed is a SWITCH, never an audience (Flow changes program item 3, Oct 19 2026, #1242–#1244, migration 269 the ONLY DDL)

> **Amended by Training fixes PR 4 (Oct 21 2026, zero DDL):** for a WORKOUT, Finish is the RECORD and Post or Done is the DECISION. The finish branch no longer stamps `share_decided_at`; `PATCH { decided: true }` (Done — the switch off) and `postId` (Post) do. Until then the workout is UNPOSTED — the owner's draft: it stands in Training for the owner with a "Finish posting" tag, a visitor never sees it (the list and the single read filter `share_decided_at IS NULL` for non-owners), and the pill, the reopen prompt, the Drafts page and the start screen offer the preview step (`/app/workout/[id]?step=preview`; `?share=1` is its alias). "OFF = Done, nothing written" below is superseded: Done writes the decision. See `workouts-and-sessions.md`, Oct 21 2026.

**Sports are the profile's (Media + Stats), training is Training's, and the feed is a SWITCH, never an audience (Oct 19 2026, mig 269)** — Tom: sports on Media and Stats, activities and training on the Training tab, both postable to the feed by the user's choice each time, that choice never hiding anything from the profile — and **"Only me" is dropped**. The rules:

- **The three buckets (`src/lib/statements.ts`, THE THREE BUCKETS):** MEDIA = every non-text post that is NOT training; STATS ⊂ MEDIA = posts with data that are NOT training; TRAINING = the source rows (workouts, activities, body metrics) + every posted training item. **The training predicate** lives in the five profile RPCs (re-declared verbatim from 253 by 269, at FOUR sites — `get_profile_all_media`, `get_profile_stats_media`, the counts' `all_media_count` / `stats_media_count`): `post_category IS DISTINCT FROM 'training' AND stats_data->>'type' IS DISTINCT FROM 'activity'` (`IS DISTINCT FROM`: the category is nullable; the second clause covers the Sep 29 – Oct 1 activity shares that predate the category). `isTrainingPost` is its TS mirror. Tagged and statements are untouched. **A body-metric post and a posted activity are training** (they left Media / Stats the moment 269 ran); an activity posted as a SPORT result ("Post as a Cycling result") is a stat line and stays in Stats — the writer sets `post_category = 'training'` only for a general post (the bug 269's first backfill corrected). A free "Log Training" text post is a statement (known edge).
- **`posts.on_feed` is a SWITCH (`boolean NOT NULL DEFAULT true`, no index — not selective).** It is not an audience: the account still decides who sees the post (Convention 39), and a post with the switch off is on the profile for whoever the account lets in. **Feed-side readers filter `on_feed = true`:** the posts list when no `?userId=` is asked for (the default feed, the following lens — `feed_following` carries it, re-declared from 230 — the org lens, the contest filter), Explore, Search's post reads (an off-feed post is not a discovery result), the org activity page. **Profile-side readers NEVER filter it:** the five RPCs, the profile media route, `/api/public/profile`, Vitals, the read gate, the single-post GET, comments / likes / saves / tags / mentions / notifications, pinned posts, the calendar. `feed-toggle-readers.test.ts` walks both lists.
- **Writers:** `POST /api/posts` takes `onFeed` (default true); `PUT /api/posts` takes it behind the content gate (Edit post → the switch — never a visibility change); `publishDraftPost(admin, { postId, onFeed })` writes it in the one draft-guarded update (`PATCH { action: 'post', onFeed }`); group-post / event writers leave the default (a draft's value is decided at Post).
- **One control — `FeedToggle` (`src/components/posts/FeedToggle.tsx`, `data-feed-toggle="on|off"`, `role="switch"`):** label `COPY.AUDIENCE.FEED_TOGGLE` "Post to feed"; ON its line is `whoSeesPost(accountVisibility)`, OFF `feedOffLine(place)` ("Not on the feed — stays on your profile, in Training / in Stats"). **Remembered per KIND on the device** (`src/lib/posts/feed-memory.ts`, zero imports, `ea:post:feed:v1`, kinds `sport | activity | workout`, default ON, fail-open; a guardian acting for an athlete shares the device's habit). Hosts: the recorder's Finish sheet (`activity`; OFF saves the row with NO post — the row is the profile presence; Post / Save), the workout share step (`workout`; OFF = Done, nothing written), the golf draft review (`sport`), the composer (`workout` for a Training post, else `sport`), the body-metric modal (`workout`; its old per-post Public / Private picker is gone), Edit post (initial = `post.on_feed`, no memory, `onFeed` only when it changed). `PostChoicePicker`, `PostChoice`, `DEFAULT_CHOICE`, `onlyMeLine`, `COPY.AUDIENCE.ONLY_ME*` do not exist (`feed-toggle-ui.test.ts`).
- **Finish is the decision.** A finished workout stamps `share_decided_at` at Finish (never a draft; the Drafts list has no "Ready to post" bucket; `keepPrivate` is gone); a finished activity lands in Training with `only_me = false` (nothing at save decides the profile; `onlyMe` at save is not read). **Hiding is the owner's LATER door, on the item's page:** an activity's "Hide from my profile" / "Show on my profile" is the existing `PATCH { onlyMe }` (245's rule: refused while a feed post exists); a workout's is `PATCH { hidden }` → `workout_sessions.profile_hidden_at` (241's shape) — the list skips a hidden session for a visitor and the single read answers 404; the owner always has it. **The feed is the other door:** an activity page offers "Post to feed" (no post) / "On the feed" + "Remove from feed" / "Show on feed" (`PUT { onFeed }`; the detail GET fills `owner.postOnFeed`).
- **Nothing is lost:** the switch never deletes, hides or re-audiences anything; `/api/public/profile` reads published rows only (a draft could reach the CDN `/u/` page) and subtracts training from its count.

Proof lives in `e2e/post-audience`, `feed-toggle`, `activities-record` (the review case), `workout-drafts`, `drafts`, `profile-buckets`, `activities-ui`; `training-buckets.test.ts` and `drafts-readers.test.ts` read 269 for the RPC bodies. Devlog: "Flow changes C1 … C4" (Oct 19 2026).

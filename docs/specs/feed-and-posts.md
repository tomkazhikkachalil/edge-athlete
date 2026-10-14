# Feed and posts: likes and impact, drafts, profile cover, posting audience

> Moved verbatim from CLAUDE.md "Key Conventions" on Oct 13 2026. Convention numbers are kept because code comments and docs cite them. Read the devlog entries each convention names (`docs/devlog.md`) before changing the code it describes.

## Convention 32 — Likes you can trust, and impact everyone can see (likes round, Oct 4 2026, #1081 + mig 252)

**Likes you can trust, and impact everyone can see (likes round, Oct 4 2026,
#1081 + mig 252)** — Tom: the count must be accurate; a heart must agree on
every surface; "an impact so you know 1000 ppl viewed your post." **Counts
are RECOUNTS** (post likes in the route + 015's trigger; comment likes in
`POST /api/comments/like` + 252's recount triggers); a reader embeds only the
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
the RECORD is live (the mirror, the handicap, round history, Vitals, the
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
REPLACES the feed's "Live round at …" banner and the Vitals workout
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

**Who sees a post is the ACCOUNT's call; per item only Post it or Only me
(Posting round, Oct 9 2026, zero DDL)** — Tom: a public account means anyone
sees what you post, a private one your approved fans; the only per-item
choice is Post it or Only me (not on the feed; an activity stays in Vitals,
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

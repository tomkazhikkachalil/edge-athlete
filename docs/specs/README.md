# docs/specs — the feature specs

Each file holds the conventions of one area, moved verbatim from CLAUDE.md on Oct 13 2026 with their numbers kept (code comments cite "convention N"). **Adding a program:** write or extend the area's file, add its row here, and record the round in `docs/devlog.md` — never in CLAUDE.md.

| File | What |
| --- | --- |
| `architecture.md` | environments, the gate's heap and lint rules, the route tree and the (public) iron rules, libraries, middleware, sport adapters, database patterns, privacy, common tasks |
| `ui-conventions.md` | navigation (no dead ends), web + mobile parity, the browser floor, spacing / type / contrast, the interaction classes, the Create menu (Post · Sport · Event · Record Activity; one start path for workouts) |
| `media.md` | Media: capture, upload, video |
| `orgs.md` | Organizations: staff, onboarding, pages, unification, authority, teams |
| `site-builder.md` | Site Builder (public org sites) |
| `contests-recruiting.md` | Contest place and recruiting |
| `data-foundation.md` | Data foundation: provenance, performances, departed accounts, results kept, RLS helpers |
| `events.md` | Events: phases 1–4, competition formats, leftovers |
| `support.md` | Support and reporting |
| `play.md` | Play: badges, rivalries, cheers, challenges |
| `activities.md` | Activities: imported, connected, live-recorded |
| `install-and-push.md` | Download the app, push notifications, the icon badge |
| `feed-and-posts.md` | Feed and posts: likes and impact, drafts, profile cover, posting audience |
| `golf-course-data.md` | Golf course data: near me, elevation, hole detail, course flow, the map sweep |
| `workouts-and-sessions.md` | Workouts and sessions: capture, the resume pill, the workout screen |
| `profile.md` | The profile: sports and pins (263), photos, Training — the Oct 14 2026 quick fixes |
| `messaging.md` | Messaging: the Message door on a profile, the thread on a phone (Oct 14 2026) |

## Convention number → file

| # | Title | File |
| --- | --- | --- |
| 8 | Media capture attaches first | `media.md` |
| 9 | Org authority is capabilities, not a role string | `orgs.md` |
| 10 | An org is live by link; approval gates the listing | `orgs.md` |
| 11 | The bubble language is house-wide; org pages speak it | `orgs.md` |
| 12 | Sites are compositions of registered widgets; edits go to a draft | `site-builder.md` |
| 13 | A contest is a PLACE | `contests-recruiting.md` |
| 14 | Recruiting is gated by ONE column and ONE predicate | `contests-recruiting.md` |
| 15 | Your own affiliations always show; a viewer sees the org's visibility | `orgs.md` |
| 16 | The schema has one source of truth; performances have one fact table | `data-foundation.md` |
| 17 | An Event is organizer intent layered over a live round | `events.md` |
| 18 | A tournament is a SEQUENCE of rounds run one at a time; the event follows its rounds | `events.md` |
| 19 | A match is a group with two sides; its status is computed, its outcome written once | `events.md` |
| 20 | An event is a live place for EVERY sport; the shape lives on the event, the mode is derived, the lines are the record | `events.md` |
| 21 | The org formats and the events meet on ONE contest through TWO doors | `events.md` |
| 22 | Seven leftovers, one migration | `events.md` |
| 23 | Support is ONE ticket table behind three doors; type is a field | `support.md` |
| 24 | An org is ONE row, ONE kind, ONE name | `orgs.md` |
| 25 | Results outlive the person; a departed account is a TOMBSTONE, not a gap | `data-foundation.md` |
| 26 | Every club, league and event has a backup and a way back; authority is audited, ceilinged by moderation, and recoverable by the Edge Athlete team | `orgs.md` |
| 27 | Results are never lost: a person controls how their profile LOOKS; only Edge Athlete support makes a recorded result leave the backend | `data-foundation.md` |
| 28 | A team is a thing with a page, a roster that names its season, and an identity; the switches hide, never delete | `orgs.md` |
| 29 | Play is sport-agnostic by construction: it reads the ONE fact table, sports join by DATA, and one post-write hook drives it | `play.md` |
| 30 | Activities are not sports: one normalized shape, parsed where it must be, the route private at both ends | `activities.md` |
| 31 | The app is DOWNLOADED from the browser, never a store; one rule says what a device can do | `install-and-push.md` |
| 32 | Likes you can trust, and impact everyone can see | `feed-and-posts.md` |
| 33 | Finish and Post are two actions; nothing is ever auto-posted | `feed-and-posts.md` |
| 34 | The golf course near you, and the hole in front of you | `golf-course-data.md` |
| 35 | The course flow: the green is a shape, elevation is free, every door hydrates, Follow is a toggle, the course has a summary | `golf-course-data.md` |
| 36 | Every course OSM can map IS mapped, by a sweep, through ONE pipeline whose every refusal is honest | `golf-course-data.md` |
| 37 | A workout clip is a tile the instant the camera hands it back; the set carries it until it is stored | `workouts-and-sessions.md` |
| 38 | Every profile card opens with the cover and the picture half over its edge | `feed-and-posts.md` |
| 39 | Who sees a post is the ACCOUNT's call; per item only Post it or Only me | `feed-and-posts.md` |
| 40 | The Security Advisor stays clean; RLS helpers live in `private` | `data-foundation.md` |
| 41 | A session is a place you can always get back to | `workouts-and-sessions.md` |
| 42 | A workout has a clock you control, groups done for rounds, a rest timer and a stopwatch, and nothing saved before it changes | `workouts-and-sessions.md` |
| 43 | A video is a poster first, media never looks broken, and the iPhone's clip is converted by a worker | `media.md` |

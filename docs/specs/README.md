# docs/specs — the feature specs

Each file holds the conventions of one area, moved verbatim from CLAUDE.md on Oct 13 2026 with their numbers kept (code comments cite "convention N"). **Adding a program:** write or extend the area's file, add its row here, and record the round in `docs/devlog.md` — never in CLAUDE.md.

| File | What |
| --- | --- |
| `architecture.md` | environments, the gate's heap and lint rules, the route tree and the (public) iron rules, libraries, middleware, sport adapters, database patterns, privacy, common tasks |
| `ui-conventions.md` | navigation (no dead ends), web + mobile parity, the browser floor, spacing / type / contrast, the interaction classes, the Create menu (Post · Sport · Event · Record Activity; one start path for workouts), the sport picker (search first, favourites per account — migration 285), light + dark on every phone (the `only` schemes vs Android forced dark); explanatory text behind an (i) — `SectionInfo`, one dismiss hook, always collapsed, h1 subtitles deleted (Oct 28 2026) |
| `media.md` | Media: capture, upload, video |
| `browser-support.md` | every browser the same: the six Playwright projects (Brave Shields, Firefox), feature-detect never sniff, `check:blocklists`, the Sentry relay |
| `orgs.md` | Organizations: staff, onboarding, pages, unification, authority, teams |
| `site-builder.md` | Site Builder (public org sites) |
| `contests-recruiting.md` | Contest place and recruiting |
| `data-foundation.md` | Data foundation: provenance, performances, departed accounts, results kept, RLS helpers |
| `events.md` | Events: phases 1–4, competition formats, leftovers |
| `support.md` | Support and reporting |
| `play.md` | Play: badges, rivalries, cheers, challenges |
| `activities.md` | Activities: imported, connected, live-recorded; set up before Start and the per-type layout table (Programs E and F, Oct 20 2026) |
| `install-and-push.md` | Download the app, push notifications, the icon badge |
| `feed-and-posts.md` | Feed and posts: likes and impact, drafts, profile cover, posting audience, the feed switch; the feed's viewer side is one call (Oct 27 2026, mig 281); the like toggle is one call (mig 282); search's decoration rides the search call (mig 283, docs/SEARCH.md); the notifications page is one call (mig 284, `install-and-push.md`) |
| `golf-course-data.md` | Golf course data: near me, elevation, hole detail, course flow, the map sweep; the weather at the course for a live round (Open-Meteo, Oct 29 2026 — the rule is in `golf-round-setup.md`'s Conditions step) |
| `workouts-and-sessions.md` | Workouts and sessions: capture, the resume pill, the workout screen; Training's Start chooser, one bubble per exercise, a clip belongs to the exercise; the rest timer's phases, the total beside the clock, the picker panel, rest is personal (Oct 22 2026); the stopwatch's lead-in, count-down, bell, rest interplay and longest-hold records (Oct 23 2026) |
| `profile.md` | The profile: sports and pins (263), photos, Training — the Oct 14 2026 quick fixes; the sport setup as steps (51) |
| `messaging.md` | Messaging: the Message door on a profile, the thread on a phone (Oct 14 2026); one live signal for the list, presence only while the dock is in use (Oct 25 2026) |
| `contacts-and-admin.md` | The contact list (sign-ups and inquiries → a row, a mail to ONE setting, a confirmation) and the admin console's own door (Oct 19 2026) |
| `platform-overview.md` | The platform Overview: the console's numbers from small tables — nightly rollups, the seen mark, sampled health, estimates (Oct 19 2026) |
| `golf-round-setup.md` | The golf round setup as steps (Oct 28 2026): StepFlow over `round-steps.ts`, the list follows the first step, only the course step refuses, Near me on entry only when already granted, the date locked while live, Scores for already played only |

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
| 44 | MMA, boxing, wrestling and jiu-jitsu are sports, and a bout is a result | `combat-sports.md` |
| 45 | Every activity records what its kind of session records, asks at most three questions, and never invents a number | `activities.md` (+ `workouts-and-sessions.md`) |
| 46 | Every browser works the same: feature-detect, never sniff; no first-party path a blocker blocks | `browser-support.md` |
| 47 | A sign-up or inquiry is a contact row, a mail to ONE setting, and a confirmation the person reads | `contacts-and-admin.md` |
| 48 | The admin console is its own door: its own sign-in, its own cookie, the app session never grants it | `contacts-and-admin.md` |
| 49 | Every number on the Overview is read from a SMALL table: counted once a night over an index, estimated where exact would be a scan, sampled where it is a probe | `platform-overview.md` |
| 50 | Sports are the profile's (Media + Stats), training is Training's, and the feed is a SWITCH, never an audience (amended Oct 21 2026: a workout's Finish records, Post or Done decides) | `feed-and-posts.md` (+ `activities.md`, `workouts-and-sessions.md`) |
| 51 | One Sports tab; a sport's setup is a few short steps from its schema, every field optional, one save | `profile.md` |
| 52 | The profile is a profile, not a settings form: the owner sees the visitor's view plus ONE Edit Profile control; every field is edited in Edit Profile, Save and Close both return to the profile | `profile.md` |
| 53 | A golf round is set up in steps; every input the form had keeps its place; the frame is StepFlow and the list follows the first step | `golf-round-setup.md` |
| 54 | The pulse: the header's two numbers (the live count, the unread messages) are ONE call, `/api/me/pulse`, behind one RPC and one module-level store; the rules say when it fetches; the conversation list keeps its own refresh | `pulse.md` |

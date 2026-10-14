# Contest place and recruiting

> Moved verbatim from CLAUDE.md "Key Conventions" on Oct 13 2026. Convention numbers are kept because code comments and docs cite them. Read the devlog entries each convention names (`docs/devlog.md`) before changing the code it describes.

## Convention 13 — A contest is a PLACE (Contest Place program, Sep 10 2026, E1–E4, mig 181 the only DDL)

**A contest is a PLACE (Contest Place program, Sep 10 2026, E1–E4,
mig 181 the only DDL)** — `/event/[contestId]` in the app (a PUBLIC
competition's contest is server-rendered, viewer-independent, titled;
everything else hands off to the `ContestGate` client island, which
fetches `GET /api/contests/[id]` with the session and renders the same
props-only body for a member or a real not-available screen) and
`/org/[slug]/schedule/[contestId]` (+ the vanity twin) on the org site
(ISR, the schedule module's detail). ONE reader,
`src/lib/competitions/contest-view.ts fetchContestView`;
`resolveContestAccess` is the ONLY gate (public competition of a public
org → everyone; else org role / staff capability / athlete entry / team
roster; a refusal is the same 404 as not-found); `projectContestView`
is the pure projection — names through `publicDisplayName`/`publicHandle`
in BOTH modes, the sanctioned tier derived (`orgs/sanction-reads.ts`),
never an email / supervision state / profile id / club id in the output
(a test serialises the view). `deriveContestOutcome` + `assignSharedRanks`
(`scoring.ts`) are the one ranking rule shared with the standings.
`ContestPage` (`src/components/contests/`) is server-safe on purpose —
no hooks, no `next/headers`, no FA — with every host-dependent href
through its `links` prop (`contestHref(id, basePath?)` beside
`playerHref`: relative in the app, absolute on a site). `posts` /
`group_posts.contest_id` (181) have ONE writer, the golf sync's
`stampContestAttachments` (attached ≡ the current results' rounds); no
client sets them. The calendar's backlink is a read-time reverse lookup
on `contests.event_id` — the events table gains no column. New root
segments join `RESERVED_ROOT_SLUGS` (`reserved.test.ts` enforces) and
the `reserved_handles` seed in the next migration. Parked (masterplan
§3.3 gaps): bracket / meet formats, ad-hoc teams, adapter competition
hooks, a composer attach-to-event picker. Read DEVLOG Sep 10 2026 E1–E4.

## Convention 14 — Recruiting is gated by ONE column and ONE predicate (Recruiting skeleton, Sep 10 2026, R1–R5, migs 182–183)

**Recruiting is gated by ONE column and ONE predicate (Recruiting
skeleton, Sep 10 2026, R1–R5, migs 182–183)** — `profiles.recruiting_status`
(`closed | open | committed`) decides whether anything recruiting-facing
renders or is even selected; `isRecruitable` (`src/lib/recruiting/
profile.ts`: claimed AND public AND not closed — supervision is NOT a
term, Tom's call: a guardian-opened supervised athlete is recruitable)
is what the shortlist POST and the scout search re-apply. Writes go
through `PATCH /api/profile/[id]/recruiting` under `manage_settings`
(self or guardian, never the supervised profile); the profile PUT strips
the recruiting fields; the academics never ship from the batched GET.
Scouts are an ACCOUNT TYPE (`user_type 'scout'`, minted by the signup
actor branch only, the organizer's shape); `requireScout` gates
`/api/scout/*`. The athlete sees a shortlist COUNT, never names. No
recruiting email — contact is the message flow and its first-contact
hold. **The profile has NO recruiting surface (Tom, Oct 4 2026):** the
athlete's door is Settings → Recruiting (`RecruitingSettings` over the ONE
form `RecruitingFields`, which the Edit Profile dialog renders only for a
guardian acting as a supervised athlete); a scout shortlists from Scout
search; the card returns with the scout program.
The ladder's words live in `src/lib/sports/provenance-copy.ts`;
a disputed line is "Unconfirmed" and leaves the headline numbers.
`docs/RECRUITING.md` carries the entities, gates and growth paths.

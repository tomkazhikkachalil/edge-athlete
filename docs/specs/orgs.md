# Organizations: staff, onboarding, pages, unification, authority, teams

> Moved verbatim from CLAUDE.md "Key Conventions" on Oct 13 2026. Convention numbers are kept because code comments and docs cite them. Read the devlog entries each convention names (`docs/devlog.md`) before changing the code it describes.

## Convention 9 — Org authority is capabilities, not a role string (Org Staff Program, Sep 2026, mig 178)

**Org authority is capabilities, not a role string (Org Staff Program,
Sep 2026, mig 178)** — `src/lib/orgs/authz.ts` answers every "may this
profile do X to this org" question: the ladder (owner > manager > member,
follow rows) plus `kind='staff'` grant rows (`admin`, or `staff` with a
`sections[]` subset of the nine console keys, at org | division | team
scope). Routes pass an **intent** to `requireOrgManager(..., { intent,
scope })`; `manage_org` (identity, settings, slug/domain, delete) is
ladder-or-admin only — nine ticked sections is never admin; only OWNERS
change roles, owners or grants. Organizer accounts (`user_type
'organizer'`) have no DOB and never enter the athlete wizard. Staff
authority never implies guardian visibility. Read DEVLOG Sep 4 2026
rounds 0–6 before touching any of it.

## Convention 10 — An org is live by link; approval gates the listing (Onboarding v2, Sep 8 2026, mig 179)

**An org is live by link; approval gates the listing (Onboarding v2,
Sep 8 2026, mig 179)** — `clubs.listing_status` / `leagues.listing_status`
(`unlisted | pending | listed`, read through `src/lib/orgs/listing.ts`)
decides the directories, the sitemap, search and the robots index —
never the door: the org GET, the join door, the console, publishing and
member rounds work from creation. `approved_at` is only the listing's
timestamp. Every org-site subpage exists in TWO route trees
(`/org/[slug]/…` and the vanity twin `/[slug]/…`). A member reaches the
roster by their OWN opt-in (`rosterSelfPost`): an adult in one act, a
supervised athlete through the guardian offer — the follow edge is still
never a pipe. A supervised profile can never create an org
(`requireOrgCreator`). Read DEVLOG Sep 8 2026 rounds 0–5 first.

## Convention 11 — The bubble language is house-wide; org pages speak it (Org Pages Program, Sep 8–9 2026, #607–#611)

**The bubble language is house-wide; org pages speak it (Org Pages
Program, Sep 8–9 2026, #607–#611)** — `src/components/bubbles/`:
`BubbleCard` (the whole card is the button; one big number + a sub-line;
literal col-spans) and `LargerWindow` (bottom sheet <sm, centered card
sm:+, z-50 BELOW PostDetailModal/MediaLightbox/ConfirmModal at z-[60];
Escape closes the TOPMOST `[role="dialog"]` only; `hostsOwnHeading` when
the hosted section renders its own `<h2>`). CSS: `.ea-bubble` /
`ea-pop-in` / `--ea-spring` are the neutral names; `.tr-scope` (Training)
and `.org-app-scope` (the in-app league/club page) are the two dialect
scopes that re-point the TWO shadow levels — never a third, never
`--brand` (the PUBLIC site's `.org-scope` does re-point brand; the two
never nest). The in-app org page is ONE `OrgPage` (`side` prop) under
`src/components/orgs/page/`: hero (brand from the org GET — draft sites
show it for everyone), a glance grid whose windows host the existing
section components with `bare`, and the media the site already had
(gallery under IDENTICAL public gates, news covers, course photos,
members' posts via `/api/posts?org=`). e2e taps the bubble first:
`e2e/helpers/org-page.ts openWindow(page, key)`. Read DEVLOG Sep 8–9
2026 R1–R5 before touching any of it.

## Convention 15 — Your own affiliations always show; a viewer sees the org's visibility (profile org strip, Sep 11 2026, #672, zero DDL)

**Your own affiliations always show; a viewer sees the org's visibility
(profile org strip, Sep 11 2026, #672, zero DDL)** — Tom's rule: your
own memberships always appear on your own profile regardless of listing
or visibility; LISTING governs whether strangers can discover the org;
VISIBILITY governs what strangers see inside it; neither governs whether
you see your own affiliation; on someone else's profile apply the org's
visibility. `getProfileOrganizations(admin, profileId, opts)` takes the
viewer (`SELF_VIEW` for self or guardian, `STRANGER_VIEW` for the
CDN-cached `/u/` payload) and filters with the pure
`src/lib/affiliations/org-visibility.ts filterOrgsForViewer` (a private
org only to its members). `profileMembershipRows` selects ONE side's org
column — always `.not(col, 'is', null)` before an `.in()` (a NULL in a
PostgREST `in()` is a 400 that emptied the whole side for anyone in a
club AND a league). `e2e/profile-orgs.spec.ts` is the regression.

## Convention 24 — An org is ONE row, ONE kind, ONE name (Round 5 — the organizations unification, Sep 22–24 2026, #891–#912, migs 231–237)

**An org is ONE row, ONE kind, ONE name (Round 5 — the organizations
unification, Sep 22–24 2026, #891–#912, migs 231–237)** —
`public.organizations` is THE org table: one row per league or club,
`kind ∈ {league, club}` (the org's self-description and route family —
school later; Tom's decision) beside the capability columns
`operates_competitions` / `operates_teams`, which stay the behaviour
switches. `leagues` and `clubs` are `security_invoker` VIEWS over it
(235: the old column sets, `sport_key AS primary_sport`; service_role
SELECT / UPDATE / DELETE, **never INSERT** — a stray insert through an
old name fails loudly). Every table that names an org carries `org_id`
alone (the `league_id` / `club_id` pair, its CHECKs, indexes, sync and
mirrors left in 235); the four side-named shapes are org shapes since
236 / 237: `affiliations` (org_id = the CHILD, parent_org_id = the
PARENT; `initiated_by child | parent`), `org_requests` (`kind`; a league
needs `sport_key`; ONE pending per profile across kinds),
`org_join_requests`, and `sanction_grants.grantor_org_id /
grantee_org_id`. **In code, `src/lib/orgs/org-ref.ts` (zero imports) is
the one spelling:** `OrgKind` is the ONE name (`OrgSide` and every inline
`'league' | 'club'` are gone — the sweep test forbids them); READ a
pair table with `.eq(ORG_ID, orgId)` and its kind through
`ORG_KIND_EMBED` (`org:organizations(kind)`; `!inner` + `.eq('org.kind',
kind)` to LIST one kind); WRITE with `...pairFor(ref)` (sends `org_id`);
the org row through `.from('organizations')` (a list of one kind adds
`.eq('kind', kind)`); a URL family through `ORG_ROUTE_FAMILY[kind]` (URLs
never changed — `/league/[id]`, `/api/clubs/…` stay); a person-facing
word through `ORG_LABEL[kind]`; a row's org through `orgIdOf` /
`orgKindOf` / `orgRefOf` (the embed is the ONLY source of a kind — no
fallback). **The public API keeps speaking `league_id` / `club_id`**
(calendar events, sport events, admin venues, affiliations, the request
rows' `created_<kind>_id`) — translated at the route boundary by
`orgRefFromBody` / `pairFieldsFor` / `publicOrgRow` / `publicRequestRow`;
and the notifications `metadata` key stays the kind's old column name
FOREVER (`NOTIFY_ORG_KEY[kind]` — history, and the announce readers
match on it). **One library, one handler per twin:** `orgs/validate.ts`
(a league's one sport is the ONE designed divergence), `orgs/notify.ts`,
`orgs/create.ts createOrgWithOwner`, `orgs/requests-server.ts` +
`admin-requests-server.ts`, and `src/lib/orgs/routes/<name>.ts` — the 42
paired route bodies as `<name>Route<VERB>(request, kind, params)`; every
`/api/leagues/[id]/…` and `/api/clubs/[id]/…` file is a shim that passes
its kind, and the route-authz audit FOLLOWS the delegation (the gate
lives in the handler module). `OrgStartPage` / `OrgStandingsPage` are
the two page pairs. A migration that drops a shape re-backfills first
(237's rule) and a dual-write for a migration window is removed in the
drop's own PR (the 237 probe caught one outliving its columns). Staging
is the FREE tier: previews + CI smoke + local e2e together crash it
(HARDENING). Read DEVLOG Sep 22–24 2026 (A–C, D0-a…D3, 234–237, E-1…F)
before touching any of it.

## Convention 26 — Every club, league and event has a backup and a way back; authority is audited, ceilinged by moderation, and recoverable by the Edge Athlete team (Authority round, Sep 25 2026, #923–#927, mig 240 the ONLY DDL)

**Every club, league and event has a backup and a way back; authority is audited, ceilinged by moderation, and recoverable by the Edge Athlete team (Authority round, Sep 25 2026, #923–#927, mig 240 the ONLY DDL)** — Tom's decisions: a backup is a WARNING, never a block (`authority/BackupBanner.tsx`, non-dismissible: an org needs 2+ active, unmoderated, non-departed OWNERS or MANAGERS — staff never count, `backup.ts orgBackupStatus`; an event an ACCEPTED co-organizer, `eventBackupStatus`); account deletion's 409 guard stays. **ONE audit writer**: `authority/audit-server.ts recordAuthority` (never throws; `AUTHORITY_ACTIONS` ≡ 240's CHECK; the detail is an allowlist, no email / phone / token; a PLATFORM act must carry its ticket — 240's CHECK) into `authority_audit`, append-only with NO foreign keys (MIGRATIONS.md); every module that changes who runs an org or event, or its public face, calls it (`AUDITED_WRITERS`, pinned). **The moderation ceiling** lives at four choke points only — `getOrgRole`, `getOrgCapabilities` (`roleCeiling` / `authorityCeiling`: an owner or manager reads as a MEMBER), `readSportEventAccess` and the scoring gate — each reading `holdsAuthority` IN PARALLEL with its own reads (a serial read cost every score write a round trip). **Events:** co-organizers through `roles.ts planRoleChange`; `host-transfer-server.ts transferHost` is THE one host writer. **Recovery is the team's, on a ticket** (`requireModerator` intent `recover_authority`, owner-only, NOT in `MODERATOR_INTENTS`): `authority/recovery.ts` (pure rules) + `recovery-server.ts` (every write: an open ticket, the `authority-admin` bucket, a platform audit row, an internal ticket step, an `authority_notice` bell naming "Edge Athlete support"); the recovery LINK (`org_claim_invites.purpose 'recovery'`, email-bound, 7 days, ADDS an owner); the site HOLD (`org_sites.held_at`, 240's CHECK held ⇒ unpublished; going live / publishing 409, preview 404); a support restore publishes WITHOUT pruning. **Reports of an org or event** name the thing, never a person (`profileId` null, `NO_INTAKE_TARGETS`); the recovery request is Help reason `recovery` (high), signed in or out, the same 201 whatever the reference matches. **News deletes are soft** (`deleted_at`; every reader names it — a sweep test; the daily cron purges after 30 days); revisions younger than 30 days are never pruned nor counted; the owner's **Activity** (`/api/{leagues,clubs}/[id]/authority-log`, owners only) reads through `authority/projection.ts` — never the admin, the ticket or the team's note. `docs/SUPPORT.md` "Authority" and `docs/EVENTS.md` "Backups…" are the references; read DEVLOG Sep 25 2026 (Authority PR 1–5) first.

## Convention 28 — A team is a thing with a page, a roster that names its season, and an identity; the switches hide, never delete (Teams & divisions program, Sep 26–27 2026, #940–#954, mig 242 the ONLY DDL)

**A team is a thing with a page, a roster that names its season, and an identity; the switches hide, never delete (Teams & divisions program, Sep 26–27 2026, #940–#954, mig 242 the ONLY DDL)** — Tom's decisions: "We run teams" / "We run competitions" (`organizations.operates_teams / operates_competitions`) GATE the console sections, the org page's tiles and the site's widgets and pages through ONE classifier, `src/lib/orgs/switches.ts` (zero imports; every console section and widget key classified exactly once — pinned; a failed read reads ON); the owner flips them in the console's "What you run" (`manage_org`, audited `identity_changed`). A team roster spot is a `memberships` row (`kind roster`, scope `team`) that **always names its season** (242's CHECK): ONE writer `src/lib/teams/roster-server.ts` (add / move / remove; the CSV import, registration placement and the rollover carry are the sanctioned twins), ONE current-season reader (`currentTeamRosterRows`, `keepCurrent`) that event sides, stat attribution, meet affiliation, the calendar audience and the team pages read — the contest place and the teammate album stay any-season on purpose. A team add needs a MEMBER already on the ORG roster (`planTeamAdd`) — a minor only through the guardian-approved offer; no team spot is ever pending. `team_roster` bells copy a supervised athlete's guardians. A team has a sport, two colours and a logo (`team-logos/`, protected from the storage sweep — PR 0 found the sweep deleting every bare-path upload, org logos included: a new bare-path writer is classified in `storage-sweep.test.ts` or the gate fails); `teams/brand.ts teamLook` is the one look (the team's, readable; else the club's). A team's schedule is ONE merge (`teams/schedule.ts`: calendar + contests + `sport_event_teams` games, each once, results from the team's side "W 3–2"; a division's home-first); `sport_event_teams` has one writer (`linkEventTeams`). Pages: `/{club,league}/[id]/teams/[teamId]` (`?tab=`), `/{club,league}/[id]/divisions/[divisionId]`, and the public `/org/[slug]/teams|divisions/[id]` + twins; the in-app reads (`orgs/routes/teams.ts`) answer `private, no-store` and a private org's outsider a 404. A coach (every grant on a team or division) lands on `ScopedConsole` (`authz.consoleLanding`), and `authz.scheduleScopeAllows` → `calendar/scope-authz-server.ts canScheduleForScope` lets them schedule their scope (org-level events stay owner / manager). Rollover carries a roster only for the teams the manager ticks (`planCarry`; default none). `docs/TEAMS.md` is the reference; read DEVLOG Sep 26–27 2026 (Teams & divisions PR 0–11) first.

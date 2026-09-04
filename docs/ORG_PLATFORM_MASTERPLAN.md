# Edge Athlete: Organization Platform Master Plan

Clubs, schools, and leagues run their entire online presence inside Edge
Athlete. Their website is not a thing they maintain. It is a rendering of
their EA data.

**Status: phases 0–6b SHIPPED (Aug 30–Sep 1 2026).** This document is the
design reference; `DEVLOG.md` is the round-by-round record and wins on any
conflict. Payments (§11 phase 6) is deliberately skipped. Phase 6c (golf
leagues that fill themselves from member rounds, the import leftovers) is
in flight — see the DEVLOG. Companion to `docs/LAUNCH_RUNBOOK.md`.

## 1. The thesis

Every incumbent in this space (SportsEngine, RAMP, Crossbar, TeamSnap)
treats the website as the product and the data as exhaust. Edge Athlete
inverts that. The site is generated and effectively free. The structured
graph of athletes, teams, contests, results, and media is the product.

The property that makes it work: an org never updates their website. A coach
enters a result in the app and the standings page changes. A registrar places
a player and the roster page changes. A parent uploads photos from a game and
the team gallery and the athlete's profile both fill in. No webmaster, no
stale schedule PDF, no volunteer learning WordPress in August.

That property is also a constraint, and it drives the whole design:

> **If it can be derived from data, it is not editable.**

The moment a page can hold hand-authored content that EA does not know about,
the maintenance burden comes back and the pitch dies. Hand-authored content
is confined to a small, deliberate list (section 6).

Second-order effects worth naming, because they justify the build cost:

- **Acquisition.** The site is the reason an org signs up. The data is why
  they stay.
- **Ingestion.** Onboarding an association imports hundreds of teams and
  thousands of athletes in one motion. This is how the athlete graph gets
  populated.
- **Virality.** A club names its league during onboarding. The league gets a
  claimable stub and an invite. Leagues bring dozens of clubs.
- **SEO.** Parents search "Kanata Blazers U13 A schedule." Every team,
  division, and competition is a static indexable page. That is a permanent
  acquisition channel that costs nothing per user.

## 2. Locked decisions

| Decision | Choice | Notes |
| --- | --- | --- |
| Builder depth (v1) | Themed templates, module toggles, brand tokens | No free-form layout |
| Domains (v1) | `{slug}.edgeathlete.com` | Custom domains SHIPPED (phase 6b C1/C2, mig 171): claim → TXT verify → Vercel attach → activate; served behind the `CUSTOM_DOMAINS` build flag |
| Registration | Capture data, no money movement | Schema assumes fees arrive later |
| Venue vs org | Split | A golf club is both a venue and an org, stored separately |
| Org type | Capability set, not enum | An association is a club and a league at once |
| League to team | Registration edge, not ownership | Club owns the team, league registers it |

## 3. Entity model

### 3.1 Organizations and places

```
organization        id, slug, legal_name, display_name, short_name,
                    country, region, city, branding_id, status
org_capability      org_id, capability
                    { operates_teams, operates_competitions,
                      sanctions, hosts_venues }
affiliation         org_id, parent_org_id, type, season_id?
                    { member_of, sanctioned_by, district_of, partner_of }
venue               id, name, address, geo, owner_org_id?
facility            venue_id, name, type, sport_config
                    (a golf course, an ice pad, court 3, field B)
```

`org_capability` replaces a type column. Kanata Minor Hockey operates teams
(its Blazers play in HEO) and operates competitions (it runs its own house
league). One org, two capabilities. This is the common case in amateur
sport, not an edge case.

`affiliation` is self-referential and typed, so KMHA → HEO District 11 →
Hockey Eastern Ontario → OHF → Hockey Canada is one recursive chain.
Populate the first link now, leave room for the rest.

### 3.2 Program structure

```
season              id, label ("2026-27"), starts_on, ends_on, sport?
division            org_id, season_id, sport, age_band, gender_stream,
                    tier, name, convener_role_id, capacity_estimate
program             org_id, season_id, sport, type, name
                    (non-competitive: learn to play, clinics, camps)
team                org_id, division_id, name, display_name,
                    branding_override_id?, status
```

Division is the layer that makes this survivable. Do not hang hundreds of
teams off an org. The division tuple (age band, gender stream, tier, season)
is doing four jobs at once: it is the navigation, it holds registration and
eligibility rules, it is the scheduling unit for internal competition, and
it is the scope a convener is granted.

`program` is a sibling of `division` for offerings that have registrants but
no contests. Associations run these and they generate revenue and
registration volume, so they cannot be an afterthought.

### 3.3 Competition

```
competition         owner_org_id, season_id, sport, name,
                    format, entrant_type, scoring_rule, visibility
                    format:       fixture | leaderboard | bracket | meet
                    entrant_type: team | athlete | ad_hoc_team
entry               competition_id, entrant_ref, status, seed, pool
contest             competition_id, venue_id, facility_id,
                    scheduled_at, round, status
contest_participant contest_id, entrant_ref, side, start_position
result              contest_id, participant_id, payload (adapter typed)
stat_line           contest_id, athlete_id, team_id, payload
standing            competition_id, entrant_ref, derived (materialized)
```

One competition model covers both contexts:

- **House league:** competition owned by KMHA, entrants are KMHA teams from
  one division, contests at KMHA venues. KMHA acting as league.
- **Rep:** competition owned by HEO District 11, entrants are teams from many
  associations, contests across many venues. KMHA acting as club.

The only differences are which org owns the competition and whether entrants
come from one org or several. Same tables, same UI, different scope.

The four formats cover the four competition shapes: team fixtures (hockey,
soccer), individual entry (golf tournaments, tennis draws), aggregated meets
(track, swimming, cross country, where individual results roll up to a team
score), and team of individuals (four ball, USTA league tennis, school golf,
where a team fixture decomposes into individual matchups). The sport adapter
supplies entrant type, contest format, result scoring, and the team-score
derivation rule. Team scores are always derived from participant results,
never authored separately.

### 3.4 People and roles

```
membership          user_id, scope_type, scope_id, role, season_id?, kind
                    scope_type: org | division | team | competition | site
                    kind:       follow | roster
```

**One scoped membership table, not three.** Earlier drafts carried
`org_membership`, `team_membership`, and `staff_role_grant` as separate
tables; they collapse into the membership table that already exists in the
build, because every structure this plan needs — org admin, division
convener, team coach, team roster spot — is the same row with a scope on it.
Staff grants are role-bearing rows here (with `granted_by`, `granted_at`,
`expires_at` on the row); athlete edges are `kind`-bearing rows.

The two athlete edges survive as two rows, because of a real gap in the
calendar. A kid registers with KMHA in June. Tryouts are in September.
Between those moments they are a member of the association with no team: an
org-scope roster row (status: registered | evaluating | placed | released)
is created at registration, the team-scope roster row at placement, and the
profile renders honestly in between.

### 3.5 Site

```
site                org_id, template_id, theme_token_set, nav_config,
                    subdomain, custom_domain?, domain_verified_at?,
                    published_at
site_module         site_id, module_key, enabled, order, config
page                site_id, slug, title, body, visibility
                    (the short hand-authored list only)
```

Recommendation, cheap to take now: store `page.body` as an ordered block
array rather than a single rich text field, even though v1 exposes no block
editor. It costs nothing today and avoids a content migration when a block
builder ships.

## 4. Org onboarding

Design target: a publishable site with real structure in under fifteen
minutes, with zero athletes loaded. A volunteer registrar has one evening.
The wizard is resumable, saves a draft at every step, and never blocks
publish on data completeness.

**The wizard runs inside the existing approval queue.** The org is built
fully in draft — identity, structure, connections, people, site — and
approval just flips it live. Review protects the name and (once sites exist)
the subdomain namespace from squatters without ever slowing onboarding:
self-serve speed, vetted publication.

### Step 1: Identity

Name, short name, slug (generated, editable), country, region, city, logo,
primary and secondary color.

Then the capability question, asked in plain language as checkboxes, not a
radio:

- We run teams that play in leagues → `operates_teams`
- We run our own competitions or house league → `operates_competitions`
- We are a school → `operates_teams` plus school flag
- We govern or sanction other organizations → `sanctions`

Most associations check the first two. That is correct and expected.

### Step 2: Sports

Multi-select from enabled sports. Per sport, ask whether they run
competitive, recreational, or both. This selects the adapter and pre-filters
the structure templates in step 3.

### Step 3: Structure

The step that decides whether onboarding succeeds. Three ways in, offered in
this order:

1. **Structure template.** "Canadian minor hockey, U7 to U18, AA/A/B/C,
   house and rep" prefills the entire division grid. Ship a curated template
   per sport per country. This is the single highest-leverage thing in the
   wizard.
2. **Grid builder.** Pick age bands, tiers, and gender streams. EA generates
   the cross product. They uncheck what they do not run.
3. **CSV import** of existing divisions and teams.

Capture estimated athletes, per division if they know it, total if they do
not. It drives plan tier, whether onboarding is self-serve or assisted, and
capacity planning. Ask it here where it feels like part of the structure,
not later where it feels like a sales question.

### Step 4: Connections

"Which leagues do your teams play in?" Search existing EA orgs. If absent,
create a claimable stub and send an invite.

"Who sanctions you?" Same pattern, writes an affiliation of type
`sanctioned_by`.

This step is the growth loop. Treat stub creation and the claim email as a
first-class flow, not a stopgap.

### Step 5: People

Invite admins by email, each with a role and scope (section 5). Optional
staff CSV import. At minimum one Owner besides the creator, because
volunteer turnover is the norm and a single-owner org becomes unrecoverable.

### Step 6: Site

Pick a template, confirm the subdomain, preview, publish. The site goes live
at the end of the wizard containing the division structure, empty team
pages, and a registration call to action. That is the moment the org
understands what they bought.

### After the wizard

Org dashboard shows a checklist, not a blank page: import rosters, set
season dates, add venues, invite coaches, open registration, enter or import
a schedule. Each item links straight to the tool and shows progress.

## 5. Admin and permissions

The requirement was a master admin plus separate admins per section, and the
ability to manage at a high or a low level. The mechanism that delivers both
is one role table where scope does the work — the scoped membership table of
section 3.4:

```
membership (staff rows): user_id, role, scope_type, scope_id, season_id?
scope_type: org | division | team | competition | site
```

Grant Convener at org scope and the person conveners everything. Grant
Convener at "U13 Boys A" and they convene that division only. Same role,
different scope. Nothing else in the model needs to change to support
high-level or low-level management.

### Roles

| Role | Typical scope | Can do |
| --- | --- | --- |
| Owner | org | Everything, plus billing, ownership transfer, delete |
| Org Admin | org | Everything except billing and ownership |
| Registrar | org | Registrations, memberships, placements, imports, eligibility. Sees personal data |
| Convener | org or division | Create teams, assign coaches, manage division schedule, move players within scope |
| Head Coach | team | Roster, lineups, events, post as team, enter results |
| Team Manager | team | Roster view, events, posts. No result entry |
| Competition Admin | competition | Schedule, results, standings, discipline |
| Site Editor | site | Template, theme, pages, news. No athlete data |
| Communications | org | Post and message as the org. No data access |
| Board Viewer | org | Read only, including reports |

### Rules

- Grants are additive. Effective permission is the union of all grants.
- A grant at a parent scope implies the same capability at every child scope.
- Grants may be season scoped. At rollover, last season's coaches lose
  access automatically. This is the difference between a system that stays
  clean and one that accumulates a decade of stale access.
- Every grant, change, and revocation is appended to the existing audit
  trail.
- A league cannot grant roles inside a member club. Cross-org authority is
  limited to competition scope: approve or reject an entry, flag an
  ineligible player, confirm a result. It never extends to editing a club's
  roster. Get this wrong and clubs will not join.

### Safety boundary

Staff roles never confer guardian visibility. This must be enforced in
policy, not convention, because the same human is often a guardian on one
team and a coach on another.

- A coach sees: roster, jersey numbers, attendance, and guardian contact
  where org policy enables it.
- A coach never sees: guardian approval queues, supervision settings, DMs,
  the family console, or any other family's private data.
- For minors, the default contact surfaced to staff is the guardian's, not
  the child's.
- Registrar access to personal data is an explicit elevated capability with
  its own audit entries, not a side effect of being an admin.

## 6. The site builder

### Modules

The builder is a set of module toggles. Each module is a route, a component,
and a data source. Enabling one turns on the route and its nav entry.

Home, Divisions and Teams, Team pages, Schedule, Standings, Stat leaders,
News, Media galleries, Registration, Documents and policies, Staff
directory, Venues and directions, Sponsors, Contact.

Shipped (Sep 2026): the 16 keys in `MODULE_KEYS`
(`src/lib/org-sites/validate.ts`) — hero, standings, schedule, teams, staff,
venues, affiliations, sponsors, contact, news, gallery, register, courses
(the golf club's linked catalog courses), divisions, leaders, documents.

Every module reads live EA data. Ordering and nav labels are editable. That
is the entire v1 builder.

### Hand-authored content, the complete list

News posts, the hero block, sponsor blocks, and a short set of rich text
pages (about, policies, code of conduct, contact). Nothing else. Everything
else is derived.

### Theming

A token set: primary, secondary, accent, surface, text, logo, wordmark,
favicon, and a typeface pair from a curated list. Templates supply layout,
tokens supply brand.

Shipped (phase 6b B1/B2): accent, accentStrong, surface (plain|tinted),
typeface (sans|serif as CSS stacks — no per-site webfont), wordmark, logo,
a generated favicon, and two templates (classic, bold). `text`, `primary`
and `secondary` were deliberately skipped (a user-set text colour on white
is a contrast liability; the primaries collapse into the accents). The
public segment is LIGHT-ONLY by rule — phone-width parity came free, dark
mode did not (and is not wanted there).

### Routing and domains

- v1: `{slug}.edgeathlete.com` for the public site.
- `edgeathlete.com/org/{slug}` always resolves, and is what in-app links use.
- Shipped (phase 6b C1/C2, mig 171): claim → TXT verify (`_edgeathlete.<domain>`)
  → Vercel attach → activation by a reachability probe
  (`/.well-known/edge-athlete`); the middleware serves the custom host by
  rewrite and the apex 301s to an ACTIVE domain single-hop
  (`src/lib/org-sites/domain-server.ts`, `domain-cache.ts`).
- Canonical: once a domain is active every public URL mints on it
  (`siteAbsoluteUrl`); until then the vanity `/{slug}` path is canonical.

### Rendering, and the biggest technical risk in this plan

Public site pages are unauthenticated, crawlable, and must be fast. They
must not be served through the authenticated RLS path.

Build a public projection: a set of views or materialized tables containing
only publicly visible fields, with their own policies, fed by the same
writes. Statically generate with on-demand revalidation when the underlying
data changes. Getting this wrong produces either a data leak or a slow site,
and both are hard to walk back once orgs are live. Treat it as a design
spike before phase 3 starts.

### SEO

Every division, team, competition, and contest gets an indexable page with
schema.org structured data (SportsTeam, SportsEvent, SportsOrganization,
Person). Athlete pages are indexable only when the athlete is an adult with
a public profile. Minors are never indexed, regardless of org settings.

## 7. The automatic flows

These are the reason an org tolerates switching. They should feel like the
system knows things.

### Result to athlete stat

```
Competition admin or coach enters result
  → result + stat_line rows (athlete, team, contest)
  → athlete career aggregates recompute
  → athlete profile updates, with provenance and a backlink to the contest
  → team season stats and competition standings recompute from the same rows
```

Provenance ladder, extending the tracked-versus-claimed model already
shipped:

1. **Sanctioned:** result in a competition owned by an org with a
   `sanctioned_by` chain
2. **League verified:** result in an EA competition, confirmed by a
   competition admin
3. **Club recorded:** entered by team staff, unconfirmed
4. **Self reported:** entered by the athlete
5. **Imported:** migrated historical data, labeled as such

Display the tier. This ladder is the integrity story behind the recruiting
dataset, and it is the part a scout or a college coach will actually
interrogate.

Add a dispute state. When a club and a league disagree about a result, the
record holds both and shows unconfirmed until the competition admin
resolves it. Do not let last-write-wins decide a season.

### Media to athlete

Media uploaded in a contest context inherits competition, contest, teams,
venue, and date automatically. Attribution to individual athletes then
happens by:

- Explicit tagging, which already exists
- Roster-scoped suggestions: only offer the athletes actually in that
  contest, which turns tagging from a search problem into a thirty-item
  picker

The athlete's media tab fills from anything they are tagged in, across every
org they belong to.

**Guardian gate, non-negotiable.** A minor's media appearing on a public
club site requires a photo consent flag captured at registration on the
roster membership. The automatic flow checks it. Absence of consent means
the media exists in the org's private library and never renders publicly.
The convenience of automation must not become a path around the family
console.

## 8. The multi-sport, multi-org athlete

A kid plays hockey for KMHA in winter, soccer for a different club in
summer, and golfs at a course club year round. One EA profile, three orgs,
three sports, three competition contexts, each rendered by its own sport
adapter with its native stat schema.

No incumbent can show that page, because they are all single-sport or
single-org.

Three invariants that protect it:

1. **An org never owns an athlete.** Membership is an edge. The athlete's
   account, profile, media, and history belong to the athlete (and their
   guardian).
2. **Leaving a club does not erase history.** An org can revoke future
   access. It cannot revoke the past record. Say this in the terms, and
   expect to defend it in sales conversations with associations who assume
   otherwise.
3. **Follow and roster are different edges, permanently.** Follow is the
   community edge: one tap, ungated, a lens and nothing more. Roster is the
   record edge: invitation or registration, season scoped, guardian gated
   for minors — and only the roster edge carries stats attribution, media
   attribution, and calendar writes. No future feature may quietly turn the
   follow edge into a pipe.

## 9. Season lifecycle

```
clone prior season structure
  → registration window opens, org roster memberships created
  → evaluation period, placements
  → teams rostered, entries into competitions
  → season active: contests, results, stats, media
  → season closes: standings frozen, awards, archive
  → rollover: grants expire, rosters empty, structure clones forward
```

Rollover being one button is a retention feature. The moment a registrar has
to rebuild 140 teams by hand in August, they start shopping. Clone forward,
keep the structure, empty the rosters, expire the season-scoped grants.

## 10. Import and migration

Getting an association off their existing site is the actual sales obstacle.

- Divisions and teams by CSV — shipped (phase 6 R5)
- Rosters by CSV per team, creating unclaimed athlete stubs — shipped (phase 1)
- Schedule by CSV — shipped (phase 6 R6); by ICS — phase 6c I1
- Historical results, optional, tagged with imported provenance and visibly
  labeled — shipped (phase 6 R6)
- Claim flow: an email or guardian invite converts a stub into a real
  profile and merges its history — shipped (phase 1)
- Per-athlete stat lines by CSV (roster-matched) — phase 6c I2

The stub and claim path is the growth loop, not an import edge case. A
league handing over four thousand kids is four thousand invitations with a
real reason to accept.

Open: many associations sit on Hockey Canada Registry, RAMP, or Crossbar
exports. Parsing those formats directly is likely worth it later. Do not
commit in v1.

## 11. Build sequence

Each phase lands under the existing standard: numbered migrations,
`npm run verify` green, atomic PRs with auto-merge, production probe, DEVLOG
entry, phone-width parity.

| Phase | Scope | Exit condition |
| --- | --- | --- |
| 0 | Foundations: capabilities, affiliation, venue and facility split, season, division, scoped role grants | SHIPPED (migs 140–150) |
| 1 | Onboarding wizard, org dashboard, division and team CRUD, rosters with stubs and claim | SHIPPED |
| 2 | Competition model, four formats behind the adapter, house league and external league, standings | SHIPPED (migs 151–154) |
| 3 | Public site: templates, tokens, modules, subdomain routing, public projection, SEO | SHIPPED (migs 155–156; block editor shipped here, not in phase 6) |
| 4 | Automatic flows: stat to profile with provenance, contest-scoped media attribution, guardian gates | SHIPPED (migs 157–160) |
| 5 | Registration capture, programs, eligibility, placement workflow | SHIPPED (migs 161–165) |
| 6 | Vanity paths + slug engine, sanctioning chain, result disputes, CSV import (Tom's redefined scope) | SHIPPED (migs 166–168) |
| 6b | Golf club page, builder depth (tokens, second template, three modules), custom domains | SHIPPED (migs 169–171) |
| — | Payments | SKIPPED by decision (registrations stays the invoice anchor) |
| 6c | Golf leagues that fill themselves from member rounds, ICS + stat-line imports, the two-page club/league defaults | IN FLIGHT |
| 7 | Org Staff Program (§3.4 + §5 delivered): organizer accounts, section-scoped staff grants on the one membership table, owner-minted email invites, the Hierarchy console section, season expiry at rollover, audit trail | SHIPPED (mig 178; Sep 4 2026 rounds 0–6; the §5 named-role ladder is expressed as section sets, not ten role strings) |

The public projection spike (phase 2) resolved to posture A — service-role,
viewer-independent reads in the (public) segment — with one recorded
exception, the anon SECURITY DEFINER host RPCs of mig 171
(`docs/HARDENING.md` §B4 #10).

## 12. Open questions and risks

### Technical

- Public read path versus RLS. Resolved — see the note under §11 (posture A + the one recorded exception).
- Scale: one hundred thousand orgs at one hundred teams each is ten million
  teams. Division queries, season clone, and standings recomputation all
  need to be batched from the start.
- Scheduling. Generating a house league schedule against ice-time
  constraints is a hard optimization problem. Import first, generate later.
- Slug collisions across orgs, and disambiguation in search.

### Product

- The team page serves two masters: club branding and league context. Needs
  a design decision before phase 3.
- Do house league teams get full team pages, or lighter ones? Volume argues
  for lighter.
- How much does a league see inside a member club by default? Recommend:
  rosters for eligibility only, nothing else.

### Safety and legal

- Photo consent for minors on public sites, and whether the default varies
  by jurisdiction. Needs a policy decision, possibly per country.
- Whether staff can be granted any view of another family's data, under any
  circumstance. Recommend a firm no.
- Data ownership language in the org terms, given invariant 2 in section 8.

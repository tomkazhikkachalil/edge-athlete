# Data foundation: provenance, performances, departed accounts, results kept, RLS helpers

> Moved verbatim from CLAUDE.md "Key Conventions" on Oct 13 2026. Convention numbers are kept because code comments and docs cite them. Read the devlog entries each convention names (`docs/devlog.md`) before changing the code it describes.

## Convention 16 — The schema has one source of truth; performances have one fact table (Data foundation, Sep 13–14 2026, #709–#720, migs 190–194)

**The schema has one source of truth; performances have one fact
table (Data foundation, Sep 13–14 2026, #709–#720, migs 190–194)** — Tom's
vision is a multi-sport ANALYSIS / RECRUITING dataset, so two things
got one owner each. **Provenance**: every live table and column is
named by a numbered migration or by an entry in
`database/provenance/allowlist.json` (EMPTY since the baselines
190–193, Sep 14 2026; a new entry needs the migration that retires it);
`npm run check:schema` (LOCAL only — the service key; never CI) reads
PostgREST's OpenAPI as the live inventory and fails on drift or a stale
entry (108/108 live tables owned, Sep 14); the read-only ONE-statement
`database/provenance/live-dump.sql` is how the baselines 190 (social
core) · 191 (athlete legacy) · 192 (golf conditions) · 193 (profile
measurables) were written — from the Sep 14 CSV under
`database/provenance/dumps/`, every body verbatim, each a NO-OP on
prod with a check grid (a baseline that rewrites live behaviour is not
a baseline; what it found odd it RECORDS in its header for a later
migration). **Policies and functions have owners too (provenance round,
Sep 15 2026, #722–#725, migs 195–197):** `provenance_inventory()` (195,
a service-role-only RPC) is the live catalog; `check:schema` requires
every live policy to be the chain's LAST statement for it (same cmd /
roles) and every live function BODY to equal the chain's dollar-quoted
text (`md5(prosrc)`, plus SECURITY DEFINER / `search_path`) — 196
recorded the 56 policies the chain never named and dropped its 29 stale
claims, 197 re-declared 13 function bodies verbatim; the hygiene sweep
(Sep 16, migs 198–199) added TRIGGER and GRANT facets (a normalised
trigger tuple; the chain's simulated EXECUTE grantee set vs `proacl`)
and dropped what the baselines had recorded as redundant. Whitespace-
only body diffs and SECURITY DEFINER-executable-by-API-role are
informational. **The common
shape**: `athlete_performances` (194, posture A) is ONE row per EVENT
per athlete — `natural_key` = the ORIGIN ROW id (`post:` ·
`golf_round:` · `contest_stat_line:`; never (contest, profile)), a
golf league result is an OVERLAY on the round's row (never a second
row), NUMERIC-ONLY `metrics` in the sport's stat-schema vocabulary, the
152 provenance ladder with `DEFAULT 'self_reported'` (load-bearing: a
PostgREST upsert updates only the payload's columns), no visibility
snapshot. `src/lib/performance/`: pure mappers (`map.ts`), the ONE
writer (`write-server.ts` — never throws, never fails the user's
write, pre-194 `skipped`; every hook AWAITED after the origin write),
the backfill (`backfill.ts` + `/api/admin/performance-backfill`,
dry-run by default, keyset-paged, the dashboard panel is its door —
an owner action gets a UI, never a console recipe). A stat line is
validated SERVER-SIDE (`stat-line-validate.ts`): a schema miss is a
400 naming the field — never clamped, never stripped. The scout
search is the first reader (`since`, `minProvenance` over
`rungsAtOrAbove`, `minHeadline` by `HEADLINE_DIRECTION`; a post's row
counts only while the post is public and published). ONE ladder:
`PROVENANCE_RANK` in `provenance-copy.ts`. `docs/PERFORMANCE_DATA.md`
is the reference; read DEVLOG Sep 13 2026 P1, F1–F6 first.

## Convention 25 — Results outlive the person; a departed account is a TOMBSTONE, not a gap (Departed accounts, Sep 24 2026, mig 238)

**Results outlive the person; a departed account is a TOMBSTONE, not a
gap (Departed accounts, Sep 24 2026, mig 238)** — Tom's rule: a result
that is part of a game, event, round, club or league OUTLIVES the person
("if someone leaves, I don't want that affecting other players' stats").
The ONE writer is `src/lib/account-deletion.ts hardDeleteAccount` (the
30-day park purge, the owner's `POST /api/admin/account-purge` door, the
orphan path); the ONE decision is `src/lib/account-departure.ts
departureMode` → `erase` (nothing tied, a stub, a minor whose guardian
signed consent **v2** — that signature promised erasure) · `tombstone`
(an adult with tied rows: entries, stat lines, event participation, a
hosted event, a shared / minted round, a card on another's round, an
org calendar event, shared media) · `masked` (a supervised athlete whose
guardian signed **v3**, renamed "Athlete"). A kept row: auth user
deleted (238 dropped `profiles_id_fkey` — NEVER delete users from the
Supabase dashboard; the twin counts orphans), personal columns stripped
by the pinned KEEP / SET / NULL lists (a test holds them equal to the
live column set), `<id>@departed.invalid`, handle released, private,
`departed_at` stamped. Every cascading FK onto profiles is classified in
`PROFILE_FK_POLICY` (survives · goes · engine) and a test holds the
engine to deleting each `goes` entry by name — a new table must be
classified. ONE predicate: `departed_at` (`isDeparted` in
`orgs/public-names.ts`; REQUIRED on `MaskableProfile`, and a sweep test
holds every select carrying `visibility, email, supervision_state` to
carry it): `publicDisplayName` answers the FULL name, `isPublicProfile`
false (no link, no page, never recruitable). `canViewProfile`,
`/api/profile`, messages and follow refuse a tombstone; search forgets
it (238); a bell to it is dropped (238's trigger); `athlete_performances`
is SET NULL for everyone who leaves (kept, severed). You cannot delete
your account while you are the ONLY one who can run an unfinished event,
a club or a league (`account-sole-authority.ts`, 409) — the creation-time
"two accounts" rule (convention 26) and the untag rule (convention 27)
followed. `docs/EVENTS.md` "When a person leaves" and
`docs/PERFORMANCE_DATA.md` are the references; read DEVLOG Sep 24 2026
(Departed accounts PR 1–2) first.

## Convention 27 — Results are never lost: a person controls how their profile LOOKS; only Edge Athlete support makes a recorded result leave the backend (Results-kept round — the untag rule, Sep 26 2026, #928–#932, mig 241 the ONLY DDL)

**Results are never lost: a person controls how their profile LOOKS; only Edge Athlete support makes a recorded result leave the backend (Results-kept round — the untag rule, Sep 26 2026, #928–#932, mig 241 the ONLY DDL)** — Tom: *"any data metrics recorded will go towards understanding what the athlete's athletic score is"*. "Delete" on a result (a golf round, a stat line, an event post, a scored shared round) is a HIDE through ONE writer, `src/lib/results/hide-server.ts setResultHidden` (`golf_rounds.profile_hidden_at`; `posts.status 'profile_hidden'` — a status, so every published-only reader skips it; distinct from moderation's `hidden`) that never touches the handicap, the leaderboards or `athlete_performances`; ordinary posts still delete; `src/lib/results/kinds.ts isResultPost` decides. The event opt-out is the same profile hide (the mirror is written and stamped, never removed). Hidden rounds leave LISTS for other viewers; AGGREGATES and the dataset count everything. **Official** = `official.ts isOfficialOrigin` (org host · competition · linked contest · provenance `club_recorded`+), walked by `origin-server.ts resolveResultOrigin` (FAILS CLOSED): no untag, no tag edit, no score rewrite by the player (409 `OFFICIAL_RESULT_REFUSAL`); an org taking a person off an official record bells them (`notify-server.ts tellOfficialChange`). A played event is never deleted; a scored decline is refused; a round creator's delete removes only an unplayed round (`deleteOrHideRound`). **Wrong person** = report reason `wrong_person` (event-only) → support's `correction-server.ts` (move WHOLE to the right account, contest dropped then re-synced; correct with before/after; remove a mistaken result — the only true removal), everyone told. A sweep test allowlists every `.delete()` on `golf_rounds` / `athlete_performances`. Photo tags stay the person's to remove (likeness). `docs/PERFORMANCE_DATA.md` "Results are never lost" is the reference; read DEVLOG Sep 26 2026 (Results kept PR 1–5) first. **Amended Oct 2 2026 (Tom, quick fixes PR 1–2, zero DDL): a FOR-FUN result gets BOTH Hide and a real Delete; an official result and any event round stay hide-only.** Hide has to be SEEN: the feed's owner arm excludes `profile_hidden` (241 wrongly assumed a status needed no reader change), the owner's own profile keeps the result MARKED with "Show on profile" on it, and `hide-server.ts setWholeResultHidden` moves the post and the same owner's stats row together (every door uses it; `hidden-list.ts pairHiddenResults` lists one row per result). Delete is `src/lib/results/delete-rule.ts planResultDelete` (pure: official or event → refuse; an UNFINISHED casual round → its creator discards it whole, nothing was recorded; finished and alone → the whole round; finished and shared → the requester's result only — stats row, dataset row, their scores on the card, plus the post when they created it) carried out by the ONE writer `delete-server.ts`. **A delete is asked for BY NAME** (`?mode=delete` on `DELETE /api/posts`, `/api/group-posts/[id]`, `/api/golf/rounds/[id]`): a bare DELETE keeps its Sep 26 meaning — a result is hidden — so an old tab never destroys what its confirm promised to keep. `resolveResultOrigin` still fails closed (a failed read → hide-only), and the `.delete()` allowlist names the new writer.

## Convention 40 — The Security Advisor stays clean; RLS helpers live in `private` (Oct 9 2026, migs 257–258)

**The Security Advisor stays clean; RLS helpers live in `private` (Oct 9
2026, migs 257–258)** — a SECURITY DEFINER function a policy calls goes in
the non-API schema `private` (never `public`, where it is an open RPC);
a body that calls one names `private.<helper>`; trigger functions carry no
EXECUTE grants; `pg_trgm` / `unaccent` live in `extensions`; `pg_net` in
`public` is the ONE accepted Advisor item (Tom). `schema_dump()` exports
`private`, so the baseline rebuilds it. `docs/HARDENING.md` B6 is the
check; `database/MIGRATIONS.md` has the rules.

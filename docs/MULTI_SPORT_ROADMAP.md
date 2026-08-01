# Multi-Sport Roadmap — Audit Findings & Deferred Work

**Date:** July 17, 2026 (updated same day — sports #2/#3 shipped)
**Status:** Golf fully implemented; **ice hockey + volleyball live via the stat-line architecture** (see below). This doc records the audit findings and what remains for deeper sport build-outs.

## Stat-line architecture (DECIDED July 17, 2026)

Sports whose per-game data fits a stat line store one structured object in
`posts.stats_data` (`{type:'stat_line', sport_key, date, opponent, result,
result_score, stats}`) — zero DDL, scoped by `sport_key`. Single source of
truth: `src/lib/sports/stat-schemas.ts` — the composer form (`StatLineForm`),
feed card (`StatLineCard`), profile aggregates (`/api/sports/stat-lines` +
`StatLinePostAdapter`), and media-tile summaries all derive from it.

**Adding another stat-line sport = 2 edits:** a schema in `stat-schemas.ts`
(fields + `profileTiles` + headline) + `enabled: true` in `SportRegistry`
(add the key to the `statLineSports` list in `AdapterRegistry`). No
component or API changes. Profile tiles use `profileTiles` computations
(count/sum/avg) so rate stats (PPG, AVG) aggregate correctly.

**Live sports (July 17, 2026):** golf (deep tables: golf_rounds/golf_holes),
ice hockey, volleyball, basketball, soccer, baseball (stat-line), + training.

**Graduating a sport to deep tables** (like golf's `golf_rounds`/`golf_holes`):
do it when features demand per-period/per-set detail. Keep the stat-line as
the summary layer; the deep tables hang off it.

Guiding principle: *build for today, architect for tomorrow.* We deliberately did **not** genericize the surfaces below yet — refactoring before a second sport exists to validate the abstraction produces the wrong abstraction. This doc is the map for when that day comes.

---

## What is already sport-agnostic (do not regress)

- **Core tables:** `profiles` (no sport columns beyond `sport` label), `posts.sport_key` + `posts.stats_data` (JSONB), `season_highlights` (sport_key + generic metrics), `sport_settings` (profile_id + sport_key + JSONB).
- **Adapter scaffolding:** `src/lib/sports/SportRegistry.ts` (11 sports defined, golf + training enabled), `SportAdapter.ts` interface, `AdapterRegistry.ts`, `adapters/GolfAdapter.ts`.
- **Surfaces the adapter actually governs today:** profile highlight tiles (`MultiSportHighlights`) and profile activity table (`MultiSportActivity`).
- **Generic settings API:** `/api/sport-settings` (GET/PUT/DELETE) is fully sport-agnostic.
- **Cleaned in migration 020:** dead per-sport FK columns (`posts.game_id/match_id/race_id`), 5 dead tables, `golf_mode` → `activity_mode`.

## Where golf is still hardcoded (the sport-#2 work list)

Ordered by size. Each item = a seam the adapter interface needs before "drop in an adapter" is true.

### 1. Post pipeline (largest)
- `src/app/api/posts/route.ts` — create route branches on `postType === 'golf'` and inserts/updates `golf_rounds` + `golf_holes` directly; read paths embed `golf_rounds(golf_holes(...))`.
- **Needed seam:** `adapter.composePost()` (currently a stub in GolfAdapter) — adapter owns sport-table writes; core route only writes `posts` + calls the adapter.

### 2. Feed rendering — ✅ DONE (July 17, 2026)
- Extracted to `golf/GolfRoundCard` + `golf/GolfStatsSummaryCard`, dispatched by `SportPostBody` (sport_key-keyed). Stat-line sports render via `StatLineCard` in the default case. PostCard: 1030 → 612 lines.

### 3. Post composer
- `src/components/CreatePostModal.tsx` (2113 lines) + `CreatePostModalSteps.tsx` — golf course search, tee/par/hole state, scorecard forms inline.
- **Needed seam:** per-sport composer component registered by sport_key; shared modal handles caption/media/tags only.

### 4. Read APIs embedding golf tables
- `src/app/api/public/profile/route.ts` (golfStats calc), `src/app/api/profile/[profileId]/media/route.ts` (golf_round join), `src/app/api/posts/[id]/route.ts`, `src/app/athlete/saved/page.tsx`, `src/app/feed/page.tsx` (`type === 'golf_round'` branch).
- **Needed seam:** adapter-provided "activity summary" fetch, or a generic `activities` view per sport keyed by `sport_key` + `activity_id`.

### 5. Profile editing & equipment
- ~~Equipment is golf-hardcoded~~ ✅ **DONE.** Categories per sport (July 26, 2026), then
  brand seeds, per-category spec fields and free-text entry for every enabled sport
  (August 1, 2026). The seam landed as three sibling `Record<sport_key, …>` files —
  `equipment-config.ts` (categories), `equipment-brands.ts` (brands), `equipment-specs.ts`
  (spec fields) — each with a safe empty fallback, plus `equipment-catalog.ts` for
  matching/ranking. `AddEquipmentModal` and `EquipmentSection` now carry **no sport
  knowledge at all**.
  - This entry used to cite `src/app/api/equipment/route.ts:70` as hardcoding
    `sport_key: 'golf'`. That was fixed in July; the route validates `sportKey` against
    `getEquipmentSportOptions()` and 400s on unknown sports. Line 70 is unrelated code.
    Re-verified August 1, 2026 — don't go looking for it.
- **STILL OPEN — profile editing only:** `src/components/EditProfileTabs.tsx` has a
  hardcoded golf tab, and its golf form (handicap/home course/tee/hand) is the only writer
  of `sport_settings` (`?sport=golf`).
- **Needed seam (remaining):** settings-schema-per-sport, adapter- or registry-driven.
  `stat-schemas.ts` is the shape to copy — a schema per sport driving one generic form.

### 6. Consolidations / small fixes (can do anytime, low risk)
- **Two parallel sport registries:** `src/lib/sports/SportRegistry.ts` vs `src/lib/config/sports-config.ts` (icons/colors/names duplicated). Merge to one source of truth. (Still open.)
- ~~`MultiSportHighlights` / `MultiSportActivity` hardcode sport lists~~ ✅ DONE — derived via `getPrimarySports()` (July 17, 2026).
- `src/lib/stats-summary.ts` — move `formatGolfStatsSummary` into GolfAdapter (generic sibling already exists).
- `src/lib/supabase.ts:185–217` — `GolfSettings`/`HockeySettings`/`BasketballSettings` types belong per-adapter.
- `src/lib/copy.ts` — `FEATURES.GOLF` block, `getSportRoute()` special-cases golf.
- `src/app/app/sport/[sport_key]/activity/[id]/page.tsx` — special-cases golf redirect.
- `src/app/u/[username]/page.tsx` — hardcoded "Golf Stats" card.
- `EditPostModal.tsx` / `CreatePostModal.tsx` — hardcoded golf hashtag/tag catalogs → move into registry per sport.

## sport_settings — current truth

- Schema is correct and generic. **Written** only by EditProfileTabs' golf tab (`?sport=golf`). **Read by no rendering code** — feed/profile/highlights all read `golf_rounds` directly. 0 rows in production as of this audit (nothing forces a write; there's no onboarding write).
- When wiring sport #2 settings, also add a *read* path or the table stays decorative.

## Database conventions going forward

- Shared entities: sport-agnostic names (`posts`, `season_highlights`, `sport_settings`, future `events`, `organizations`).
- Sport detail: per-sport tables (`golf_rounds`, `golf_holes`; future `hockey_game_stats`, …) referenced from posts via `round_id`-style FK **or** (preferred for sport #2) a generic `activity_id` + `sport_key` pair — decide when sport #2's data model is real.
- Migrations: additive-first; destructive changes require verified-empty targets or explicit sign-off + backup.

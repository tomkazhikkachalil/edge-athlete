# Search & location — the model every entity follows

**Status:** foundation shipped Aug 24 2026 (migrations 104–107); users and
clubs on the same model in 108; `search_documents` + `search_all` unified the
searchable entities in 112; **leagues adopted it on creation in 113** (the
first entity born inside the unified index); arenas, teams and events do the
same when they arrive. Read this before adding a search box, a location
field, or a new locatable entity.

## Why

Tom (Aug 24): search "is only by name" — people search by country,
province/state, city and region, they may not know the exact name, and
that has to work for users, clubs and leagues, not just courses, growing
toward a "mini Google" over every entity in every sport. The prod audit
the same day showed the deeper problem was **data**: 5% of 28,968 courses
carried a country, in mixed formats (`US`/`USA`, `FL`). A search function
can't match what a row doesn't have, so the model came first.

## The `places` table

One row per populated place from GeoNames `cities5000` (~69k rows,
CC BY 4.0 — the attribution line is rendered wherever these fields
appear): `name, ascii_name, region, region_code, country, country_code,
lat, lng, population, search_vector`. `region_code` is ISO-3166-2 letters
where people type them (US states, Canadian provinces — GeoNames numbers
the latter; `iso-data.ts` maps them), otherwise GeoNames' admin1 code.
Seeded by an ops script (DEVLOG, Aug 24); refreshed the same way.

`admin2` (county / census division, from GeoNames) and `metro` (computed:
the largest place within 40 km at least twice the place's size — 110) live
on `places` only; every entity's search vector pulls them through
`place_id` at weight D, so "ottawa" reaches Kanata, Nepean and Gatineau
without any entity gaining a column.

`search_places(q, max_results, p_country_code)` powers every location
autocomplete (profile location, filters, event locations). `place_aliases`
(109, from GeoNames `alternatenames`, rule in `src/lib/geo/aliases.ts`)
lets "NYC" / "New York" reach New York City in both the picker and the
free-text backfill.

## The location columns (every locatable entity)

```
place_id uuid REFERENCES places(id) ON DELETE SET NULL,
city text, region text, region_code text, country text, country_code text,
lat double precision, lng double precision,
location_source text   -- who filled it: 'osm' | 'provider' | 'nominatim' | 'gazetteer' | 'user'
```

Denormalized on purpose: an entity's own `search_vector` and its filters
must not need a join. Names AND codes are stored so "Florida" and "FL",
"Canada" and "CA" all match. Writers go through
`src/lib/geo/regions.ts` (`normalizeCountry`, `normalizeRegion`,
`formatPlace`) and never downgrade a better `location_source`.

Backfilling an entity from coordinates is one SQL statement — nearest
place within 40 km via a lat/lng box + `haversine_km` (see
`105_backfill_course_places.sql`). Backfilling from free text is a name
match against `places` (108's `backfill_places_from_text` does this for
`profiles.location` and `clubs.location`).

## The search contract (every search RPC)

- Parameters: `q`, `max_results`, `p_country_code`, `p_region_code`,
  `p_near_lat`, `p_near_lng`, `p_radius_km` (default 50) — the same names
  everywhere, so a UI filter component is entity-agnostic.
- Text: `search_prefix_tsquery(q)` — tokens AND'd, **prefix on every
  token**, over a `search_vector` built with `search_normalize` (lower +
  `unaccent`) and the `simple` config (no stemming, no stop words — the
  087 lesson: `websearch_to_tsquery('english')` is whole-word and eats
  "the"). Weights: name **A**, secondary name (club) **B**, city **C**,
  region/codes/country **D**. Trigram substring on the raw columns is the
  fallback ("reek" → Eagle Creek).
- Multi-term relevance: rank PER TOKEN (`search_token_hits` on the name
  vector, `search_token_rank` = sum of single-token `ts_rank`). Plain
  `ts_rank` and `ts_rank_cd` both score term PROXIMITY for AND queries, so
  a city token beside a region token beats a name token whatever the
  weights (107, probe-caught).
- Ranking ladder, in order: exact name → name prefix → per-token rank
  (`search_token_hits` on the name vector, then `search_token_rank` — 107;
  never plain `ts_rank`/`ts_rank_cd`, which score term PROXIMITY for AND
  queries) → richness (the entity's own "has real data" rule) → recency →
  distance → name. A "near me" browse (empty `q`) puts distance first.
- Security: `SECURITY INVOKER`, `REVOKE EXECUTE … FROM PUBLIC, anon,
  authenticated`, `GRANT … TO service_role`; routes call through the admin
  client and apply privacy themselves (087's rule). Migrations end with a
  re-runnable SELECT check grid, never RAISE (the SQL-editor transaction
  trap).
- App side: an RPC missing because a migration hasn't run yet degrades to
  the previous search and logs loudly (`people-server.ts` pattern); it
  never 500s the picker.

## Surfaces

| surface | today | with 104–106 |
|---|---|---|
| Composer course picker | name/club/city/region substring | tokens across all fields + country; rows show `City, Region · Country` ✅ |
| Explore → Courses | text only | + Country → Region facets (`/api/golf/courses/facets`), Near me, `?course=<id>` deep link ✅ |
| Explore → Athletes | sport chips only | name search + place filter + Near me (108) |
| Header ⌘K | people (names), posts, clubs | Location filter (place → 50 km); people and clubs match and DISPLAY location (108); + Golf Courses type ✅ |
| ⌘K → Leagues | — | league rows (113), navigable to `/league/[id]`, place + sport subtitle ✅ |
| ⌘K filter panel | type/sport/school/place | + live facet counts: per-type totals, Country → Region selects (`search_all_facets`) ✅ |
| ⌘K → Clubs | inert rows (no page) | navigable to `/club/[id]` (117) ✅ |
| Profile location | free text | place picker (`search_places`); free text kept as the display string |

## `search_all` (the mini-Google endpoint) — shipped in 112

`search_documents`: one row per searchable entity (`entity_type` in
athlete/club/course/post/league — a NAMED check constraint, so a new type is
one constraint swap, exactly how 113 added leagues), with `title` (the ranking name), `subtitle`, `sport_key`,
`owner_id`, `visibility`, the location columns, `rich`, `recency` and a
`search_vector`. Maintained by AFTER triggers on each source table (upsert +
delete pairs); course/athlete/club documents REUSE the entity's own contract
vector, post documents get a fresh `simple`-config one (caption A, hashtags
B, sport_key C — `posts.tags` holds tagged-profile UUIDs and is excluded).
`search_all(q, p_types, max_per_type, visible_ids, include_public, location
params)` runs the ladder above with a per-type ROW_NUMBER quota;
`search_all_facets` returns type/sport/country/region counts, surfaced in
the ⌘K filter panel (live type counts + Country → Region selects via
`/api/search/facets`; the codes feed the country/region params `search_all`
already filters on). `/api/search` hydrates display rows from the ranked ids and keeps
the entire pre-112 per-entity path as its degrade fallback.

Privacy split, deliberate: athlete documents carry `visibility`/`owner_id`
and are filtered in-query (search_people semantics — LIMIT after privacy);
post documents EXIST only while the post is public and published, and
author-level privacy (a private athlete's accepted followers still see
their posts) stays in the route. Known gap: athlete docs have `sport_key`
NULL — `profiles.sport` stores a display label, so the sport chip remains a
route post-filter.

Leagues (113) are the worked example: the named-CHECK swap, one trigger
pair, a backfill — and deliberately NO bespoke `search_leagues` RPC. The
per-entity RPCs exist because those entities predate `search_all`; an entity
born inside the unified index needs only its doc-sync triggers (checklist
item 3 is satisfied by `search_all` itself). League doc rows carry
`owner_id` NULL on purpose — the `owner_id = ANY(visible_ids)` privacy
pass-through must never apply to an always-public type.

## Adding a new locatable entity (checklist)

1. Table gets the location columns above (+ `place_id` FK).
2. A `search_vector` trigger built with `search_normalize` + `simple`,
   weights per the contract; GIN index; `(country_code, region_code)` and
   `lat` btrees.
3. `search_<entity>(...)` RPC with the standard parameters, revoked from
   anon/authenticated; check grid.
4. Writers normalize through `regions.ts`; the UI uses the shared place
   picker and `formatPlace`.
5. Attribution: GeoNames line wherever place-derived fields render.

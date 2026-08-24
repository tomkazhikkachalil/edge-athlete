# Search & location — the model every entity follows

**Status:** foundation shipped Aug 24 2026 (migrations 104–107); users and
clubs on the same model in 108; leagues, arenas, teams and events adopt it
on creation. Read this before adding a search
box, a location field, or a new locatable entity.

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

`search_places(q, max_results, p_country_code)` powers every location
autocomplete (profile location, filters, event locations).

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
- Ranking ladder, in order: exact name → name prefix → `ts_rank_cd` →
  richness (the entity's own "has real data" rule) → recency → distance →
  name. A "near me" browse (empty `q`) puts distance first.
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
| Composer course picker | name/club/city/region substring | tokens across all fields + country; rows show `City, Region · Country` |
| Explore → Courses | text only | + Country → Region facets (`/api/golf/courses/facets`), Near me |
| Explore → Athletes | sport chips only | name search + place filter + Near me (108) |
| Header ⌘K | people (names), posts, clubs | Location filter (place → 50 km); people and clubs match and DISPLAY location (108); + courses (PR 3) |
| Profile location | free text | place picker (`search_places`); free text kept as the display string |

## Toward `search_all` (the mini-Google endpoint)

When more than two or three entity types are searchable, unify: a
`search_documents` table (`entity_type, entity_id, sport_key, title,
subtitle, the location columns, search_vector`) maintained by per-entity
triggers, one `search_all(q, p_types, location params)` RPC using the same
tokenizer and ladder, facets by type/sport/country/region. Golf courses are
document type #1; nothing in this design changes for them. Until then,
each entity's RPC is the contract above — which is exactly what makes the
unification mechanical later.

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

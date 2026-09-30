// The production reset (Sep 30 2026): which tables are REFERENCE data (kept)
// and which are user data (truncated). Read by the SQL generator, the wipe
// script and the pinning test — one classification, three consumers.
// The go-list is derived: every table in the schema dump that is not kept.
// A table added later therefore lands on the go-list automatically, and the
// test fails if the dump and this file disagree.

import { readFileSync } from 'node:fs';

/** Reference data — not a person's, kept through the reset. */
export const KEEP = [
  'schema_migrations', // the chain's ledger
  'reserved_handles', // the chain's seed (root segments)
  'golf_courses', // the global course catalog (OSM / API / seed; hole data is jsonb on the row)
  'golf_clubs',
  'places', // the geo catalog
  'place_aliases',
  // NOT kept, on purpose:
  //  - golf_holes is per-ROUND hole scores (FK → golf_rounds), not the catalog;
  //  - help_articles references profiles (created_by), so profiles cannot be
  //    truncated while it stands outside the statement; it holds 0 rows on
  //    Sep 30 2026 and goes with the rest (re-author after).
];

/** Every FK from a KEEP table must point at a KEEP table, so the TRUNCATE
 *  runs WITHOUT CASCADE: a missed table makes Postgres refuse, never
 *  silently truncate something extra. Pinned by the test against the
 *  baseline's FK declarations. */

/** Kept table, but its USER rows go: search_documents holds the catalog's
 *  course index beside athlete / club / league / post rows. */
export const PARTIAL = { search_documents: "entity_type <> 'course'" };

export const DUMP = 'database/provenance/dumps/2026-09-30-schema.json';

export function allTables(dumpPath = DUMP) {
  const d = JSON.parse(readFileSync(dumpPath, 'utf8'));
  return d.tables.map(t => t.name).sort();
}

export function goTables(dumpPath = DUMP) {
  const keep = new Set([...KEEP, ...Object.keys(PARTIAL)]);
  return allTables(dumpPath).filter(t => !keep.has(t));
}

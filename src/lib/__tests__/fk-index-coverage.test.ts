import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { foreignKeys, indexColumnLists } from './helpers/live-schema';

/**
 * Every foreign key has an index whose LEADING columns are its columns
 * (migration 239, Sep 25 2026). Without one, every DELETE of the referenced
 * row — and every SET NULL / CASCADE through the column — makes Postgres's RI
 * trigger scan the whole child table: one profile delete measured 756 ms on a
 * quiet staging (13.9 s under load) before 239 indexed the 83 that lacked
 * one, 111 ms after. Read from the baseline plus every migration above its
 * head, so a migration that adds a foreign key without its index fails the
 * gate — the catalog twin (verify-239-fk-indexes.sql) is the same rule live.
 */
describe('every foreign key has a leading index', () => {
  const fks = foreignKeys();
  const indexes = indexColumnLists();
  const covered = (table: string, cols: string[]) =>
    (indexes.get(table) ?? []).some(ix => cols.every((c, i) => ix[i] === c));

  it('reads a plausible schema (the parser found the baseline)', () => {
    expect(fks.length).toBeGreaterThan(200);
    expect(covered('posts', ['profile_id'])).toBe(true);
  });

  it('no foreign key is left without one', () => {
    const missing = fks.filter(fk => !covered(fk.table, fk.columns)).map(fk => `${fk.table}(${fk.columns.join(', ')}) → ${fk.ref}`);
    expect(missing).toEqual([]);
  });

  it('the rule bites: an FK without an index is reported', () => {
    expect(covered('contests', ['nonexistent_column'])).toBe(false);
  });
});

describe('239_fk_indexes.sql', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'database/migrations/239_fk_indexes.sql'), 'utf8').replace(/--[^\n]*/g, '');
  it('builds its 82 indexes in the SQL editor\'s one transaction (never CONCURRENTLY) and records itself', () => {
    expect(sql.match(/^CREATE INDEX IF NOT EXISTS /gm)).toHaveLength(82);
    expect(sql).not.toMatch(/CONCURRENTLY/);
    expect(sql).toMatch(/INSERT INTO public\.schema_migrations \(number, name\) VALUES \(239, '239_fk_indexes\.sql'\) ON CONFLICT \(number\) DO NOTHING;/);
  });
});

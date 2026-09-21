import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The row-type insert lesson, pinned (Round 1 PR 1, Sep 2026 — after
 * migrations 175, 179, 182 and 223 each broke "add a supervised athlete").
 *
 * `create_managed_profile` (053) inserts a WHOLE profiles row through
 * `jsonb_populate_record(NULL::profiles, p_profile)`: every column the JSON
 * does not name arrives as an explicit NULL, so a column's DEFAULT never
 * applies and a NOT NULL fires. Therefore every `profiles` column added
 * NOT NULL after 053 must EITHER be named by the route's `p_profile` OR have
 * a later migration drop the NOT NULL. This test reads the chain and the
 * route and refuses the fifth repeat.
 */
const MIGRATIONS = path.join(process.cwd(), 'database/migrations');
const ROUTE = path.join(process.cwd(), 'src/app/api/guardian/athletes/route.ts');

function chain(): Array<{ n: number; text: string }> {
  return fs
    .readdirSync(MIGRATIONS)
    .filter(f => /^\d+_.+\.sql$/.test(f))
    .map(f => ({ n: parseInt(f, 10), text: fs.readFileSync(path.join(MIGRATIONS, f), 'utf8') }))
    .filter(m => m.n > 53)
    .sort((a, b) => a.n - b.n);
}

describe('profiles NOT NULL columns vs create_managed_profile', () => {
  it('every NOT NULL profiles column added after 053 is supplied by the route or later made nullable', () => {
    const files = chain();
    const route = fs.readFileSync(ROUTE, 'utf8');
    const problems: string[] = [];
    for (const m of files) {
      // ALTER TABLE profiles ADD COLUMN [IF NOT EXISTS] <col> <type…> NOT NULL …  (one statement, possibly multi-line)
      const re = /ALTER TABLE (?:public\.)?profiles\s+ADD COLUMN (?:IF NOT EXISTS )?(\w+)\s+([^;]*?)\bNOT NULL\b/g;
      for (const hit of m.text.matchAll(re)) {
        const col = hit[1];
        const droppedLater = files.some(
          later => later.n >= m.n && new RegExp(`ALTER TABLE (?:public\\.)?profiles\\s+ALTER COLUMN ${col}\\s+DROP NOT NULL`).test(later.text)
        );
        const supplied = new RegExp(`\\b${col}\\s*:`).test(route);
        if (!droppedLater && !supplied) problems.push(`${m.n}: profiles.${col} NOT NULL — neither supplied in p_profile nor made nullable later`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

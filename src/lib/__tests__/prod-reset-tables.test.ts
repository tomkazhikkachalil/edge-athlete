import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { KEEP, PARTIAL, allTables, goTables } from '../../../scripts/prod-reset/tables.mjs';

// The production reset (Sep 30 2026): the classification covers every table
// in the schema dump, and no kept table references a wiped one (the SQL
// truncates WITHOUT cascade so a miss fails loudly instead of truncating a
// kept table).

describe('prod reset: the table classification', () => {
  it('covers every table in the schema dump exactly once', () => {
    const all = allTables();
    const go = goTables();
    const kept = [...KEEP, ...Object.keys(PARTIAL)];
    expect(new Set([...go, ...kept]).size).toBe(all.length);
    expect(go.some((t: string) => kept.includes(t))).toBe(false);
    expect(all.length).toBeGreaterThan(100);
  });

  it('no kept table holds a foreign key onto a wiped table', () => {
    const sql = readFileSync('database/baseline/000_rebuild.sql', 'utf8');
    const go = new Set(goTables());
    const kept = new Set([...KEEP, ...Object.keys(PARTIAL)]);
    const bad: string[] = [];
    for (const m of sql.matchAll(/ALTER TABLE public\.(\w+) ADD CONSTRAINT \w+ FOREIGN KEY \([^)]*\) REFERENCES (?:public\.)?(\w+)\(/g)) {
      const [, from, to] = m;
      if (kept.has(from) && go.has(to)) bad.push(`${from} → ${to}`);
    }
    expect(bad).toEqual([]);
  });

  it('the generated SQL names every wiped table', () => {
    const sql = readFileSync('database/ops/2026-09-30-prod-reset.sql', 'utf8');
    for (const t of goTables()) expect(sql, t).toContain(`public.${t}`);
    for (const t of KEEP) expect(sql.match(new RegExp(`TRUNCATE[^;]*\\bpublic\\.${t}\\b`)), `${t} must not be truncated`).toBeNull();
  });
});

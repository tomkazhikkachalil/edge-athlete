import fs from 'node:fs';
import path from 'node:path';

/**
 * The schema as of the chain's head, read from files: the generated baseline
 * (database/baseline/000_rebuild.sql, the live schema at its ledger head)
 * with every numbered migration ABOVE that head applied on top — so a test
 * stays true both before and after the baseline is regenerated. Only the two
 * facts the departed-account tests need are modelled: a table's columns and
 * the foreign keys onto profiles(id) with their ON DELETE action.
 */
const ROOT = process.cwd();
const BASELINE = path.join(ROOT, 'database/baseline/000_rebuild.sql');
const MIGRATIONS = path.join(ROOT, 'database/migrations');

export function baselineText(): string {
  return fs.readFileSync(BASELINE, 'utf8');
}

export function baselineHead(text = baselineText()): number {
  const m = /Ledger head at generation: (\d+)/.exec(text);
  if (!m) throw new Error('000_rebuild.sql names no ledger head');
  return Number(m[1]);
}

/** Migrations numbered above the baseline's head, in order. */
export function migrationsAbove(head: number): Array<{ n: number; name: string; text: string }> {
  return fs
    .readdirSync(MIGRATIONS)
    .filter(f => /^\d{3}_.+\.sql$/.test(f))
    .map(f => ({ n: parseInt(f, 10), name: f, text: fs.readFileSync(path.join(MIGRATIONS, f), 'utf8') }))
    .filter(m => m.n > head)
    .sort((a, b) => a.n - b.n);
}

/** Strip `-- …` line comments so a sentence in a header never reads as DDL. */
function sqlOnly(text: string): string {
  return text.replace(/--[^\n]*/g, '');
}

export function tableColumns(table: string): string[] {
  const base = baselineText();
  const block = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(base);
  if (!block) throw new Error(`no CREATE TABLE for ${table} in the baseline`);
  const cols = new Set(
    block[1]
      .split('\n')
      .map(l => /^\s+([a-z_][a-z0-9_]*)\s/.exec(l)?.[1])
      .filter((c): c is string => !!c && c !== 'constraint')
  );
  for (const m of migrationsAbove(baselineHead(base))) {
    const sql = sqlOnly(m.text);
    for (const hit of sql.matchAll(new RegExp(`ALTER TABLE (?:public\\.)?${table}\\s+ADD COLUMN (?:IF NOT EXISTS )?(\\w+)`, 'gi'))) cols.add(hit[1]);
    for (const hit of sql.matchAll(new RegExp(`ALTER TABLE (?:public\\.)?${table}\\s+DROP COLUMN (?:IF EXISTS )?(\\w+)`, 'gi'))) cols.delete(hit[1]);
  }
  return [...cols].sort();
}

export type FkAction = 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';

/** `table.column` → ON DELETE action, for every FK onto profiles(id). */
export function profileForeignKeys(): Map<string, FkAction> {
  const base = baselineText();
  const byName = new Map<string, { key: string; action: FkAction }>();
  const re = /ALTER TABLE (?:public\.)?(\w+)\s+ADD CONSTRAINT (\w+)\s+FOREIGN KEY \((\w+)\)\s+REFERENCES (?:public\.)?profiles\(id\)(?: ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION))?/g;
  for (const hit of base.matchAll(re)) {
    byName.set(hit[2], { key: `${hit[1]}.${hit[3]}`, action: (hit[4] as FkAction) ?? 'NO ACTION' });
  }
  for (const m of migrationsAbove(baselineHead(base))) {
    const sql = sqlOnly(m.text);
    // statement order matters: a DROP then a re-ADD of the same name
    const events: Array<{ at: number; apply: () => void }> = [];
    for (const d of sql.matchAll(/DROP CONSTRAINT (?:IF EXISTS )?(\w+)/g)) {
      const name = d[1];
      events.push({ at: d.index ?? 0, apply: () => byName.delete(name) });
    }
    for (const a of sql.matchAll(re)) {
      const [, table, name, col, action] = a;
      events.push({ at: a.index ?? 0, apply: () => byName.set(name, { key: `${table}.${col}`, action: (action as FkAction) ?? 'NO ACTION' }) });
    }
    for (const e of events.sort((x, y) => x.at - y.at)) e.apply();
  }
  const out = new Map<string, FkAction>();
  for (const { key, action } of byName.values()) out.set(key, action);
  return out;
}

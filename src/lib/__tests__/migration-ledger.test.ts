import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { chainNumbers, diffLedger, formatLedgerReport } from '../../../scripts/schema-inventory-ledger.mjs';

// Round 2 — the migration ledger (226). Two things are pinned: the pure
// diff `check:schema` runs against the live `schema_migrations`, and the
// FILE convention — from 227 on every migration records itself with the
// one-line footer, so a file without it never merges. The chain's
// numbering is checked too: contiguous from 001 to the head, with 217 the
// one recorded gap (skipped in Sep 2026, nothing says why — 226's header).

const migrationsDir = join(process.cwd(), 'database', 'migrations');
const LEDGER_BORN = 226;
const KNOWN_GAPS = [217];

const files = readdirSync(migrationsDir).filter(n => /^\d{3}_.*\.sql$/.test(n)).sort();

describe('the chain\'s numbering', () => {
  it('is contiguous from 001 to the head, with only the recorded gap, and no duplicates', () => {
    const numbers = files.map(n => Number(n.slice(0, 3)));
    expect(new Set(numbers).size).toBe(numbers.length);
    const head = Math.max(...numbers);
    const missing = [];
    for (let n = 1; n <= head; n++) if (!numbers.includes(n)) missing.push(n);
    expect(missing).toEqual(KNOWN_GAPS);
  });
});

describe('the ledger footer (every migration from 227 on records itself)', () => {
  it('names its own number and file name in an INSERT into schema_migrations', () => {
    for (const name of files) {
      const number = Number(name.slice(0, 3));
      if (number < LEDGER_BORN) continue;
      const sql = readFileSync(join(migrationsDir, name), 'utf8');
      const footer = new RegExp(`INSERT INTO public\\.schema_migrations \\(number, name\\) VALUES \\(${number}, '${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\) ON CONFLICT \\(number\\) DO NOTHING;`);
      expect(sql, `${name} lacks its ledger footer`).toMatch(footer);
    }
  });

  it('226 seeds every earlier file by name', () => {
    const sql = readFileSync(join(migrationsDir, files.find(n => n.startsWith('226_'))!), 'utf8');
    for (const name of files) {
      const number = Number(name.slice(0, 3));
      if (number >= LEDGER_BORN) continue;
      expect(sql, `226 does not seed ${name}`).toContain(`(${number}, '${name}', 'backfill-226')`);
    }
  });
});

describe('diffLedger', () => {
  const chain = ['001_a.sql', '002_b.sql', '004_d.sql', 'RUNBOOK.md'];
  it('reads numbers from file names only', () => {
    expect([...chainNumbers(chain).keys()]).toEqual([1, 2, 4]);
  });
  it('is OK when the ledger and the chain agree', () => {
    const r = diffLedger(chain, [{ number: 1, name: '001_a.sql' }, { number: 2, name: '002_b.sql' }, { number: 4, name: '004_d.sql' }]);
    expect(r).toMatchObject({ ok: true, notRun: [], ledgerOnly: [], renamed: [], chainHead: 4, ledgerHead: 4 });
    expect(formatLedgerReport(r)).toContain('Ledger OK');
  });
  it('names a file that has not run, and a row with no file', () => {
    const r = diffLedger(chain, [{ number: 1, name: '001_a.sql' }, { number: 2, name: '002_b.sql' }, { number: 3, name: '003_gone.sql' }]);
    expect(r.ok).toBe(false);
    expect(r.notRun).toEqual(['004_d.sql']);
    expect(r.ledgerOnly).toEqual(['3 (003_gone.sql)']);
    expect(formatLedgerReport(r)).toContain('NOT RUN here (1)');
  });
  it('reports a rename as informational, not drift', () => {
    const r = diffLedger(chain, [{ number: 1, name: '001_old.sql' }, { number: 2, name: '002_b.sql' }, { number: 4, name: '004_d.sql' }]);
    expect(r.ok).toBe(true);
    expect(r.renamed).toEqual(['001_a.sql (ledger says 001_old.sql)']);
  });
  it('numbers arrive as strings from PostgREST too', () => {
    expect(diffLedger(['001_a.sql'], [{ number: '1', name: '001_a.sql' }]).ok).toBe(true);
  });
});

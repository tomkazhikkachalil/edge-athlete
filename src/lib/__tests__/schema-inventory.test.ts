import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { diff, formatReport, ident, liveFromOpenApi, parseChain, splitStatements, stripComments, stripDollarBodies } from '../../../scripts/schema-inventory-core.mjs';

// Data foundation P1 — the provenance inventory's core. The parser's rules
// (what OWNS a table or a column), the diff and the allowlist semantics are
// pinned on fixtures; a smoke run over the real chain keeps the parser
// honest against every migration file that exists.

const file = (name: string, sql: string) => ({ name, sql });

describe('the SQL scrubbing', () => {
  it('strips -- and /* */ comments but not string literals', () => {
    expect(stripComments("select 'a -- not a comment' -- real\n/* block */ from t").replace(/\s+/g, ' ').trim()).toBe("select 'a -- not a comment' from t");
  });
  it('drops function bodies but keeps DO blocks', () => {
    const sql = "create function f() returns void as $$ alter table x add column hidden text $$ language plpgsql; do $$ begin alter table y add column kept text; end $$;";
    const out = stripDollarBodies(sql);
    expect(out).not.toContain('hidden');
    expect(out).toContain('kept');
  });
  it('splits statements on ; outside parentheses and literals', () => {
    expect(splitStatements("create table t (a int, b text default ';'); alter table t add c int")).toHaveLength(2);
  });
  it('identifiers: quoted, schema-qualified, case-folded', () => {
    expect(ident('"MyTable"')).toBe('mytable');
    expect(ident('public.posts')).toBe('posts');
    expect(ident('Posts')).toBe('posts');
  });
});

describe('parseChain — what owns what', () => {
  it('CREATE TABLE owns the table and its inline columns; constraints are not columns', () => {
    const owned = parseChain([file('001.sql', "CREATE TABLE IF NOT EXISTS public.t (\n id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n \"Name\" text NOT NULL CHECK (length(\"Name\") > 0),\n created_at timestamptz DEFAULT now(),\n CONSTRAINT t_name_key UNIQUE (\"Name\"),\n PRIMARY KEY (id),\n FOREIGN KEY (id) REFERENCES p(id),\n CHECK (created_at > '2020-01-01')\n);")]);
    expect([...owned.tables.get('t')!].sort()).toEqual(['created_at', 'id', 'name']);
  });
  it('ALTER TABLE ADD (multi, IF NOT EXISTS, in a DO block) adds columns; RENAME moves; DROP disowns', () => {
    const owned = parseChain([
      file('001.sql', 'create table t (id int);'),
      file('002.sql', 'ALTER TABLE ONLY public.t ADD COLUMN IF NOT EXISTS a int, ADD b text, ADD COLUMN c bool;'),
      file('003.sql', "do $$ begin alter table t add column if not exists d int; end $$;"),
      file('004.sql', 'alter table t rename column b to b2; alter table t drop column if exists c;'),
    ]);
    expect([...owned.tables.get('t')!].sort()).toEqual(['a', 'b2', 'd', 'id']);
  });
  it('an ALTER on a table the chain never created does NOT own the table — a later CREATE absorbs those columns', () => {
    const onlyAltered = parseChain([file('002.sql', 'alter table posts add column round_id uuid;')]);
    expect(onlyAltered.tables.has('posts')).toBe(false);
    expect([...onlyAltered.altered.get('posts')!]).toEqual(['round_id']);
    const baselined = parseChain([file('002.sql', 'alter table posts add column round_id uuid;'), file('190.sql', 'create table if not exists posts (id uuid, caption text);')]);
    expect([...baselined.tables.get('posts')!].sort()).toEqual(['caption', 'id', 'round_id']);
  });
  it('views and functions are recorded; DROP TABLE disowns; RENAME TO moves the table', () => {
    const owned = parseChain([file('a.sql', 'create or replace view v as select 1; create function f() returns int as $$ select 1 $$ language sql; create table gone (id int); drop table gone; create table old (id int); alter table old rename to fresh;')]);
    expect(owned.views.has('v')).toBe(true);
    expect(owned.functions.has('f')).toBe(true);
    expect(owned.tables.has('gone')).toBe(false);
    expect(owned.tables.has('fresh')).toBe(true);
    expect(owned.tables.has('old')).toBe(false);
  });
  it('a mention is not ownership: a policy or an index naming a column does not define it', () => {
    const owned = parseChain([file('a.sql', "create table t (id int); create index i on t (ghost); create policy p on t using (ghost = 1);")]);
    expect([...owned.tables.get('t')!]).toEqual(['id']);
  });
});

describe('diff + allowlist', () => {
  const owned = parseChain([file('a.sql', 'create table t (id int, a int); create view v as select 1;')]);
  it('reports unowned tables and columns; views count as owned tables', () => {
    const r = diff({ t: ['id', 'a', 'b'], u: ['id'], v: ['x'] }, owned);
    expect(r.unownedTables).toEqual(['u']);
    expect(r.unownedColumns).toEqual([{ table: 't', column: 'b' }]);
    expect(r.ok).toBe(false);
  });
  it('an allowlist entry documents a table (every column) or one column; stale entries fail', () => {
    const ok = diff({ t: ['id', 'a', 'b'], u: ['id'] }, owned, [{ table: 'u', column: null, reason: 'legacy', ref: 'x' }, { table: 't', column: 'b', reason: 'loose', ref: 'y' }]);
    expect(ok.ok).toBe(true);
    expect(ok.documented).toHaveLength(2);
    const stale = diff({ t: ['id', 'a'] }, owned, [{ table: 't', column: 'a', reason: '', ref: '' }, { table: 'zz', column: null, reason: '', ref: '' }, { table: 't', column: 'nope', reason: '', ref: '' }]);
    expect(stale.staleAllowlist.map(e => e.why)).toEqual(['column is owned now', 'not live', 'column not live']);
    expect(stale.ok).toBe(false);
  });
  it('liveFromOpenApi maps definitions to columns and lists the RPCs; the report names the state', () => {
    const live = liveFromOpenApi({ definitions: { t: { properties: { id: {}, a: {} } } }, paths: { '/t': {}, '/rpc/do_thing': {} } });
    expect(live.tables).toEqual({ t: ['id', 'a'] });
    expect(live.rpcs).toEqual(['do_thing']);
    const r = diff(live.tables, owned);
    expect(formatReport(r, { liveTables: 1, ownedTables: 1, rpcs: live.rpcs })).toContain('OK — every live table and column is owned or documented.');
    expect(formatReport(diff({ q: [] }, owned))).toContain('UNOWNED TABLES (1)');
  });
});

describe('the real chain', () => {
  it('parses every numbered migration and owns what the chain plainly creates', () => {
    const dir = join(process.cwd(), 'database', 'migrations');
    const files = readdirSync(dir)
      .filter(n => /^\d{3}_.*\.sql$/.test(n))
      .sort()
      .map(name => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
    expect(files.length).toBeGreaterThan(180);
    const owned = parseChain(files);
    expect(owned.tables.get('org_site_news')).toContain('pinned_at');
    expect(owned.tables.get('org_sites')).toContain('seo_config');
    expect(owned.tables.get('contest_stat_lines')).toContain('provenance');
    expect(owned.tables.get('golf_rounds')).toContain('course_id');
    // The pre-chain tables are ALTERed, never created — the gap this program closes.
    expect(owned.tables.has('posts')).toBe(false);
    expect(owned.altered.get('posts')).toContain('contest_id');
  });
});

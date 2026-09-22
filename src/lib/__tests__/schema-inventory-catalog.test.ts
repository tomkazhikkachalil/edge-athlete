import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  diffCatalog,
  formatCatalogReport,
  identityTypes,
  liveFromCatalog,
  maskSql,
  DEFAULT_GRANTEES,
  parseTriggerStatement,
  triggerTuple,
  normalizeBody,
  normalizeSearchPath,
  normalizeType,
  parseCatalogChain,
  policyName,
  statements,
} from '../../../scripts/schema-inventory-catalog.mjs';

// Provenance round, PR B — the catalog facets (policies, functions). The
// parser's rules are pinned on fixtures; a smoke run over the real chain
// keeps them honest against every migration file that exists.

const file = (name: string, sql: string) => ({ name, sql });
const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');

describe('the offset-preserving mask', () => {
  it('keeps length and newlines; blanks comments and literal interiors; keeps dollar tags and records segments', () => {
    const sql = "select 'a;b' -- c\n/* d\ne */ $$ x $$";
    const { masked, dollars } = maskSql(sql);
    expect(masked.length).toBe(sql.length);
    expect(masked.split('\n').length).toBe(sql.split('\n').length);
    expect(masked).toBe("select '   '     \n    \n     $$   $$");
    expect(dollars).toEqual([{ start: sql.indexOf('$$'), bodyStart: sql.indexOf('$$') + 2, bodyEnd: sql.lastIndexOf('$$'), end: sql.length, tag: '$$' }]);
  });
  it('a -- inside a dollar body is body text; a $$ inside a comment is nothing', () => {
    const sql = "-- not $$ a body\ncreate function f() returns void language sql as $$ select 1 -- keep me\n$$;";
    const chain = parseCatalogChain([file('001.sql', sql)]);
    const f = chain.functions.get('f()')!;
    expect(f.body).toBe(' select 1 -- keep me\n');
    expect(f.bodyMd5).toBe(md5(' select 1 -- keep me\n'));
  });
  it('splits statements on ; outside literals, bodies and parentheses, and trims by the mask', () => {
    const sql = "-- lead\ncreate table t (a text default ';'); do $$ begin x; y; end $$; select 1";
    const { masked } = maskSql(sql);
    const st = statements(sql, masked);
    expect(st.map(s => s.raw.slice(0, 12))).toEqual(['create table', 'do $$ begin ', 'select 1']);
    expect(st[0].start).toBe(sql.indexOf('create'));
  });
});

describe('normalisation', () => {
  it('types: aliases, arrays, typmods, schema prefixes', () => {
    expect(normalizeType('INT')).toBe('integer');
    expect(normalizeType('int4[]')).toBe('integer[]');
    expect(normalizeType('FLOAT8')).toBe('double precision');
    expect(normalizeType('TIMESTAMPTZ')).toBe('timestamp with time zone');
    expect(normalizeType('timestamp')).toBe('timestamp without time zone');
    expect(normalizeType('VARCHAR(20)')).toBe('character varying');
    expect(normalizeType('numeric(5,2)')).toBe('numeric');
    expect(normalizeType('text[]')).toBe('text[]');
    expect(normalizeType('public.uuid')).toBe('uuid');
    expect(normalizeType('double precision')).toBe('double precision');
    expect(normalizeType('character varying')).toBe('character varying');
  });
  it('identity types: names dropped, OUT args removed, DEFAULTs ignored, modes stripped', () => {
    expect(identityTypes('p_user UUID, p_limit INT DEFAULT 20, OUT total bigint, VARIADIC tags text[]')).toEqual(['uuid', 'integer', 'text[]']);
    expect(identityTypes('uuid, text')).toEqual(['uuid', 'text']);
    expect(identityTypes('')).toEqual([]);
    expect(identityTypes('p_at timestamp with time zone, p_flag boolean = false')).toEqual(['timestamp with time zone', 'boolean']);
  });
  it('search_path spellings collapse to one form', () => {
    expect(normalizeSearchPath("''")).toBe('');
    expect(normalizeSearchPath('""')).toBe('');
    expect(normalizeSearchPath("'public'")).toBe('public');
    expect(normalizeSearchPath('public')).toBe('public');
    expect(normalizeSearchPath('public, extensions')).toBe('public, extensions');
    expect(normalizeSearchPath("'public', 'extensions'")).toBe('public, extensions');
    expect(normalizeSearchPath('search_path=public, extensions')).toBe('public, extensions');
    expect(normalizeSearchPath('"$user", public')).toBe('$user, public');
    expect(normalizeSearchPath(null)).toBeNull();
  });
  it('policy names: quoted keeps case and spaces (with "" unescaped), bare lowercases', () => {
    expect(policyName('"Users can view their own profile"')).toBe('Users can view their own profile');
    expect(policyName('"say ""hi"""')).toBe('say "hi"');
    expect(policyName('Posts_Select_Policy')).toBe('posts_select_policy');
  });
  it('the body normalisation mirrors the RPC (CRLF, trailing whitespace, outer trim)', () => {
    expect(normalizeBody('\r\n BEGIN  \r\n  x;\t\n END;\n\n')).toBe('BEGIN\n  x;\n END;');
  });
});

describe('parseCatalogChain — functions', () => {
  it('reads the body between any dollar tag, and the clauses after the body (the 014 shape)', () => {
    const body = '\nBEGIN\n  RETURN NEW;\nEND;\n';
    const chain = parseCatalogChain([file('014.sql', `CREATE FUNCTION f()\nRETURNS TRIGGER AS $t$${body}$t$ LANGUAGE plpgsql SECURITY DEFINER\nSET search_path = '';`)]);
    const f = chain.functions.get('f()')!;
    expect(f.body).toBe(body);
    expect(f.bodyMd5).toBe(md5(body));
    expect(f.bodyMd5Norm).toBe(md5(normalizeBody(body)));
    expect(f.secdef).toBe(true);
    expect(f.searchPath).toBe('');
    expect(f.language).toBe('plpgsql');
    expect(f.returns).toBe('trigger');
  });
  it('the nested DO / EXECUTE $func$ / $t$ shape yields the inner body exactly', () => {
    const sql = "DO $$\nBEGIN\n  IF EXISTS (SELECT 1) THEN\n    EXECUTE $func$\n    CREATE FUNCTION g()\n    RETURNS TRIGGER AS $t$ BODY $t$ LANGUAGE plpgsql;\n    $func$;\n  END IF;\nEND $$;";
    const chain = parseCatalogChain([file('014.sql', sql)]);
    expect(chain.functions.get('g()')!.body).toBe(' BODY ');
    expect(chain.functions.get('g()')!.line).toBe(5);
    expect(chain.dynamic).toEqual([]);
  });
  it('overloads are separate keys; the last definition wins; explicit and name-wide DROPs', () => {
    const chain = parseCatalogChain([
      file('124.sql', "create function public.gcl(p_user UUID) returns setof record language sql as $$ select 1 $$;"),
      file('127.sql', "create or replace function public.gcl(p_user UUID, p_limit INT, p_before TIMESTAMPTZ) returns setof record language sql as $$ select 2 $$;"),
      file('128.sql', "create or replace function public.gcl(p_user uuid, p_limit integer, p_before timestamp with time zone) returns setof record language sql as $$ select 3 $$;"),
      file('129.sql', "DROP FUNCTION IF EXISTS public.gcl(uuid) CASCADE;"),
      file('130.sql', "create function h(a text) returns void language sql as $$ $$; create function h(a text, b text) returns void language sql as $$ $$; drop function h;"),
    ]);
    expect([...chain.byName.get('gcl')!].sort()).toEqual(['gcl(uuid)', 'gcl(uuid,integer,timestamp with time zone)']);
    expect(chain.functions.get('gcl(uuid)')!.state).toBe('dropped');
    expect(chain.functions.get('gcl(uuid,integer,timestamp with time zone)')).toMatchObject({ state: 'created', file: '128.sql', body: ' select 3 ' });
    expect(chain.functions.get('h(text)')!.state).toBe('dropped');
    expect(chain.functions.get('h(text,text)')!.state).toBe('dropped');
  });
  it('a pg_proc loop with proname literals is a dynamic site that drops / alters those names', () => {
    const chain = parseCatalogChain([
      file('001.sql', "create function a() returns void language sql as $$ $$; create function b(x int) returns void language sql as $$ $$;"),
      file('082.sql', "DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT p.oid, p.proname FROM pg_proc p WHERE p.proname IN ('a', 'b') LOOP EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = ''public''', r.proname, r.args); END LOOP; END $$;"),
      file('127.sql', "DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE proname = 'b' LOOP EXECUTE 'DROP FUNCTION ' || r.sig::text; END LOOP; END $$;"),
    ]);
    expect(chain.functions.get('a()')).toMatchObject({ state: 'created', searchPath: 'public' });
    expect(chain.functions.get('b(integer)')!.state).toBe('dropped');
    expect(chain.dynamic.map(d => [d.file, d.kind, d.names])).toEqual([['082.sql', 'alter function', ['a', 'b']], ['127.sql', 'drop function', ['b']]]);
  });
  it('ALTER FUNCTION patches config; RESET clears it; no parens = every overload', () => {
    const chain = parseCatalogChain([
      file('001.sql', "create function f(uuid) returns void language sql as $$ $$; create function f(uuid, text) returns void language sql as $$ $$;"),
      file('040.sql', "ALTER FUNCTION public.f(uuid) SET search_path = 'public'; ALTER FUNCTION f SECURITY DEFINER;"),
      file('041.sql', 'ALTER FUNCTION public.f(uuid, text) RESET search_path;'),
    ]);
    expect(chain.functions.get('f(uuid)')).toMatchObject({ searchPath: 'public', secdef: true });
    expect(chain.functions.get('f(uuid,text)')).toMatchObject({ searchPath: null, secdef: true });
  });
});

describe('parseCatalogChain — policies', () => {
  it('names, tables, defaults, TO, drop-then-create, drop-only, a foreign schema', () => {
    const chain = parseCatalogChain([
      file('001.sql', "CREATE POLICY \"Users can view their own profile\" ON profiles FOR SELECT USING (auth.uid() = id);\nCREATE POLICY \"Clubs are viewable\" \n ON clubs FOR SELECT \n TO authenticated \n USING (true);"),
      file('052.sql', "DROP POLICY IF EXISTS profiles_x ON profiles; CREATE POLICY profiles_x ON public.profiles\n  FOR SELECT USING (\n    public.has_profile_access(id, ARRAY['guardian','supervised','viewer'])\n  );"),
      file('040.sql', 'DROP POLICY IF EXISTS "Public Access" ON storage.objects; DROP POLICY IF EXISTS gone ON public.notifications;'),
      file('117.sql', 'DROP POLICY IF EXISTS "Clubs are viewable" ON clubs;'),
      file('190.sql', "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'posts' AND policyname = 'posts_guardian_write') THEN CREATE POLICY posts_guardian_write ON public.posts FOR ALL USING (has_profile_access(profile_id, ARRAY['guardian'::text])) WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text])); END IF; END $$;"),
    ]);
    expect(chain.policies.get('profiles|Users can view their own profile')).toMatchObject({ state: 'created', cmd: 'SELECT', roles: ['public'], permissive: 'PERMISSIVE', file: '001.sql', line: 1, using: 'auth.uid() = id' });
    expect(chain.policies.get('clubs|Clubs are viewable')).toMatchObject({ state: 'dropped', file: '117.sql' });
    expect(chain.policies.get('profiles|profiles_x')).toMatchObject({ state: 'created', cmd: 'SELECT', file: '052.sql' });
    expect(chain.policies.get('notifications|gone')).toMatchObject({ state: 'dropped', file: '040.sql' });
    expect(chain.policies.get('posts|posts_guardian_write')).toMatchObject({ state: 'created', cmd: 'ALL', check: "has_profile_access(profile_id, ARRAY['guardian'::text])" });
    expect(chain.foreignSchema).toEqual([{ file: '040.sql', line: 1, statement: 'drop policy', table: 'storage.objects' }]);
  });
  it('an EXECUTE format CREATE POLICY loop is a dynamic site with no names', () => {
    const chain = parseCatalogChain([file('052.sql', "DO $$ DECLARE t TEXT; BEGIN FOREACH t IN ARRAY ARRAY['a','b'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_s', t); EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (true)', t || '_s', t); END LOOP; END $$;")]);
    expect(chain.dynamic.map(d => [d.kind, d.names])).toEqual([['drop policy', []], ['create policy', []]]);
    expect(chain.policies.size).toBe(0);
  });
});

describe('diffCatalog', () => {
  const chain = parseCatalogChain([
    file('001.sql', [
      "create table t (id uuid);",
      "CREATE POLICY t_select ON t FOR SELECT USING (true);",
      "CREATE POLICY t_stale ON t FOR DELETE USING (true);",
      "CREATE POLICY t_cmd ON t FOR UPDATE USING (true);",
      "CREATE POLICY t_dropped ON t FOR INSERT WITH CHECK (true);",
      "DROP POLICY IF EXISTS t_dropped ON t;",
      "create function same() returns void language sql security definer set search_path = '' as $$ select 1 $$;",
      "create function ws() returns void language sql as $$ select 1 $$;",
      "create function drift() returns void language sql as $$ select 1 $$;",
      "create function cfg() returns void language sql set search_path = public as $$ select 1 $$;",
      "create function chainonly() returns void language sql as $$ select 1 $$;",
      "create function other(x int) returns void language sql as $$ select 1 $$;",
    ].join('\n')),
  ]);
  const fn = (name: string, arg_types: string, body: string, extra: Record<string, unknown> = {}) => ({
    name, arg_types, identity_args: arg_types, returns: 'void', kind: 'f', language: 'sql', volatility: 'v', secdef: false, config: null,
    body_md5: md5(body), body_md5_norm: md5(normalizeBody(body)), body_bytes: body.length, definition: `CREATE OR REPLACE FUNCTION public.${name}(${arg_types}) …`,
    acl: ['=X/postgres', 'postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres'], owner: 'postgres', ...extra,
  });
  const catalog = {
    rls: [{ table: 't', enabled: true, forced: false }],
    policies: [
      { table: 't', name: 't_select', permissive: 'PERMISSIVE', roles: ['public'], cmd: 'SELECT', qual: 'true', with_check: null },
      { table: 't', name: 't_cmd', permissive: 'PERMISSIVE', roles: ['public'], cmd: 'SELECT', qual: 'true', with_check: null },
      { table: 't', name: 't_dropped', permissive: 'PERMISSIVE', roles: ['public'], cmd: 'INSERT', qual: null, with_check: 'true' },
      { table: 't', name: 't_unowned', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'ALL', qual: 'true', with_check: 'true' },
    ],
    functions: [
      fn('same', '', ' select 1 ', { secdef: true, config: ['search_path=""'] }),
      fn('ws', '', ' select 1\n'),
      fn('drift', '', ' select 2 '),
      fn('cfg', '', ' select 1 ', { config: ['search_path=public, extensions'] }),
      fn('other', 'uuid', ' select 1 '),
      fn('unowned', 'text, integer', ' select 1 '),
    ],
    triggers: [{ table: 't', name: 'trg', enabled: 'O', definition: 'CREATE TRIGGER …' }],
  };
  const live = liveFromCatalog(catalog);

  it('classifies every drift class and stays silent on exact matches and whitespace', () => {
    const r = diffCatalog(live, chain);
    expect(r.ok).toBe(false);
    expect(r.unownedPolicies.map(p => [p.name, p.why.split(' (')[0]])).toEqual([['t_dropped', 'the chain last DROPs it'], ['t_unowned', 'no numbered file names it']]);
    expect(r.stalePolicyClaims.map(p => p.name)).toEqual(['t_stale']);
    expect(r.policyMismatch.map(p => [p.name, p.live.cmd, p.chain.cmd])).toEqual([['t_cmd', 'SELECT', 'UPDATE']]);
    expect(r.unownedFunctions.map(f => [f.key, f.hint])).toEqual([['other(uuid)', 'the chain defines other(integer) at 001.sql:12'], ['unowned(text,integer)', null]]);
    expect(r.bodyDrift.map(f => f.key)).toEqual(['drift()']);
    expect(r.whitespaceOnly.map(f => f.key)).toEqual(['ws()']);
    expect(r.configDrift.map(f => [f.key, f.diff[0].split(' ')[0]])).toEqual([['cfg()', 'search_path']]);
    expect(r.chainOnlyFunctions.map(f => f.key)).toEqual(['chainonly()', 'other(integer)']);
    expect(r.counts).toMatchObject({ livePolicies: 4, liveFunctions: 6, liveTriggers: 1, chainPolicies: 3, chainFunctions: 6 });
    const report = formatCatalogReport(r);
    expect(report).toContain('UNOWNED POLICIES (2)');
    expect(report).toContain('BODY DRIFT (1)');
    expect(report).toContain('DRIFT — see above.');
  });
  it('the allowlist documents by kind and goes stale when the object is owned or gone', () => {
    const allow = [
      { kind: 'policy', table: 't', name: 't_unowned', reason: 'r', ref: 'x' },
      { kind: 'policy', table: 't', name: 't_dropped', reason: 'r', ref: 'x' },
      { kind: 'policy', table: 't', name: 't_cmd', reason: 'r', ref: 'x' },
      { kind: 'function', name: 'unowned', args: 'TEXT, INT', reason: 'r', ref: 'x' },
      { kind: 'function', name: 'other', args: 'uuid', reason: 'r', ref: 'x' },
      { kind: 'function', name: 'drift', args: '', reason: 'r', ref: 'x' },
      { kind: 'function', name: 'cfg', args: '', reason: 'r', ref: 'x' },
      { kind: 'function', name: 'same', args: '', reason: 'r', ref: 'x' },
      { kind: 'policy', table: 't', name: 't_select', reason: 'r', ref: 'x' },
      { kind: 'function', name: 'gone', args: '', reason: 'r', ref: 'x' },
      { table: 't', column: 'id', reason: 'a column entry is not this diff\'s business', ref: 'x' },
    ];
    const r = diffCatalog(live, chain, allow);
    expect(r.unownedPolicies).toEqual([]);
    expect(r.policyMismatch).toEqual([]);
    expect(r.unownedFunctions).toEqual([]);
    expect(r.bodyDrift).toEqual([]);
    expect(r.configDrift).toEqual([]);
    expect(r.documented.length).toBe(7);
    expect(r.staleAllowlist.map(e => [e.kind, e.name, e.why])).toEqual([['policy', 't_select', 'owned now'], ['function', 'same', 'owned now'], ['function', 'gone', 'not live']]);
    expect(r.stalePolicyClaims.map(p => p.name)).toEqual(['t_stale']); // a stale claim is the chain's problem, never allowlisted away
    expect(r.ok).toBe(false);
  });
  it('a clean catalog is OK', () => {
    const clean = liveFromCatalog({
      rls: [{ table: 't', enabled: true }],
      policies: [{ table: 't', name: 't_select', permissive: 'PERMISSIVE', roles: ['public'], cmd: 'SELECT' }, { table: 't', name: 't_stale', permissive: 'PERMISSIVE', roles: ['public'], cmd: 'DELETE' }, { table: 't', name: 't_cmd', permissive: 'PERMISSIVE', roles: ['public'], cmd: 'UPDATE' }],
      functions: [fn('same', '', ' select 1 ', { secdef: true, config: ['search_path=""'] }), fn('ws', '', ' select 1\n'), fn('drift', '', ' select 1 '), fn('cfg', '', ' select 1 ', { config: ['search_path=public'] }), fn('chainonly', '', ' select 1 '), fn('other', 'integer', ' select 1 ')],
      triggers: [],
    });
    const r = diffCatalog(clean, chain);
    expect(r.ok).toBe(true);
    expect(r.whitespaceOnly.map(f => f.key)).toEqual(['ws()']);
    expect(formatCatalogReport(r)).toContain('OK — every live policy, function, trigger and grant is owned or documented.');
  });
});

describe('parseCatalogChain — triggers', () => {
  const grantees = (chain: ReturnType<typeof parseCatalogChain>, key: string) => [...(chain.grants.get(key) ?? [])].sort();
  it('reads timing, events, UPDATE OF, level, function and args; PROCEDURE ≡ FUNCTION; public. stripped', () => {
    const chain = parseCatalogChain([file('001.sql', [
      'CREATE TRIGGER t1 AFTER INSERT OR DELETE OR UPDATE OF status, b ON public.posts\n  FOR EACH ROW EXECUTE FUNCTION f();',
      "CREATE TRIGGER t2 BEFORE UPDATE ON posts FOR EACH ROW EXECUTE PROCEDURE public.g('post');",
      'CREATE TRIGGER t3 AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();',
    ].join('\n'))]);
    expect(chain.triggers.get('posts|t1')).toMatchObject({ state: 'created', timing: 'after', events: ['delete', 'insert', 'update'], updateOf: ['b', 'status'], level: 'row', fn: 'f', args: '', when: null, constraint: false, line: 1 });
    expect(chain.triggers.get('posts|t2')).toMatchObject({ timing: 'before', events: ['update'], fn: 'g', args: "'post'", line: 3 });
    expect(chain.foreignSchema).toEqual([{ file: '001.sql', line: 4, statement: 'create trigger', table: 'auth.users' }]);
    expect(triggerTuple(chain.triggers.get('posts|t2')!)).toBe(triggerTuple(parseTriggerStatement(...(() => { const d = "CREATE TRIGGER t2 BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION g('post')"; return [maskSql(d).masked, d] as const; })())!));
  });
  it('constraint triggers, WHEN spellings, drop-then-create, drop-only, CASCADE', () => {
    const chain = parseCatalogChain([
      file('048.sql', 'CREATE CONSTRAINT TRIGGER profile_access_last_guardian AFTER DELETE OR UPDATE OF role ON profile_access DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_last_guardian(); CREATE CONSTRAINT TRIGGER c2 AFTER INSERT ON t FOR EACH ROW EXECUTE FUNCTION h();'),
      file('008.sql', "CREATE TRIGGER trig_when AFTER INSERT ON post_tags FOR EACH ROW\n  WHEN (NEW.status = 'active')\n  EXECUTE FUNCTION notify_profile_tagged();"),
      file('025.sql', 'DROP TRIGGER IF EXISTS trig_when ON post_tags CASCADE; DROP TRIGGER IF EXISTS gone ON posts; CREATE TRIGGER trig_when AFTER INSERT ON post_tags FOR EACH ROW WHEN (NEW.status = \'active\') EXECUTE FUNCTION notify_profile_tagged();'),
    ]);
    expect(chain.triggers.get('profile_access|profile_access_last_guardian')).toMatchObject({ constraint: true, deferrable: true, initially: 'deferred', events: ['delete', 'update'], updateOf: ['role'] });
    expect(chain.triggers.get('t|c2')).toMatchObject({ constraint: true, deferrable: false, initially: 'immediate' });
    expect(chain.triggers.get('post_tags|trig_when')).toMatchObject({ state: 'created', file: '025.sql', when: "NEW.status = 'active'" });
    expect(chain.triggers.get('posts|gone')).toMatchObject({ state: 'dropped', file: '025.sql' });
    const liveDef = "CREATE TRIGGER trig_when AFTER INSERT ON public.post_tags FOR EACH ROW WHEN ((new.status = 'active'::text)) EXECUTE FUNCTION notify_profile_tagged()";
    expect(triggerTuple(parseTriggerStatement(maskSql(liveDef).masked, liveDef)!)).toBe(triggerTuple(chain.triggers.get('post_tags|trig_when')!));
    const changed = "CREATE TRIGGER trig_when AFTER INSERT ON public.post_tags FOR EACH ROW WHEN ((new.status = 'pending'::text)) EXECUTE FUNCTION notify_profile_tagged()";
    expect(triggerTuple(parseTriggerStatement(maskSql(changed).masked, changed)!)).not.toBe(triggerTuple(chain.triggers.get('post_tags|trig_when')!));
  });
  it("EXECUTE '…' literals are parsed as statements: the 014 single-line and the 003 next-line shapes, with '' unescaped and lines mapped", () => {
    const sql = [
      'DO $$',
      'BEGIN',
      "  IF EXISTS (SELECT 1) THEN",
      "    EXECUTE 'CREATE TRIGGER trigger_notify_post_like AFTER INSERT ON post_likes FOR EACH ROW EXECUTE FUNCTION notify_post_like()';",
      "    EXECUTE '",
      "      CREATE FUNCTION nf()",
      "      RETURNS TRIGGER AS $func$ BEGIN RETURN NEW; END; $func$ LANGUAGE plpgsql;",
      "      ';",
      "    EXECUTE '",
      "      CREATE TRIGGER t_next AFTER INSERT ON post_comments FOR EACH ROW WHEN (NEW.content = ''x'') EXECUTE FUNCTION nf();",
      "      ';",
      "    EXECUTE 'DROP FUNCTION ' || r.sig::text;",
      "  END IF;",
      'END $$;',
    ].join('\n');
    const chain = parseCatalogChain([file('003.sql', sql)]);
    expect(chain.triggers.get('post_likes|trigger_notify_post_like')).toMatchObject({ state: 'created', line: 4 });
    expect(chain.functions.get('nf()')).toMatchObject({ state: 'created', body: ' BEGIN RETURN NEW; END; ', line: 6 });
    expect(chain.triggers.get('post_comments|t_next')).toMatchObject({ state: 'created', when: "NEW.content = 'x'", line: 10 });
    expect(chain.dynamic.map(d => d.kind)).toEqual(['drop function']);
  });
  it('grants: the default on a fresh CREATE; REVOKE / GRANT / ALL; DROP + CREATE resets; OR REPLACE keeps; a REVOKE before the first CREATE means the function existed', () => {
    const chain = parseCatalogChain([
      file('001.sql', 'create function f(a int) returns void language sql as $$ $$; create function g() returns void language sql as $$ $$; create function h() returns void language sql as $$ $$;'),
      file('040.sql', 'REVOKE EXECUTE ON FUNCTION public.f(integer) FROM PUBLIC, anon, authenticated; REVOKE ALL ON FUNCTION g() FROM PUBLIC; GRANT EXECUTE ON FUNCTION g() TO authenticated, anon; REVOKE EXECUTE ON FUNCTION pre() FROM PUBLIC, anon, authenticated;'),
      file('050.sql', 'DROP FUNCTION IF EXISTS h(); create function h() returns void language sql as $$ $$; create or replace function f(a INT) returns void language sql as $$ $$; CREATE OR REPLACE FUNCTION public.pre() RETURNS void LANGUAGE sql AS $$ $$;'),
    ]);
    expect(grantees(chain, 'f(integer)')).toEqual(['service_role']);
    expect(grantees(chain, 'g()')).toEqual(['anon', 'authenticated', 'service_role']);
    expect(grantees(chain, 'h()')).toEqual([...DEFAULT_GRANTEES].sort());
    expect(grantees(chain, 'pre()')).toEqual(['service_role']);
  });
  it('grants: the 040 FOREACH ARRAY loop and the 085 proname loop resolve names and roles; 052-style policy loops stay unresolved', () => {
    const chain = parseCatalogChain([
      file('001.sql', 'create function a() returns void language sql as $$ $$; create function b(x uuid) returns void language sql as $$ $$; create function b(x uuid, y text) returns void language sql as $$ $$;'),
      file('040.sql', "DO $$ DECLARE fn text; BEGIN FOREACH fn IN ARRAY ARRAY['a', 'never_created'] LOOP BEGIN EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated', fn); EXCEPTION WHEN undefined_function THEN RAISE NOTICE 'skip %', fn; END; END LOOP; END $$;"),
      file('085.sql', "DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p WHERE p.proname IN ('b') LOOP EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args); END LOOP; END $$;"),
      file('052.sql', "DO $$ DECLARE t TEXT; BEGIN FOREACH t IN ARRAY ARRAY['p','q'] LOOP EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (true)', t || '_s', t); END LOOP; END $$;"),
    ]);
    expect(grantees(chain, 'a()')).toEqual(['service_role']);
    expect(grantees(chain, 'never_created()')).toEqual(['service_role']); // seeded by %I(): the function existed live
    expect(grantees(chain, 'b(uuid)')).toEqual(['service_role']);
    expect(grantees(chain, 'b(uuid,text)')).toEqual(['service_role']);
    expect(chain.dynamic.map(d => [d.file, d.kind, d.names])).toEqual([['040.sql', 'revoke', ['a', 'never_created']], ['085.sql', 'revoke', ['b']], ['052.sql', 'create policy', []]]);
  });
});

describe('diffCatalog — triggers and grants', () => {
  const chain = parseCatalogChain([file('001.sql', [
    'create table t (id uuid);',
    'create function f() returns trigger language plpgsql security definer as $$ begin return new; end $$;',
    'create function g() returns void language sql as $$ select 1 $$;',
    'REVOKE EXECUTE ON FUNCTION g() FROM PUBLIC, anon, authenticated;',
    'CREATE TRIGGER owned AFTER INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();',
    'CREATE TRIGGER drifted AFTER INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();',
    'CREATE TRIGGER stale AFTER DELETE ON t FOR EACH ROW EXECUTE FUNCTION f();',
    'CREATE TRIGGER dropped AFTER DELETE ON t FOR EACH ROW EXECUTE FUNCTION f(); DROP TRIGGER IF EXISTS dropped ON t;',
  ].join('\n'))]);
  const fn = (name: string, body: string, extra: Record<string, unknown> = {}) => ({
    name, arg_types: '', identity_args: '', returns: 'void', kind: 'f', language: 'sql', volatility: 'v', secdef: false, config: null,
    body_md5: md5(body), body_md5_norm: md5(normalizeBody(body)), body_bytes: body.length, definition: '', acl: null, owner: 'postgres', ...extra,
  });
  const trg = (name: string, def: string) => ({ table: 't', name, enabled: 'O', definition: def });
  const live = liveFromCatalog({
    rls: [{ table: 't', enabled: true }],
    policies: [],
    functions: [
      fn('f', ' begin return new; end ', { secdef: true, returns: 'trigger', language: 'plpgsql', acl: ['=X/postgres', 'postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres'] }),
      fn('g', ' select 1 ', { acl: ['postgres=X/postgres', 'service_role=X/postgres', 'anon=X/postgres'] }),
    ],
    triggers: [
      trg('owned', 'CREATE TRIGGER owned AFTER INSERT ON public.t FOR EACH ROW EXECUTE FUNCTION f()'),
      trg('drifted', 'CREATE TRIGGER drifted BEFORE INSERT ON public.t FOR EACH ROW EXECUTE FUNCTION f()'),
      trg('dropped', 'CREATE TRIGGER dropped AFTER DELETE ON public.t FOR EACH ROW EXECUTE FUNCTION f()'),
      trg('unowned', 'CREATE TRIGGER unowned AFTER DELETE ON public.t FOR EACH ROW EXECUTE FUNCTION f()'),
    ],
  });
  it('classifies unowned, stale, drifted triggers and a grant drift; reports the advisory', () => {
    const r = diffCatalog(live, chain);
    expect(r.unownedTriggers.map(t => [t.name, t.why.split(' (')[0]])).toEqual([['dropped', 'the chain last DROPs it'], ['unowned', 'no numbered file creates it']]);
    expect(r.staleTriggerClaims.map(t => t.name)).toEqual(['stale']);
    expect(r.triggerDrift.map(t => t.key)).toEqual(['t|drifted']);
    expect(r.grantDrift).toEqual([{ key: 'g()', at: '001.sql:3', chain: ['service_role'], live: ['anon', 'service_role'] }]);
    expect(r.secdefPublic.map(s => s.key)).toEqual(['f()']);
    expect(r.counts).toMatchObject({ liveTriggers: 4, chainTriggers: 3, liveGrants: 2 });
    expect(r.ok).toBe(false);
    const report = formatCatalogReport(r);
    expect(report).toContain('UNOWNED TRIGGERS (2)');
    expect(report).toContain('GRANT DRIFT (1)');
    expect(report).toContain('SECURITY DEFINER functions executable by an API role');
  });
  it('trigger and grant allowlist entries document, and go stale when owned or gone', () => {
    const allow = [
      { kind: 'trigger', table: 't', name: 'unowned', reason: 'r', ref: 'x' },
      { kind: 'trigger', table: 't', name: 'dropped', reason: 'r', ref: 'x' },
      { kind: 'trigger', table: 't', name: 'drifted', reason: 'r', ref: 'x' },
      { kind: 'trigger', table: 't', name: 'owned', reason: 'r', ref: 'x' },
      { kind: 'trigger', table: 't', name: 'never', reason: 'r', ref: 'x' },
      { kind: 'grant', name: 'g', args: '', reason: 'r', ref: 'x' },
      { kind: 'grant', name: 'f', args: '', reason: 'r', ref: 'x' },
    ];
    const r = diffCatalog(live, chain, allow);
    expect(r.unownedTriggers).toEqual([]);
    expect(r.triggerDrift).toEqual([]);
    expect(r.grantDrift).toEqual([]);
    expect(r.documented.length).toBe(4);
    expect(r.staleAllowlist.map(e => [e.kind, e.name, e.why])).toEqual([['trigger', 'owned', 'owned now'], ['trigger', 'never', 'not live'], ['grant', 'f', 'owned now']]);
    expect(r.staleTriggerClaims.map(t => t.name)).toEqual(['stale']);
  });
  it('acl → grantees: the owner removed, the empty grantee is public, a null acl is the public default', () => {
    const l = liveFromCatalog({ rls: [], policies: [], triggers: [], functions: [fn('a', ' ', { acl: ['postgres=X/postgres', 'service_role=X/postgres'] }), fn('b', ' ', { acl: null }), fn('c', ' ', { acl: ['=X/postgres', 'postgres=X/postgres'] })] });
    expect(l.functions.map(f => f.grantees)).toEqual([['service_role'], ['public'], ['public']]);
  });
});

describe('the real chain', () => {
  const dir = join(process.cwd(), 'database', 'migrations');
  const files = readdirSync(dir)
    .filter(n => /^\d{3}_.*\.sql$/.test(n))
    .sort()
    .map(name => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
  const chain = parseCatalogChain(files);

  it('reads every function with a body, the two overloads, the dynamic drops and the 052 loops', () => {
    expect(chain.functions.size).toBeGreaterThan(100);
    for (const f of chain.functions.values()) if (f.state === 'created') expect(f.body, f.name).toBeTruthy();
    expect(chain.functions.get('bump_site_hit(uuid,date,text,text)')).toMatchObject({ state: 'created', file: '188_org_site_analytics.sql', secdef: true, searchPath: 'public' });
    expect(chain.functions.get('bump_site_hit(uuid,date,text,text)')!.body).toContain('ON CONFLICT DO NOTHING');
    expect(chain.functions.get('bump_site_hit(uuid,date,text,text)')!.bodyMd5).toMatch(/^[0-9a-f]{32}$/);
    // The two real overloads.
    expect(chain.functions.get('get_conversation_list(uuid)')!.state).toBe('dropped'); // 127's pg_proc loop
    expect(chain.functions.get('get_conversation_list(uuid,integer,timestamp with time zone)')).toMatchObject({ state: 'created', file: '131_first_contact_hold.sql' });
    expect(chain.functions.get('search_people(text,uuid[],boolean,integer,boolean,uuid)')!.state).toBe('dropped'); // 108 drops the 7-arg
    expect(chain.functions.get('search_people(text,uuid[],boolean,integer,boolean,uuid,text,text,double precision,double precision,double precision)')).toMatchObject({ state: 'created', file: '108_profiles_clubs_places.sql' });
    // 193 copied split_full_name verbatim from pg_get_functiondef: comments are body.
    expect(chain.functions.get('split_full_name()')).toMatchObject({ state: 'created', file: '193_profiles_measurables.sql', searchPath: '' });
    expect(chain.functions.get('split_full_name()')!.body).toContain('-- Only process');
    expect(chain.functions.get('notify_post_like()')).toMatchObject({ state: 'created', file: '190_baseline_social_core.sql' });
    // 197 re-declares the drifted bodies verbatim and pins the one config-only drift.
    expect(chain.functions.get('handle_new_user()')).toMatchObject({ state: 'created', file: '197_baseline_functions.sql', secdef: true, searchPath: '' });
    expect(chain.functions.get('is_valid_handle(text)')).toMatchObject({ file: '006_handles_system.sql', searchPath: '' });
    // 082's loop re-pins search_path on two names.
    expect(chain.functions.get('get_tagged_posts(uuid,uuid,integer,integer)')).toMatchObject({ searchPath: 'public' });
    const dyn = chain.dynamic.map(d => `${d.file.slice(0, 3)}:${d.kind}${d.names.length ? ':' + d.names.join(',') : ''}`);
    expect(dyn).toContain('052:create policy');
    expect(dyn.some(d => d.startsWith('003:'))).toBe(false); // 003's EXECUTE '…' literals are parsed now
    expect(dyn).toContain('040:revoke:update_equipment_updated_at,update_conversation_on_message,handle_new_user,notify_comment_like,notify_follow_accepted,notify_follow_declined,notify_follow_request,notify_new_follower,notify_post_comment,notify_post_like,notify_profile_tagged,update_post_comments_count,update_post_likes_count');
    expect(dyn).toContain('127:drop function:get_conversation_list');
    expect(dyn).toContain('082:alter function:get_unread_notification_count,get_tagged_posts');
    const foreign = chain.foreignSchema.map(s => `${s.file.slice(0, 3)}:${s.statement}:${s.table}`);
    expect(foreign.filter(f => f.includes('storage.objects'))).toEqual(['040:drop policy:storage.objects', '040:drop policy:storage.objects', '040:drop policy:storage.objects']);
    expect(foreign).toContain('001:create trigger:auth.users'); // on_auth_user_created — the auth schema is Supabase's
  });
  it('reads every trigger claim and simulates every grant set', () => {
    const g = (key: string) => [...(chain.grants.get(key) ?? [])].sort();
    expect(chain.triggers.get('post_likes|trigger_update_post_likes_count')).toMatchObject({ state: 'created', file: '190_baseline_social_core.sql' });
    expect(chain.triggers.get('post_likes|update_post_likes_count_trigger')).toMatchObject({ state: 'dropped', file: '199_cleanup.sql' }); // 190 recorded the twin, 199 dropped it
    expect(chain.triggers.get('post_comments|update_post_comments_count_trigger')).toMatchObject({ state: 'dropped', file: '199_cleanup.sql' });
    expect(chain.triggers.get('athlete_badges|handle_updated_at_athlete_badges')).toMatchObject({ state: 'dropped', file: '199_cleanup.sql' }); // DROP TABLE takes the triggers
    expect(chain.triggers.get('post_likes|trigger_notify_post_like')).toMatchObject({ state: 'created', file: '190_baseline_social_core.sql' });
    expect(chain.triggers.get('posts|trigger_notify_profile_tagged')).toMatchObject({ state: 'dropped', file: '025_fix_tag_notification_trigger.sql' });
    expect(chain.triggers.get('profiles|profiles_search_vector_trigger')).toMatchObject({ state: 'dropped', file: '108_profiles_clubs_places.sql' });
    expect(chain.triggers.get('profile_access|profile_access_last_guardian')).toMatchObject({ constraint: true, deferrable: true, initially: 'deferred', updateOf: ['role'] });
    expect(chain.triggers.get('posts|posts_search_doc_delete')).toMatchObject({ fn: 'search_document_delete', args: "'post'" });
    expect(chain.triggers.get('group_posts|trigger_group_posts_updated_at')).toMatchObject({ state: 'dropped', file: '199_cleanup.sql' }); // 198 recorded it, 199 dropped the duplicate
    for (const k of ['handle_updated_at()', 'update_post_reposts_count()', 'consent_records_forbid_mutation()', 'notify_post_comment()']) expect(g(k), k).toEqual(['service_role']); // 199's revokes
    expect(g('notify_post_like()')).toEqual(['service_role']); // 014 create → 040's FOREACH revoke → 190 OR REPLACE keeps
    expect(g('notify_comment_like()')).toEqual(['service_role']); // existed before the chain: 040 revoked it, 190 OR REPLACEd it
    expect(g('bump_site_hit(uuid,date,text,text)')).toEqual(['service_role']);
    expect(g('decrement_post_save_count()')).toEqual(['anon', 'authenticated', 'public', 'service_role']); // 197's explicit re-grant
    expect(chain.functions.get('mark_all_notifications_read()')).toMatchObject({ state: 'dropped', file: '199_cleanup.sql' });
    expect(chain.functions.get('mark_all_notifications_read(uuid)')).toMatchObject({ state: 'dropped', file: '199_cleanup.sql' });
  });
  it('reads every policy claim: 196 records the drop of 001\'s profile family and makes 052\'s loop products literal', () => {
    const created = [...chain.policies.values()].filter(p => p.state === 'created');
    expect(created.length).toBeGreaterThan(170); // 172 live after 199 (+ the two athlete_clubs claims on a table that is not live)
    expect(chain.policies.get('profiles|Users can view their own profile')).toMatchObject({ state: 'dropped', file: '196_baseline_policies.sql' });
    expect(chain.policies.get('profiles|profiles_select_policy')).toMatchObject({ state: 'created', file: '196_baseline_policies.sql', cmd: 'SELECT' });
    expect(chain.policies.get('clubs|Clubs are viewable by authenticated users')).toMatchObject({ state: 'dropped', file: '117_clubs_real.sql' });
    expect(chain.policies.get('posts|posts_guardian_write')).toMatchObject({ state: 'created', file: '190_baseline_social_core.sql', cmd: 'ALL' });
    expect(chain.policies.get('golf_rounds|golf_rounds_profile_access_select')).toMatchObject({ state: 'created', file: '196_baseline_policies.sql', cmd: 'SELECT' });
    // 199: the fold and the drops.
    expect(chain.policies.get('golf_participant_scores|golf_scores_update_policy')).toMatchObject({ state: 'created', file: '199_cleanup.sql', cmd: 'UPDATE' });
    expect(chain.policies.get('golf_participant_scores|golf_scores_update_policy')!.using).toContain('creator_id');
    expect(chain.policies.get('golf_participant_scores|participant_scores_update_policy')).toMatchObject({ state: 'dropped', file: '199_cleanup.sql' });
    expect(chain.policies.get('golf_hole_scores|hole_scores_select_policy')!.state).toBe('created');
    // 200: the creator may UPDATE hole scores, as INSERT and DELETE always allowed.
    expect(chain.policies.get('golf_hole_scores|hole_scores_update_policy')).toMatchObject({ state: 'created', file: '200_hole_scores_creator_update.sql', cmd: 'UPDATE' });
    expect(chain.policies.get('golf_hole_scores|hole_scores_update_policy')!.using).toContain('creator_id');
    expect(chain.policies.get('athlete_badges|athlete_badges_select_policy')).toMatchObject({ state: 'dropped', file: '199_cleanup.sql' }); // DROP TABLE takes the policies
  });
  it('a saved catalog, when one exists, parses and agrees with the verbatim 190 functions', () => {
    const dumps = join(process.cwd(), 'database', 'provenance', 'dumps');
    const saved = readdirSync(dumps).filter(n => /-catalog\.json$/.test(n)).sort().pop();
    if (!saved) return;
    const live = liveFromCatalog(JSON.parse(readFileSync(join(dumps, saved), 'utf8')));
    expect(live.functions.length).toBeGreaterThan(50);
    expect(live.functions.some(f => f.name === 'unaccent')).toBe(false);
    const r = diffCatalog(live, chain);
    for (const name of ['update_follows_updated_at()', 'posts_search_vector_update()', 'notify_post_like()', 'notify_comment_like()']) {
      expect(r.bodyDrift.map(f => f.key), name).not.toContain(name);
    }
    // The simulated grantee sets agree with proacl for every chain-defined function — except, while the
    // saved catalog predates a REVOKE the chain has made since (199's four trigger functions), those keys.
    const revokedBy199 = ['handle_updated_at()', 'update_post_reposts_count()', 'consent_records_forbid_mutation()', 'notify_post_comment()'];
    expect(r.grantDrift.map(g => g.key).filter(k => !revokedBy199.includes(k))).toEqual([]);
    expect(r.triggerDrift).toEqual([]);
    // A trigger the chain added AFTER the saved catalog is not stale, it is
    // newer: 229's follows_counts_sync (Round 3). Save a fresh catalog once
    // 229 has run on prod (`npm run check:schema:prod -- --save-catalog`) and
    // drop this entry.
    const newerThanCatalog = ['follows|follows_counts_sync'];
    expect(r.staleTriggerClaims.map(c => `${c.table}|${c.name}`).filter(k => !newerThanCatalog.includes(k))).toEqual([]);
    expect(r.secdefPublic.map(s => s.key)).toContain('is_conversation_participant(uuid,uuid)');
  });
});

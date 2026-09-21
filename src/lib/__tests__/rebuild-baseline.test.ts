import { describe, expect, it } from 'vitest';
import { buildRebuildSql, emitConstraints, emitPolicies, emitSeedRows, emitTables } from '../../../scripts/rebuild-baseline-core.mjs';
import { parseChain } from '../../../scripts/schema-inventory-core.mjs';

// Round 2 — the rebuild baseline generator over a fixture in schema_dump()'s
// shape (migration 227). Pinned: the emission ORDER (a blank database's
// dependency order), the guards, the column forms (identity, generated,
// default, NOT NULL), the policy forms (INSERT has no USING), the ledger
// seed bounded by the dump's head, the cron jobs commented with the source
// host scrubbed — and that the provenance parser reads the output back
// (the CLI's self-check against the live inventory rests on that).

const dump = {
  meta: { version: 1, generated_at: '2026-09-21T00:00:00Z', server_version: '17.4', ledger: { head: 227, rows: 226 } },
  extensions: [{ name: 'pg_trgm', schema: 'extensions', version: '1.6' }, { name: 'pg_cron', schema: 'pg_catalog', version: '1.6' }],
  types: [{ name: 'mood', labels: ['sad', 'ok', 'happy'] }],
  sequences: [
    { name: 'legacy_id_seq', data_type: 'bigint', start: 1, increment: 1, min: 1, max: 9223372036854775807, cycle: false, owned_by: 'legacy.id', identity: false, grants: { anon: false, authenticated: true, service_role: true } },
    { name: 'tickets_number_seq', data_type: 'bigint', start: 1000, increment: 1, min: 1, max: 9223372036854775807, cycle: false, owned_by: 'tickets.number', identity: true, grants: { anon: false, authenticated: false, service_role: true } },
  ],
  tables: [
    { name: 'tickets', kind: 'r', rls: true, rls_forced: false, comment: 'Support tickets', columns: [
      { name: 'id', type: 'uuid', not_null: true, default: 'gen_random_uuid()', identity: '', generated: '', comment: null },
      { name: 'number', type: 'bigint', not_null: true, default: null, identity: 'a', generated: '', comment: 'EA-####' },
      { name: 'subject', type: 'text', not_null: true, default: null, identity: '', generated: '', comment: null },
      { name: 'subject_lower', type: 'text', not_null: false, default: 'lower(subject)', identity: '', generated: 's', comment: null },
      { name: 'mood', type: 'mood', not_null: false, default: "'ok'::mood", identity: '', generated: '', comment: null },
    ], grants: { service_role: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] } },
    { name: 'legacy', kind: 'r', rls: false, rls_forced: false, comment: null, columns: [
      { name: 'id', type: 'bigint', not_null: true, default: "nextval('legacy_id_seq'::regclass)", identity: '', generated: '', comment: null },
      { name: 'ticket_id', type: 'uuid', not_null: false, default: null, identity: '', generated: '', comment: null },
    ], grants: { anon: ['SELECT'], authenticated: ['SELECT'], service_role: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] } },
    { name: 'schema_migrations', kind: 'r', rls: true, rls_forced: false, comment: null, columns: [
      { name: 'number', type: 'integer', not_null: true, default: null, identity: '', generated: '', comment: null },
      { name: 'name', type: 'text', not_null: true, default: null, identity: '', generated: '', comment: null },
      { name: 'applied_at', type: 'timestamp with time zone', not_null: true, default: 'now()', identity: '', generated: '', comment: null },
      { name: 'applied_by', type: 'text', not_null: true, default: "'sql-editor'::text", identity: '', generated: '', comment: null },
    ], grants: {} },
  ],
  constraints: [
    { table: 'legacy', name: 'legacy_ticket_id_fkey', type: 'f', definition: 'FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL', index: null },
    { table: 'legacy', name: 'legacy_pkey', type: 'p', definition: 'PRIMARY KEY (id)', index: 'legacy_pkey' },
    { table: 'tickets', name: 'tickets_pkey', type: 'p', definition: 'PRIMARY KEY (id)', index: 'tickets_pkey' },
    { table: 'tickets', name: 'tickets_number_key', type: 'u', definition: 'UNIQUE (number)', index: 'tickets_number_key' },
    { table: 'tickets', name: 'tickets_subject_check', type: 'c', definition: "CHECK ((length(subject) < 200))", index: null },
    { table: 'schema_migrations', name: 'schema_migrations_pkey', type: 'p', definition: 'PRIMARY KEY (number)', index: 'schema_migrations_pkey' },
  ],
  indexes: [
    { table: 'tickets', name: 'tickets_pkey', definition: 'CREATE UNIQUE INDEX tickets_pkey ON public.tickets USING btree (id)', constraint: true },
    { table: 'tickets', name: 'idx_tickets_subject_lower', definition: 'CREATE INDEX idx_tickets_subject_lower ON public.tickets USING btree (subject_lower)', constraint: false },
  ],
  views: [{ name: 'open_tickets', materialized: false, definition: ' SELECT tickets.id\n   FROM tickets;', grants: { authenticated: ['SELECT'] } }],
  functions: [
    { name: 'ticket_count', identity_args: '', kind: 'f', language: 'sql', definition: "CREATE OR REPLACE FUNCTION public.ticket_count()\n RETURNS bigint\n LANGUAGE sql\n STABLE\nAS $function$ select count(*) from public.tickets $function$\n", grants: { anon: false, authenticated: true, service_role: true }, comment: 'How many' },
    { name: 'touch', identity_args: '', kind: 'f', language: 'plpgsql', definition: 'CREATE OR REPLACE FUNCTION public.touch()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$ begin new.subject := new.subject; return new; end $function$\n', grants: { anon: true, authenticated: true, service_role: true }, comment: null },
  ],
  triggers: [
    { schema: 'public', table: 'tickets', name: 'touch_tickets', enabled: 'O', definition: 'CREATE TRIGGER touch_tickets BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION touch()' },
    { schema: 'auth', table: 'users', name: 'on_auth_user_created', enabled: 'O', definition: 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION touch()' },
  ],
  policies: [
    { schema: 'public', table: 'tickets', name: 'tickets_read_own', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'SELECT', qual: '(id = (select auth.uid()))', with_check: null },
    { schema: 'public', table: 'tickets', name: 'tickets_insert_own', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'INSERT', qual: null, with_check: '(id = (select auth.uid()))' },
    { schema: 'storage', table: 'objects', name: 'uploads_public_read', permissive: 'PERMISSIVE', roles: ['public'], cmd: 'SELECT', qual: "(bucket_id = 'uploads'::text)", with_check: null },
  ],
  publications: [{ publication: 'supabase_realtime', table: 'tickets' }],
  storage_buckets: [{ id: 'uploads', name: 'uploads', public: true, file_size_limit: null, allowed_mime_types: null }],
  cron_jobs: [{ name: 'calendar-reminders', schedule: '*/10 * * * *', active: true, command: "select net.http_get(url := 'https://edge-athlete.vercel.app/api/cron/reminders', headers := jsonb_build_object('Authorization', 'Bearer __CRON_SECRET__'))" }],
  seed_rows: { reserved_handles: [{ handle: 'admin', reason: "System's path", reserved_at: '2026-01-01T00:00:00+00:00' }] },
};
const chainFiles = ['001_a.sql', '226_ledger.sql', '227_dump.sql', '228_future.sql'];

describe('buildRebuildSql', () => {
  const sql = buildRebuildSql(dump, { chainFiles, sourceHost: 'edge-athlete.vercel.app' });
  const at = (s: string) => {
    const i = sql.indexOf(s);
    expect(i, `missing: ${s}`).toBeGreaterThan(-1);
    return i;
  };

  it('emits in dependency order for a blank database', () => {
    const order = [
      'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;',
      'CREATE TYPE public.mood AS ENUM',
      'CREATE SEQUENCE IF NOT EXISTS public.legacy_id_seq',
      'CREATE TABLE IF NOT EXISTS public.tickets (',
      'ALTER SEQUENCE public.legacy_id_seq OWNED BY public.legacy.id;',
      'ADD CONSTRAINT tickets_pkey PRIMARY KEY (id)',
      'ADD CONSTRAINT legacy_ticket_id_fkey FOREIGN KEY',
      'CREATE INDEX IF NOT EXISTS idx_tickets_subject_lower',
      'CREATE OR REPLACE VIEW public.open_tickets AS',
      'CREATE OR REPLACE FUNCTION public.ticket_count()',
      'CREATE TRIGGER touch_tickets',
      'ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;',
      'CREATE POLICY tickets_read_own ON public.tickets',
      'GRANT SELECT ON TABLE public.legacy TO anon;',
      'GRANT USAGE ON SEQUENCE public.legacy_id_seq TO authenticated, service_role;',
      'GRANT EXECUTE ON FUNCTION public.ticket_count() TO authenticated, service_role;',
      "COMMENT ON TABLE public.tickets IS 'Support tickets';",
      'INSERT INTO storage.buckets',
      'ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;',
      'INSERT INTO public.reserved_handles (handle, reason, reserved_at) VALUES',
      "(227, '227_dump.sql', 'rebuild-000')",
      "-- SELECT cron.schedule('calendar-reminders'",
      "SELECT '000 REBUILT' AS result",
    ];
    let last = -1;
    for (const s of order) {
      const i = at(s);
      expect(i, `${s} is out of order`).toBeGreaterThan(last);
      last = i;
    }
    expect(sql.startsWith('-- ====')).toBe(true);
    expect(sql).toContain('SET check_function_bodies = off;');
  });

  it('writes every column form', () => {
    expect(sql).toContain('  id uuid DEFAULT gen_random_uuid() NOT NULL');
    expect(sql).toContain('  number bigint GENERATED ALWAYS AS IDENTITY NOT NULL');
    expect(sql).toContain('  subject_lower text GENERATED ALWAYS AS (lower(subject)) STORED');
    expect(sql).toContain("  mood mood DEFAULT 'ok'::mood");
    expect(sql).toContain("  applied_by text DEFAULT 'sql-editor'::text NOT NULL");
  });

  it('never creates an identity sequence itself, and skips a constraint-owned index', () => {
    expect(sql).not.toContain('CREATE SEQUENCE IF NOT EXISTS public.tickets_number_seq');
    expect(sql).not.toContain('CREATE UNIQUE INDEX IF NOT EXISTS tickets_pkey');
  });

  it('policies: INSERT has WITH CHECK only, storage.objects is schema-qualified, public role stays bare', () => {
    expect(sql).toContain('CREATE POLICY tickets_insert_own ON public.tickets\n  AS PERMISSIVE\n  FOR INSERT\n  TO authenticated\n  WITH CHECK ((id = (select auth.uid())));');
    expect(sql).toContain('DROP POLICY IF EXISTS uploads_public_read ON storage.objects;');
    expect(sql).toContain('TO public\n  USING ((bucket_id = \'uploads\'::text));');
  });

  it('triggers on auth.users are carried; the ledger seed stops at the head; the cron host is scrubbed', () => {
    expect(sql).toContain('DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;');
    expect(sql).toContain("(226, '226_ledger.sql', 'rebuild-000')");
    expect(sql).not.toContain('228_future.sql');
    expect(sql).toContain('__APP_URL__/api/cron/reminders');
    expect(sql).not.toContain('edge-athlete.vercel.app/api/cron');
    expect(sql).toContain("Bearer __CRON_SECRET__");
  });

  it('is readable by the provenance parser — the self-check rests on it', () => {
    const parsed = parseChain([{ name: '000_rebuild.sql', sql }]);
    expect([...parsed.tables.keys()].sort()).toEqual(['legacy', 'schema_migrations', 'tickets']);
    expect([...parsed.tables.get('tickets')!].sort()).toEqual(['id', 'mood', 'number', 'subject', 'subject_lower']);
    expect(parsed.functions.has('ticket_count')).toBe(true);
    expect(parsed.views.has('open_tickets')).toBe(true);
  });

  it('a dump without the ledger table says so instead of inserting into nothing', () => {
    const noLedger = { ...dump, tables: dump.tables.filter(t => t.name !== 'schema_migrations'), meta: { ...dump.meta, ledger: null } };
    const s = buildRebuildSql(noLedger, { chainFiles });
    expect(s).toContain('the source had no schema_migrations table');
    expect(s).not.toContain("'rebuild-000'");
  });
});

describe('the small emitters', () => {
  it('constraints: trigger constraints (type t) are never emitted', () => {
    expect(emitConstraints([{ table: 'x', name: 'y', type: 't', definition: 'TRIGGER' }], { foreign: false })).toBe('');
  });
  it('tables: a quoted identifier survives', () => {
    expect(emitTables([{ name: 'Odd Name', columns: [{ name: 'select', type: 'text', not_null: false, default: null, identity: '', generated: '' }] }])).toContain('"Odd Name" (\n  "select" text');
  });
  it('seed rows quote strings, pass numbers and booleans, jsonb objects as text', () => {
    const s = emitSeedRows({ t: [{ a: "it's", b: 2, c: true, d: null, e: { k: 1 } }] });
    expect(s).toContain("('it''s', 2, true, NULL, '{\"k\":1}'::jsonb)");
  });
  it('policies default to ALL / public when the dump is sparse', () => {
    expect(emitPolicies([{ table: 't', name: 'p' }])).toContain('FOR ALL\n  TO public;');
  });
});

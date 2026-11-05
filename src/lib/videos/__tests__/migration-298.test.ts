import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/** Videos Phase 3 (298): the YouTube connection, pinned at the SQL. */
describe('migration 298 — the YouTube connection', () => {
  const sql = read('database/migrations/298_youtube_connections.sql');

  it('one table, a profile XOR an org, the connector, the channel, the scopes, the sealed secret, the status words', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.youtube_connections (');
    expect(sql).toContain('CONSTRAINT youtube_connections_one_owner_check CHECK (num_nonnulls(profile_id, org_id) = 1)');
    expect(sql).toContain('connected_by_user_id uuid NOT NULL');
    expect(sql).toContain("scopes text[] NOT NULL DEFAULT '{}'::text[]");
    expect(sql).toContain("status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'error'))");
    expect(sql).toContain("CONSTRAINT youtube_connections_secret_check CHECK (status <> 'active' OR secret_ciphertext IS NOT NULL)");
  });

  it('one connection per owner; every foreign key named, cascading from its parent, with its own index', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS youtube_connections_profile_uidx ON public.youtube_connections (profile_id) WHERE profile_id IS NOT NULL;');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS youtube_connections_org_uidx ON public.youtube_connections (org_id) WHERE org_id IS NOT NULL;');
    for (const [col, table] of [['profile_id', 'profiles'], ['org_id', 'organizations'], ['connected_by_user_id', 'profiles']] as const) {
      expect(sql).toContain(`ADD CONSTRAINT youtube_connections_${col}_fkey FOREIGN KEY (${col}) REFERENCES public.${table}(id) ON DELETE CASCADE;`);
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS youtube_connections_${col}_idx ON public.youtube_connections (${col});`);
    }
  });

  it('posture A with the service_role grant, the updated_at trigger, the ledger footer and the result row', () => {
    expect(sql).toContain('ALTER TABLE public.youtube_connections ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('REVOKE ALL ON TABLE public.youtube_connections FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT ALL ON TABLE public.youtube_connections TO service_role;');
    expect(sql).toContain('CREATE TRIGGER youtube_connections_updated_at BEFORE UPDATE ON public.youtube_connections FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();');
    expect(sql).toContain("INSERT INTO public.schema_migrations (number, name) VALUES (298, '298_youtube_connections.sql') ON CONFLICT (number) DO NOTHING;");
    expect(sql).toContain("SELECT '298 APPLIED' AS result");
    expect(sql).toContain("IF n < 297 THEN RAISE EXCEPTION '298 pre-flight: ledger head is %, expected 297', n; END IF;");
  });

  it('both profile keys are classified as going with the person, and deleted with the account', () => {
    const departure = read('src/lib/account-departure.ts');
    const deletion = read('src/lib/account-deletion.ts');
    expect(departure).toContain("'youtube_connections.profile_id': 'goes',");
    expect(departure).toContain("'youtube_connections.connected_by_user_id': 'goes',");
    expect(deletion).toContain("mustDelete('youtube_connections', 'profile_id')");
    expect(deletion).toContain("mustDelete('youtube_connections', 'connected_by_user_id')");
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Supabase, Oct 30 2026: a NEW table in `public` gets no Data API grants unless
// its migration grants them (existing tables keep theirs). From migration 270
// on, every CREATE TABLE ships its grants in the SAME file — posture A
// (service_role only) or a policy table (anon / authenticated as the policies
// allow, plus service_role). The server always needs service_role. History
// before 270 is not rewritten; the two newest files are the fixtures that show
// the rule is the right one (267 passes, 266 would not).

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'database', 'migrations');
export const GRANT_RULE_FROM = 270;

const strip = (sql: string) => sql.replace(/--[^\n]*/g, '');
const ident = (s: string) => s.replace(/^"|"$/g, '').toLowerCase();

export function auditMigrationGrants(sql: string): string[] {
  const src = strip(sql);
  const problems: string[] = [];
  const tables = [...src.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?("?[a-z_][a-z0-9_]*"?)\s*\(/gi)].map(m => ident(m[1]));
  for (const t of tables) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const granted = (role: string) => new RegExp(`GRANT\\s+[^;]*?\\bON\\s+(?:TABLE\\s+)?(?:public\\.)?"?${esc}"?\\s+TO\\s+[^;]*\\b${role}\\b`, 'i').test(src);
    const revokedApi = new RegExp(`REVOKE\\s+[^;]*?\\bON\\s+(?:TABLE\\s+)?(?:public\\.)?"?${esc}"?\\s+FROM\\s+[^;]*\\b(anon|authenticated)\\b`, 'i').test(src);
    if (!granted('service_role')) {
      problems.push(revokedApi
        ? `${t}: revoked from anon/authenticated and never granted to service_role — unreachable after Oct 30 2026`
        : `${t}: no GRANT in the file — Supabase no longer grants a new table automatically (Oct 30 2026)`);
    }
    // A policy declared for a role the file never grants cannot be used by that role.
    const policies = [...src.matchAll(new RegExp(`CREATE\\s+POLICY\\s+[^;]*?\\bON\\s+(?:public\\.)?"?${esc}"?\\b([^;]*);`, 'gi'))];
    for (const pm of policies) {
      const body = pm[1];
      const to = body.match(/\bTO\s+([a-z_,\s]+?)(?:\s+USING|\s+WITH|\s*$)/i)?.[1] ?? 'public';
      const roles = to.toLowerCase().includes('public') ? ['anon', 'authenticated'] : to.toLowerCase().split(',').map(r => r.trim()).filter(r => r === 'anon' || r === 'authenticated');
      for (const r of roles) if (!granted(r)) problems.push(`${t}: a policy names ${r} but the file never grants ${r} on it`);
    }
  }
  return problems;
}

const numberOf = (f: string) => Number(f.match(/^(\d+)_/)?.[1] ?? NaN);

describe('every new table ships its Data API grants (Supabase, Oct 30 2026)', () => {
  const files = fs.readdirSync(DIR).filter(f => /^\d+_.*\.sql$/.test(f));
  it('from migration 270 on, a CREATE TABLE without its grants fails the gate', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (numberOf(f) < GRANT_RULE_FROM) continue;
      for (const p of auditMigrationGrants(fs.readFileSync(path.join(DIR, f), 'utf8'))) offenders.push(`${f}: ${p}`);
    }
    expect(offenders).toEqual([]);
  });
  it('the rule is the right one: 267 (posture A per table) passes it, 266 (RLS on, no grant) would not', () => {
    expect(auditMigrationGrants(fs.readFileSync(path.join(DIR, '267_platform_stats.sql'), 'utf8'))).toEqual([]);
    const m266 = auditMigrationGrants(fs.readFileSync(path.join(DIR, '266_contacts.sql'), 'utf8'));
    expect(m266.map(p => p.split(':')[0]).sort()).toEqual(['app_settings', 'contacts']);
    expect(m266[0]).toMatch(/no GRANT in the file/);
    // The older shape: revoked and never granted.
    expect(auditMigrationGrants("CREATE TABLE public.t (id int);\nREVOKE ALL ON TABLE public.t FROM anon, authenticated;")).toEqual([
      't: revoked from anon/authenticated and never granted to service_role — unreachable after Oct 30 2026',
    ]);
    // A policy table: anon's policy with no anon grant is caught; granted, it passes.
    const policyTable = "CREATE TABLE public.p (id int);\nCREATE POLICY read ON public.p FOR SELECT TO anon USING (true);\nGRANT ALL ON TABLE public.p TO service_role;";
    expect(auditMigrationGrants(policyTable)).toEqual(['p: a policy names anon but the file never grants anon on it']);
    expect(auditMigrationGrants(policyTable + "\nGRANT SELECT ON TABLE public.p TO anon;")).toEqual([]);
  });
  it('the baseline still emits every table\'s grants, so a rebuild after Oct 30 is complete', () => {
    const core = fs.readFileSync(path.join(ROOT, 'scripts/rebuild-baseline-core.mjs'), 'utf8');
    expect(core).toMatch(/export function emitTableGrants\(tables\)/);
    const baseline = fs.readFileSync(path.join(ROOT, 'database/baseline/000_rebuild.sql'), 'utf8');
    for (const t of ['contacts', 'platform_jobs', 'profiles', 'posts']) {
      expect(baseline, t).toMatch(new RegExp(`GRANT [^;]*ON TABLE public\\.${t} TO service_role;`));
    }
    expect(baseline).toMatch(/GRANT [^;]*ON TABLE public\.posts TO authenticated;/);
  });
});

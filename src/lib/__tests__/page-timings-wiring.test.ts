import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Real-user page timings by build (migration 305; performance program Phase 0.4,
 * Nov 2026): the beacon on every app page, the one writer with its IP bucket
 * and its beacon posture, the admin card's reader, the daily prune — and
 * that nothing about a person travels. page-timings-rules.test.ts pins the rules;
 * this pins the wiring.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('page timings — the wiring', () => {
  it('the app layout mounts the beacon once; the beacon sends only the allowed fields through sendBeacon', () => {
    expect(read('src/app/(app)/layout.tsx').match(/<PageTimingBeacon \/>/g)).toHaveLength(1);
    const beacon = read('src/components/observability/PageTimingBeacon.tsx');
    expect(beacon).toContain("JSON.stringify({ build, route: maskRoute(pathRef.current ?? '/'), device: deviceClass(window.innerWidth), navigation, metrics })");
    expect(beacon).toContain("navigator.sendBeacon('/api/page-timings'");
    expect(beacon).not.toMatch(/userAgent|user\.id|email|cookie/);
  });
  it('the writer answers 204 whatever happens, spends the page-timings IP bucket, and tolerates the table being absent', () => {
    const route = read('src/app/api/page-timings/route.ts');
    expect(route).toContain("new NextResponse(null, { status: 204, headers: NO_STORE })");
    expect(route).toContain("enforceRateLimit(request, 'page-timings')");
    expect(route).toContain("error.code !== '42P01' && error.code !== 'PGRST205'");
    expect(route).toContain(".from('page_timings').insert(rows)");
    expect(read('src/lib/rate-limit-core.ts')).toMatch(/'page-timings': \{ max: 60, windowSeconds: 60, keyBy: 'ip' \}/);
  });
  it('the reader is behind the console gate; the console mounts the card; the daily cron prunes', () => {
    expect(read('src/app/api/admin/page-timings/route.ts')).toMatch(/await requireAdmin\(request\);\s*const summary = await readPageTimingsSummary/);
    expect(read('src/app/(admin)/admin/(console)/page.tsx')).toContain('<PageTimingsPanel />');
    const cron = read('src/app/api/cron/daily/route.ts');
    expect(cron).toContain('summary.pageTimings = await runPageTimingsPrune(admin);');
  });
  it('migration 305 is posture A with the grants and the ledger footer, and records no person', () => {
    const sql = read('database/migrations/305_page_timings.sql');
    expect(sql).toContain('ALTER TABLE public.page_timings ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('REVOKE ALL ON TABLE public.page_timings FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT ALL ON TABLE public.page_timings TO service_role;');
    expect(sql).toContain("INSERT INTO public.schema_migrations (number, name) VALUES (305, '305_page_timings.sql')");
    expect(sql).not.toMatch(/user_id|profile_id|ip\b|user_agent/);
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Scale fix 5 (Oct 25 2026, docs/SCALE_AUDIT.md hole 5): the cheer totals are
// ONE grouped RPC (`live_cheer_totals`, migration 275), never six head counts
// — and never the rows (the 5,000-row cap trap of Sep 29 2026).
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('Cheers: the totals are one grouped query', () => {
  const server = read('src/lib/play/cheers-server.ts');
  it('readCheerFeed calls live_cheer_totals once and never counts per key', () => {
    expect(server).toMatch(/admin\.rpc\('live_cheer_totals', \{ p_context_key: contextKey \}\)/);
    expect(server).not.toMatch(/CHEER_KEYS\.map\([^)]*count: 'exact'/);
    expect(server).not.toMatch(/from\('live_cheers'\)\.select\('id', \{ count: 'exact'/);
  });
  it('the recent list stays capped (rows never leave uncapped)', () => {
    expect(server).toMatch(/const RECENT_CAP = 50;/);
    expect(server).toMatch(/\.limit\(RECENT_CAP\)/);
  });
  it('migration 275 is service_role-only, INVOKER, search_path pinned, and groups by cheer', () => {
    const m = read('database/migrations/275_live_cheer_totals.sql');
    expect(m).toMatch(/CREATE OR REPLACE FUNCTION public\.live_cheer_totals\(p_context_key text\)/);
    expect(m).toMatch(/SECURITY INVOKER/);
    expect(m).toMatch(/SET search_path = public/);
    expect(m).toMatch(/GROUP BY c\.cheer/);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.live_cheer_totals\(text\) FROM PUBLIC, anon, authenticated;/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.live_cheer_totals\(text\) TO service_role;/);
    expect(m).toMatch(/VALUES \(275, '275_live_cheer_totals\.sql'\)/);
  });
});

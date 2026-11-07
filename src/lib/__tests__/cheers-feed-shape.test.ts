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
});

// Scale round 2 (Nov 7 2026, hole 5's second half): a PUBLIC round's read is
// one CDN copy — the payload has no viewer field, so the only thing that
// split it per watcher was the client's `since`. The window is the server's
// (30 s, every reader alike), the client dedupes by id, and the gate reads
// the roster alone (the scores embed fed a value nothing used).
describe('Cheers: a public round is one CDN copy', () => {
  const server = read('src/lib/play/cheers-server.ts');
  const route = read('src/app/api/live/cheers/route.ts');
  const hook = read('src/hooks/useCheers.ts');
  it('the gate says whether anyone may watch, by the same rule a stranger is judged by', () => {
    expect(server).toContain('publicView: boolean;');
    expect(server).toContain('publicView: canViewSharedRound({ viewerId: null, ...round })');
    expect(server).toMatch(/resolveSportEventAccess\(\{\s*event: \{[^}]+\},\s*viewerId: null,\s*presentedToken: null,\s*participant: null,/);
  });
  it('the recent window is the server\'s 30 s; no `since` reaches the query', () => {
    expect(server).toContain('export const RECENT_WINDOW_MS = 30_000;');
    expect(server).toContain('export async function readCheerFeed(admin: Admin, contextKey: string): Promise<CheerFeed>');
    expect(server).toMatch(/\.gt\('created_at', windowStart\)/);
    expect(route).not.toContain("searchParams.get('since')");
    expect(hook).not.toMatch(/q\.set\('since'/);
    expect(hook).toContain('const seen = useRef(new Map<string, number>());');
  });
  it('the route splits the header on the gate: a public round is cacheable, everything else no-store', () => {
    expect(route).toContain("const PUBLIC_ROUND = { 'Cache-Control': 'public, max-age=5, s-maxage=10' };");
    expect(route).toContain("const PRIVATE = { 'Cache-Control': 'private, no-store' };");
    expect(route).toContain('headers: gate.publicView ? PUBLIC_ROUND : PRIVATE');
    expect(route).toMatch(/status: 404, headers: PRIVATE/);
    expect(route).toMatch(/status: 201, headers: PRIVATE/);
    // The POST spends its bucket WITH write-general in one trip (hole 8).
    expect(route).toContain("getServerAuth(request, { limit: 'cheer' })");
  });
  it('the gate reads the roster only — no scores embed', () => {
    expect(server).toContain("admin.from('group_post_participants').select('profile_id').eq('group_post_id', ctx.id)");
    expect(server).not.toContain('golf_participant_scores(updated_at)');
    expect(server).not.toContain('last_score_activity_at');
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

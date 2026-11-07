import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// SCALE_AUDIT hole 6's leftovers (Nov 6 2026, the improvements round PR 4):
// PostgREST cuts an unbounded read at 1,000 rows silently. Every read of
// `follows` in a route or a server module is therefore BOUNDED — a single
// row, an id list it was given, a limit, a count, or a page — and the three
// that used to ship the viewer's whole follow list back out as a filter now
// join it in SQL (migration 303: live_now_participants, search_people_for).
const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
};
const BOUNDED = /\.limit\(|\.in\(|\.maybeSingle\(|\.single\(|\.range\(|count: 'exact'|\.delete\(|\.insert\(|\.update\(|\.upsert\(/;

describe("every read of `follows` is bounded", () => {
  const files = [...walk(path.join(ROOT, 'src/app/api')), ...walk(path.join(ROOT, 'src/lib'))];
  it('finds the reads (the regex is live)', () => {
    expect(read('src/app/api/suggestions/route.ts')).toMatch(/\.from\('follows'\)/);
  });
  it('no read of follows runs without a limit, an id list, a single row, a count or a page', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = read(path.relative(ROOT, f));
      let from = 0;
      for (;;) {
        const i = code.indexOf(".from('follows')", from);
        if (i === -1) break;
        // The chain: from `.from('follows')` to the first `;` (or `,` ending a Promise.all member).
        const end = (() => { const semi = code.indexOf(';', i); const j = code.indexOf('\n        ]', i); return j !== -1 && j < semi ? j : semi; })();
        let chain = code.slice(i, end === -1 ? i + 400 : end);
        // A builder (`let q = admin.from('follows')…;` then `q.range(…)`): the bound sits on the variable, within the function.
        const builder = /(?:let|const)\s+(\w+)\s*=\s*[^;]*$/.exec(code.slice(Math.max(0, i - 120), i));
        if (builder) chain += code.slice(end, end + 1500).split(new RegExp(`\\b${builder[1]}\\b`)).slice(1).join(' ');
        if (!BOUNDED.test(chain)) offenders.push(`${path.relative(ROOT, f)}:${code.slice(0, i).split('\n').length}`);
        from = i + 1;
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('migration 303: the follows join in SQL', () => {
  const sql = read('database/migrations/303_follows_bounded.sql');
  it('live_now_participants: the viewer + accepted followees, newest first, a capped limit', () => {
    expect(sql).toMatch(/WHERE gpp\.profile_id = p_viewer\s+OR gpp\.profile_id IN \(\s+SELECT f\.following_id\s+FROM public\.follows f\s+WHERE f\.follower_id = p_viewer AND f\.status = 'accepted'\s+LIMIT 2000/);
    expect(sql).toMatch(/LIMIT GREATEST\(1, LEAST\(COALESCE\(p_limit, 100\), 500\)\)/);
  });
  it("search_people_for: 'following' = follows I made, otherwise either direction, both capped at 2000, handed to search_people", () => {
    expect(sql).toMatch(/WHEN p_direction = 'following' THEN ARRAY\(\s+SELECT f\.following_id\s+FROM public\.follows f\s+WHERE f\.follower_id = p_viewer AND f\.status = 'accepted' AND f\.following_id <> p_viewer\s+LIMIT 2000/);
    expect(sql).toMatch(/f\.status = 'accepted' AND \(f\.follower_id = p_viewer OR f\.following_id = p_viewer\)\s+LIMIT 2000/);
    expect(sql).toMatch(/FROM public\.search_people\(/);
  });
  it('STABLE invoker, service_role only, the ledger row and the result row', () => {
    expect(sql.match(/LANGUAGE sql STABLE SECURITY INVOKER/g)?.length).toBe(2);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.live_now_participants\(uuid, int\) TO service_role;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.search_people_for\([^)]+\) TO service_role;/);
    expect(sql).toMatch(/VALUES \(303, '303_follows_bounded\.sql'\)/);
    expect(sql).toMatch(/functions_expect_2/);
  });
  it('the routes use them: live-now reads one RPC; mentions and invite search pass the viewer, not a list', () => {
    const liveNow = read('src/app/api/golf/live-now/route.ts');
    expect(liveNow).toContain(".rpc('live_now_participants', { p_viewer: viewer.id, p_limit: 100 })");
    expect(liveNow).not.toContain(".from('follows')");
    expect(read('src/app/api/mentions/search/route.ts')).toContain("viewer: { id: user.id, direction: 'following' }");
    expect(read('src/app/api/calendar/invite-search/route.ts')).toContain("viewer: { id: user.id, direction: 'either' }");
    const server = read('src/lib/search/people-server.ts');
    expect(server).toContain("await admin.rpc('search_people_for', {");
    expect(server).toContain("visibleIds = await accessibleProfileIds(viewer.id, viewer.direction);"); // the pre-303 fallback
  });
});

describe("304: search_people_for answers 'following' and 'either' only", () => {
  it('any other direction sees nobody private, never everybody', () => {
    const h = read('database/migrations/304_harden_round.sql');
    expect(h).toMatch(/WHEN p_direction = 'following' THEN ARRAY\(/);
    expect(h).toMatch(/WHEN p_direction = 'either' THEN ARRAY\(/);
    expect(h).toMatch(/ELSE NULL::uuid\[\]/);
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Scale fix 4 (Oct 25 2026, docs/SCALE_AUDIT.md hole 4; Convention 32
// amended): the TRIGGER recounts a cached counter inside the write's own
// statement — 015 for posts.likes_count, 095 for posts.comments_count
// (published only), 252 for post_comments.likes_count. A route READS the
// column after its write; it never counts the rows again and never writes
// the column itself. Two counts + two writes per like became one of each.
const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// `via` (282, trip-count PR 3): the route reads the column THROUGH one RPC —
// the function's body is where the read must be (and no count, no write).
const ROUTES: Array<{ file: string; table: string; column: string; via?: { rpc: string; migration: string } }> = [
  { file: 'src/app/api/posts/like/route.ts', table: 'post_likes', column: 'likes_count', via: { rpc: 'post_like_toggle', migration: 'database/migrations/287_post_like_allowed.sql' } },
  { file: 'src/app/api/comments/like/route.ts', table: 'comment_likes', column: 'likes_count', via: { rpc: 'comment_like_toggle', migration: 'database/migrations/288_comment_like_toggle.sql' } },
  { file: 'src/app/api/comments/route.ts', table: 'post_comments', column: 'comments_count' },
];

describe('Counters: the trigger recounts, the route reads', () => {
  for (const { file, table, column, via } of ROUTES) {
    it(`${file} never recounts ${table} nor writes ${column}`, () => {
      const code = read(file);
      // A `.from('<table>').select(…, { count: 'exact', head: true })` is a recount.
      const recount = new RegExp(`from\\('${table}'\\)\\s*\\.select\\([^)]*count:\\s*'exact'[^)]*head:\\s*true`);
      expect(code).not.toMatch(recount);
      expect(code).not.toMatch(new RegExp(`\\.update\\(\\{\\s*${column}`));
      if (via) {
        // …the one RPC reads the trigger-written column back; the route touches no table itself.
        expect(code.match(new RegExp(`\\.rpc\\('${via.rpc}'`, 'g'))?.length).toBe(1);
        expect(code).not.toMatch(/\.from\('/);
        const fn = read(via.migration);
        expect(fn).toMatch(new RegExp(`SELECT COALESCE\\(${column}, 0\\) INTO v_count FROM public\\.(posts|post_comments)`));
        expect(fn).not.toMatch(new RegExp(`count\\(\\*\\)\\s+FROM\\s+public\\.${table}`, 'i'));
        expect(fn).not.toMatch(new RegExp(`SET ${column}`));
      } else {
        // …and it does read the trigger-written column back.
        expect(code).toMatch(new RegExp(`\\.select\\('${column}'\\)`));
      }
    });
  }
  it('the delete still asks for its own row count (a no-op is a 404, not a recount)', () => {
    expect(read('src/app/api/comments/route.ts')).toMatch(/\.delete\(\{ count: 'exact' \}\)/);
  });
  // Part b (277, Oct 26 2026): the triggers add or subtract ONE; the nightly
  // recount is the accuracy rule.
  it('migration 277 makes the four trigger bodies ±1 and keeps the recount in counters_recount()', () => {
    const m = read('database/migrations/277_counter_triggers_plus_minus.sql');
    const body = (name: string) => {
      const i = m.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      expect(i).toBeGreaterThan(-1);
      return m.slice(i, m.indexOf('$$;', i));
    };
    for (const fn of ['update_post_likes_count', 'update_post_comments_count', 'increment_comment_likes_count', 'decrement_comment_likes_count']) {
      const b = body(fn);
      expect(b).not.toMatch(/count\(\*\)/i);
      expect(b).toMatch(/\+ 1|- 1, 0\)/);
      expect(b).toMatch(/SET search_path = ''/);
    }
    expect(body('update_post_comments_count')).toMatch(/OLD\.status = 'published'/);
    expect(body('counters_recount')).toMatch(/count\(\*\)/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.counters_recount\(\) TO service_role;/);
    expect(m).toMatch(/VALUES \(277, '277_counter_triggers_plus_minus\.sql'\)/);
  });
  it('the daily cron runs the recount step through the one server module', () => {
    expect(read('src/app/api/cron/daily/route.ts')).toMatch(/runCounterRecount\(admin\)/);
    expect(read('src/lib/counters/recount-server.ts')).toMatch(/admin\.rpc\('counters_recount'\)/);
  });
  it('the three recount triggers exist in the baseline', () => {
    const base = read('database/baseline/000_rebuild.sql');
    expect(base).toMatch(/CREATE TRIGGER trigger_update_post_likes_count AFTER INSERT OR DELETE ON public\.post_likes/);
    expect(base).toMatch(/CREATE TRIGGER trigger_update_post_comments_count AFTER INSERT OR DELETE OR UPDATE OF status ON public\.post_comments/);
    expect(base).toMatch(/CREATE TRIGGER trigger_increment_comment_likes_count AFTER INSERT ON public\.comment_likes/);
    expect(base).toMatch(/CREATE TRIGGER trigger_decrement_comment_likes_count AFTER DELETE ON public\.comment_likes/);
  });
});

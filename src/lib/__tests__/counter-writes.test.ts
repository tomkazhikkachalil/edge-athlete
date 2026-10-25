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

const ROUTES: Array<{ file: string; table: string; column: string }> = [
  { file: 'src/app/api/posts/like/route.ts', table: 'post_likes', column: 'likes_count' },
  { file: 'src/app/api/comments/like/route.ts', table: 'comment_likes', column: 'likes_count' },
  { file: 'src/app/api/comments/route.ts', table: 'post_comments', column: 'comments_count' },
];

describe('Counters: the trigger recounts, the route reads', () => {
  for (const { file, table, column } of ROUTES) {
    it(`${file} never recounts ${table} nor writes ${column}`, () => {
      const code = read(file);
      // A `.from('<table>').select(…, { count: 'exact', head: true })` is a recount.
      const recount = new RegExp(`from\\('${table}'\\)\\s*\\.select\\([^)]*count:\\s*'exact'[^)]*head:\\s*true`);
      expect(code).not.toMatch(recount);
      expect(code).not.toMatch(new RegExp(`\\.update\\(\\{\\s*${column}`));
      // …and it does read the trigger-written column back.
      expect(code).toMatch(new RegExp(`\\.select\\('${column}'\\)`));
    });
  }
  it('the delete still asks for its own row count (a no-op is a 404, not a recount)', () => {
    expect(read('src/app/api/comments/route.ts')).toMatch(/\.delete\(\{ count: 'exact' \}\)/);
  });
  it('the three recount triggers exist in the baseline', () => {
    const base = read('database/baseline/000_rebuild.sql');
    expect(base).toMatch(/CREATE TRIGGER trigger_update_post_likes_count AFTER INSERT OR DELETE ON public\.post_likes/);
    expect(base).toMatch(/CREATE TRIGGER trigger_update_post_comments_count AFTER INSERT OR DELETE OR UPDATE OF status ON public\.post_comments/);
    expect(base).toMatch(/CREATE TRIGGER trigger_increment_comment_likes_count AFTER INSERT ON public\.comment_likes/);
    expect(base).toMatch(/CREATE TRIGGER trigger_decrement_comment_likes_count AFTER DELETE ON public\.comment_likes/);
  });
});

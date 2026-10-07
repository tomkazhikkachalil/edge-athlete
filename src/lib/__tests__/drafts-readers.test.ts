import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLISH_REFUSALS } from '../posts/publish-server';

// Drafts round PR 1 (253, Oct 6 2026). Tom: a golf round started and
// abandoned partway showed up on the feed and the profile. Finish and Post
// are two actions now: a round's feed post is born a DRAFT and becomes a
// post only when its owner posts it. 'draft' is a post STATUS, so every
// published-only reader skips it for free — and, the lesson of 241 / #1039,
// the OWNER arms must exclude it by name. These pins hold the arms.

const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('a draft is a status every list skips — the owner arms too', () => {
  it('the feed: neither arm hands a draft back to its owner', () => {
    const src = code('src/app/api/posts/route.ts');
    expect(src).toMatch(/status\.eq\.published,and\(profile_id\.eq\.\$\{currentUserId\},status\.neq\.draft\)/);
    expect(src).toMatch(/status\.eq\.published,and\(profile_id\.eq\.\$\{currentUserId\},status\.not\.in\.\(profile_hidden,draft\)\)/);
  });
  it('the JavaScript round filter is gone — status is the one rule', () => {
    const src = code('src/app/api/posts/route.ts');
    expect(src).not.toMatch(/effectiveRoundStatus/);
    expect(src).not.toMatch(/sport_event_round_id\) return true/);
  });
  it('the single-post gate opens a draft to the round\'s players and nobody else', () => {
    const src = code('src/app/api/posts/route.ts');
    expect(src).toMatch(/!\(post\.status === 'draft' && \(await viewerIsParticipant\(\)\)\)/);
  });
  it('the five profile RPCs exclude a draft from the owner\'s own tiles (253, verbatim re-declarations)', () => {
    const sql = read('database/migrations/253_drafts.sql');
    const names = ['get_profile_tagged_media', 'get_profile_stats_media', 'get_profile_statements_media', 'get_profile_all_media', 'get_profile_media_counts'];
    for (const n of names) expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${n}\\(`));
    expect(sql.match(/CREATE OR REPLACE FUNCTION public\.get_profile_/g)?.length).toBe(5);
    // Every owner arm carries the exclusion: 1 + 1 + 1 + 1 + 4 (counts has four subqueries).
    expect(sql.match(/OR \(viewer_id IS NOT NULL AND viewer_id = p\.profile_id AND p\.status <> 'draft'\)\)/g)?.length).toBe(8);
    // And no owner arm was left behind.
    expect(sql.match(/OR \(viewer_id IS NOT NULL AND viewer_id = p\.profile_id\)\)/g)).toBeNull();
    expect(sql).toMatch(/posts_status_check[\s\S]*'draft'/);
  });
});

describe('a round is born a draft; nothing auto-posts; one writer publishes', () => {
  it('the round\'s feed post is inserted as a draft', () => {
    const src = code('src/app/api/group-posts/route.ts');
    expect(src).toMatch(/\.from\('posts'\)\s*\.insert\(\{\s*profile_id: actorId,[\s\S]*?status: 'draft',/);
  });
  it('completion no longer re-dates the post — posting does', () => {
    expect(code('src/lib/golf/round-status.ts')).not.toMatch(/created_at: new Date\(\)/);
    expect(code('src/app/api/group-posts/[id]/route.ts')).not.toMatch(/created_at: new Date\(\)/);
    const writer = code('src/lib/posts/publish-server.ts');
    expect(writer).toMatch(/\.update\(\{ status: 'published', created_at: now \}\)[\s\S]*?\.eq\('status', 'draft'\)/);
  });
  it('publish-server.ts is the only place that writes draft → published', () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) return d.name === 'node_modules' || d.name === '__tests__' ? [] : walk(p);
      return /\.(ts|tsx)$/.test(d.name) ? [p] : [];
    });
    const writers = walk(path.join(ROOT, 'src')).filter(f => {
      const src = code(path.relative(ROOT, f));
      // The site builder has its own draft / published vocabulary (org_site_revisions) — posts only.
      return /\.from\('posts'\)/.test(src) && /status: 'published'/.test(src) && /'draft'/.test(src);
    });
    expect(writers.map(f => path.relative(ROOT, f)).sort()).toEqual(['src/lib/posts/publish-server.ts']);
  });
  it('the door is PATCH /api/posts action post, behind the owner / write_content gate', () => {
    const src = code('src/app/api/posts/route.ts');
    expect(src).toMatch(/\['pin', 'unpin', 'approve', 'reject', 'request_changes', 'post'\]\.includes\(action\)/);
    const gateIdx = src.indexOf("if (!(await sessionMayManagePostContent(user.id, post.profile_id))) {\n      return NextResponse.json({ error: action === 'post'");
    const postIdx = src.indexOf("if (action === 'post') {");
    expect(gateIdx).toBeGreaterThan(0);
    expect(postIdx).toBeGreaterThan(gateIdx);
  });
  it('the refusals say why, in the owner\'s words', () => {
    expect(PUBLISH_REFUSALS.round_not_finished.status).toBe(409);
    expect(PUBLISH_REFUSALS.not_a_draft.status).toBe(409);
    expect(PUBLISH_REFUSALS.not_found.status).toBe(404);
  });
  it('the card: a draft has no like / comment / share / save row and sends no view beacon', () => {
    const card = code('src/components/PostCard.tsx');
    expect(card).toMatch(/\{showActions && !isDraft && \(/);
    expect(card).toMatch(/enabled: !actingAs && !isDraft && currentUserId !== post\.profile\.id/);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/**
 * Videos program (296) — the doors and the player, pinned at the source:
 * the Create sheet's fifth door, the composer's "too long" hint naming the
 * same door, the player built from the link helper and never a script, and
 * the pages that must stay reachable.
 */
describe('the Videos program\'s doors', () => {
  it('the Create sheet has the Full game door and the header opens /videos/new', () => {
    const sheet = read('src/components/CreateSheet.tsx');
    expect(sheet).toContain('data-create-full-game=""');
    expect(sheet).toContain('fa-film');
    expect(sheet).toContain('onFullGame');
    // The four doors before it are untouched.
    for (const hook of ['data-create-post', 'data-create-sport', 'data-create-event', 'data-create-record-activity']) expect(sheet).toContain(hook);
    expect(read('src/components/AppHeader.tsx')).toContain("onFullGame={() => { setIsCreateOpen(false); router.push('/videos/new'); }}");
  });

  it('the composer keeps its "Too long" tile line byte-identical and names the full-game door in the footer hint', () => {
    const composer = read('src/components/CreatePostModal.tsx');
    expect(composer).toContain('Too long — trim in the editor');
    expect(composer).toContain('data-full-game-link=""');
    expect(composer).toContain('href="/videos/new"');
    expect(composer).toContain("'Add a caption or media to post'");
  });

  it('the Create menu spec lists five doors', () => {
    const spec = read('docs/specs/ui-conventions.md');
    expect(spec).toContain('Five doors in this order');
    expect(spec).toContain('`data-create-full-game`');
  });
});

describe('the player', () => {
  const player = read('src/components/videos/YouTubePlayer.tsx');
  it('is an iframe built by the link helper, never a script and never a raw <video>', () => {
    expect(player).toContain('<iframe');
    expect(player).toContain("from '@/lib/videos/youtube'");
    expect(player).toContain('embedSrcAt(');
    expect(player).not.toMatch(/<script/);
    expect(player).not.toMatch(/iframe_api/);
    expect(player).not.toMatch(/<video[\s>]/);
  });
  it('remounts on a highlight (key = playKey) and offers the watch page', () => {
    expect(player).toContain('key={playKey}');
    expect(player).toContain('watchUrl(videoId)');
    expect(player).toContain('open it on YouTube');
  });
  it('the embed host is the CSP\'s (one list)', () => {
    expect(read('src/lib/videos/youtube.ts')).toContain('EMBED_FRAME_HOSTS[0]');
  });
});

describe('the pages', () => {
  it('/videos/[id] and /videos/new exist, the detail page is a server shell over a client screen, the new page never auto-focuses', () => {
    const detail = read('src/app/(app)/videos/[id]/page.tsx');
    expect(detail).not.toMatch(/^'use client'/);
    expect(detail).toContain('<AppHeader />');
    expect(detail).toContain('<VideoScreen videoId={id} />');
    const flow = read('src/components/videos/NewVideoFlow.tsx');
    expect(flow).not.toMatch(/autoFocus/);
    expect(flow).toContain("fetch('/api/videos'");
    expect(read('src/app/(app)/videos/new/page.tsx')).toContain("router.replace('/')");
  });
  it('the video screen answers a 404 with the not-available view and a Back that is never a dead end', () => {
    const screen = read('src/components/videos/VideoScreen.tsx');
    expect(screen).toContain('Video not available');
    expect(screen).toContain('backOr(router');
    expect(screen).toContain('initialAuthCheckComplete');
  });
});

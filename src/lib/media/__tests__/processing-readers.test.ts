import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROCESSING_FRESH_MS, shouldPollProcessing } from '@/components/media/useProcessingRefresh';

// Video posters PR 8 (Oct 13 2026): `processing` end to end — every media
// reader emits `codec` + `processing` (never the timestamp), every media
// writer asks the worker for the row's jobs, the card polls only a FRESH post.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

describe('the readers', () => {
  it('the three post selects and the shared-post embed name codec + processing_at; every mapper emits processing as a boolean', () => {
    const posts = read('src/app/api/posts/route.ts');
    expect(posts.match(/thumbnail_url,\n\s+blur_hash,\n\s+codec,\n\s+processing_at,/g)?.length).toBe(3);
    expect(posts).toMatch(/media:post_media \( media_url, media_type, thumbnail_url, blur_hash, codec, processing_at \)/);
    expect(posts.match(/processing: !!(media|m)\.processing_at,/g)?.length).toBe(4);
    expect(posts).not.toMatch(/processing_at: (media|m)\.processing_at/);
    const profile = read('src/app/api/profile/[profileId]/media/route.ts');
    expect(profile).toMatch(/thumbnail_url, blur_hash, codec, processing_at'/);
    expect(profile).toMatch(/processing: !!processing_at,/);
    const activities = read('src/lib/activities/media-server.ts');
    expect(activities).toMatch(/blur_hash, codec, processing_at, duration_seconds/);
    expect(read('src/lib/activities/visibility.ts')).toMatch(/processing: !!r\.processing_at,/);
  });
  it('the writers enqueue: the post insert, the activity media insert and the three mirrors (origin mirror)', () => {
    expect(read('src/app/api/posts/route.ts')).toMatch(/enqueueForPostMedia\(getSupabaseAdmin\(\), post\.id, insertedMedia as MediaRowForPlan\[\] \| null, 'upload'\)/);
    expect(read('src/app/api/activities/[id]/media/route.ts')).toMatch(/enqueueForActivityMedia\(admin, inserted/);
    for (const f of ['src/lib/golf/round-mirror.ts', 'src/lib/sport-events/media-server.ts', 'src/lib/activities/media-server.ts']) {
      expect(read(f), f).toMatch(/enqueueForPostMedia\(admin, [a-zA-Z._]+, inserted as MediaRowForPlan\[\] \| null, 'mirror'\)/);
    }
  });
  it('the post insert stores codec and processing_at only for a transcode-needing codec while the worker is on', () => {
    const posts = read('src/app/api/posts/route.ts');
    expect(posts).toMatch(/processing_at: codec && needsTranscode\(codec\) && mediaJobsEnabled\(\) \? new Date\(\)\.toISOString\(\) : null,/);
  });
});

describe('the card', () => {
  it('VideoFrame takes codec and state from the media; a processing clip the device decodes is ready; the composer tile names an HEVC clip', () => {
    const card = read('src/components/PostCard.tsx');
    expect(card).toMatch(/codec=\{shownMedia\[currentMediaIndex\]\.codec\}/);
    expect(card).toMatch(/state=\{shownMedia\[currentMediaIndex\]\.processing \? 'processing' : 'ready'\}/);
    expect(card).toMatch(/useProcessingRefresh\(post\.id, post\.media, post\.created_at, setRefreshedMedia\)/);
    const frame = read('src/components/media/VideoFrame.tsx');
    expect(frame).toMatch(/state === 'processing' && decodes === true \? 'ready' : state/);
    expect(frame).toMatch(/data-video-unplayable=""/);
    expect(read('src/components/CreatePostModal.tsx')).toMatch(/itemFor\(file\.id\)\?\.codec === 'hevc'/);
  });
  it('shouldPollProcessing: only a fresh post with processing media', () => {
    const now = Date.parse('2026-10-13T12:00:00Z');
    const fresh = new Date(now - 60_000).toISOString();
    const old = new Date(now - PROCESSING_FRESH_MS - 1).toISOString();
    expect(shouldPollProcessing([{ id: 'a', processing: true }], fresh, now)).toBe(true);
    expect(shouldPollProcessing([{ id: 'a', processing: true }], old, now)).toBe(false);
    expect(shouldPollProcessing([{ id: 'a', processing: false }], fresh, now)).toBe(false);
    expect(shouldPollProcessing([], fresh, now)).toBe(false);
    expect(shouldPollProcessing(undefined, fresh, now)).toBe(false);
    expect(shouldPollProcessing([{ id: 'a', processing: true }], undefined, now)).toBe(false);
  });
});

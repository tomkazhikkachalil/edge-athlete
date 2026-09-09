import { describe, it, expect } from 'vitest';
import { orderGalleryForApp } from '../app-gallery';
import { resolveNewsCover } from '../news-cover';
import { coursePhotoUrls } from '../course-photos';
import type { PublicGalleryItem } from '../public-data';

const SITE = '11111111-1111-4111-8111-111111111111';
const FILE = '22222222-2222-4222-8222-222222222222.jpg';

function item(id: string, over: Partial<PublicGalleryItem> = {}): PublicGalleryItem {
  return {
    id,
    url: `/api/media/contest-media/${id}`,
    mediaType: 'image',
    caption: null,
    date: null,
    competitionName: 'Open',
    tagLabels: [],
    kind: 'contest',
    width: null,
    height: null,
    ...over,
  };
}

describe('orderGalleryForApp', () => {
  it('one timeline: newest first, members before contest on a date, undated last, stable', () => {
    const out = orderGalleryForApp([
      item('a', { date: '2026-09-01', kind: 'contest' }),
      item('b', { date: '2026-09-08', kind: 'contest' }),
      item('c', { date: null }),
      item('d', { date: '2026-09-08', kind: 'member' }),
      item('e', { date: '2026-09-08', kind: 'contest' }),
    ]);
    expect(out.map(i => i.id)).toEqual(['d', 'b', 'e', 'a', 'c']);
  });
  it('does not mutate its input', () => {
    const input = [item('x', { date: '2026-01-01' }), item('y', { date: '2026-02-01' })];
    const snapshot = input.map(i => i.id);
    orderGalleryForApp(input);
    expect(input.map(i => i.id)).toEqual(snapshot);
  });
});

describe('resolveNewsCover', () => {
  it('maps the first image block through the streamer URL, keeping dims', () => {
    const body = [
      { type: 'paragraph', text: 'hi' },
      { type: 'image', path: `org-media/${SITE}/${FILE}`, alt: ' The tee ', width: 800, height: 600 },
      { type: 'image', path: `org-media/${SITE}/33333333-3333-4333-8333-333333333333.jpg` },
    ];
    expect(resolveNewsCover(SITE, body)).toEqual({
      url: `/api/media/org-media/${SITE}/${FILE}`,
      alt: 'The tee',
      width: 800,
      height: 600,
    });
  });
  it("a path under another site's prefix is no cover; junk never throws", () => {
    expect(resolveNewsCover(SITE, [{ type: 'image', path: `org-media/other/${FILE}` }])).toBeNull();
    expect(resolveNewsCover(SITE, 'junk')).toBeNull();
    expect(resolveNewsCover(SITE, [])).toBeNull();
  });
});

describe('coursePhotoUrls', () => {
  it('maps course and hole paths, drops foreign paths, keeps hole numbering', () => {
    const out = coursePhotoUrls(SITE, {
      c1: { path: `org-media/${SITE}/${FILE}`, alt: 'Clubhouse', holes: { 1: { path: `org-media/${SITE}/${FILE}` }, 18: { path: 'org-media/other/x.jpg' } } },
      c2: { holes: { 7: { path: `org-media/${SITE}/${FILE}`, alt: 'Seven' } } },
      c3: { path: 'org-media/other/x.jpg' },
    });
    expect(out.c1.photo).toEqual({ url: `/api/media/org-media/${SITE}/${FILE}`, alt: 'Clubhouse' });
    expect(Object.keys(out.c1.holes ?? {})).toEqual(['1']);
    expect(out.c2.photo).toBeUndefined();
    expect(out.c2.holes?.[7]).toEqual({ url: `/api/media/org-media/${SITE}/${FILE}`, alt: 'Seven' });
    expect(out.c3).toBeUndefined();
  });
});

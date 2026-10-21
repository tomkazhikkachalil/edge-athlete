import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toMediaItem, type TrainingPostRow } from '../training/media-item';

// Training fixes PR 2 (Oct 21 2026): the Training Activity posts are the
// Stats / Media tile grid. The mapper hands the Training API's row to the tile.

const row: TrainingPostRow = {
  id: 'p1', caption: 'Push day', sport_key: 'general', stats_data: { type: 'workout_session' }, visibility: 'public', created_at: '2026-10-21T10:00:00Z',
  likes_count: 2, comments_count: 1, saves_count: 0,
  profile: { id: 'u1', first_name: 'Edge', last_name: 'Alpha', full_name: 'Edge Alpha', avatar_url: null },
  media: [
    { id: 'm2', media_url: '/api/media/2', media_type: 'video', display_order: 1, thumbnail_url: '/api/media/2-poster', blur_hash: 'LKO2' },
    { id: 'm1', media_url: '/api/media/1', media_type: 'image', display_order: 0 },
  ],
};

describe('a training post as a grid tile', () => {
  it('flattens the author, counts the media, sorts it by display order and keeps a video poster', () => {
    const item = toMediaItem(row, 'u1');
    expect(item.profile_id).toBe('u1');
    expect(item.profile_full_name).toBe('Edge Alpha');
    expect(item.media_count).toBe(2);
    expect(item.media!.map(m => m.id)).toEqual(['m1', 'm2']);
    expect(item.media![1]).toMatchObject({ media_type: 'video', thumbnail_url: '/api/media/2-poster', blur_hash: 'LKO2' });
    expect(item.media![0]).toMatchObject({ thumbnail_url: null, blur_hash: null });
    expect(item.is_own_post).toBe(true);
    expect(item.likes_count).toBe(2);
    expect(item.tags).toBeNull();
  });
  it('a visitor is not the owner; a post without media is a text tile (count 0); absent counts read 0', () => {
    const item = toMediaItem({ ...row, media: null, likes_count: null, comments_count: undefined }, 'u2');
    expect(item.is_own_post).toBe(false);
    expect(item.media_count).toBe(0);
    expect(item.media).toEqual([]);
    expect(item.likes_count).toBe(0);
    expect(item.comments_count).toBe(0);
    expect(toMediaItem(row, null).is_own_post).toBe(false);
  });
  it('the Training tab renders the grid tile, not a post card; the modal walks the shown tiles; the route selects the poster', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
    const tab = read('src/components/TrainingTab.tsx');
    expect(tab).not.toMatch(/import PostCard/);
    expect(tab).toMatch(/<MediaGridItem/);
    expect(tab).toMatch(/data-training-activity-grid=/);
    expect(tab).toMatch(/grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2/);
    expect(tab).toMatch(/item=\{toMediaItem\(post, currentUserId\)\}/);
    expect(tab).toMatch(/showNavigation=\{linkedPostId === null && shownActivityPosts\.length > 1\}/);
    expect(tab).toMatch(/const ACTIVITY_TILES_FIRST = 6;/);
    const route = read('src/app/api/vitals/route.ts');
    expect(route).toMatch(/display_order,\s*thumbnail_url,\s*blur_hash/);
  });
});

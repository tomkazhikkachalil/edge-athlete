import { describe, it, expect } from 'vitest';
import { isStatementPost } from '../statements';

describe('isStatementPost', () => {
  it('caption-only post is a statement', () => {
    expect(isStatementPost({ stats_data: null, round_id: null, group_post_id: null })).toBe(true);
  });

  it('all fields absent is a statement (sparse API shapes)', () => {
    expect(isStatementPost({})).toBe(true);
  });

  it('empty stats_data object is a statement (SQL: = {}::jsonb)', () => {
    expect(isStatementPost({ stats_data: {} })).toBe(true);
  });

  it('non-empty stats_data is not a statement', () => {
    expect(isStatementPost({ stats_data: { points: 12 } })).toBe(false);
  });

  it('solo round (round_id) is not a statement', () => {
    expect(isStatementPost({ round_id: 'r-1' })).toBe(false);
  });

  it('shared round (group_post_id) is not a statement — the migration 070 shape', () => {
    // Shared rounds carry NEITHER stats_data nor round_id.
    expect(isStatementPost({ stats_data: null, round_id: null, group_post_id: 'g-1' })).toBe(false);
  });

  it('media_count > 0 (RPC row shape) is not a statement', () => {
    expect(isStatementPost({ media_count: 1 })).toBe(false);
  });

  it('media_count 0 is a statement', () => {
    expect(isStatementPost({ media_count: 0 })).toBe(true);
  });

  it('empty post_media embed is a statement', () => {
    expect(isStatementPost({ post_media: [] })).toBe(true);
  });

  it('non-empty post_media embed (PostgREST shape) is not a statement', () => {
    expect(isStatementPost({ post_media: [{ id: 'm-1' }] })).toBe(false);
  });

  it('non-empty enriched media array is not a statement', () => {
    expect(isStatementPost({ media: [{ id: 'm-1' }] })).toBe(false);
  });

  it('a future repost shape (shared_post_id only, no own content) classifies as a statement by construction', () => {
    const futureRepost = { shared_post_id: 'p-1', stats_data: null, round_id: null, group_post_id: null };
    expect(isStatementPost(futureRepost)).toBe(true);
  });
});

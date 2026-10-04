import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authorizeMedia } from '../authorize';

/**
 * Speed round 2: the authorizer takes the viewer as a thunk and awaits it
 * ONLY when the answer depends on who is asking. A public post's media is
 * decided from the post alone — the session check never blocks it.
 */
function adminWith(rows: Record<string, unknown>): SupabaseClient {
  const chain = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'in', 'limit', 'order']) builder[m] = () => builder;
    builder.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    return builder;
  };
  return { from: chain } as unknown as SupabaseClient;
}

describe('authorizeMedia and the lazy viewer', () => {
  it('a public post resolves without ever asking who the viewer is', async () => {
    const admin = adminWith({ posts: { visibility: 'public', profile_id: 'owner', profiles: { visibility: 'public' } } });
    const viewer = vi.fn(() => new Promise<string | null>(() => {})); // never resolves
    const result = await authorizeMedia(admin, { v: 1, b: 'uploads', k: 'k', t: 'post', id: 'p1' }, viewer);
    expect(result).toEqual({ allow: true, isPublic: true });
    expect(viewer).not.toHaveBeenCalled();
  });

  it('a private post asks, and the owner is let in', async () => {
    const admin = adminWith({ posts: { visibility: 'private', profile_id: 'owner', profiles: { visibility: 'public' } } });
    const viewer = vi.fn(async () => 'owner');
    expect(await authorizeMedia(admin, { v: 1, b: 'uploads', k: 'k', t: 'post', id: 'p1' }, viewer)).toEqual({ allow: true, isPublic: false });
    expect(viewer).toHaveBeenCalledTimes(1);
  });

  it('a private post with no viewer is denied; a plain string viewer still works', async () => {
    const admin = adminWith({ posts: { visibility: 'public', profile_id: 'owner', profiles: { visibility: 'private' } }, follows: null });
    expect(await authorizeMedia(admin, { v: 1, b: 'uploads', k: 'k', t: 'post', id: 'p1' }, null)).toEqual({ allow: false, isPublic: false });
    expect(await authorizeMedia(admin, { v: 1, b: 'uploads', k: 'k', t: 'post', id: 'p1' }, 'owner')).toEqual({ allow: true, isPublic: false });
  });

  it('a public group round and a public profile\'s equipment decide without the viewer too', async () => {
    const admin = adminWith({ group_posts: { visibility: 'public', creator_id: 'c' }, profiles: { visibility: 'public' } });
    const viewer = vi.fn(() => new Promise<string | null>(() => {}));
    expect(await authorizeMedia(admin, { v: 1, b: 'uploads', k: 'k', t: 'group', id: 'g' }, viewer)).toEqual({ allow: true, isPublic: true });
    expect(await authorizeMedia(admin, { v: 1, b: 'uploads', k: 'k', t: 'equipment', id: 'u' }, viewer)).toEqual({ allow: true, isPublic: true });
    expect(viewer).not.toHaveBeenCalled();
  });

  it('a message is never public and always asks', async () => {
    const admin = adminWith({ messages: { conversation_id: 'c', deleted_at: null }, conversation_participants: { id: 'x' } });
    const viewer = vi.fn(async () => 'u');
    expect(await authorizeMedia(admin, { v: 1, b: 'uploads', k: 'k', t: 'message', id: 'm' }, viewer)).toEqual({ allow: true, isPublic: false });
    expect(viewer).toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import { mediaRight, parseMediaBody, projectMedia } from '../media';
import { parseEventTab, tabsFor } from '../tabs';

const base = { viewerId: 'v', eventStatus: 'live' as const, eventRole: 'participant' as const, participantStatus: 'accepted', canManage: false };

describe('mediaRight — add: any accepted row or an organizer, never on a cancelled event; remove: the uploader or an organizer', () => {
  it('add', () => {
    expect(mediaRight('add', base)).toEqual({ allowed: true, via: 'participant' });
    expect(mediaRight('add', { ...base, eventRole: 'follower' })).toEqual({ allowed: true, via: 'participant' });
    expect(mediaRight('add', { ...base, participantStatus: null, canManage: true })).toEqual({ allowed: true, via: 'organizer' });
    expect(mediaRight('add', { ...base, participantStatus: 'invited' })).toMatchObject({ allowed: false, status: 403 });
    expect(mediaRight('add', { ...base, participantStatus: null, eventRole: 'viewer' })).toMatchObject({ allowed: false, status: 403 });
    expect(mediaRight('add', { ...base, viewerId: null })).toMatchObject({ allowed: false, status: 401 });
    expect(mediaRight('add', { ...base, eventStatus: 'cancelled' })).toMatchObject({ allowed: false, status: 409 });
    // A completed event still takes a late photo (it re-mirrors once).
    expect(mediaRight('add', { ...base, eventStatus: 'completed' })).toMatchObject({ allowed: true });
  });
  it('remove', () => {
    expect(mediaRight('remove', { ...base, uploadedBy: 'v' })).toEqual({ allowed: true, via: 'uploader' });
    expect(mediaRight('remove', { ...base, uploadedBy: 'x', canManage: true })).toEqual({ allowed: true, via: 'organizer' });
    expect(mediaRight('remove', { ...base, uploadedBy: 'x' })).toMatchObject({ allowed: false, status: 403 });
    expect(mediaRight('remove', { ...base, viewerId: null, uploadedBy: 'x' })).toMatchObject({ allowed: false, status: 401 });
  });
});

describe('parseMediaBody — the uploaded URL, its type, the optional poster / duration / caption / round', () => {
  it('accepts the minimum and the full body; refuses by name', () => {
    expect(parseMediaBody({ media_url: 'https://x.supabase.co/storage/v1/object/public/uploads/a.jpg', media_type: 'image' })).toEqual({ ok: true, value: { media_url: 'https://x.supabase.co/storage/v1/object/public/uploads/a.jpg', media_type: 'image', thumbnail_url: null, duration_seconds: null, caption: null, round_id: null } });
    expect(parseMediaBody({ media_url: 'https://x/v.mp4', media_type: 'video', thumbnail_url: 'https://x/p.jpg', duration_seconds: 12.345, caption: ' Goal! ', round_id: '11111111-1111-4111-8111-111111111111' })).toEqual({ ok: true, value: { media_url: 'https://x/v.mp4', media_type: 'video', thumbnail_url: 'https://x/p.jpg', duration_seconds: 12.35, caption: 'Goal!', round_id: '11111111-1111-4111-8111-111111111111' } });
    expect(parseMediaBody({ media_url: 'not a url', media_type: 'image' })).toMatchObject({ ok: false, error: expect.stringContaining('media_url') });
    expect(parseMediaBody({ media_url: 'https://x/a.jpg', media_type: 'gif' })).toMatchObject({ ok: false, error: expect.stringContaining('media_type') });
    expect(parseMediaBody({ media_url: 'https://x/a.jpg', media_type: 'image', caption: 'x'.repeat(501) })).toMatchObject({ ok: false, error: expect.stringContaining('caption') });
    expect(parseMediaBody({ media_url: 'https://x/a.jpg', media_type: 'image', duration_seconds: -1 })).toMatchObject({ ok: false });
    expect(parseMediaBody({ media_url: 'https://x/a.jpg', media_type: 'image', round_id: 'nope' })).toMatchObject({ ok: false, error: expect.stringContaining('round_id') });
    expect(parseMediaBody({ media_url: 'https://x/a.jpg', media_type: 'image', extra: 1 })).toEqual({ ok: false, error: 'Unknown field: extra' });
  });
});

describe('projectMedia — newest first, mine, can_remove', () => {
  it('projects', () => {
    const rows = [
      { id: 'm1', sport_event_id: 'e', sport_event_round_id: null, uploaded_by: 'a', created_by_user_id: null, media_url: 'u1', media_type: 'image' as const, thumbnail_url: null, duration_seconds: null, caption: null, mirrored_at: null, created_at: '2030-01-01T10:00:00Z' },
      { id: 'm2', sport_event_id: 'e', sport_event_round_id: 'r', uploaded_by: 'b', created_by_user_id: null, media_url: 'u2', media_type: 'video' as const, thumbnail_url: 't2', duration_seconds: 4, caption: 'Goal', mirrored_at: null, created_at: '2030-01-01T11:00:00Z' },
    ];
    const names = new Map([['a', { name: 'Edge A.', avatar_url: null }]]);
    const out = projectMedia(rows, names, { profileId: 'b', canManage: false, eventStatus: 'live' });
    expect(out.map(m => m.id)).toEqual(['m2', 'm1']);
    expect(out[0]).toMatchObject({ mine: true, can_remove: true, uploader: { name: 'Athlete' }, caption: 'Goal' });
    expect(out[1]).toMatchObject({ mine: false, can_remove: false, uploader: { name: 'Edge A.' } });
    expect(projectMedia(rows, names, { profileId: null, canManage: false, eventStatus: 'live' })[1].can_remove).toBe(false);
    expect(projectMedia(rows, names, { profileId: 'x', canManage: true, eventStatus: 'live' })[1].can_remove).toBe(true);
  });
  it('the Gallery tab shows for everyone, last', () => {
    expect(tabsFor({ canManage: false })).toContain('gallery');
    expect(tabsFor({ canManage: false, shape: 'game' }).at(-1)).toBe('gallery');
    expect(parseEventTab('gallery', { canManage: false })).toBe('gallery');
  });
});

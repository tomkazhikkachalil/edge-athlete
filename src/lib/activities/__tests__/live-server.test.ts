import { describe, expect, it } from 'vitest';
import { parseWireActivity } from '../wire-schema';
import { toWire } from '../wire';
import { line } from './fixtures';
import { isOwnUploadUrl, parseActivityMediaBody, parseActivityMediaPatch, ACTIVITY_MEDIA_MAX } from '../media';

const REC = '7d4f9e2a-1b3c-4d5e-8f6a-9b0c1d2e3f40';
const PROFILE = '00000000-0000-4000-8000-000000000002';
const BASE = 'https://proj.supabase.co/storage/v1/object/public/uploads';

function liveWire(over: Record<string, unknown> = {}) {
  const w = toWire({ format: 'live', type: 'walk', name: null, points: line(300, { stepM: 1.4, stepS: 1 }), device: {}, tzOffsetMin: null }, 'UTC');
  return { ...w, recordingId: REC, segments: [{ id: 'a', kind: 'sprint', from_s: 10, to_s: 40 }], ...over };
}

describe('the live wire — what the import door refuses (251)', () => {
  it('accepts a recording with its id and segments', () => {
    const r = parseWireActivity(liveWire());
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
  });
  it('a recording names itself; a file never carries the recorder\'s fields', () => {
    expect(parseWireActivity(liveWire({ recordingId: undefined }))).toMatchObject({ ok: false, error: expect.stringContaining('recordingId') });
    expect(parseWireActivity(liveWire({ recordingId: 'rec-1' }))).toMatchObject({ ok: false });
    const gpx = { ...liveWire(), format: 'gpx' };
    expect(parseWireActivity(gpx)).toMatchObject({ ok: false, error: expect.stringContaining('format') });
  });
  it('a segment past the end, a 2 s mis-tap, and the 51st are refused', () => {
    expect(parseWireActivity(liveWire({ segments: [{ id: 'a', kind: 'sprint', from_s: 10, to_s: 5000 }] }))).toMatchObject({ ok: false, error: expect.stringContaining('to_s') });
    expect(parseWireActivity(liveWire({ segments: [{ id: 'a', kind: 'sprint', from_s: 10, to_s: 12 }] }))).toMatchObject({ ok: false });
    expect(parseWireActivity(liveWire({ segments: new Array(51).fill(0).map((_, i) => ({ id: `s${i}`, kind: 'lap', from_s: i, to_s: i + 10 })) }))).toMatchObject({ ok: false });
  });
});

describe('activity photos — the body a POST accepts (251)', () => {
  it('takes a file THIS profile uploaded through the one door, and nothing else', () => {
    expect(isOwnUploadUrl(`${BASE}/posts/${PROFILE}/a.jpg`, PROFILE)).toBe(true);
    expect(isOwnUploadUrl(`${BASE}/posts/other/a.jpg`, PROFILE)).toBe(false);
    expect(isOwnUploadUrl(`${BASE}/activities/${PROFILE}/x.json.gz`, PROFILE)).toBe(false);
    expect(isOwnUploadUrl('https://evil.example/a.jpg', PROFILE)).toBe(false);
    const good = parseActivityMediaBody({ media_url: `${BASE}/posts/${PROFILE}/a.jpg`, media_type: 'image', at_s: 120, caption: '  Hill  ' }, PROFILE);
    expect(good).toEqual({ ok: true, value: { media_url: `${BASE}/posts/${PROFILE}/a.jpg`, media_type: 'image', thumbnail_url: null, duration_seconds: null, caption: 'Hill', at_s: 120 } });
    expect(parseActivityMediaBody({ media_url: `${BASE}/posts/other/a.jpg`, media_type: 'image' }, PROFILE)).toMatchObject({ ok: false });
    expect(parseActivityMediaBody({ media_url: `${BASE}/posts/${PROFILE}/a.jpg`, media_type: 'gif' }, PROFILE)).toMatchObject({ ok: false });
    expect(parseActivityMediaBody({ media_url: `${BASE}/posts/${PROFILE}/a.jpg`, media_type: 'image', at_s: 1.5 }, PROFILE)).toMatchObject({ ok: false });
    expect(parseActivityMediaBody({ media_url: `${BASE}/posts/${PROFILE}/a.jpg`, media_type: 'image', extra: 1 }, PROFILE)).toMatchObject({ ok: false });
    expect(ACTIVITY_MEDIA_MAX).toBe(20);
  });
  it('a PATCH changes the caption, the moment or the file — never nothing', () => {
    expect(parseActivityMediaPatch({ caption: null, at_s: 30 }, PROFILE)).toEqual({ ok: true, value: { caption: null, at_s: 30 } });
    expect(parseActivityMediaPatch({ media_url: `${BASE}/posts/${PROFILE}/b.jpg` }, PROFILE)).toEqual({ ok: true, value: { media_url: `${BASE}/posts/${PROFILE}/b.jpg` } });
    expect(parseActivityMediaPatch({}, PROFILE)).toMatchObject({ ok: false });
    expect(parseActivityMediaPatch({ media_url: `${BASE}/posts/other/b.jpg` }, PROFILE)).toMatchObject({ ok: false });
  });
});

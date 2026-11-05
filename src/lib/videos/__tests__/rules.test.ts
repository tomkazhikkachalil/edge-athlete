import { describe, expect, it } from 'vitest';
import {
  defaultVideoTitle,
  placeOf,
  formatTimestamp,
  highlightRangeOk,
  manageRight,
  parseHighlightBody,
  parseHighlightMeta,
  parseHighlightPatch,
  parseTypedTimestamp,
  parseVideoBody,
  parseVideoPatch,
  videoRight,
  viewRight,
  type VideoRightFacts,
} from '@/lib/videos/rules';

const U = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';

describe('videoRight — a profile\'s video', () => {
  const base = (over: Partial<VideoRightFacts>): VideoRightFacts => ({ viewerId: U, status: 'published', owner: 'profile', isOwner: false, isGuardian: false, profileCanView: false, ...over });

  it('the owner manages and views, published or hidden', () => {
    expect(manageRight(base({ isOwner: true })).allowed).toBe(true);
    expect(viewRight(base({ isOwner: true, status: 'hidden' })).allowed).toBe(true);
  });
  it('an approved guardian manages', () => {
    const r = manageRight(base({ isGuardian: true }));
    expect(r).toEqual({ allowed: true, via: 'guardian' });
  });
  it('a follower views a published video and cannot manage', () => {
    expect(viewRight(base({ profileCanView: true }))).toEqual({ allowed: true, via: 'viewer' });
    expect(manageRight(base({ profileCanView: true }))).toMatchObject({ allowed: false, status: 403 });
  });
  it('a follower never sees a hidden video — and the refusal is a 404', () => {
    expect(viewRight(base({ profileCanView: true, status: 'hidden' }))).toMatchObject({ allowed: false, status: 404 });
  });
  it('a stranger on a private profile gets 404; on a public one, the video', () => {
    expect(viewRight(base({ viewerId: null }))).toMatchObject({ allowed: false, status: 404 });
    expect(viewRight(base({ viewerId: null, profileCanView: true })).allowed).toBe(true);
  });
  it('signed out, manage is a 401', () => {
    expect(manageRight(base({ viewerId: null }))).toMatchObject({ allowed: false, status: 401 });
  });
  it('videoRight dispatches', () => {
    expect(videoRight('manage', base({ isOwner: true })).allowed).toBe(true);
    expect(videoRight('view', base({ profileCanView: true })).allowed).toBe(true);
  });
});

describe('videoRight — an org\'s video', () => {
  const base = (over: Partial<VideoRightFacts>): VideoRightFacts => ({ viewerId: U, status: 'published', owner: 'org', orgAccess: null, orgCanManage: false, ...over });

  it('a manager (ladder or website grant → orgCanManage) manages and sees hidden', () => {
    expect(manageRight(base({ orgCanManage: true }))).toEqual({ allowed: true, via: 'org' });
    expect(viewRight(base({ orgCanManage: true, status: 'hidden' })).allowed).toBe(true);
  });
  it('a public org: everyone, signed out too; a member of a private org: yes; a stranger on a private org: 404', () => {
    expect(viewRight(base({ viewerId: null, orgAccess: 'public' }))).toEqual({ allowed: true, via: 'public' });
    expect(viewRight(base({ orgAccess: 'member' }))).toEqual({ allowed: true, via: 'member' });
    expect(viewRight(base({ viewerId: null, orgAccess: null }))).toMatchObject({ allowed: false, status: 404 });
  });
  it('a member never manages, and never sees a hidden video', () => {
    expect(manageRight(base({ orgAccess: 'member' }))).toMatchObject({ allowed: false, status: 403 });
    expect(viewRight(base({ orgAccess: 'member', status: 'hidden' }))).toMatchObject({ allowed: false, status: 404 });
  });
});

describe('parseHighlightBody', () => {
  it('accepts a full marker and trims the label', () => {
    expect(parseHighlightBody({ start_ms: 90_000, end_ms: 95_000, label: '  Eagle on 7 ', meta: { hole: 7, score: -2, note: 'wind' } })).toEqual({
      ok: true,
      value: { start_ms: 90_000, end_ms: 95_000, label: 'Eagle on 7', meta: { hole: 7, score: -2, note: 'wind' } },
    });
  });
  it('start 0 is fine; end defaults to null; meta defaults to {}', () => {
    expect(parseHighlightBody({ start_ms: 0, label: 'Tee off' })).toEqual({ ok: true, value: { start_ms: 0, end_ms: null, label: 'Tee off', meta: {} } });
  });
  it.each([
    [{ start_ms: -1, label: 'x' }, /0 or more/],
    [{ start_ms: 1.5, label: 'x' }, /whole number/],
    [{ start_ms: '90', label: 'x' }, /whole number/],
    [{ start_ms: 90_000, end_ms: 90_000, label: 'x' }, /after start_ms/],
    [{ start_ms: 90_000, end_ms: 10, label: 'x' }, /after start_ms/],
    [{ start_ms: 1, label: '' }, /label is required/],
    [{ start_ms: 1, label: '   ' }, /label is required/],
    [{ start_ms: 1, label: 'x'.repeat(121) }, /at most 120/],
    [{ start_ms: 1, label: 'x', extra: 1 }, /Unknown field: extra/],
    [{ start_ms: 25 * 3600 * 1000, label: 'x' }, /within 24 hours/],
    [null, /JSON body/],
    [[], /JSON body/],
  ])('%j is refused', (body, re) => {
    const r = parseHighlightBody(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(re);
  });
});

describe('parseHighlightMeta — a closed vocabulary', () => {
  it('hole 1..36, score a whole number, note ≤ 200 trimmed; empties dropped', () => {
    expect(parseHighlightMeta({ hole: 18, score: 4, note: ' nice ' })).toEqual({ ok: true, value: { hole: 18, score: 4, note: 'nice' } });
    expect(parseHighlightMeta({ note: '  ', hole: null })).toEqual({ ok: true, value: {} });
    expect(parseHighlightMeta(undefined)).toEqual({ ok: true, value: {} });
  });
  it.each([
    [{ hole: 0 }, /hole/],
    [{ hole: 37 }, /hole/],
    [{ hole: 1.5 }, /hole/],
    [{ score: 'four' }, /score/],
    [{ note: 'n'.repeat(201) }, /note/],
    [{ player: 'x' }, /Unknown meta field: player/],
    [[], /object/],
  ])('%j is refused', (meta, re) => {
    const r = parseHighlightMeta(meta);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(re);
  });
});

describe('parseHighlightPatch + highlightRangeOk', () => {
  it('a subset; end null clears; a self-contradicting pair is refused', () => {
    expect(parseHighlightPatch({ label: 'New' })).toEqual({ ok: true, value: { label: 'New' } });
    expect(parseHighlightPatch({ end_ms: null })).toEqual({ ok: true, value: { end_ms: null } });
    expect(parseHighlightPatch({ start_ms: 10, end_ms: 5 })).toMatchObject({ ok: false });
    expect(parseHighlightPatch({})).toMatchObject({ ok: false, error: 'Nothing to change' });
    expect(parseHighlightPatch({ nope: 1 })).toMatchObject({ ok: false });
  });
  it('the range rule against the stored row', () => {
    expect(highlightRangeOk({ start_ms: 1000, end_ms: 2000 }, { start_ms: 2500 })).toBe(false);
    expect(highlightRangeOk({ start_ms: 1000, end_ms: 2000 }, { end_ms: 1500 })).toBe(true);
    expect(highlightRangeOk({ start_ms: 1000, end_ms: null }, { start_ms: 5000 })).toBe(true);
    expect(highlightRangeOk({ start_ms: 1000, end_ms: 2000 }, { end_ms: null })).toBe(true);
  });
});

describe('parseVideoBody', () => {
  it('a profile video with defaults: published, own profile, no place', () => {
    expect(parseVideoBody({ url: ' https://youtu.be/dQw4w9WgXcQ ' })).toEqual({
      ok: true,
      value: { url: 'https://youtu.be/dQw4w9WgXcQ', title: null, description: null, sport_key: null, status: 'published', owner: { kind: 'profile', profileId: null }, sport_event_id: null, contest_id: null, group_post_id: null, activity_id: null, workout_session_id: null },
    });
  });
  it('an org video needs side + org_id and no profile_id', () => {
    const r = parseVideoBody({ url: 'https://youtu.be/dQw4w9WgXcQ', side: 'club', org_id: U, title: 'Final', status: 'hidden', contest_id: V });
    expect(r).toMatchObject({ ok: true, value: { owner: { kind: 'org', side: 'club', orgId: U }, title: 'Final', status: 'hidden', contest_id: V } });
    expect(parseVideoBody({ url: 'https://youtu.be/dQw4w9WgXcQ', side: 'club' })).toMatchObject({ ok: false, error: /org_id is required/ });
    expect(parseVideoBody({ url: 'https://youtu.be/dQw4w9WgXcQ', org_id: U })).toMatchObject({ ok: false, error: /side must be/ });
    expect(parseVideoBody({ url: 'https://youtu.be/dQw4w9WgXcQ', side: 'club', org_id: U, profile_id: V })).toMatchObject({ ok: false, error: /not both/ });
  });
  it('a guardian names the athlete with profile_id', () => {
    expect(parseVideoBody({ url: 'https://youtu.be/dQw4w9WgXcQ', profile_id: V })).toMatchObject({ ok: true, value: { owner: { kind: 'profile', profileId: V } } });
  });
  it.each([
    [{}, /Paste a YouTube link/],
    [{ url: '' }, /Paste a YouTube link/],
    [{ url: 'x', title: 't'.repeat(161) }, /at most 160/],
    [{ url: 'x', description: 'd'.repeat(2001) }, /at most 2000/],
    [{ url: 'x', status: 'draft' }, /status must be/],
    [{ url: 'x', sport_event_id: 'nope' }, /uuid/],
    [{ url: 'x', sport_event_id: U, contest_id: V }, /one place/],
    [{ url: 'x', group_post_id: U, activity_id: V }, /one place/],
    [{ url: 'x', workout_session_id: 'nope' }, /uuid/],
    [{ url: 'x', audience: 'followers' }, /Unknown field: audience/],
  ])('%j is refused', (body, re) => {
    const r = parseVideoBody(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(re);
  });
});

describe('parseVideoPatch', () => {
  it('a subset; the link never changes; an empty title is refused', () => {
    expect(parseVideoPatch({ title: ' New ', status: 'hidden' })).toEqual({ ok: true, value: { title: 'New', status: 'hidden' } });
    expect(parseVideoPatch({ description: null, sport_event_id: null })).toEqual({ ok: true, value: { description: null, sport_event_id: null } });
    expect(parseVideoPatch({ title: '  ' })).toMatchObject({ ok: false, error: 'title is required' });
    expect(parseVideoPatch({ url: 'https://youtu.be/x' })).toMatchObject({ ok: false, error: /Unknown field: url/ });
    expect(parseVideoPatch({})).toMatchObject({ ok: false });
    expect(parseVideoPatch({ sport_event_id: U, contest_id: V })).toMatchObject({ ok: false, error: /one place/ });
    expect(parseVideoPatch({ activity_id: U })).toEqual({ ok: true, value: { activity_id: U } });
    expect(parseVideoPatch({ group_post_id: null })).toEqual({ ok: true, value: { group_post_id: null } });
  });
});

describe('placeOf', () => {
  it('the one place a row carries, in the list\'s order; null when none', () => {
    expect(placeOf({ sport_event_id: null, contest_id: null, group_post_id: U, activity_id: null, workout_session_id: null })).toEqual({ key: 'group_post_id', id: U });
    expect(placeOf({ workout_session_id: V })).toEqual({ key: 'workout_session_id', id: V });
    expect(placeOf({})).toBeNull();
  });
});

describe('the words', () => {
  it('formatTimestamp', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(7_000)).toBe('0:07');
    expect(formatTimestamp(123_999)).toBe('2:03');
    expect(formatTimestamp(3_723_000)).toBe('1:02:03');
    expect(formatTimestamp(-5)).toBe('0:00');
  });
  it('parseTypedTimestamp', () => {
    expect(parseTypedTimestamp('90')).toBe(90_000);
    expect(parseTypedTimestamp('1:30')).toBe(90_000);
    expect(parseTypedTimestamp('1:02:03')).toBe(3_723_000);
    expect(parseTypedTimestamp('1:60')).toBeNull();
    expect(parseTypedTimestamp('a:b')).toBeNull();
    expect(parseTypedTimestamp('')).toBeNull();
    expect(parseTypedTimestamp('1:2:3:4')).toBeNull();
  });
  it('defaultVideoTitle carries the date', () => {
    expect(defaultVideoTitle(new Date('2026-11-04T12:00:00Z'))).toBe('Full game · 2026-11-04');
  });
});

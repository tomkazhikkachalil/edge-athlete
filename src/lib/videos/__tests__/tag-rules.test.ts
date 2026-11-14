import { describe, it, expect } from 'vitest';
import { GAME_SHEETS } from '../game-sheets';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkTag, clipAround, defaultTagLabel, EMPTY_TAG, nudgeMs, parseTagFields, parseTagPerson, parseRestoreBody, removedOut, RESTORE_IDS_MAX, RESTORE_WINDOW_MS, restoreSince, ROLE_IN_CLIP, TAG_PEOPLE_MAX, tagPersonKey, type TagInput } from '../tag-rules';
import { parseHighlightBody, parseHighlightPatch } from '../rules';

/** A tag on a highlight (Sprint 3 PR 3): the event, its period / side / value, the people by role. */
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const tag = (over: Partial<TagInput>): TagInput => ({ ...EMPTY_TAG, ...over });
const person = (role: string, profile_id: string | null, name: string | null = null, side: 1 | 2 | null = null) => ({ profile_id, name, role, side });

describe('parseTagPerson', () => {
  it('a profile, or a typed name (trimmed, single-spaced) — never both, never neither', () => {
    expect(parseTagPerson({ profile_id: P1.toUpperCase(), role: 'scorer' })).toEqual({ ok: true, value: person('scorer', P1) });
    expect(parseTagPerson({ name: '  Ann   Lee ', role: 'assist', side: 2 })).toEqual({ ok: true, value: person('assist', null, 'Ann Lee', 2) });
    expect(parseTagPerson({ profile_id: P1, name: 'Ann', role: 'scorer' }).ok).toBe(false);
    expect(parseTagPerson({ role: 'scorer' }).ok).toBe(false);
    expect(parseTagPerson({ name: '   ', role: 'scorer' }).ok).toBe(false);
  });
  it('a role is needed; a bad id, a long name, a bad side, an unknown field are refused', () => {
    expect(parseTagPerson({ profile_id: P1 }).ok).toBe(false);
    expect(parseTagPerson({ profile_id: 'nope', role: 'scorer' }).ok).toBe(false);
    expect(parseTagPerson({ name: 'x'.repeat(81), role: 'scorer' }).ok).toBe(false);
    expect(parseTagPerson({ profile_id: P1, role: 'scorer', side: 3 }).ok).toBe(false);
    expect(parseTagPerson({ profile_id: P1, role: 'scorer', jersey: 9 }).ok).toBe(false);
  });
  it('one key per person whatever the case of a name', () => {
    expect(tagPersonKey({ profile_id: P1, name: null })).toBe(`p:${P1}`);
    expect(tagPersonKey({ profile_id: null, name: 'Ann LEE' })).toBe('n:ann lee');
  });
});

describe('parseTagFields', () => {
  it('nothing is a plain marker; every field checked', () => {
    expect(parseTagFields({})).toEqual({ ok: true, value: EMPTY_TAG });
    expect(parseTagFields({ event_key: 'fg3_made', period: 2, side: 1, value: null, people: [{ profile_id: P1, role: 'scorer' }] })).toEqual({ ok: true, value: { event_key: 'fg3_made', period: 2, side: 1, value: null, people: [person('scorer', P1)] } });
    expect(parseTagFields({ event_key: 'Three!' }).ok).toBe(false);
    expect(parseTagFields({ period: 0 }).ok).toBe(false);
    expect(parseTagFields({ period: 1.5 }).ok).toBe(false);
    expect(parseTagFields({ side: 0 }).ok).toBe(false);
    expect(parseTagFields({ value: -1 }).ok).toBe(false);
    expect(parseTagFields({ people: 'ann' }).ok).toBe(false);
  });
  it('the same person twice in one role is refused; in two roles is fine; a tag names twelve at most', () => {
    expect(parseTagFields({ people: [{ profile_id: P1, role: 'scorer' }, { profile_id: P1, role: 'scorer' }] }).ok).toBe(false);
    expect(parseTagFields({ people: [{ name: 'Ann', role: 'scorer' }, { name: 'ANN', role: 'scorer' }] }).ok).toBe(false);
    expect(parseTagFields({ people: [{ profile_id: P1, role: 'scorer' }, { profile_id: P1, role: 'in_clip' }] }).ok).toBe(true);
    expect(parseTagFields({ people: Array.from({ length: TAG_PEOPLE_MAX + 1 }, (_, i) => ({ name: `P${i}`, role: 'in_clip' })) }).ok).toBe(false);
  });
});

describe('checkTag — the tag against the game\'s sheet', () => {
  const bb = GAME_SHEETS.basketball;
  it('no event: a plain marker; people may only be in the clip; no value', () => {
    expect(checkTag(null, tag({})).ok).toBe(true);
    expect(checkTag(null, tag({ people: [person(ROLE_IN_CLIP, P1)] })).ok).toBe(true);
    expect(checkTag(bb, tag({ people: [person('scorer', P1)] })).ok).toBe(false);
    expect(checkTag(bb, tag({ value: 3 })).ok).toBe(false);
  });
  it('an event needs a game, and must be the sport\'s', () => {
    expect(checkTag(null, tag({ event_key: 'fg3_made', side: 1 }))).toEqual({ ok: false, error: 'Add the game details before tagging events' });
    expect(checkTag(bb, tag({ event_key: 'goal', side: 1 })).ok).toBe(false);
    expect(checkTag(bb, tag({ event_key: 'fg3_made', side: 1, people: [person('scorer', P1), person('assist', P2)] })).ok).toBe(true);
  });
  it('whose event is it: a two-sided sport needs the side; a race has none', () => {
    expect(checkTag(bb, tag({ event_key: 'fg3_made' }))).toEqual({ ok: false, error: 'Choose which team this is for' });
    expect(checkTag(GAME_SHEETS.mma, tag({ event_key: 'knockdown' })).ok).toBe(false);
    expect(checkTag(GAME_SHEETS.running, tag({ event_key: 'finish', value: 61_000, people: [person('athlete', P1)] })).ok).toBe(true);
    expect(checkTag(GAME_SHEETS.running, tag({ event_key: 'finish', value: 61_000, side: 1 })).ok).toBe(false);
  });
  it('roles are the event\'s (or in the clip), and no more than the role allows', () => {
    expect(checkTag(bb, tag({ event_key: 'steal', side: 1, people: [person('scorer', P1)] })).ok).toBe(false);
    expect(checkTag(bb, tag({ event_key: 'fg2_made', side: 1, people: [person('scorer', P1), person('scorer', P2)] })).ok).toBe(false);
    expect(checkTag(bb, tag({ event_key: 'fg2_made', side: 1, people: [person('scorer', P1), person(ROLE_IN_CLIP, P2)] })).ok).toBe(true);
    const hockey = GAME_SHEETS.ice_hockey;
    const three = [person('assist', P1), person('assist', P2), person('assist', null, 'Third')];
    expect(checkTag(hockey, tag({ event_key: 'goal', side: 1, people: three.slice(0, 2) })).ok).toBe(true);
    expect(checkTag(hockey, tag({ event_key: 'goal', side: 1, people: three })).ok).toBe(false);
  });
  it('a value only where the event takes one, inside its range; a default stands in for none', () => {
    const hockey = GAME_SHEETS.ice_hockey;
    expect(checkTag(hockey, tag({ event_key: 'penalty', side: 1 })).ok).toBe(true); // the default two minutes
    expect(checkTag(hockey, tag({ event_key: 'penalty', side: 1, value: 5 })).ok).toBe(true);
    expect(checkTag(hockey, tag({ event_key: 'penalty', side: 1, value: 60 })).ok).toBe(false);
    expect(checkTag(hockey, tag({ event_key: 'hit', side: 1, value: 2 })).ok).toBe(false);
    expect(checkTag(GAME_SHEETS.running, tag({ event_key: 'finish' })).ok).toBe(false); // a finish needs its time
    expect(checkTag(GAME_SHEETS.golf, tag({ event_key: 'hole_score', period: 3, value: 4, people: [person('golfer', P1)] })).ok).toBe(true);
  });
});

describe('the highlight body carries the tag', () => {
  it('a POST without tag fields is the plain marker it always was; with them, the tag is parsed', () => {
    const plain = parseHighlightBody({ start_ms: 1000, label: 'Nice' });
    expect(plain.ok && plain.value.tag).toBeUndefined();
    const tagged = parseHighlightBody({ start_ms: 1000, end_ms: 9000, label: '3-pointer', event_key: 'fg3_made', side: 2, period: 1, people: [{ profile_id: P1, role: 'scorer' }] });
    expect(tagged.ok && tagged.value.tag).toEqual({ event_key: 'fg3_made', period: 1, side: 2, value: null, people: [person('scorer', P1)] });
    expect(parseHighlightBody({ start_ms: 1000, label: 'x', side: 9 }).ok).toBe(false);
    expect(parseHighlightBody({ start_ms: 1000, label: 'x', jersey: 9 }).ok).toBe(false);
  });
  it('a PATCH leaves the tag alone unless a tag field is sent — then it is replaced whole', () => {
    const move = parseHighlightPatch({ start_ms: 5000 });
    expect(move.ok && move.value.tag).toBeUndefined();
    const clear = parseHighlightPatch({ event_key: null, people: [] });
    expect(clear.ok && clear.value.tag).toEqual(EMPTY_TAG);
  });
});

describe('the helpers', () => {
  it('the default label is the event, with the first name when there is one', () => {
    expect(defaultTagLabel(GAME_SHEETS.basketball, { event_key: 'fg3_made' }, 'Ann Lee')).toBe('3-pointer made — Ann Lee');
    expect(defaultTagLabel(GAME_SHEETS.basketball, { event_key: 'fg3_made' })).toBe('3-pointer made');
    expect(defaultTagLabel(GAME_SHEETS.basketball, { event_key: null })).toBeNull();
    expect(defaultTagLabel(null, { event_key: 'fg3_made' })).toBeNull();
  });
  it('a nudge stays inside the video; the default clip is a lead-in and a tail around the moment', () => {
    expect(nudgeMs(3_000, -5_000, 60_000)).toBe(0);
    expect(nudgeMs(58_000, 5_000, 60_000)).toBe(60_000);
    expect(nudgeMs(10_000, 5_000, null)).toBe(15_000);
    expect(clipAround(30_000, 600_000)).toEqual({ start_ms: 22_000, end_ms: 34_000 });
    expect(clipAround(2_000, 600_000)).toEqual({ start_ms: 0, end_ms: 6_000 });
    expect(clipAround(600_000, 600_000)).toEqual({ start_ms: 592_000, end_ms: 600_000 });
  });
});

/** The four faults found after Sprint 3 (Nov 13 2026). */
describe('a removal is not undone by a manager', () => {
  const row = (profile_id: string, highlight_id: string, status: string) => ({ profile_id, highlight_id, status });
  it('a removed row on THIS tag keeps the person off it, whatever the role', () => {
    expect(removedOut([row(P1, 'h1', 'removed'), row(P1, 'h2', 'active')], 'h1')).toEqual([P1]);
    expect(removedOut([row(P1, 'h1', 'removed'), row(P1, 'h2', 'active')], 'h2')).toEqual([]);
  });
  it('someone who took themselves out of the game is not tagged into a new clip of it', () => {
    expect(removedOut([row(P1, 'h1', 'removed'), row(P1, 'h2', 'removed')], 'h3')).toEqual([P1]);
    expect(removedOut([row(P2, 'h1', 'active')], 'h3')).toEqual([]);
    expect(removedOut([], 'h1')).toEqual([]);
  });
});

describe('the writer and the form keep what they were given', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  const server = src('src/lib/videos/videos-server.ts');
  const fields = src('src/components/videos/TagFields.tsx');
  it('a manager reads the LINK of an athlete whose account is gone; nobody else gets the id', () => {
    expect(server).toContain("profile_id: viewer.canManage ? r.profile_id : null, name: maskedName(r.profile_id), handle: null, avatar_url: null, role: r.role, side: r.side, masked: true");
  });
  it('someone already on the tag is not checked again, and the edit route says which tag', () => {
    expect(server).toContain('!alreadyOn.has(v)');
    expect(src('src/app/api/videos/[id]/highlights/[highlightId]/route.ts')).toContain('prepareTag(admin, id, parsed.value.tag, user.id, highlightId, ');
  });
  it('the writer asks who removed themselves before it inserts', () => {
    expect(server).toContain('!(p.profile_id && out.has(p.profile_id))');
  });
  it('the form sends the stored side back and never a stand-in as a typed name', () => {
    expect(fields).toContain('side: p.side ?? null');
    expect(fields).not.toContain('role: p.role, side: null }');
    expect(fields).toContain('.filter(p => !(p.masked && !p.profile_id))');
  });
});

/** Undo of a removal (round 2 PR 5, Nov 13 2026). */
describe('a removal can be undone by whoever made it, for ten minutes', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('the body is exactly the ids the removal answered with', () => {
    expect(parseRestoreBody({ ids: [P1.toUpperCase(), P1, P2] })).toEqual({ ok: true, value: { ids: [P1, P2] } });
    expect(parseRestoreBody({ ids: [] }).ok).toBe(false);
    expect(parseRestoreBody({ ids: ['x'] }).ok).toBe(false);
    expect(parseRestoreBody({ ids: [P1], all: true }).ok).toBe(false);
    expect(parseRestoreBody(null).ok).toBe(false);
    expect(parseRestoreBody({ ids: Array.from({ length: RESTORE_IDS_MAX + 1 }, () => P1) }).ok).toBe(false);
  });
  it('the window is ten minutes back from now', () => {
    expect(RESTORE_WINDOW_MS).toBe(600_000);
    expect(restoreSince(Date.parse('2026-11-13T12:10:00.000Z'))).toBe('2026-11-13T12:00:00.000Z');
  });
  it('only this profile\'s rows on this video, removed by this user, inside the window — and the removal hands back the ids', () => {
    const server = src('src/lib/videos/videos-server.ts');
    for (const part of [".update({ status: 'active', removed_by_user_id: null, removed_at: null })", ".eq('video_id', videoId)", ".eq('status', 'removed')", ".eq('removed_by_user_id', byUserId)", ".gte('removed_at', restoreSince(Date.now()))"]) expect(server).toContain(part);
    expect(server).toContain('return { ok: true, value: { removed: ids.length, ids } };');
    const route = src('src/app/api/videos/[id]/tags/restore/route.ts');
    expect(route).toContain("getServerAuth(request, { limit: 'video-write' })");
    expect(route).toContain("resolveActingProfile(user.id, request.nextUrl.searchParams.get('profileId')");
    expect(route).toContain('restoreTagsOf(getSupabaseAdmin(), id, acting.actorId, user.id, parsed.value.ids)');
    expect(route).not.toContain('readVideoForViewer');
  });
  it('both doors remove at once and offer Undo — no confirm for a reversible act', () => {
    for (const f of ['src/components/videos/TaggedGames.tsx', 'src/components/videos/VideoScreen.tsx']) {
      const ui = src(f);
      expect(ui).toContain('showUndo(');
      expect(ui).toContain('/restore');
      expect(ui).not.toContain('cannot be put back by the people who made them');
    }
  });
});

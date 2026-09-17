import { describe, expect, it } from 'vitest';
import { STAT_SCHEMAS } from '@/lib/sports/stat-schemas';
import { FEATURE_FLAGS } from '@/lib/features';
import { applyIncrement, heroValue, lineHeadline, parseStatWrite, sideTotals, statSchemaFor, topLines } from '../stats';
import { parseScoreWrite, resultFor, resultScore, scoreLabel, sideNamesOf } from '../game';
import { scoreWriteRight, statEntryRight } from '../stats-authz';
import { lineState, nextStatToFlush, overlayStats, parseStatOutbox, removeStatEntry, serializeStatOutbox, upsertStatEntry, markStatEntry } from '../stat-outbox';
import { conflictStatFrom, savedStatVersionFrom, statLinePath, statPayloadFor } from '../stat-flush';
import { DEFAULT_SIDE_NAMES, parseFormatConfig, parseGameConfig, readFormatConfig, readGameConfig } from '../format-config';
import { parseEventTab, tabsFor } from '../tabs';
import { emptyRoundDraft, emptyWizardState, isWizardDirty, localStartIso, localTimeOf, roundBodyFrom, validateRoundDraft, validateWizardStep, withSport, wizardToCreateBody } from '../wizard';
import { validateGroupsPlan } from '../groups';
import { isStatShape, isStatSport, shapeOf, SPORT_EVENT_SPORTS, SPORT_EVENT_SPORTS_ALL, SPORT_EVENT_STAT_SPORTS } from '../types';

const hockey = STAT_SCHEMAS.ice_hockey!;

describe('the vocabulary — every stat sport has a schema and is enabled; the create list stays golf until 215', () => {
  it('pins the lists', () => {
    for (const s of SPORT_EVENT_STAT_SPORTS) {
      expect(STAT_SCHEMAS[s], `${s} has a stat schema`).toBeTruthy();
      expect(FEATURE_FLAGS.FEATURE_SPORTS, `${s} is enabled`).toContain(s);
    }
    expect(SPORT_EVENT_SPORTS).toEqual(['golf']);
    expect(SPORT_EVENT_SPORTS_ALL[0]).toBe('golf');
    expect(isStatSport('soccer')).toBe(true);
    expect(isStatSport('golf')).toBe(false);
    expect(isStatSport('track_field')).toBe(false);
    expect(statSchemaFor('track_field')).toBeNull();
    expect(statSchemaFor('basketball')?.sport_key).toBe('basketball');
  });
  it('the shape: a stored one, else round', () => {
    expect(shapeOf({ sport_key: 'golf' })).toBe('round');
    expect(shapeOf({ sport_key: 'ice_hockey', shape: 'game' })).toBe('game');
    expect(shapeOf({ sport_key: 'ice_hockey', shape: 'bogus' })).toBe('round');
    expect(isStatShape('session')).toBe(true);
    expect(isStatShape('round')).toBe(false);
  });
});

describe('stats — the schema is the vocabulary; a miss is refused by name, never clamped', () => {
  it('parseStatWrite: the whole object + the version', () => {
    expect(parseStatWrite({ stats: { goals: 2, assists: 1 }, expected_version: 0 }, hockey)).toEqual({ ok: true, value: { stats: { goals: 2, assists: 1 }, expected_version: 0 } });
    expect(parseStatWrite({ stats: { goals: 2 } }, hockey)).toMatchObject({ ok: false, error: expect.stringContaining('expected_version') });
    expect(parseStatWrite({ stats: { rebounds: 2 }, expected_version: 0 }, hockey)).toEqual({ ok: false, error: 'Unknown stat "rebounds" for this sport' });
    expect(parseStatWrite({ stats: { goals: 21 }, expected_version: 0 }, hockey)).toEqual({ ok: false, error: 'Goals is out of range' });
    expect(parseStatWrite({ stats: { goals: '2' }, expected_version: 0 }, hockey)).toMatchObject({ ok: false, error: 'Goals must be a number' });
    expect(parseStatWrite({ stats: {}, expected_version: 3, extra: 1 }, hockey)).toEqual({ ok: false, error: 'Unknown field: extra' });
  });
  it('applyIncrement: +1 / −1 within the range, refused at the edge', () => {
    expect(applyIncrement({}, 'goals', 1, hockey)).toEqual({ ok: true, value: { goals: 1 } });
    expect(applyIncrement({ goals: 1 }, 'goals', -1, hockey)).toEqual({ ok: true, value: { goals: 0 } });
    expect(applyIncrement({ goals: 0 }, 'goals', -1, hockey)).toEqual({ ok: false, error: 'Goals is out of range' });
    expect(applyIncrement({}, 'rebounds', 1, hockey)).toMatchObject({ ok: false, error: expect.stringContaining('rebounds') });
  });
  it('the headline, the hero value, side totals, the top lines', () => {
    expect(lineHeadline({ goals: 2, assists: 1 }, hockey)).toMatch(/2 G/);
    expect(lineHeadline({}, hockey)).toBeNull();
    expect(heroValue({ goals: 2, assists: 1 }, hockey)).toBe(3);
    const lines: Array<{ id: string; participant_id: string; stats: Record<string, number> }> = [{ id: 'l1', participant_id: 'p1', stats: { goals: 2 } }, { id: 'l2', participant_id: 'p2', stats: { goals: 1, assists: 3 } }, { id: 'l3', participant_id: 'p3', stats: {} }];
    expect(sideTotals(lines, new Map([['p1', 1], ['p2', 2]]), 'goals')).toEqual({ 1: 2, 2: 1 });
    const top = topLines(lines, hockey, 5);
    expect(top.map(l => l.participant_id)).toEqual(['p2', 'p1']);
    expect(top[0]).toMatchObject({ hero: 4 });
  });
});

describe('game — the score, the result, the sides', () => {
  const score = { side1_score: 4, side2_score: 2, period: 3 };
  it('result and result_score from a side', () => {
    expect(resultFor(1, score)).toBe('W');
    expect(resultFor(2, score)).toBe('L');
    expect(resultFor(1, { side1_score: 2, side2_score: 2, period: 1 })).toBe('T');
    expect(resultFor(1, { side1_score: null, side2_score: 2, period: 1 })).toBeNull();
    expect(resultScore(1, score)).toBe('4-2');
    expect(resultScore(2, score)).toBe('2-4');
    expect(sideNamesOf(null)).toEqual([...DEFAULT_SIDE_NAMES]);
    expect(scoreLabel(score, ['Reds', 'Blues'])).toBe('Reds 4 – 2 Blues · P3');
    expect(scoreLabel({ side1_score: null, side2_score: null, period: null }, ['Reds', 'Blues'])).toBe('Reds – Blues');
  });
  it('parseScoreWrite: both sides 0..999, the period 1..99 (default 1), the version', () => {
    expect(parseScoreWrite({ side1_score: 1, side2_score: 0, expected_version: 0 })).toEqual({ ok: true, value: { side1_score: 1, side2_score: 0, period: 1, expected_version: 0 } });
    expect(parseScoreWrite({ side1_score: -1, side2_score: 0, expected_version: 0 })).toMatchObject({ ok: false, error: expect.stringContaining('side1_score') });
    expect(parseScoreWrite({ side1_score: 1, side2_score: 0, period: 0, expected_version: 0 })).toMatchObject({ ok: false, error: expect.stringContaining('period') });
    expect(parseScoreWrite({ side1_score: 1, side2_score: 0 })).toMatchObject({ ok: false, error: expect.stringContaining('expected_version') });
    expect(parseScoreWrite({ side1_score: 1, side2_score: 0, expected_version: 0, extra: 1 })).toEqual({ ok: false, error: 'Unknown field: extra' });
  });
});

describe('stats-authz — rights come from the ROUND status', () => {
  const base = { viewerId: 'v', ownerProfileId: 'o', eventRole: 'participant' as const, recorder: false, selfEntry: true, roundStatus: 'live' as const };
  it('live: organizers, recorders, the player on their own line under self_entry; strangers refused', () => {
    expect(statEntryRight({ ...base, eventRole: 'co_organizer' })).toEqual({ allowed: true, via: 'organizer' });
    expect(statEntryRight({ ...base, recorder: true })).toEqual({ allowed: true, via: 'recorder' });
    expect(statEntryRight({ ...base, viewerId: 'o' })).toEqual({ allowed: true, via: 'self' });
    expect(statEntryRight({ ...base, viewerId: 'o', selfEntry: false })).toMatchObject({ allowed: false, status: 403, reason: 'recorder_only' });
    expect(statEntryRight({ ...base, viewerId: 'o', selfEntry: false, recorder: true })).toEqual({ allowed: true, via: 'recorder' });
    expect(statEntryRight(base)).toMatchObject({ allowed: false, status: 403 });
  });
  it('scheduled → 409 not_live; completed → organizers only; cancelled → nobody', () => {
    expect(statEntryRight({ ...base, eventRole: 'organizer', roundStatus: 'scheduled' })).toMatchObject({ allowed: false, status: 409, reason: 'not_live' });
    expect(statEntryRight({ ...base, eventRole: 'organizer', roundStatus: 'completed' })).toEqual({ allowed: true, via: 'organizer' });
    expect(statEntryRight({ ...base, recorder: true, roundStatus: 'completed' })).toMatchObject({ allowed: false, status: 409, reason: 'over' });
    expect(statEntryRight({ ...base, eventRole: 'organizer', roundStatus: 'cancelled' })).toMatchObject({ allowed: false, status: 409 });
  });
  it('the score: recorder or organizer only', () => {
    expect(scoreWriteRight({ eventRole: 'participant', recorder: true, roundStatus: 'live' })).toEqual({ allowed: true, via: 'recorder' });
    expect(scoreWriteRight({ eventRole: 'organizer', recorder: false, roundStatus: 'live' })).toEqual({ allowed: true, via: 'organizer' });
    expect(scoreWriteRight({ eventRole: 'participant', recorder: false, roundStatus: 'live' })).toMatchObject({ allowed: false, status: 403 });
    expect(scoreWriteRight({ eventRole: 'participant', recorder: true, roundStatus: 'completed' })).toMatchObject({ allowed: false, status: 409 });
  });
});

describe('stat-outbox + stat-flush — one desired state per line', () => {
  it('upsert overwrites in place, the overlay shows the pending stats, the queue honours the backoff', () => {
    let entries = upsertStatEntry([], { lineId: 'l1', stats: { goals: 1 }, expectedVersion: 0 }, 1000);
    entries = upsertStatEntry(entries, { lineId: 'l1', stats: { goals: 2 }, expectedVersion: 0 }, 2000);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ stats: { goals: 2 }, state: 'pending', queuedAt: 2000 });
    expect(overlayStats([{ id: 'l1', stats: { goals: 0 } }, { id: 'l2', stats: { goals: 5 } }], entries)).toEqual([{ id: 'l1', stats: { goals: 2 } }, { id: 'l2', stats: { goals: 5 } }]);
    expect(lineState(entries, 'l1')).toBe('pending');
    expect(lineState(entries, 'l2')).toBe('saved');
    expect(nextStatToFlush(entries, 2000)?.lineId).toBe('l1');
    const backed = markStatEntry(entries, 'l1', { attempts: 2, queuedAt: 2000 });
    expect(nextStatToFlush(backed, 2500)).toBeNull();
    expect(nextStatToFlush(backed, 7000)?.lineId).toBe('l1');
    expect(removeStatEntry(entries, 'l1')).toEqual([]);
  });
  it('round-trips through storage; a foreign or stale box reads as empty', () => {
    const entries = upsertStatEntry([], { lineId: 'l1', stats: { goals: 1 }, expectedVersion: 2 }, 1000);
    const raw = serializeStatOutbox('r1', entries, 1000);
    expect(parseStatOutbox(raw, 'r1', 2000)).toEqual(entries);
    expect(parseStatOutbox(raw, 'r2', 2000)).toEqual([]);
    expect(parseStatOutbox(raw, 'r1', 1000 + 49 * 3600 * 1000)).toEqual([]);
    expect(parseStatOutbox('{', 'r1')).toEqual([]);
  });
  it('the flush payload and the response readers', () => {
    const e = upsertStatEntry([], { lineId: 'l1', stats: { goals: 1 }, expectedVersion: 2 })[0];
    expect(statPayloadFor(e)).toEqual({ stats: { goals: 1 }, expected_version: 2 });
    expect(statLinePath('e', 'r', 'l')).toBe('/api/sport-events/e/rounds/r/stats/l');
    expect(savedStatVersionFrom({ line: { version: 3 } })).toBe(3);
    expect(savedStatVersionFrom({})).toBeNull();
    expect(conflictStatFrom({ current: { version: 4, stats: { goals: 2 } } })).toEqual({ version: 4, stats: { goals: 2 } });
    expect(conflictStatFrom({ current: null })).toBeNull();
  });
});

describe('format_config.game and the tabs on a team shape', () => {
  it('game: two distinct names on a game shape only; cut / match refused on a team event', () => {
    expect(parseGameConfig({ side_names: ['Reds', ' Blues '] })).toEqual({ ok: true, value: { side_names: ['Reds', 'Blues'] } });
    expect(parseGameConfig({ side_names: ['Reds', 'reds'] })).toMatchObject({ ok: false, error: expect.stringContaining('differ') });
    expect(parseGameConfig({ side_names: ['Reds'] })).toMatchObject({ ok: false });
    expect(parseGameConfig({ side_names: ['', 'B'] })).toMatchObject({ ok: false, error: expect.stringContaining('[0]') });
    expect(parseFormatConfig({ game: { side_names: ['A', 'B'] } }, { roundCount: 1, format: 'stroke_gross', shape: 'game' })).toEqual({ ok: true, value: { game: { side_names: ['A', 'B'] } } });
    expect(parseFormatConfig({ game: { side_names: ['A', 'B'] } }, { roundCount: 1, format: 'stroke_gross', shape: 'session' })).toMatchObject({ ok: false, error: expect.stringContaining('only allowed on a game') });
    expect(parseFormatConfig({ game: { side_names: ['A', 'B'] } }, { roundCount: 1, format: 'stroke_gross' })).toMatchObject({ ok: false });
    expect(parseFormatConfig({ cut: { after_round: 1, top_n: 5 } }, { roundCount: 3, format: 'stroke_gross', shape: 'session' })).toMatchObject({ ok: false, error: expect.stringContaining('team event') });
    expect(parseFormatConfig({ match: { sides: 'singles' } }, { roundCount: 3, format: 'match_gross', shape: 'game' })).toMatchObject({ ok: false, error: expect.stringContaining('team event') });
    expect(readGameConfig({}, 'game')).toEqual({ side_names: ['Home', 'Away'] });
    expect(readGameConfig({ game: { side_names: ['A', 'B'] } }, 'game')).toEqual({ side_names: ['A', 'B'] });
    expect(readGameConfig({ game: { side_names: ['A', 'B'] } }, 'round')).toBeNull();
    expect(readFormatConfig({ game: { side_names: ['A', 'B'] } }, 1, 'stroke_gross', 'game')).toEqual({ game: { side_names: ['A', 'B'] } });
    expect(readFormatConfig({ game: { side_names: ['A', 'B'] } }, 1, 'stroke_gross')).toEqual({});
  });
  it('a team shape shows Stats instead of Leaderboard / Matches / Scorecard; golf is unchanged', () => {
    expect(tabsFor({ canManage: true, roundMinted: true, shape: 'game' })).toEqual(['overview', 'schedule', 'players', 'groups', 'stats', 'gallery']);
    expect(tabsFor({ canManage: false, isPlayer: true, roundMinted: true, shape: 'session' })).toEqual(['overview', 'schedule', 'players', 'stats', 'gallery']);
    expect(tabsFor({ canManage: true, roundMinted: true })).toEqual(['overview', 'schedule', 'players', 'groups', 'leaderboard', 'scorecard', 'gallery']);
    expect(tabsFor({ canManage: true, roundMinted: true, shape: 'round' })).not.toContain('stats');
    expect(parseEventTab('stats', { canManage: false, shape: 'game' })).toBe('stats');
    expect(parseEventTab('stats', { canManage: false })).toBe('overview');
    expect(parseEventTab('leaderboard', { canManage: false, shape: 'game' })).toBe('overview');
  });
});

describe('the wizard — the sport, the shape, the side names, the team round', () => {
  it('a golf state is exactly phase 1\'s body (no shape key)', () => {
    const body = wizardToCreateBody({ ...emptyWizardState(), name: 'X', rounds: [{ ...emptyRoundDraft(), scheduled_on: '2030-01-01', course: { id: null, name: 'C', tees: [], holesCount: null } }] }, { publish: false, profileId: null });
    expect(body).not.toHaveProperty('shape');
    expect(body.sport_key).toBe('golf');
    expect((body as { round?: unknown }).round).toEqual({ scheduled_on: '2030-01-01', name: null, course_id: null, course_name: 'C', tee: null, holes: 18, starting_hole: 1 });
  });
  it('withSport resets the shape and the golf vocabulary; a game sends its sides, a session none', () => {
    const s0 = emptyWizardState();
    const hockey = withSport({ ...s0, format: 'match_net', competition: 'c1' }, 'ice_hockey');
    expect(hockey).toMatchObject({ sport_key: 'ice_hockey', shape: 'game', format: 'stroke_gross', competition: null });
    expect(isWizardDirty(hockey)).toBe(true);
    expect(withSport({ ...hockey, shape: 'session' }, 'basketball').shape).toBe('session');
    expect(withSport(hockey, 'golf')).toMatchObject({ sport_key: 'golf', shape: 'round' });
    const draft = { ...emptyRoundDraft(), scheduled_on: '2030-01-01', place: 'The Rink', starts_at: '19:30' };
    const game = wizardToCreateBody({ ...hockey, name: 'Friday skate', side_names: ['Reds', 'Blues'], rounds: [draft] }, { publish: true, profileId: null });
    expect(game).toMatchObject({ sport_key: 'ice_hockey', shape: 'game', format_config: { game: { side_names: ['Reds', 'Blues'] } }, round: { scheduled_on: '2030-01-01', course_name: 'The Rink', name: null } });
    // The start is the organizer's clock: HH:MM on the date → ISO, and back.
    const startIso = (game as { round: { starts_at: string | null } }).round.starts_at;
    expect(startIso).toMatch(/Z$/);
    expect(localTimeOf(startIso)).toBe('19:30');
    expect(localStartIso('2030-01-01', '9:00')).toBeNull();
    expect(localTimeOf(null)).toBe('');
    expect((game as { round?: unknown }).round).not.toHaveProperty('holes');
    expect(game).not.toHaveProperty('format'); // golf vocabulary — the route refuses it on a team sport
    const session = wizardToCreateBody({ ...hockey, shape: 'session', name: 'Practice', rounds: [draft] }, { publish: true, profileId: null });
    expect(session).not.toHaveProperty('format_config');
    expect(session.shape).toBe('session');
  });
  it('a team round needs a place and a well-formed time; the format step checks the side names', () => {
    const d = { ...emptyRoundDraft(), scheduled_on: '2030-01-01' };
    expect(validateRoundDraft(d, 'soccer')).toMatch(/Where is it/);
    expect(validateRoundDraft({ ...d, place: 'Pitch 2', starts_at: '9:00' }, 'soccer')).toMatch(/HH:MM/);
    expect(validateRoundDraft({ ...d, place: 'Pitch 2', starts_at: '09:00' }, 'soccer')).toBeNull();
    expect(validateRoundDraft({ ...d, place: 'Pitch 2' }, 'golf')).toMatch(/course/);
    expect(roundBodyFrom({ ...d, place: ' Pitch 2 ' }, 'soccer')).toEqual({ scheduled_on: '2030-01-01', name: null, course_name: 'Pitch 2', starts_at: null, timezone: expect.any(String) });
    const s = withSport(emptyWizardState(), 'soccer');
    expect(validateWizardStep('format', { ...s, side_names: ['A', 'a'] })).toMatch(/different names/);
    expect(validateWizardStep('format', { ...s, side_names: ['', 'B'] })).toMatch(/Name both sides/);
    expect(validateWizardStep('format', { ...s, side_names: ['A', 'B'], capacity: '0' })).toMatch(/Field size/);
    expect(validateWizardStep('format', { ...s, side_names: ['A', 'B'] })).toBeNull();
    expect(validateWizardStep('format', { ...s, shape: 'session', side_names: ['A', 'a'] })).toBeNull();
  });
});

describe('groups on a game — a side is sent (1 | 2) or left open, never derived; refused elsewhere', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const eligible = new Set([a, b]);
  it('admits explicit sides on a game and leaves a plain id open', () => {
    expect(validateGroupsPlan({ groups: [{ members: [{ participant_id: a, side: 1 }, b] }] }, eligible, { sides: null, game: true })).toMatchObject({ ok: true, value: [{ members: [{ participant_id: a, position: 1, side: 1 }, { participant_id: b, position: 2, side: null }] }] });
    expect(validateGroupsPlan({ groups: [{ members: [{ participant_id: a, side: 1 }, b] }] }, eligible, { sides: null })).toMatchObject({ ok: false, error: expect.stringContaining('match-play event or a game') });
    expect(validateGroupsPlan({ groups: [{ members: [{ participant_id: a, side: 3 }] }] }, eligible, { sides: null, game: true })).toMatchObject({ ok: false });
  });
});

import { splitSides } from '../game';

describe('splitSides (leftovers PR 5)', () => {
  it('a player on both rosters plays home; no duplicates; roster order kept', () => {
    expect(splitSides(['a', 'b', 'a'], ['b', 'c', 'c'])).toEqual([['a', 'b'], ['c']]);
    expect(splitSides([], ['x'])).toEqual([[], ['x']]);
  });
});

import { test, expect, request as pwRequest } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';

// Golf's sport profile, the reads ("one wave", phase 3, PR 1 — Nov 2026).
// Career → Season (the calendar year) → Round → Hole from golf_rounds and
// golf_holes. A round its owner hid counts in every total and is never
// listed, sent or opened for anyone else; a block closes all of it.

interface Totals { rounds: number; scored: number; avg18: number | null; best18: { gross: number; roundId: string | null } | null; kinds: Record<string, number>; fairways: { hit: number; of: number }; byPar: Array<{ par: number; holes: number; toPar: number }> }
interface Golf { supported: boolean; kind: string; career: Totals; seasons: Array<Totals & { year: string; courses: Array<{ course: string; rounds: number }> }>; rounds: Array<{ id: string; date: string; hidden: boolean; toPar: number | null }>; can_edit: boolean; handicap: { index: number | null } }

test('golf\'s sport profile: totals over every round, the list and the holes only for rounds the viewer may see; a block closes it', async () => {
  test.setTimeout(180_000);
  const owner = await createQaUser({ displayName: 'Gil Golfer', firstName: 'Gil', lastName: 'Golfer' });
  const visitor = await createQaUser({ displayName: 'Vic Visitor', firstName: 'Vic', lastName: 'Visitor' });
  const admin = adminClient();
  const ownerApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(owner), extraHTTPHeaders: bypassHeaders() });
  const visitorApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(visitor), extraHTTPHeaders: bypassHeaders() });
  try {
    expect((await admin.from('profiles').update({ visibility: 'public' }).eq('id', owner.id)).error).toBeNull();
    const round = (date: string, gross: number | null, extra: Record<string, unknown> = {}) => ({ profile_id: owner.id, date, course: 'QA Links', holes: 18, par: 72, gross_score: gross, is_complete: gross !== null, round_type: 'outdoor', ...extra });
    const { data: rows, error } = await admin.from('golf_rounds').insert([
      round('2026-06-01', 82),
      round('2026-07-01', 78, { course: 'QA Dunes' }),
      round('2026-08-01', 70, { profile_hidden_at: new Date().toISOString() }),
      round('2025-05-05', 90),
    ]).select('id, date');
    expect(error, error?.message).toBeNull();
    const idOn = (date: string) => (rows ?? []).find(r => r.date === date)!.id as string;
    const hole = (round_id: string, hole_number: number, par: number, strokes: number, extra: Record<string, unknown> = {}) => ({ round_id, hole_number, par, strokes, ...extra });
    const { error: holeErr } = await admin.from('golf_holes').insert([
      hole(idOn('2026-06-01'), 1, 4, 5, { putts: 2, fairway_hit: true, green_in_regulation: false }),
      hole(idOn('2026-06-01'), 2, 3, 2, { putts: 1, green_in_regulation: true }),
      hole(idOn('2026-07-01'), 1, 4, 4, { fairway_hit: false }),
      hole(idOn('2026-08-01'), 1, 5, 3, { fairway_hit: true }), // the hidden round's eagle
    ]);
    expect(holeErr, holeErr?.message).toBeNull();

    const read = async (api: typeof ownerApi, extra = '') => {
      const r = await api.get(`/api/profile/${owner.id}/sport-profile?sport=golf${extra}`);
      expect(r.status(), await readErrorBody(r)).toBe(200);
      expect(r.headers()['cache-control']).toBe('private, no-store');
      return r.json();
    };

    // ── The visitor: every round counts; the hidden one is never listed and never a door.
    const seen = (await read(visitorApi)) as Golf;
    expect(seen).toMatchObject({ supported: true, kind: 'golf', can_edit: false });
    expect(seen.career).toMatchObject({ rounds: 4, scored: 4, avg18: 80 });
    expect(seen.career.best18).toMatchObject({ gross: 70, roundId: null });
    expect(seen.career.kinds).toMatchObject({ eagle: 1, birdie: 1, par: 1, bogey: 1 });
    expect(seen.career.fairways).toEqual({ hit: 2, of: 3 });
    expect(seen.seasons.map(s => [s.year, s.rounds])).toEqual([['2026', 3], ['2025', 1]]);
    expect(seen.seasons[0].courses.map(c => [c.course, c.rounds])).toEqual([['QA Links', 2], ['QA Dunes', 1]]);
    expect(seen.rounds.map(r => r.id)).toEqual([idOn('2026-07-01'), idOn('2026-06-01'), idOn('2025-05-05')]);
    expect(seen.rounds.map(r => r.toPar)).toEqual([6, 10, 18]);
    const holes = (await read(visitorApi, '&holes=2026')) as { kind: string; year: string; holes: Record<string, Array<{ n: number; strokes: number }>> };
    expect(holes.kind).toBe('golf-holes');
    expect(Object.keys(holes.holes).sort()).toEqual([idOn('2026-06-01'), idOn('2026-07-01')].sort());
    expect(holes.holes[idOn('2026-06-01')].map(h => [h.n, h.strokes])).toEqual([[1, 5], [2, 2]]);

    // ── The athlete: the hidden round is listed, marked, and the door to their best.
    const mine = (await read(ownerApi)) as Golf;
    expect(mine.can_edit).toBe(true);
    expect(mine.rounds).toHaveLength(4);
    expect(mine.rounds.find(r => r.id === idOn('2026-08-01'))?.hidden).toBe(true);
    expect(mine.career.best18).toMatchObject({ gross: 70, roundId: idOn('2026-08-01') });
    expect(Object.keys(((await read(ownerApi, '&holes=2026')) as { holes: Record<string, unknown> }).holes)).toHaveLength(3);

    // ── A block closes it; a bad year is the whole profile, not an error.
    expect(((await read(visitorApi, '&holes=20x6')) as Golf).kind).toBe('golf');
    expect((await admin.from('user_blocks').insert({ blocker_id: owner.id, blocked_id: visitor.id })).error).toBeNull();
    expect((await visitorApi.get(`/api/profile/${owner.id}/sport-profile?sport=golf`)).status()).toBe(404);
    expect((await visitorApi.get(`/api/profile/${owner.id}/sport-profile?sport=golf&holes=2026`)).status()).toBe(404);
  } finally {
    await ownerApi.dispose();
    await visitorApi.dispose();
    await deleteQaUser(owner.id);
    await deleteQaUser(visitor.id);
  }
});

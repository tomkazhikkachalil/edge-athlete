import { test, expect } from './helpers/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { cleanup } from './helpers/cleanup';

// Migration 320 (Nov 25 2026): each penalty on a hole keeps its own stroke
// value, aligned with its type. Through the API only: stored and read back,
// reset when an older writer names the types alone, cleared with the types,
// refused when malformed — and NEVER added to the score.
test('penalty strokes: stored with their types, reset by a types-only write, cleared with them, never scored', async () => {
  const me = loadQaUser('user.json');
  const api = await apiAs('state.json');
  const admin = adminClient();
  const stamp = Date.now();
  let groupPostId = '';
  try {
    const created = await api.post('/api/group-posts', {
      data: {
        type: 'golf_round',
        title: `QA Penalty Round ${stamp}`,
        date: new Date().toISOString().split('T')[0],
        participant_ids: [],
        golf_data: { course_name: `QA Penalty Course ${stamp}`, round_type: 'outdoor', holes_played: 9 },
      },
    });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    groupPostId = (await created.json()).group_post.id as string;
    const gp = await api.get(`/api/group-posts/${groupPostId}`);
    const participants = (await gp.json()).group_post.participants as Array<{ id: string; profile_id: string }>;
    const mine = participants.find(p => p.profile_id === me.id)!;
    const url = `/api/golf/scorecards/${mine.id}/scores`;
    type Hole = { hole_number: number; strokes: number; penalties: string[] | null; penalty_strokes: number[] | null };
    const hole1 = async () => {
      const card = await api.get(url);
      expect(card.ok(), await readErrorBody(card)).toBe(true);
      const golf = (await card.json()).golf_scores as { total_score: number; hole_scores: Hole[] };
      return { total: golf.total_score, hole: golf.hole_scores.find(h => h.hole_number === 1)! };
    };

    // Types with their strokes.
    let res = await api.post(url, { data: { scores: [{ hole_number: 1, strokes: 7, putts: 2, penalties: ['out_of_bounds', 'lost_ball'], penalty_strokes: [1, 2] }] } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    let now = await hole1();
    expect(now.hole.penalties).toEqual(['out_of_bounds', 'lost_ball']);
    expect(now.hole.penalty_strokes).toEqual([1, 2]);
    // Descriptive: the score is the strokes entered, nothing added.
    expect(now.hole.strokes).toBe(7);
    expect(now.total).toBe(7);

    // A score without the penalties key leaves both arrays alone.
    res = await api.post(url, { data: { scores: [{ hole_number: 1, strokes: 6, putts: 2 }] } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    now = await hole1();
    expect(now.hole.strokes).toBe(6);
    expect(now.hole.penalties).toEqual(['out_of_bounds', 'lost_ball']);
    expect(now.hole.penalty_strokes).toEqual([1, 2]);

    // An older writer names the types alone: the stale strokes do not stay.
    res = await api.post(url, { data: { scores: [{ hole_number: 1, strokes: 6, penalties: ['water'] }] } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    now = await hole1();
    expect(now.hole.penalties).toEqual(['water']);
    expect(now.hole.penalty_strokes).toBeNull();

    // All ones is "one each": stored as null.
    res = await api.post(url, { data: { scores: [{ hole_number: 1, strokes: 6, penalties: ['water', 'drop'], penalty_strokes: [1, 1] }] } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    expect((await hole1()).hole.penalty_strokes).toBeNull();

    // Malformed: refused by name, nothing written.
    for (const [body, said] of [
      [{ hole_number: 1, strokes: 6, penalties: ['water'], penalty_strokes: [1, 2] }, /one per penalty/],
      [{ hole_number: 1, strokes: 6, penalties: ['water'], penalty_strokes: [10] }, /between 1 and 9/],
      [{ hole_number: 1, strokes: 6, penalty_strokes: [2] }, /must come with penalties/],
    ] as const) {
      const bad = await api.post(url, { data: { scores: [body] } });
      expect(bad.status()).toBe(400);
      expect((await bad.json()).error).toMatch(said);
    }
    expect((await hole1()).hole.penalties).toEqual(['water', 'drop']);

    // Cleared together.
    res = await api.post(url, { data: { scores: [{ hole_number: 1, strokes: 6, penalties: [] }] } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    now = await hole1();
    expect(now.hole.penalties ?? []).toEqual([]);
    expect(now.hole.penalty_strokes).toBeNull();
  } finally {
    await cleanup('penalty-strokes', [
      // A round with a score is a result the API will not delete; purge QA's own.
      () => groupPostId && admin.from('group_posts').delete().eq('id', groupPostId),
      () => api.dispose(),
    ]);
  }
});

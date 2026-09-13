import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Data foundation F4 (Sep 13 2026): every writer projects its fact into
// athlete_performances (migration 194) AFTER the origin write, and a lost
// fact is a deleted row. This spec follows a stat-line post and a solo
// golf round through create → edit → delete and reads the table through
// the service role (posture A — no policy lets a session see it). Skips
// on a target without 194. The live-round mirror (source live_round) and
// the league overlay are exercised by the prod probe, not here — a scored
// live round is a multi-participant flow this spec does not seed.
test('performance rows follow a stat-line post and a solo golf round through create, edit and delete', async () => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const probe = await admin.from('athlete_performances').select('id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 194 not applied on this target');
  expect(probe.error, probe.error?.message).toBeNull();

  const user = loadQaUser('user.json');
  const api = await apiAs('state.json');
  const stamp = Date.now();

  const rowFor = async (key: string, expectPresent: boolean): Promise<Record<string, unknown> | null> => {
    for (let i = 0; i < 30; i++) {
      const { data, error } = await admin.from('athlete_performances').select('*').eq('natural_key', key).maybeSingle();
      expect(error, error?.message).toBeNull();
      if (!!data === expectPresent) return data;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`athlete_performances row ${key} did not become ${expectPresent ? 'present' : 'absent'}`);
  };

  let postId = '';
  let roundId = '';
  try {
    // ── A stat-line post ──────────────────────────────────────────────────
    const post = await api.post('/api/posts', {
      data: {
        caption: `Performance hockey ${stamp}`,
        visibility: 'private',
        postType: 'ice_hockey',
        stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2026-09-10', opponent: 'Wolves', result: 'W', result_score: '4-2', stats: { goals: 2, assists: 1 } },
      },
    });
    expect(post.ok(), await readErrorBody(post)).toBe(true);
    postId = (await post.json()).post.id;
    const line = await rowFor(`post:${postId}`, true);
    expect(line).toMatchObject({
      profile_id: user.id,
      sport_key: 'ice_hockey',
      occurred_on: '2026-09-10',
      source: 'post',
      source_table: 'posts',
      source_id: postId,
      provenance: 'self_reported',
      dispute_status: 'none',
      metrics: { goals: 2, assists: 1 },
      context: { opponent: 'Wolves', result: 'W', result_score: '4-2' },
    });
    expect(Number(line?.headline)).toBe(3);

    const postKey = `post:${postId}`;
    const gone = await api.delete(`/api/posts?postId=${postId}`);
    expect(gone.ok(), await readErrorBody(gone)).toBe(true);
    postId = '';
    await rowFor(postKey, false);

    // ── A solo golf round: create (bogey golf) → edit (par golf) → delete ──
    const holesData = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, score: 5 }));
    const golf = await api.post('/api/posts', {
      data: {
        caption: `Performance round ${stamp}`,
        visibility: 'private',
        postType: 'golf',
        golfData: { date: '2026-09-11', courseName: `QA Links ${stamp}`, holes: '18', coursePar: 72, holesData },
      },
    });
    expect(golf.ok(), await readErrorBody(golf)).toBe(true);
    const golfPost = (await golf.json()).post;
    // The response projects the post; the origin link is the row's round_id.
    const { data: golfRow } = await admin.from('posts').select('round_id').eq('id', golfPost.id).maybeSingle();
    roundId = (golfRow?.round_id as string | null) ?? '';
    expect(roundId, 'the golf post carries its round').toBeTruthy();
    const round = await rowFor(`golf_round:${roundId}`, true);
    expect(round).toMatchObject({
      profile_id: user.id,
      sport_key: 'golf',
      occurred_on: '2026-09-11',
      source: 'post',
      source_table: 'golf_rounds',
      source_id: roundId,
      provenance: 'self_reported',
    });
    expect((round?.metrics as Record<string, number>).gross).toBe(90);
    expect((round?.metrics as Record<string, number>).to_par).toBe(18);
    expect((round?.metrics as Record<string, number>).differential, 'no rating and slope → no differential').toBeUndefined();
    expect(Number(round?.headline)).toBe(90);

    const edit = await api.patch(`/api/golf/rounds/${roundId}`, {
      data: { holes: Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, strokes: 4 })) },
    });
    expect(edit.ok(), await readErrorBody(edit)).toBe(true);
    for (let i = 0; i < 30; i++) {
      const { data } = await admin.from('athlete_performances').select('metrics, headline').eq('natural_key', `golf_round:${roundId}`).maybeSingle();
      if (data && (data.metrics as Record<string, number>).gross === 72) break;
      await new Promise(r => setTimeout(r, 500));
    }
    const edited = await rowFor(`golf_round:${roundId}`, true);
    expect((edited?.metrics as Record<string, number>).gross).toBe(72);
    expect(Number(edited?.headline)).toBe(72);

    const del = await api.delete(`/api/golf/rounds/${roundId}`);
    expect(del.ok(), await readErrorBody(del)).toBe(true);
    const roundKey = `golf_round:${roundId}`;
    roundId = '';
    await rowFor(roundKey, false);
    // The round's feed post is its own delete (the round outlives no post).
    const postGone = await api.delete(`/api/posts?postId=${golfPost.id}`);
    expect(postGone.ok(), await readErrorBody(postGone)).toBe(true);
  } finally {
    if (postId) await api.delete(`/api/posts?postId=${postId}`).catch(() => {});
    if (roundId) await api.delete(`/api/golf/rounds/${roundId}`).catch(() => {});
    await api.dispose();
  }
});

import { test, expect } from './helpers/test';
import { cleanup } from './helpers/cleanup';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Nov 19 2026 (Tom's group round): two faults while scoring for a group.
//   • Tapping another player jumped the scorer back to an early hole.
//   • The round ended, and locked, as soon as ONE golfer had every hole.

type Card = { scorecard: { group_post: { status: string }; participants: Array<{ participant: { id: string; profile_id: string; profile?: { first_name?: string | null } | null }; scores: { holes_completed?: number | null; hole_scores?: Array<{ hole_number: number; strokes: number | null }> } | null }> } };

const today = () => new Date().toISOString().split('T')[0];
async function startRound(api: Awaited<ReturnType<typeof apiAs>>, partnerIds: string[], label: string) {
  const res = await api.post('/api/group-posts', {
    data: { type: 'golf_round', title: `QA ${label} ${Date.now()}`, date: today(), visibility: 'private', participant_ids: partnerIds, golf_data: { course_name: `QA ${label} Course ${Date.now()}`, round_type: 'outdoor', holes_played: 9 } },
  });
  expect(res.ok(), await readErrorBody(res)).toBe(true);
  return (await res.json()).group_post.id as string;
}
const readCard = async (api: Awaited<ReturnType<typeof apiAs>>, id: string) => (await (await api.get(`/api/group-posts/${id}/scorecard`)).json()) as Card;
const rowOf = (card: Card, profileId: string) => card.scorecard.participants.find(p => p.participant.profile_id === profileId)!;
const holes = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ hole_number: from + i, strokes: 4 }));

test('switching players keeps the hole on screen, and saves the hole being left', async ({ page }) => {
  test.setTimeout(150_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const api = await apiAs('state.json');
  let id = '';
  try {
    id = await startRound(api, [userB.id], 'Switch');
    const card = await readCard(api, id);
    const rowA = rowOf(card, userA.id).participant.id;
    const rowB = rowOf(card, userB.id).participant.id;
    // A has holes 1–4. B has 1 and 3: a GAP at 2, the hole the scorer used to jump back to.
    expect((await api.post(`/api/golf/scorecards/${rowA}/scores`, { data: { scores: holes(1, 4) } })).status()).toBe(201);
    expect((await api.post(`/api/golf/scorecards/${rowB}/scores`, { data: { scores: [{ hole_number: 1, strokes: 4 }, { hole_number: 3, strokes: 5 }] } })).status()).toBe(201);
    await page.goto(`/live/${id}`);
    // The scorer opens on A's first unscored hole.
    await expect(page.getByText('Hole 5 of 9')).toBeVisible({ timeout: 30_000 });
    // By the card's id: the QA accounts share a first name.
    const chip = (rowId: string) => page.locator(`[data-scorer-player="${rowId}"]`);
    // Typing a digit on the wheel commits it (the quick-entry contract).
    const typeStrokes = async (digit: string) => {
      const strokes = page.getByRole('spinbutton', { name: 'Strokes' });
      await strokes.focus();
      await strokes.press(digit);
      await expect(strokes).toHaveAttribute('aria-valuenow', digit);
    };

    // To B: the same hole, not B's gap at hole 2.
    await expect(chip(rowA)).toHaveAttribute('aria-pressed', 'true');
    await chip(rowB).click();
    await expect(chip(rowB)).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(page.getByText('Hole 5 of 9')).toBeVisible();
    await expect(page.getByText('Hole 2 of 9')).toHaveCount(0);

    // Score B's hole 5 and leave it by the chip: it is saved, and A opens on hole 5 too.
    await typeStrokes('6');
    await chip(rowA).click();
    await expect(chip(rowA)).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(page.getByText('Hole 5 of 9')).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => rowOf(await readCard(api, id), userB.id).scores?.hole_scores?.find(h => h.hole_number === 5)?.strokes, { timeout: 15_000 }).toBe(6);

    // Next still walks on, and a switch from there carries the new hole.
    await typeStrokes('4');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Hole 6 of 9')).toBeVisible({ timeout: 15_000 });
    await chip(rowB).click();
    await expect(chip(rowB)).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(page.getByText('Hole 6 of 9')).toBeVisible();
  } finally {
    await cleanup('live-scoring-switch', [
      () => id && api.patch(`/api/group-posts/${id}`, { data: { status: 'cancelled' } }),
      () => id && api.delete(`/api/group-posts/${id}`),
      () => api.dispose(),
    ]);
  }
});

test('a group round finishes when the LAST golfer\'s card fills, not the first; an already-played round still finishes on the entered card', async ({ page }) => {
  test.setTimeout(150_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const userC = loadQaUser('user-c.json');
  const api = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  let live = '';
  let played = '';
  let notCreator = '';
  try {
    live = await startRound(api, [userB.id, userC.id], 'Group Finish');
    let card = await readCard(api, live);
    const row = (profile: string) => rowOf(card, profile).participant.id;
    const fill = async (profile: string, upTo: number) =>
      expect((await api.post(`/api/golf/scorecards/${row(profile)}/scores`, { data: { scores: holes(1, upTo) } })).status()).toBe(201);

    // The creator's own card is full; B and C have nothing: the round is NOT finished.
    await fill(userA.id, 9);
    card = await readCard(api, live);
    expect(card.scorecard.group_post.status).toBe('active');

    // …and the creator is not locked out: the live page still opens the scorer, on a golfer who is not done.
    await page.goto(`/live/${live}`);
    await expect(page.getByText(/Hole 1 of 9/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Your card is complete')).toHaveCount(0);
    await expect(page.getByText('This round is final')).toHaveCount(0);

    await fill(userB.id, 9);
    await fill(userC.id, 8);
    expect((await readCard(api, live)).scorecard.group_post.status).toBe('active');
    // The last hole of the last card finishes it.
    expect((await api.post(`/api/golf/scorecards/${row(userC.id)}/scores`, { data: { scores: [{ hole_number: 9, strokes: 4 }] } })).status()).toBe(201);
    await expect.poll(async () => (await readCard(api, live)).scorecard.group_post.status, { timeout: 15_000 }).toBe('completed');

    // An ALREADY PLAYED round: the creator enters only their own card and says so.
    played = await startRound(api, [userB.id], 'Already Played');
    const batch = await api.post('/api/golf/participant-scores', { data: { group_post_id: played, already_played: true, participant_scores: [{ participant_id: userA.id, hole_scores: holes(1, 9) }] } });
    expect(batch.ok(), await readErrorBody(batch)).toBe(true);
    await expect.poll(async () => (await readCard(api, played)).scorecard.group_post.status, { timeout: 15_000 }).toBe('completed');

    // Only the creator may say so: a partner filling their own card with the flag does not end the round.
    notCreator = await startRound(api, [userB.id], 'Not Creator');
    const asB = await apiB.post('/api/golf/participant-scores', { data: { group_post_id: notCreator, already_played: true, participant_scores: [{ participant_id: userB.id, hole_scores: holes(1, 9) }] } });
    expect(asB.ok(), await readErrorBody(asB)).toBe(true);
    expect((await readCard(api, notCreator)).scorecard.group_post.status).toBe('active');
  } finally {
    await cleanup('live-scoring-finish', [
      ...[live, played, notCreator].flatMap(id => [
        () => id && api.patch(`/api/group-posts/${id}`, { data: { status: 'cancelled' } }),
        () => id && api.delete(`/api/group-posts/${id}`),
      ]),
      () => api.dispose(),
      () => apiB.dispose(),
    ]);
  }
});

// Found while tracing Tom's list: the creator's own Finish wrote the status and
// then skipped the record (the guarded writer saw "already completed").
test('Finish round by hand writes the golf record for the cards that were scored', async () => {
  test.setTimeout(90_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const api = await apiAs('state.json');
  const admin = adminClient();
  let id = '';
  try {
    id = await startRound(api, [userB.id], 'Manual Finish');
    const card = await readCard(api, id);
    expect((await api.post(`/api/golf/scorecards/${rowOf(card, userA.id).participant.id}/scores`, { data: { scores: holes(1, 9) } })).status()).toBe(201);
    // B never scores: the round stays live until the creator finishes it.
    expect((await readCard(api, id)).scorecard.group_post.status).toBe('active');
    const none = await admin.from('golf_rounds').select('id').eq('group_post_id', id);
    expect(none.data ?? []).toHaveLength(0);
    const end = await api.patch(`/api/group-posts/${id}`, { data: { status: 'completed' } });
    expect(end.ok(), await readErrorBody(end)).toBe(true);
    await expect.poll(async () => ((await admin.from('golf_rounds').select('id, profile_id').eq('group_post_id', id)).data ?? []).map(r => r.profile_id), { timeout: 15_000 }).toEqual([userA.id]);
  } finally {
    await cleanup('live-scoring-manual-finish', [
      () => id && admin.from('golf_rounds').delete().eq('group_post_id', id),
      () => id && api.delete(`/api/group-posts/${id}`),
      () => api.dispose(),
    ]);
  }
});


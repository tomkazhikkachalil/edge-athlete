import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

type ScoresResponse = { results: Array<{ participant_id: string }>; failures: Array<{ participant_id: string; error: string }> };

// Shared-round invite: A creates a golf round with B as participant via API
// (the composer's Tag People search is public-only, so a private B is
// invisible there), and B receives the group_invite notification. There is
// no follow/visibility gate on participants — the round creator may add any
// profile. Teardown: the round is A's group_posts row, deleted by the
// existing golf chain in deleteQaUser.
test('round invite: A adds B to a shared round, B is notified', async ({ browser }) => {
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();

  const apiA = await apiAs('state.json');
  try {
    const res = await apiA.post('/api/group-posts', {
      data: {
        type: 'golf_round',
        title: `QA Shared Round ${stamp}`,
        date: new Date().toISOString().split('T')[0],
        participant_ids: [userB.id],
      },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
  } finally {
    await apiA.dispose();
  }

  // B sees the invite notification (group_invite renders the DB title — no
  // getNotificationText case; visible on the default "All" tab). The title
  // is built by notifyGroupInvites from first+last → "Edge Alpha".
  const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
  try {
    const pageB = await ctxB.newPage();
    await pageB.goto('/app/notifications');
    await expect(pageB.getByText('Edge Alpha added you to a shared round').first())
      .toBeVisible({ timeout: 15_000 });
  } finally {
    await ctxB.close();
  }
});

// The creator scores ANOTHER player, then re-scores them — the regression for
// migration 200. Both routes always authorised the creator at the app level
// and then UPSERTed through the session client; the first entry is a pure
// INSERT (always worked), the re-submit is INSERT … ON CONFLICT DO UPDATE,
// which also needs the UPDATE policy — participant-only from 004 until 200.
// The bulk route reported that failure as a 200 with failures[], which is
// why the assertion is on `failures`, not on the status. The read-back
// through the scorecard GET proves the SECURITY INVOKER totals trigger
// recomputed as the creator (199's fold on golf_participant_scores).
test('round scores: the creator enters, then re-enters, another player\'s scores and their own', async () => {
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();

  const apiA = await apiAs('state.json');
  try {
    const created = await apiA.post('/api/group-posts', {
      data: {
        type: 'golf_round',
        title: `QA Rescored Round ${stamp}`,
        date: new Date().toISOString().split('T')[0],
        participant_ids: [userB.id],
        golf_data: { course_name: `QA Rescored Course ${stamp}`, round_type: 'outdoor', holes_played: 9 },
      },
    });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    const groupPostId = (await created.json()).group_post.id as string;

    const submit = async (participantId: string, strokes: number, label: string) => {
      const res = await apiA.post('/api/golf/participant-scores', {
        data: {
          group_post_id: groupPostId,
          participant_scores: [
            { participant_id: participantId, hole_scores: [{ hole_number: 1, strokes }, { hole_number: 2, strokes }] },
          ],
        },
      });
      expect(res.ok(), `${label}: ${await readErrorBody(res)}`).toBe(true);
      const body = (await res.json()) as ScoresResponse;
      expect(body.failures, `${label}: ${JSON.stringify(body)}`).toEqual([]);
      expect(body.results.map(r => r.participant_id), label).toEqual([participantId]);
    };

    await submit(userB.id, 4, "B's scores, first entry (INSERT)");
    await submit(userB.id, 6, "B's scores, re-submitted (ON CONFLICT DO UPDATE — 42501 before 200)");
    await submit(userA.id, 5, "A's own scores, first entry");
    await submit(userA.id, 3, "A's own scores, re-submitted");

    // Read back B's card: the second submission's strokes, and a total the
    // trigger recomputed as the creator.
    const gp = await apiA.get(`/api/group-posts/${groupPostId}`);
    expect(gp.ok(), await readErrorBody(gp)).toBe(true);
    const participants = (await gp.json()).group_post.participants as Array<{ id: string; profile_id: string }>;
    const rowB = participants.find(p => p.profile_id === userB.id);
    expect(rowB, 'B is a participant').toBeTruthy();
    const card = await apiA.get(`/api/golf/scorecards/${rowB!.id}/scores`);
    expect(card.ok(), await readErrorBody(card)).toBe(true);
    const golf = (await card.json()).golf_scores as { total_score: number; hole_scores: Array<{ hole_number: number; strokes: number }> };
    expect(golf.hole_scores.sort((a, b) => a.hole_number - b.hole_number).map(h => h.strokes)).toEqual([6, 6]);
    expect(golf.total_score).toBe(12);
  } finally {
    await apiA.dispose();
  }
});

import { test, expect, type Page } from './helpers/test';
import { cleanup } from './helpers/cleanup';
import { adminClient, apiAs, readErrorBody } from './helpers/qa-user';

// Nov 19 2026: the round's own detail page (/app/sport/golf/rounds/[id]) had
// each hole's yardage in its data and never drew it. One column, beside Par,
// only when the round kept a yardage.

const today = () => new Date().toISOString().split('T')[0];
const YARDS = [350, 410, 165, 520, 388, 402, 178, 545, 430];

async function seedRound(withYardage: boolean) {
  const api = await apiAs('state.json');
  const res = await api.post('/api/group-posts', {
    data: {
      type: 'golf_round', title: `QA Detail Yards ${Date.now()}`, date: today(), visibility: 'private', participant_ids: [],
      golf_data: {
        course_name: `QA Detail Yards Course ${Date.now()}`, round_type: 'outdoor', holes_played: 9,
        hole_data: YARDS.map((y, i) => ({ hole: i + 1, par: y < 250 ? 3 : y > 480 ? 5 : 4, ...(withYardage ? { yardage: y } : {}) })),
      },
    },
  });
  expect(res.ok(), await readErrorBody(res)).toBe(true);
  const body = await res.json();
  const id = body.group_post.id as string;
  const me = body.group_post.creator_id as string;
  // The whole card at once: the round completes and is copied to the profile.
  const scored = await api.post('/api/golf/participant-scores', {
    data: { group_post_id: id, already_played: true, participant_scores: [{ participant_id: me, hole_scores: YARDS.map((_, i) => ({ hole_number: i + 1, strokes: 4 })) }] },
  });
  expect(scored.ok(), await readErrorBody(scored)).toBe(true);
  const admin = adminClient();
  let roundId = '';
  await expect.poll(async () => {
    const { data } = await admin.from('golf_rounds').select('id').eq('group_post_id', id).limit(1);
    roundId = (data?.[0]?.id as string) ?? '';
    return roundId;
  }, { timeout: 20_000 }).not.toBe('');
  return { api, admin, id, roundId };
}

async function run(page: Page, label: string) {
  const withYards = await seedRound(true);
  const without = await seedRound(false);
  try {
    await page.goto(`/app/sport/golf/rounds/${withYards.roundId}`);
    await expect(page.locator('[data-round-detail-yds-head]')).toBeVisible({ timeout: 30_000 });
    for (const [i, y] of YARDS.entries()) {
      await expect(page.locator(`[data-round-detail-yds="${i + 1}"]`)).toHaveText(String(y));
    }
    // Nothing is pushed off the screen by the extra column.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    // A round with no stored yardage draws no empty column.
    await page.goto(`/app/sport/golf/rounds/${without.roundId}`);
    await expect(page.getByRole('columnheader', { name: 'Par' })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-round-detail-yds-head]')).toHaveCount(0);
  } finally {
    await cleanup(label, [withYards, without].flatMap(r => [
      () => r.admin.from('golf_rounds').delete().eq('group_post_id', r.id),
      () => r.api.delete(`/api/group-posts/${r.id}`),
      () => r.api.dispose(),
    ]));
  }
}

test('the round detail page shows each hole\'s yardage beside its par', async ({ page }) => {
  test.setTimeout(120_000);
  await run(page, 'round-detail-yardage');
});

test('the round detail page shows each hole\'s yardage beside its par on a phone @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await run(page, 'round-detail-yardage-mobile');
});

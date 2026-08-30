import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The round post's way INTO its detail, and the order that detail reads in.
//
// Three properties, all of which regressed or were missing before this spec:
//   1. the hole count reports what was PLAYED (holes_played is written once
//      at round creation and never recomputed, so it claimed 18 forever);
//   2. the card offers a way through at the TOP, not only under the roster;
//   3. the detail leads with media and scores, with the course reference
//      material collapsed at the bottom.
//
// The round is created + scored + completed over the API (the composer path
// is covered by golf-quick-entry; this spec is about the READING surfaces),
// then driven through the real app.

const stamp = () => Date.now();

/** A completed 13-of-18 round: partial on purpose, so the count has to be
 *  derived rather than echoed back from the configured length. */
async function createPartialRound(
  api: APIRequestContext,
  userId: string
): Promise<{ groupPostId: string; postId: string; courseName: string }> {
  const courseName = `QA Details Course ${stamp()}`;
  const created = await api.post('/api/group-posts', {
    data: {
      type: 'golf_round',
      title: `QA Details Round ${stamp()}`,
      date: new Date().toISOString().split('T')[0],
      visibility: 'public',
      participant_ids: [],
      golf_data: { course_name: courseName, round_type: 'outdoor', holes_played: 18 },
    },
  });
  expect(created.ok(), await readErrorBody(created)).toBe(true);
  const body = await created.json();
  const groupPostId = body.group_post.id as string;
  const postId = (body.post?.id ?? body.group_post.post_id) as string;

  const score = await api.post('/api/golf/participant-scores', {
    data: {
      group_post_id: groupPostId,
      participant_scores: [
        {
          participant_id: userId,
          hole_scores: Array.from({ length: 13 }, (_, i) => ({
            hole_number: i + 1,
            strokes: 4,
          })),
        },
      ],
    },
  });
  expect(score.ok(), await readErrorBody(score)).toBe(true);

  // A round is only a feed post once it completes (round-lifecycle pins this).
  const end = await api.patch(`/api/group-posts/${groupPostId}`, {
    data: { status: 'completed' },
  });
  expect(end.ok(), await readErrorBody(end)).toBe(true);

  return { groupPostId, postId, courseName };
}

/** The post's own card. Scoping matters: the feed holds many posts, and a
 *  bare getByRole would match the first card on the page, not this round. */
function cardFor(page: Page, courseName: string) {
  return page.getByTestId('post-card').filter({ hasText: courseName }).first();
}

test.describe('round post — details', () => {
  // Each case seeds its own round over three API calls and then loads the
  // real feed — the house budget for a seeding spec.
  test.setTimeout(120_000);

  test('hole count reports what was played, and the top entry opens the detail', async ({
    page,
  }) => {
    const userA = loadQaUser('user.json');
    const api = await apiAs('state.json');
    let groupPostId: string | null = null;
    try {
      const round = await createPartialRound(api, userA.id);
      groupPostId = round.groupPostId;

      // Plain /feed on purpose. The `?post=` deep link opens PostDetailModal
      // OVER the feed: the card behind it still reports visible, so an expect
      // passes and the following click then retries until the test deadline
      // with no assertion error to show for it. The round was just completed,
      // so it is the newest post.
      await page.goto('/feed');
      const card = cardFor(page, round.courseName);
      await expect(card).toBeVisible({ timeout: 20_000 });

      // 1. THE COUNT. 13 holes were scored on a round configured for 18 —
      //    the meta line must say so rather than echoing the configuration.
      await expect(card.getByText('13 of 18 holes')).toBeVisible();

      // 2. THE TOP ENTRY. Distinct name from the bottom button on purpose.
      const top = card.getByRole('button', { name: /view details/i });
      await expect(top).toBeVisible();
      const box = await top.boundingBox();
      expect(box, 'top entry must have a real hit area').not.toBeNull();
      expect(box!.height, 'touch target').toBeGreaterThanOrEqual(44);

      // The bottom button KEEPS its own label and its own job.
      await expect(card.getByRole('button', { name: /view full scorecard/i })).toBeVisible();

      await top.click();
      const modal = page.getByRole('tablist', { name: /round detail sections/i });
      await expect(modal).toBeVisible({ timeout: 15_000 });
    } finally {
      if (groupPostId) await api.delete(`/api/group-posts/${groupPostId}`);
      await api.dispose();
    }
  });

  test('the detail leads with scores and keeps course reference collapsed', async ({ page }) => {
    const userA = loadQaUser('user.json');
    const api = await apiAs('state.json');
    let groupPostId: string | null = null;
    try {
      const round = await createPartialRound(api, userA.id);
      groupPostId = round.groupPostId;

      await page.goto('/feed');
      const card = cardFor(page, round.courseName);
      await expect(card).toBeVisible({ timeout: 20_000 });
      await card.getByRole('button', { name: /view details/i }).click();

      const overview = page.locator('#round-panel-overview');
      await expect(overview).toBeVisible({ timeout: 15_000 });

      // The scores come before the course reference material. (This round has
      // no media, which is exactly why the media block must self-hide rather
      // than leave a gap at the top — the scores land first.)
      const scores = overview.getByRole('heading', { name: /leaderboard|your round/i });
      const course = overview.getByText('Course details', { exact: true });
      await expect(scores).toBeVisible();
      await expect(course).toBeVisible();

      const scoresBox = await scores.boundingBox();
      const courseBox = await course.boundingBox();
      expect(scoresBox!.y, 'scores must sit above course details').toBeLessThan(courseBox!.y);

      // COLLAPSED on open — the round's content is the point, the course is
      // reference. The <details> carries no `open` attribute until asked.
      const details = overview.locator('details').filter({ hasText: 'Course details' }).first();
      await expect(details).not.toHaveAttribute('open', /.*/);

      // …and it opens, revealing the club information.
      await course.click();
      await expect(details).toHaveAttribute('open', /.*/);
      await expect(overview.getByText(round.courseName).first()).toBeVisible();

      // The detail agrees with the card about the round's length.
      await expect(overview.getByText('13 of 18', { exact: true })).toBeVisible();
    } finally {
      if (groupPostId) await api.delete(`/api/group-posts/${groupPostId}`);
      await api.dispose();
    }
  });

  test('@mobile the top entry and the collapsed course section work at phone width', async ({
    page,
  }) => {
    // The mobile project is a SEPARATE PROCESS — no serial state from the
    // desktop tests, so this seeds its own round.
    const userA = loadQaUser('user.json');
    const api = await apiAs('state.json');
    let groupPostId: string | null = null;
    try {
      const round = await createPartialRound(api, userA.id);
      groupPostId = round.groupPostId;

      // 375 is tighter than the project's 390 and is the house floor.
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/feed');
      const card = cardFor(page, round.courseName);
      await expect(card).toBeVisible({ timeout: 20_000 });

      // The header must fit the button beside a long course name, not wrap
      // it off-screen.
      const top = card.getByRole('button', { name: /view details/i });
      await expect(top).toBeVisible();
      const box = await top.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width, 'button must stay on screen').toBeLessThanOrEqual(375);

      await top.click();
      const overview = page.locator('#round-panel-overview');
      await expect(overview).toBeVisible({ timeout: 15_000 });

      const course = overview.getByText('Course details', { exact: true });
      await expect(course).toBeVisible();
      const summary = overview.locator('summary').filter({ hasText: 'Course details' }).first();
      const sBox = await summary.boundingBox();
      expect(sBox!.height, 'summary is a real touch target').toBeGreaterThanOrEqual(44);

      await course.click();
      await expect(
        overview.locator('details').filter({ hasText: 'Course details' }).first()
      ).toHaveAttribute('open', /.*/);

      // Nothing may push the modal into horizontal scroll.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, 'no horizontal overflow at 375px').toBeLessThanOrEqual(1);
    } finally {
      if (groupPostId) await api.delete(`/api/group-posts/${groupPostId}`);
      await api.dispose();
    }
  });
});

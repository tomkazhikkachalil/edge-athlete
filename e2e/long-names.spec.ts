import { test, expect } from './helpers/test';
import { cleanup } from './helpers/cleanup';
import { adminClient, apiAs } from './helpers/qa-user';

// Nov 19 2026 (Tom: in the live view a long name ran off the edge of the
// phone). A live round on a course whose name is one 60-character word and a
// long run of words: at 375 px the live page, the full card's header and the
// Live Now list keep every name inside the screen.

const UNBROKEN = `QALONG${'ABCDEFGHIJ'.repeat(5)}`.slice(0, 56);

for (const [label, courseName] of [
  ['one unbroken word', (stamp: number) => `${UNBROKEN}${String(stamp).slice(-4)}`],
  ['many words', (stamp: number) => `QA Long The Royal and Ancient Municipal Championship Links of Upper Saint Bartholomew ${String(stamp).slice(-4)}`],
] as const) {
  test(`a long course name (${label}) stays inside a 375 px screen on the live views @mobile`, async ({ page }) => {
    test.setTimeout(150_000);
    const admin = adminClient();
    const api = await apiAs('state.json');
    const stamp = Date.now();
    const name = courseName(stamp);
    let courseId = '';
    let groupPostId = '';
    const inside = async (selector: string, what: string) => {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, `${what} is rendered`).not.toBeNull();
      expect(box!.x, `${what} starts inside the screen`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${what} ends inside the screen`).toBeLessThanOrEqual(375 + 1);
    };
    const noSidewaysScroll = async (where: string) =>
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `no sideways scroll on ${where}`).toBeLessThanOrEqual(1);
    try {
      const seeded = await admin.from('golf_courses').insert({ external_source: 'qa-e2e', external_id: `longname-${stamp}-${label.length}`, name, total_par: 72, holes_count: 18, lat: 45.41, lng: -75.71, hydrated_at: new Date().toISOString() }).select('id').single();
      expect(seeded.error, seeded.error?.message).toBeNull();
      courseId = seeded.data!.id as string;
      // The round is made through the product's own door, as a live round on that course.
      const today = new Date().toISOString().slice(0, 10);
      const made = await api.post('/api/group-posts', {
        data: {
          type: 'golf_round', title: name, date: today, visibility: 'private', participant_ids: [],
          golf_data: { course_name: name, course_id: courseId, round_type: 'outdoor', holes_played: 18, tee_color: 'white' },
        },
      });
      expect(made.ok(), `${made.status()} ${await made.text()}`).toBe(true);
      const body = await made.json();
      groupPostId = body.group_post?.id ?? body.id ?? body.groupPost?.id;
      expect(groupPostId, JSON.stringify(body).slice(0, 300)).toBeTruthy();

      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/live/${groupPostId}`);
      await page.waitForTimeout(2500);
      const closeScorer = page.getByRole('button', { name: /^close/i }).last();
      if (await closeScorer.count()) await closeScorer.click();
      await expect(page.getByText(name.slice(0, 20), { exact: false }).first()).toBeVisible({ timeout: 20_000 });
      await noSidewaysScroll('the live round');

      await page.getByRole('button', { name: /View Full Scorecard/i }).first().click();
      await expect(page.locator('[data-round-course-name]')).toBeVisible({ timeout: 15_000 });
      await inside('[data-round-course-name]', 'the full card\'s course name');
      await noSidewaysScroll('the full card');

      await page.goto('/live');
      const card = page.locator('button', { hasText: name.slice(0, 20) }).first();
      if (await card.count()) {
        const box = (await card.boundingBox())!;
        expect(box.x + box.width, 'the Live Now card ends inside the screen').toBeLessThanOrEqual(375 + 1);
      }
      await noSidewaysScroll('Live Now');
    } finally {
      await cleanup('long-names', [
        () => groupPostId && api.delete(`/api/group-posts/${groupPostId}`),
        () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
        () => api.dispose(),
      ]);
    }
  });
}

import { test, expect, type Page } from './helpers/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { cleanup } from './helpers/cleanup';
import { walkLadder } from './helpers/fit-ladder';
import { expectScorerOnHole, scoreCard } from './helpers/score-card';

// The live round on every screen size and every engine (the rule in
// docs/specs/ui-conventions.md): the scoring card is opened once and each of
// its states is taken through the ladder — 320 px to 2560 px, a phone on its
// side, tablets, enlarged text — on whichever engine the project brings.

type LatLng = [number, number];

/** Measured in the page: every way the card fails to fit, in words. */
async function cardProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const doc = document.documentElement;
    if (doc.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${doc.scrollWidth} > ${vw})`);
    const dialog = document.querySelector<HTMLElement>('[data-score-card] [role="dialog"]');
    if (!dialog) return ['no scoring card'];
    const d = dialog.getBoundingClientRect();
    if (d.left < -0.5 || d.right > vw + 0.5) out.push(`the card leaves the screen sideways (${Math.round(d.left)}–${Math.round(d.right)} of ${vw})`);
    if (d.top < -0.5 || d.bottom > vh + 0.5) out.push(`the card leaves the screen vertically (${Math.round(d.top)}–${Math.round(d.bottom)} of ${vh})`);
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const name = (el: Element) => (el.getAttribute('aria-label') || el.getAttribute('data-stat-lamp') || el.textContent || el.tagName).trim().slice(0, 30);
    // Nothing a person uses pokes out of the card (a row made to scroll sideways excepted).
    for (const el of dialog.querySelectorAll('button, input, select, [role="slider"]')) {
      if (!visible(el) || el.closest('[data-scroll-x]') || el.closest('.leaflet-container')) continue;
      const r = el.getBoundingClientRect();
      if (r.left < d.left - 0.5 || r.right > d.right + 0.5) out.push(`"${name(el)}" pokes out of the card (${Math.round(r.left)}–${Math.round(r.right)} in ${Math.round(d.left)}–${Math.round(d.right)})`);
    }
    // The footer is on screen and its two controls are real targets, apart.
    const prev = dialog.querySelector('[data-scorer-previous]');
    const next = dialog.querySelector('[data-scorer-next]');
    if (prev && next) {
      const a = prev.getBoundingClientRect();
      const b = next.getBoundingClientRect();
      if (b.bottom > vh + 0.5 || b.top < 0) out.push(`the footer is off screen (${Math.round(b.top)}–${Math.round(b.bottom)} of ${vh})`);
      if (a.height < 43.5 || a.width < 43.5) out.push(`Previous is ${Math.round(a.width)} × ${Math.round(a.height)}`);
      if (b.height < 43.5) out.push(`Next is ${Math.round(b.height)} px tall`);
      if (a.right > b.left + 0.5) out.push('Previous overlaps Next');
      if (next instanceof HTMLElement && next.scrollWidth > next.clientWidth + 1) out.push('the Next label is cut');
    }
    // The scoring cluster: the dial, the capsule and the lamps side by side, none over another.
    const parts = ['[data-strokes-dial]', '[data-putts-capsule]', '[data-stat-lamp="fir"]'].map(s => dialog.querySelector(s)).filter((el): el is Element => !!el && visible(el));
    for (let i = 0; i + 1 < parts.length; i++) {
      const a = parts[i].getBoundingClientRect();
      const b = parts[i + 1].getBoundingClientRect();
      if (a.right > b.left + 0.5) out.push(`"${name(parts[i])}" overlaps "${name(parts[i + 1])}" (${Math.round(a.right)} > ${Math.round(b.left)})`);
    }
    const dial = dialog.querySelector('[data-strokes-dial] svg');
    if (dial && dial.getBoundingClientRect().width < 120) out.push(`the dial is ${Math.round(dial.getBoundingClientRect().width)} px wide`);
    // Round keys, lamps, the putts number and the action buttons: real targets.
    for (const el of dialog.querySelectorAll('[data-strokes-minus], [data-strokes-plus], [data-putts-minus], [data-putts-plus], [data-stat-lamp], [data-scorer-action], [data-penalty-add], [data-penalty-remove], [data-penalty-type], [role="tab"]')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) out.push(`"${name(el)}" is ${Math.round(r.width)} × ${Math.round(r.height)}`);
    }
    // The hole keys: the one control allowed under 44 wide — never under 40 tall, never under 24 wide.
    for (const el of dialog.querySelectorAll('[data-hole-key]')) {
      const r = el.getBoundingClientRect();
      if (r.height < 39.5 || r.width < 24) out.push(`hole key ${el.getAttribute('data-hole-key')} is ${Math.round(r.width)} × ${Math.round(r.height)}`);
    }
    // The plate's big number and the totals are whole.
    for (const el of dialog.querySelectorAll<HTMLElement>('[data-hole-number], [data-scorer-total], [data-putts-number]')) {
      if (!visible(el) || getComputedStyle(el).display === 'inline') continue;
      if (el.scrollWidth > el.clientWidth + 1) out.push(`"${name(el)}" is cut (${el.scrollWidth} in ${el.clientWidth})`);
    }
    return out;
  });
}

for (const tag of ['', ' @mobile']) {
  test(`the scoring card fits every screen size, on this engine${tag}`, async ({ page }) => {
    test.setTimeout(420_000);
    const admin = adminClient();
    const bravo = loadQaUser('user-b.json');
    const api = await apiAs('state.json');
    const stamp = Date.now();
    const holes = Array.from({ length: 18 }, (_, i) => {
      const lat = 45.3 + i * 0.004;
      return { hole: i + 1, par: 4, line: [[lat, -75.7], [lat + 0.0015, -75.6996], [lat + 0.003, -75.699]] as LatLng[] };
    });
    const found: string[] = [];
    let courseId = '';
    let roundId = '';
    try {
      const seeded = await admin.from('golf_courses').insert({
        external_source: 'qa-e2e', external_id: `livefit-${stamp}`, name: `QA Fit Meadowbrook Country Club ${stamp}`, lat: holes[0].line[0][0], lng: holes[0].line[0][1],
        hole_data: holes.map(h => ({ number: h.hole, par: 4, yardage: { championship: 462, white: 388 }, handicap: h.hole })),
        course_rating: { championship: 74.9, white: 70.1 }, slope_rating: { championship: 141, white: 125 },
        hole_geometry: { holes, source: 'osm', greens: [] }, hole_geometry_at: new Date(stamp - 60_000).toISOString(),
      }).select('id').single();
      expect(seeded.error, seeded.error?.message).toBeNull();
      courseId = seeded.data!.id as string;
      const made = await api.post('/api/group-posts', {
        data: {
          type: 'golf_round', title: `QA Fit ${stamp}`, date: new Date().toISOString().split('T')[0], visibility: 'private', participant_ids: [bravo.id],
          golf_data: { course_name: `QA Fit Meadowbrook Country Club ${stamp}`, round_type: 'outdoor', holes_played: 18, tee_color: 'championship', hole_data: holes.map(h => ({ hole: h.hole, par: 4, yardage: 462, handicap: h.hole })), course_id: courseId },
        },
      });
      expect(made.ok(), await readErrorBody(made)).toBe(true);
      roundId = (await made.json()).group_post.id as string;

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/live/${roundId}`);
      await expectScorerOnHole(page, 1, 30_000);
      const card = scoreCard(page);
      const walk = (screen: string) => walkLadder(page, screen, found, () => cardProblems(page));

      await walk('Card (a new hole)');
      // The worst case for width: a two-digit hole, a triple, 4 putts, both lamps.
      await card.locator('[data-hole-key="18"]').click();
      await expectScorerOnHole(page, 18);
      for (let i = 0; i < 6; i++) await card.locator('[data-strokes-plus]').click();
      for (let i = 0; i < 3; i++) await card.locator('[data-putts-plus]').click();
      await card.locator('[data-stat-lamp="fir"]').click();
      await card.locator('[data-stat-lamp="gir"]').click();
      await walk('Card (hole 18, +6)');
      await card.locator('[data-hole-tee-toggle]').click();
      await walk('Card (tees open)');
      await card.locator('[data-hole-tee-toggle]').click();
      await card.locator('[data-scorer-action="penalty"]').click();
      await card.locator('[data-penalty-type]').selectOption('out_of_bounds');
      await walk('Card (penalty entry)');
      await card.locator('[data-penalty-add]').click();
      await card.locator('[data-scorer-action="penalty"]').click();
      await card.locator('[data-penalty-type]').selectOption('unplayable');
      await card.locator('[data-penalty-strokes]').fill('2');
      await card.locator('[data-penalty-add]').click();
      await walk('Card (two penalties)');

      // The dial drags at the narrowest and at a wide size.
      for (const size of [{ w: 320, h: 568 }, { w: 1440, h: 900 }]) {
        await page.setViewportSize({ width: size.w, height: size.h });
        await page.waitForTimeout(300);
        const dial = card.getByRole('slider', { name: 'Strokes' });
        await dial.scrollIntoViewIfNeeded();
        const box = (await dial.boundingBox())!;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await page.mouse.move(cx, cy - box.width * 0.41);
        await page.mouse.down();
        await expect(dial, `straight up is par at ${size.w} px`).toHaveAttribute('aria-valuenow', '4');
        await page.mouse.move(cx + box.width * 0.41, cy, { steps: 6 });
        await expect(dial, `the right side is 7 on a par 4 at ${size.w} px`).toHaveAttribute('aria-valuenow', '7');
        await page.mouse.up();
      }
      expect(found, `\n${found.join('\n')}\n`).toEqual([]);
    } finally {
      await cleanup('live-fit', [
        () => roundId && admin.from('group_posts').delete().eq('id', roundId),
        () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
        () => api.dispose(),
      ]);
    }
  });
}

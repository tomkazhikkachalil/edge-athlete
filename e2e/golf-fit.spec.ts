import { test, expect, type Page, type Locator } from './helpers/test';
import { adminClient, apiAs, createQaUser, deleteQaUser, readErrorBody, type QaUser } from './helpers/qa-user';
import { cleanup } from './helpers/cleanup';
import { dragSlide, slideKey } from './helpers/go-live';
import { walkLadder } from './helpers/fit-ladder';

// Every screen size, every engine (Tom, Nov 25 2026: "dynamic so it fits any
// mobile screen size and could also be expanded to larger screens… work in
// every web browser… not Apple and Chrome focused"). The whole golf flow is
// walked ONCE; on each screen the viewport is taken through the ladder below
// and the screen is measured: nothing runs off the page or out of the
// dialog, the footer is on screen with its controls apart and tappable, no
// label is cut. The spec sets the size itself, so whichever engine a project
// brings (Chromium, WebKit, Gecko, the Android and Brave profiles) meets
// every size, phone and desktop alike.

/** Measured in the page: every way this screen fails to fit, in words. */
async function problems(page: Page, scopeSelector: string): Promise<string[]> {
  return page.evaluate(sel => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const doc = document.documentElement;
    if (doc.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${doc.scrollWidth} > ${vw})`);
    const scope = document.querySelector<HTMLElement>(sel);
    if (!scope) return [`no ${sel}`];
    const s = scope.getBoundingClientRect();
    if (s.left < -0.5 || s.right > vw + 0.5) out.push(`the dialog leaves the screen sideways (${Math.round(s.left)}–${Math.round(s.right)} of ${vw})`);
    if (s.top < -0.5 || s.bottom > vh + 0.5) out.push(`the dialog leaves the screen vertically (${Math.round(s.top)}–${Math.round(s.bottom)} of ${vh})`);
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const name = (el: Element) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 28);
    // Sideways: nothing a person uses may poke out of the dialog, unless it
    // sits in a row made to scroll sideways.
    // (`data-scroll-x`: a row that says so. A list that scrolls DOWN also
    // computes overflow-x: auto, and must not excuse a chip that pokes out.)
    const inSidewaysScroller = (el: Element) => !!el.closest('[data-scroll-x]');
    for (const el of scope.querySelectorAll('button, input, select, a, [data-slide-track]')) {
      if (!visible(el) || inSidewaysScroller(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.left < s.left - 0.5 || r.right > s.right + 0.5) out.push(`"${name(el)}" pokes out of the dialog (${Math.round(r.left)}–${Math.round(r.right)} in ${Math.round(s.left)}–${Math.round(s.right)})`);
    }
    // The footer: on screen, controls apart, each a real target, no cut label.
    const footer = scope.querySelector('[data-step-footer]');
    if (footer) {
      const f = footer.getBoundingClientRect();
      if (f.bottom > vh + 0.5 || f.top < 0) out.push(`the footer is off screen (${Math.round(f.top)}–${Math.round(f.bottom)} of ${vh})`);
      const controls = [...footer.querySelectorAll('button, [data-slide-track]')].filter(visible).filter(el => !el.closest('[data-slide-track]') || el.matches('[data-slide-track]'));
      controls.forEach((a, i) => {
        const ra = a.getBoundingClientRect();
        if (ra.height < 43.5) out.push(`footer "${name(a)}" is ${Math.round(ra.height)} px tall`);
        if (ra.width < 43.5) out.push(`footer "${name(a)}" is ${Math.round(ra.width)} px wide`);
        if (a instanceof HTMLElement && a.scrollWidth > a.clientWidth + 1 && !a.matches('[data-slide-track]')) out.push(`footer "${name(a)}" label is cut`);
        for (const b of controls.slice(i + 1)) {
          const rb = b.getBoundingClientRect();
          if (ra.left < rb.right - 0.5 && rb.left < ra.right - 0.5 && ra.top < rb.bottom - 0.5 && rb.top < ra.bottom - 0.5) out.push(`footer "${name(a)}" overlaps "${name(b)}"`);
        }
      });
    }
    // Keys, tiles and dropdowns: tappable, their words whole.
    for (const el of scope.querySelectorAll('[data-key-switch] button, [data-format-grid] button, [data-sport-row], select, [data-round-add-players], [data-golf-forecast]')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5) out.push(`"${name(el)}" is ${Math.round(r.height)} px tall`);
    }
    // A sport, a format and a key's label are short fixed words: never an
    // ellipsis, never a clipped second line. (A person's or a course's name
    // may be any length and is allowed its ellipsis.)
    for (const el of scope.querySelectorAll<HTMLElement>('[data-key-switch] button span, [data-format-name], [data-sport-name], [data-step-header] span[aria-hidden]')) {
      // An inline box has no client size to compare against (and the engines
      // disagree about its scroll size): only a box that can clip is asked.
      if (!visible(el) || getComputedStyle(el).display === 'inline') continue;
      if (el.scrollWidth > el.clientWidth + 1) out.push(`"${name(el)}" is cut (${el.scrollWidth} in ${el.clientWidth})`);
      if (el.scrollHeight > el.clientHeight + 1) out.push(`"${name(el)}" is clipped (${el.scrollHeight} in ${el.clientHeight} px tall)`);
    }
    // A picture and its ring are one circle at any text size.
    for (const ring of scope.querySelectorAll('[data-round-partner] span.relative, [data-round-quick-add-person]')) {
      const img = ring.firstElementChild;
      if (!img || !visible(ring)) continue;
      const a = ring.getBoundingClientRect();
      const b = img.getBoundingClientRect();
      if (Math.abs(a.width - b.width) > 1 || Math.abs(a.left - b.left) > 1) out.push(`a picture (${Math.round(b.width)} px) does not fill its ring (${Math.round(a.width)} px)`);
    }
    return out;
  }, scopeSelector);
}

/** Take one screen through the ladder; collect every failure with its size. */
async function fits(page: Page, screen: string, scopeSelector: string, found: string[]) {
  await walkLadder(page, screen, found, () => problems(page, scopeSelector));
}

const FRAME = '[data-composer-frame]';

for (const tag of ['', ' @mobile']) {
  test(`the golf flow fits every screen size, on this engine${tag}`, async ({ page }) => {
    test.setTimeout(420_000);
    const admin = adminClient();
    const api = await apiAs('state.json');
    const stamp = Date.now();
    const last = `Ladder${stamp}`;
    const courseName = `QA Ladder Glen ${stamp}`;
    const found: string[] = [];
    let partner: QaUser | null = null;
    let earlierRound = '';
    let courseId = '';
    let groupPostId = '';
    await page.addLocatorHandler(page.getByRole('heading', { name: 'Pick up where you left off?' }), async () => {
      await page.getByRole('button', { name: 'Not now' }).click();
    });
    try {
      partner = await createQaUser({ displayName: `Wilhelmina ${last}`, firstName: 'Wilhelmina', lastName: last });
      await admin.from('profiles').update({ visibility: 'public' }).eq('id', partner.id);
      const res = await api.post('/api/group-posts', {
        data: { type: 'golf_round', title: `QA Ladder Round ${stamp}`, date: new Date().toISOString().split('T')[0], participant_ids: [partner.id] },
      });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      earlierRound = ((await res.json()) as { group_post?: { id?: string } }).group_post?.id ?? '';
      const tees: Record<string, [number, number, number]> = { black: [73.9, 138, 400], blue: [71.7, 131, 370], white: [69.8, 126, 345], 'white (f)': [75.1, 133, 345], 'red (f)': [71.9, 124, 300] };
      const seeded = await admin.from('golf_courses').insert({
        external_source: 'qa-e2e', external_id: `ladder-${stamp}`, name: courseName, city: 'Ottawa', region: 'Ontario', country: 'Canada',
        total_par: 72, holes_count: 18, hydrated_at: new Date().toISOString(),
        course_rating: Object.fromEntries(Object.entries(tees).map(([k, v]) => [k, v[0]])),
        slope_rating: Object.fromEntries(Object.entries(tees).map(([k, v]) => [k, v[1]])),
        hole_data: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, handicap: i + 1, yardage: Object.fromEntries(Object.entries(tees).map(([k, v]) => [k, v[2]])) })),
      }).select('id').single();
      expect(seeded.error, seeded.error?.message).toBeNull();
      courseId = seeded.data!.id as string;

      // ── Select sport ──────────────────────────────────────────────────────
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/feed');
      await page.getByRole('button', { name: /create a post/i }).click();
      await page.getByRole('button', { name: /general post/i }).click();
      const picker = page.locator('div[class*="z-[60]"]');
      await expect(picker.getByPlaceholder('Search sports')).toBeVisible({ timeout: 15_000 });
      await fits(page, 'Select sport', 'div[class*="z-[60]"] > div', found);
      await picker.getByPlaceholder('Search sports').fill('golf');
      await picker.getByRole('button', { name: /golf/i }).first().click();
      const flow: Locator = page.locator('[data-step-flow="golf-round"]');
      await expect(flow).toBeVisible({ timeout: 15_000 });

      // ── Round type ────────────────────────────────────────────────────────
      await fits(page, 'Round type', FRAME, found);
      await flow.locator('[data-step-next]').click();
      await expect(flow).toHaveAttribute('data-step', 'course');

      // ── Course: search, then the picked course ────────────────────────────
      await page.getByPlaceholder(/search courses/i).fill('QA Ladder Glen');
      await expect(page.locator('[data-course-results] button', { hasText: courseName }).first()).toBeVisible({ timeout: 20_000 });
      await fits(page, 'Course search', FRAME, found);
      await page.locator('[data-course-results] button', { hasText: courseName }).first().click();
      await expect(page.locator('[data-course-chosen]')).toContainText(courseName);
      await fits(page, 'Course selected', FRAME, found);

      // ── Game format, Conditions ───────────────────────────────────────────
      await flow.locator('[data-step-next]').click();
      await expect(flow).toHaveAttribute('data-step', 'format');
      await fits(page, 'Game format', FRAME, found);
      await flow.locator('[data-step-next]').click();
      await expect(flow).toHaveAttribute('data-step', 'conditions');
      await page.locator('#golf-weather').selectOption('partly-cloudy');
      await page.locator('#golf-temperature').fill('104');
      await page.locator('#golf-wind').selectOption('moderate');
      await fits(page, 'Conditions', FRAME, found);

      // ── Players, Tag People ───────────────────────────────────────────────
      await flow.locator('[data-step-next]').click();
      await expect(flow).toHaveAttribute('data-step', 'players');
      await expect(flow.locator('[data-round-quick-add]')).toBeVisible({ timeout: 15_000 });
      await fits(page, 'Players (blank)', FRAME, found);
      await flow.locator('[data-round-add-players]').click();
      const dialog = page.locator('[data-tag-people="mech"]');
      await fits(page, 'Tag People (empty)', '[data-tag-people="mech"] [role="dialog"]', found);
      await dialog.getByPlaceholder('Search people').fill(last);
      const result = dialog.locator(`[data-tag-people-row="${partner.id}"]`);
      await expect(result).toBeVisible({ timeout: 20_000 });
      await result.click();
      await fits(page, 'Tag People (selected)', '[data-tag-people="mech"] [role="dialog"]', found);
      await dialog.locator('[data-tag-people-submit]').click();
      await expect(flow.locator(`[data-round-partner="${partner.id}"]`)).toBeVisible();
      await flow.getByRole('button', { name: /More information about/i }).click();
      await fits(page, 'Players (a partner, info open)', FRAME, found);

      // ── Start, and the slide at the narrowest and a wide size ─────────────
      await flow.locator('[data-step-next]').click();
      await expect(flow).toHaveAttribute('data-step', 'finish');
      await fits(page, 'Start', FRAME, found);
      expect.soft(found, `\n${found.join('\n')}\n`).toEqual([]);
      for (const size of [{ w: 320, h: 568 }, { w: 844, h: 390 }, { w: 1920, h: 1080 }]) {
        await page.setViewportSize({ width: size.w, height: size.h });
        const track = flow.locator('[data-slide-track]');
        await track.scrollIntoViewIfNeeded();
        // The dialog re-centres over 260 ms after a resize: measure it at rest.
        await page.waitForTimeout(450);
        const rest = Math.round((await slideKey(flow).boundingBox())!.x);
        await dragSlide(page, flow, 0.5);
        await expect(track).toHaveAttribute('data-slide-state', 'rest');
        await expect.poll(async () => Math.round((await slideKey(flow).boundingBox())!.x), { message: `the key returns at ${size.w} px` }).toBe(rest);
      }
      await page.setViewportSize({ width: 320, height: 568 });
      await page.waitForTimeout(450);
      await dragSlide(page, flow, 1);
      await page.waitForURL(/\/live\/[0-9a-f-]+/, { timeout: 30_000 });
      groupPostId = page.url().match(/\/live\/([0-9a-f-]+)/)?.[1] ?? '';

    } finally {
      await cleanup('golf-fit', [
        () => groupPostId && admin.from('group_posts').delete().eq('id', groupPostId),
        () => earlierRound && admin.from('group_posts').delete().eq('id', earlierRound),
        () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
        () => partner && deleteQaUser(partner.id),
        () => api.dispose(),
      ]);
    }
  });
}

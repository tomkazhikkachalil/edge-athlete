import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';
import { assertSuggestionsUsable } from './helpers/overlay';

/**
 * Every typed-search suggestion list, measured for the failure that shipped in
 * August 2026: a list rendered inside a scroll container too small to hold it,
 * clipped away with the modal backdrop painting over the top. Invisible and
 * unclickable — while the probe that was meant to catch it happily counted the
 * elements and passed.
 *
 * `assertSuggestionsUsable` hit-tests the first row and checks the list's box
 * against its nearest scrollable ancestor. See e2e/helpers/overlay.ts.
 *
 * Deliberately NOT parameterised by `isMobile`: playwright.config.ts sets it
 * false on purpose, because under mobile emulation Chrome expands the layout
 * viewport and real overflows read as clean. The narrow pass here resizes the
 * viewport only.
 */

const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 390, height: 844 };

test.describe('suggestion dropdowns are visible and clickable', () => {
  test('header ⌘K search results', async ({ page }) => {
    for (const viewport of [WIDE, NARROW]) {
      await page.setViewportSize(viewport);
      await page.goto('/explore');
      await page.locator('button:has(i.fa-search)').first().click();

      const input = page.locator('input[name="ea-search"]');
      await expect(input).toBeVisible();
      await input.click();
      await input.fill('e');

      // The list is inline flow content since the #157 fix, so it appears
      // below the input rather than floating over it.
      await expect(page.locator('[role="option"]').first()).toBeVisible({ timeout: 10_000 });
      await assertSuggestionsUsable(page, {
        listSelector: '[role="listbox"]',
        rowSelector: '[role="option"]',
        label: `header search @ ${viewport.width}px`,
      });
    }
  });

  test('calendar guest picker', async ({ page }) => {
    const userA = loadQaUser('user.json');
    const userB = loadQaUser('user-b.json');

    // Both QA users are private by design (qa-user.ts hard-asserts it), so
    // with stock fixtures A sees nobody. One accepted follow makes B a
    // deterministic suggestion — accessibleProfileIds counts EITHER direction,
    // so B stays private. deleteQaUser removes follows both ways in teardown.
    const admin = adminClient();
    await admin.from('follows').delete()
      .eq('follower_id', userA.id).eq('following_id', userB.id);
    const { error } = await admin.from('follows')
      .insert({ follower_id: userA.id, following_id: userB.id, status: 'accepted' });
    expect(error, `seeding the accepted follow failed: ${error?.message}`).toBeNull();

    try {
      for (const viewport of [WIDE, NARROW]) {
        await page.setViewportSize(viewport);
        // ?new=1 opens the form on first paint. The create button's accessible
        // name is a responsive label pair ("New event" >=640px, "New" below),
        // so clicking it is viewport-dependent; this is not.
        await page.goto('/calendar?new=1');
        await expect(page.getByRole('heading', { name: 'New event' })).toBeVisible({ timeout: 20_000 });

        // Guests do not exist in the DOM until this disclosure is opened. The
        // full label carries an em dash and a U+2026 ellipsis — match loosely.
        await page.getByRole('button', { name: /More options/ }).click();

        const guest = page.getByPlaceholder(/type a name or email/i);
        await expect(guest).toBeVisible();
        await guest.scrollIntoViewIfNeeded();
        await guest.fill('Edge');

        const list = 'div.absolute.max-h-56.overflow-y-auto';
        await expect(page.locator(`${list} button`).first()).toBeVisible({ timeout: 10_000 });
        await assertSuggestionsUsable(page, {
          listSelector: list,
          rowSelector: 'button',
          label: `calendar guests @ ${viewport.width}px`,
        });
      }
    } finally {
      await admin.from('follows').delete()
        .eq('follower_id', userA.id).eq('following_id', userB.id);
    }
  });

  test('equipment brand autocomplete', async ({ page }) => {
    for (const viewport of [WIDE, NARROW]) {
      await page.setViewportSize(viewport);
      await page.goto('/athlete');

      // The tab's accessible name includes a count badge ("Equipment 6").
      await page.getByRole('button', { name: /equipment/i }).first().click();

      // aria-label is "Add equipment" (lowercase e) at every width; the
      // visible "Add Equipment" text is hidden below sm. On a profile with no
      // gear the empty state offers "Add Your First Item" instead.
      const add = page.getByRole('button', { name: 'Add equipment', exact: true });
      const firstItem = page.getByRole('button', { name: 'Add Your First Item' });
      await expect(add.or(firstItem).first()).toBeVisible({ timeout: 20_000 });
      await (await add.count() > 0 ? add : firstItem).first().click();

      await expect(page.getByRole('heading', { name: 'Add Equipment' })).toBeVisible();

      // The modal opens on sport `general`, which has NO brand catalog — the
      // dropdown cannot appear until a catalog sport is chosen. The Sport
      // label is not associated with its select, so getByLabel will not work.
      await page.locator('form select').first().selectOption('golf');

      // Focus alone opens the panel with ZERO characters typed: all 73 golf
      // brands, deliberately the maximal clipping case. Do not click anything
      // else before measuring — a document mousedown closes the panel.
      const brand = page.getByPlaceholder('Search brands...');
      await expect(brand).toBeVisible();
      await brand.scrollIntoViewIfNeeded();
      await brand.click();

      const list = 'div.absolute.overflow-y-auto';
      await expect(page.locator(`${list} button`).first()).toBeVisible({ timeout: 10_000 });
      await assertSuggestionsUsable(page, {
        listSelector: list,
        rowSelector: 'button',
        label: `equipment brand @ ${viewport.width}px`,
      });
    }
  });

  test('golf course picker in the composer', async ({ page }) => {
    for (const viewport of [WIDE, NARROW]) {
      await page.setViewportSize(viewport);
      await page.goto('/feed');
      await page.getByRole('button', { name: /what's on your mind/i }).click();

      // The sport selector is a z-[60] overlay ON TOP of the composer, so an
      // unscoped /golf/i can resolve to a covered element underneath.
      await page.getByRole('button', { name: /general post/i }).click();
      const sportSelector = page.locator('div[class*="z-[60]"]');
      await sportSelector.getByPlaceholder('Search sports...').fill('golf');
      await sportSelector.getByRole('button', { name: /golf/i }).first().click();

      const course = page.getByPlaceholder(/search for a golf course/i);
      await expect(course).toBeVisible();
      await course.click();
      await course.fill('a');

      const list = 'div.absolute.max-h-60.overflow-y-auto';
      await expect(page.locator(`${list} button`).first()).toBeVisible({ timeout: 10_000 });
      await assertSuggestionsUsable(page, {
        listSelector: list,
        rowSelector: 'button',
        label: `golf course @ ${viewport.width}px`,
      });

      // The composer must still scroll while the dropdown is open. This is the
      // regression from #157: a `fixed inset-0` click-catcher chained scroll to
      // a body-scroll-locked document and froze the whole modal.
      const scrolls = await page.evaluate(() => {
        const sc = [...document.querySelectorAll('div')].find(
          d => d.scrollHeight > d.clientHeight + 40 && /overflow-y-auto/.test(d.className)
        );
        if (!sc) return null;
        const start = sc.scrollTop;
        sc.scrollTop = start + 120;
        const moved = sc.scrollTop !== start;
        sc.scrollTop = start;
        return moved;
      });
      expect(scrolls, `composer stopped scrolling with the course dropdown open @ ${viewport.width}px`).toBe(true);

      await page.keyboard.press('Escape');
    }
  });
});

import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The in-app org page's glance grid (Org Pages R3, Sep 8 2026): every dense
 * section lives behind a tappable bubble whose "larger window" hosts the
 * section unchanged — so a spec that used to assert on `/league/[id]`'s
 * long scroll now taps the bubble first and asserts INSIDE the window it
 * returns. Faces carry the counts / testids that need no tap
 * (`data-org-news`, `data-announcements`, `data-standing`).
 */
export type OrgWindowKey =
  | 'members'
  | 'week'
  | 'standings'
  | 'events'
  | 'news'
  | 'announcements'
  | 'courses'
  | 'activity'
  | 'affiliations'
  | 'photos';

/** The bubble's accessible name is its label (the whole card is the button). */
export const ORG_BUBBLE_LABEL: Record<OrgWindowKey, RegExp> = {
  members: /^Members/,
  week: /^Your week/,
  standings: /^Standings/,
  events: /^Events/,
  news: /^(League|Club) news/,
  announcements: /^Announcements/,
  courses: /^(Courses|Venues)/,
  activity: /^Recent activity/,
  affiliations: /^(Affiliated clubs|Leagues|League chain)/,
  photos: /^Photos/,
};

/** Tap the bubble, wait for its window, return the window locator. */
export async function openWindow(page: Page, key: OrgWindowKey): Promise<Locator> {
  const face = page.locator(`[data-org-bubble="${key}"]`);
  await expect(face).toBeVisible({ timeout: 20_000 });
  await face.click();
  const win = page.locator(`[data-larger-window="${key}"]`);
  await expect(win).toBeVisible({ timeout: 15_000 });
  return win;
}

export async function closeWindow(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-larger-window]')).toHaveCount(0);
}

/**
 * Site Builder P1-A (Sep 9 2026): the hero's staff doors (Edit, Share join
 * link, Public site →, Manage →, Staff & hierarchy →) live behind ONE
 * "Manage" control — a portaled popover from sm: up, the `hero-actions`
 * sheet below. Open it and return whichever surface appeared, so a spec
 * scopes its assertions the same way at every width. `exact: true` because
 * an open Members window carries a "Make manager" button.
 */
export async function openManageMenu(page: Page): Promise<Locator> {
  const trigger = page.getByRole('button', { name: 'Manage', exact: true });
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await trigger.click();
  const surface = page.locator('[data-org-manage-menu], [data-larger-window="hero-actions"]');
  await expect(surface).toBeVisible({ timeout: 15_000 });
  return surface;
}

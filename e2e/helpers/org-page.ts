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
  | 'affiliations';

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

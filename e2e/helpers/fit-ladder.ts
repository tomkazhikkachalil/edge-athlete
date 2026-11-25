import type { Page } from '@playwright/test';

// Every screen size, every engine (Tom, Nov 25 2026): a mech screen is taken
// through this ladder on each browser project, in the PR that builds it
// (docs/specs/ui-conventions.md, "The mechanical dialect"). The spec sets the
// viewport itself, so whichever engine a project brings meets every size.

interface Size { w: number; h: number; font?: number }
export const FIT_LADDER: readonly Size[] = [
  { w: 320, h: 568 }, // the smallest phones still in use
  { w: 344, h: 882 }, // a folded phone's cover screen
  { w: 360, h: 640 }, { w: 360, h: 800 }, // the common Android width
  { w: 375, h: 667 }, { w: 390, h: 844 }, { w: 412, h: 915 }, { w: 430, h: 932 },
  { w: 667, h: 375 }, { w: 844, h: 390 }, // a phone on its side
  { w: 600, h: 960 }, { w: 768, h: 1024 }, { w: 820, h: 1180 }, // small and full tablets
  { w: 1024, h: 768 }, { w: 1280, h: 800 }, { w: 1440, h: 900 }, { w: 1920, h: 1080 }, { w: 2560, h: 1440 },
  // Enlarged text (the phone's font size setting, a zoomed browser).
  { w: 390, h: 844, font: 125 }, { w: 390, h: 844, font: 150 }, { w: 320, h: 568, font: 125 },
];

const SHOT_SIZES = new Set(['320x568x0', '360x640x0', '667x375x0', '768x1024x0', '1920x1080x0', '390x844x150', '320x568x125']);

/**
 * Take the screen that is showing through the ladder. `measure` answers, in
 * words, every way it fails to fit at the current size; each answer is
 * collected with the screen's name and the size. The page is left at
 * 390 × 844 with its own text size.
 *
 * FIT_SHOTS=<dir> also photographs the screen at the sizes worth a look,
 * in both themes.
 */
export async function walkLadder(page: Page, screen: string, found: string[], measure: () => Promise<string[]>): Promise<void> {
  for (const size of FIT_LADDER) {
    await page.setViewportSize({ width: size.w, height: size.h });
    await page.evaluate(font => { document.documentElement.style.fontSize = font ? `${font}%` : ''; }, size.font ?? 0);
    // Two frames: the layout after the resize, not the one before it.
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    if (process.env.FIT_SHOTS && SHOT_SIZES.has(`${size.w}x${size.h}x${size.font ?? 0}`)) {
      for (const theme of ['dark', 'light']) {
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        // The palette's own transitions (160 ms) must settle before the picture.
        await page.waitForTimeout(350);
        await page.screenshot({ path: `${process.env.FIT_SHOTS}/${screen.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${size.w}x${size.h}${size.font ? `-text${size.font}` : ''}-${theme}.png` });
      }
    }
    for (const p of await measure()) {
      found.push(`${screen} @ ${size.w}×${size.h}${size.font ? ` text ${size.font}%` : ''}: ${p}`);
    }
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.setViewportSize({ width: 390, height: 844 });
}

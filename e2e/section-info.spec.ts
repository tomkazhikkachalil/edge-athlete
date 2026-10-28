import { test, expect } from './helpers/test';

// Explanatory text behind an (i) (Oct 28 2026). Tom: copy that only says what
// a section is for is clutter — it sits behind an info button beside the
// heading. Pinned on Settings → Privacy, the canonical site (its heading's
// paragraph AND its old "Privacy Note" box live behind the one (i)):
//   - the button is named for the section and reads collapsed on load;
//   - a tap expands the text IN CONTEXT — below the heading, above the options;
//   - a tap anywhere else collapses it; Escape collapses it;
//   - the target is a real 44 px box, and its corner is really hittable under
//     the Settings shell's overflow-hidden (the after: extender would be
//     clipped there — "counting is not seeing").
// The shared QA user (the default storage state); nothing is written.

const NAME = 'More information about Profile Visibility';
const TEXT = 'Control who can see your profile, posts, and athletic performance data.';
const NOTE = 'Your profile picture and name are always visible to help others find you.';

test('the section explainer is behind an (i): collapsed on load, inline when tapped, gone on an outside tap or Escape @mobile', async ({ page }) => {
  await page.goto('/settings?tab=privacy');
  const button = page.getByRole('button', { name: NAME });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText(TEXT)).toBeHidden();
  await expect(page.getByText(NOTE)).toBeHidden();
  // The old Note box is gone: no heading named Note anywhere on the tab.
  await expect(page.getByRole('heading', { name: /^(Privacy )?Note$/ })).toHaveCount(0);

  // Open: the text is below the heading and above the first option.
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const text = page.getByText(TEXT);
  await expect(text).toBeVisible();
  await expect(page.getByText(NOTE)).toBeVisible();
  const heading = page.getByRole('heading', { name: 'Profile Visibility', exact: true });
  const [h, t, o] = await Promise.all([
    heading.boundingBox(),
    text.boundingBox(),
    page.getByRole('heading', { name: 'Public', exact: true }).boundingBox(),
  ]);
  expect(h && t && o, 'heading, text and the Public option are laid out').toBeTruthy();
  expect(t!.y).toBeGreaterThanOrEqual(h!.y + h!.height - 1);
  expect(t!.y + t!.height).toBeLessThanOrEqual(o!.y + 1);
  // aria-controls names the panel that holds the text.
  const controls = await button.getAttribute('aria-controls');
  expect(controls).toBeTruthy();
  await expect(page.locator(`[id="${controls}"]`)).toContainText(TEXT);

  // A tap on the expanded text keeps it open (it is inside the disclosure).
  await text.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');

  // A tap anywhere else closes it.
  await page.getByRole('heading', { level: 1, name: 'Settings' }).click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(text).toBeHidden();

  // Escape closes it.
  await button.click();
  await expect(text).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(text).toBeHidden();

  // A second tap on the button closes it too.
  await button.click();
  await expect(text).toBeVisible();
  await button.click();
  await expect(text).toBeHidden();

  // The target: a real 44 px box whose edges are hittable (not clipped by the
  // shell). The button is round, and WebKit honours the radius in hit testing,
  // so the probes sit 2 px inside the circle at the mid-edges, never a corner.
  const box = await button.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const probes: [number, number][] = [
    [box!.x + 2, box!.y + box!.height / 2],
    [box!.x + box!.width - 2, box!.y + box!.height / 2],
    [box!.x + box!.width / 2, box!.y + 2],
    [box!.x + box!.width / 2, box!.y + box!.height - 2],
  ];
  const edgeHits = await page.evaluate(
    pts => pts.map(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-section-info-button]') !== null),
    probes
  );
  expect(edgeHits, 'every mid-edge of the 44 px box is the button').toEqual([true, true, true, true]);
});

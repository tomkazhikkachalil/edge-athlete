import { test, expect, type Page } from './helpers/test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { adminClient, createQaUser, deleteQaUser, loadQaUser, type QaUser } from './helpers/qa-user';
import { dragSlide } from './helpers/go-live';
import { walkLadder } from './helpers/fit-ladder';
import { captionField, composeFooter, postSlide, selectThumb, thumbs } from './helpers/composer';

// The General post composer (Tom's spec, Nov 26 2026): ONE page in the
// mechanical dialect — media keys and a thumbnail strip with a cover, the
// caption and its hashtags in one panel, a details panel, an eye key and a
// SLIDE that posts. No category chips, no feed switch, no counters or helper
// lines; the limits sit behind the Media label's info key. Closing with work
// in it offers Save draft (kept on this device, no expiry).

const PHOTO = join(process.cwd(), 'e2e', 'fixtures', 'photo.png');
const CAMERA_PHOTO = 'input[type="file"][accept="image/*"]';
const FRAME = '[data-composer-frame="compose"]';

async function openComposer(page: Page) {
  await page.goto('/feed');
  // A tap before the page is interactive does nothing: tap until it opens.
  await expect(async () => {
    await page.getByRole('button', { name: /create a post/i }).click();
    await expect(captionField(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

async function attachPhotos(page: Page, count: number) {
  for (let i = 0; i < count; i += 1) {
    // A new name each time: the same file picked twice in a row fires no change event.
    await page.locator(CAMERA_PHOTO).setInputFiles({ name: `photo-${i + 1}.png`, mimeType: 'image/png', buffer: readFileSync(PHOTO) });
    await expect(thumbs(page)).toHaveCount(i + 1, { timeout: 10_000 });
  }
  for (let i = 0; i < count; i += 1) await expect(thumbs(page).nth(i)).toHaveAttribute('data-media-upload', 'stored', { timeout: 60_000 });
}

for (const tag of ['', ' @mobile']) {
  test(`the one page: media and its cover, hashtags, people, the preview, the slide${tag}`, async ({ page }) => {
    test.setTimeout(240_000);
    const admin = adminClient();
    const me = loadQaUser('user.json');
    const stamp = Date.now();
    const marker = `One page ${stamp}`;
    let partner: QaUser | null = null;
    try {
      partner = await createQaUser({ displayName: `Marguerite Slide${stamp}`, firstName: 'Marguerite', lastName: `Slide${stamp}` });
      await admin.from('profiles').update({ visibility: 'public' }).eq('id', partner.id);
      await openComposer(page);
      const frame = page.locator(FRAME);
      const footer = composeFooter(page);

      // What is on the page, and what is gone (R1–R4, R6, A12).
      await expect(frame.getByRole('heading', { name: 'Create Post' })).toBeVisible();
      await expect(frame.getByRole('button', { name: /general post/i })).toContainText('Change');
      for (const key of ['Photo', 'Video', 'Upload']) await expect(frame.getByRole('button', { name: key, exact: true })).toBeVisible();
      await expect(frame.locator('[data-composer-audience], [data-feed-toggle]')).toHaveCount(0);
      for (const gone of ['Training', 'Competition', 'Achievement', 'Lifestyle']) await expect(frame.getByRole('button', { name: gone, exact: true })).toHaveCount(0);
      await expect(frame.getByText(/\(\d+\/10\)|0\/10/)).toHaveCount(0);
      await expect(frame.locator('[data-compose-media-info]')).toHaveCount(0);
      await frame.getByRole('button', { name: 'About media' }).click();
      await expect(frame.locator('[data-compose-media-info]')).toContainText('Up to 10 photos or videos in a post, 50 MB each.');
      await frame.getByRole('button', { name: 'About media' }).click();
      await expect(frame.locator('[data-compose-media-info]')).toHaveCount(0);

      // Empty: the slide and the eye key wait (X1, X2).
      const key = postSlide(page);
      await expect(footer.locator('[data-slide-label]')).toHaveText('Slide to post');
      await expect(key).toHaveAttribute('aria-disabled', 'true');
      await expect(frame.locator('[data-compose-preview-key]')).toBeDisabled();

      // The caption and its counter (C4).
      await captionField(page).fill(marker);
      await expect(frame.locator('[data-compose-count]')).toHaveAttribute('data-compose-count', 'ok');
      await expect(frame.locator('[data-compose-count]')).toHaveText(`${marker.length}/500`);
      await expect(key).not.toHaveAttribute('aria-disabled', 'true');

      // Hashtags: a space or a comma ends one; a suggestion adds one; no count is shown.
      const tagInput = frame.locator('[data-compose-hashtag-input]');
      await tagInput.pressSequentially('slide ');
      await tagInput.pressSequentially('#mech,');
      await tagInput.pressSequentially('typed');
      await tagInput.press('Enter');
      const chips = frame.locator('[data-compose-hashtags]');
      for (const chip of ['#slide', '#mech', '#typed']) await expect(chips.getByText(chip, { exact: true })).toBeVisible();
      await frame.locator('[data-compose-suggest-key]').click();
      const suggestion = frame.locator('[data-compose-suggestions] button').first();
      const suggested = ((await suggestion.textContent()) ?? '').replace('+ ', '').trim();
      await suggestion.click();
      await expect(chips.getByText(suggested, { exact: true })).toBeVisible();
      await chips.getByRole('button', { name: 'Remove #typed' }).click();
      await expect(chips.getByText('#typed', { exact: true })).toHaveCount(0);
      await frame.locator('[data-compose-suggest-key]').click();

      // Media: two photos; the first is the cover; Cover moves the selected one first (A7, A8).
      await attachPhotos(page, 2);
      await expect(thumbs(page).nth(0).locator('[data-compose-cover]')).toHaveText('COVER');
      await expect(thumbs(page).nth(1).locator('[data-compose-cover]')).toHaveCount(0);
      await expect(frame.locator('[data-compose-edit]')).toHaveCount(0);
      await selectThumb(page, 1);
      const edit = frame.locator('[data-compose-edit]');
      for (const k of ['Crop', 'Adjust', 'Filter', 'Cover']) await expect(edit.getByRole('button', { name: k, exact: true })).toBeVisible();
      await edit.getByRole('button', { name: 'Cover', exact: true }).click();
      await expect(thumbs(page).nth(0)).toHaveAttribute('data-compose-thumb', 'selected');
      await expect(thumbs(page).nth(0).locator('[data-compose-cover]')).toHaveText('COVER');
      await expect(edit.getByRole('button', { name: 'Cover', exact: true })).toBeDisabled();
      // Adjust opens the editor ON that tool.
      await edit.getByRole('button', { name: 'Adjust', exact: true }).click();
      const editor = page.getByRole('heading', { name: 'Edit media' });
      await expect(editor).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Adjust', exact: true, pressed: true })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel editing', exact: true }).click();
      await expect(editor).toHaveCount(0, { timeout: 20_000 });
      await selectThumb(page, 0);
      await thumbs(page).nth(0).locator('[data-compose-select]').click(); // a second tap lets go
      await expect(frame.locator('[data-compose-edit]')).toHaveCount(0);

      // Tag people: the same dialog as the golf flow's; first names on the row; a face removes.
      await frame.locator('[data-compose-tag-people]').click();
      const dialog = page.locator('[data-tag-people="mech"]');
      await dialog.locator('[data-tag-people-search]').fill(`Slide${stamp}`);
      await dialog.getByRole('button', { name: new RegExp(`Marguerite Slide${stamp}`) }).first().click();
      await dialog.getByRole('button', { name: 'Tag (1)' }).click();
      await expect(frame.locator('[data-compose-people-label]')).toHaveText('Marguerite');
      await expect(frame.locator('[data-compose-people] button')).toHaveCount(1);

      // The preview: the real feed card, one Edit key, no Post key (A5, R5).
      await frame.locator('[data-compose-preview-key]').click();
      const preview = page.locator('[data-compose-preview]');
      await expect(preview.locator('[data-testid="post-card"]')).toContainText(marker, { timeout: 20_000 });
      await expect(preview.locator('[data-testid="post-card"]')).toContainText('#slide');
      await expect(preview.locator('[data-testid="post-card"]')).toContainText('Marguerite');
      await expect(preview.getByRole('button', { name: /^(create )?post( now)?$/i })).toHaveCount(0);
      await expect(preview.getByRole('button', { name: 'Post options' })).toHaveCount(0);
      await preview.locator('[data-compose-preview-edit]').click();
      await expect(preview).toHaveCount(0);

      // The slide: a short drag springs back and nothing is posted; a full one posts.
      await dragSlide(page, footer, 0.5);
      await expect(footer.locator('[data-slide-track]')).toHaveAttribute('data-slide-state', 'rest');
      await page.waitForTimeout(400);
      await expect(captionField(page)).toBeVisible();
      await dragSlide(page, footer, 1);
      await expect(footer.locator('[data-slide-track]')).toHaveAttribute('data-slide-state', 'locked');
      await expect(footer.locator('[data-slide-label]')).toHaveText(/Posting|Posted/);
      await expect(captionField(page)).toBeHidden({ timeout: 60_000 });

      // Stored as entered: on the feed (no switch), the cover first, the tags, the person.
      const { data: post } = await admin.from('posts').select('id, on_feed, status, hashtags, tags').eq('profile_id', me.id).eq('caption', marker).single();
      expect(post?.on_feed).toBe(true);
      expect(post?.hashtags).toEqual(['#slide', '#mech', suggested]);
      expect(post?.tags).toEqual([partner.id]);
      const { data: media } = await admin.from('post_media').select('display_order').eq('post_id', post!.id).order('display_order');
      expect(media).toHaveLength(2);
      await expect(page.locator('[data-testid="post-card"]').filter({ hasText: marker }).first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await admin.from('posts').delete().eq('profile_id', me.id).eq('caption', marker);
      if (partner) await deleteQaUser(partner.id);
    }
  });

  test(`closing with work in it: Save draft keeps it on this device, Discard drops it${tag}`, async ({ page }) => {
    test.setTimeout(180_000);
    const marker = `Kept draft ${Date.now()}`;
    await openComposer(page);
    const frame = page.locator(FRAME);
    const save = page.locator('[data-mech-dialog="save-draft"]');

    // Nothing entered: the close key just closes.
    await frame.getByRole('button', { name: 'Close modal' }).click();
    await expect(captionField(page)).toBeHidden();
    await expect(save).toHaveCount(0);

    await openComposer(page);
    await captionField(page).fill(marker);
    await frame.locator('[data-compose-hashtag-input]').pressSequentially('kept ');
    await attachPhotos(page, 1);

    // Three keys; Keep editing (and Escape) go back to the work.
    await frame.getByRole('button', { name: 'Close modal' }).click();
    await expect(save.getByRole('heading', { name: 'Save draft?' })).toBeVisible();
    for (const k of ['Save draft', 'Discard', 'Keep editing']) await expect(save.getByRole('button', { name: k, exact: true })).toBeVisible();
    await save.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(save).toHaveCount(0);
    await expect(captionField(page)).toHaveValue(marker);
    await page.keyboard.press('Escape');
    await expect(save).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(save).toHaveCount(0);
    await expect(captionField(page)).toBeVisible();

    // Save draft: the composer closes; a reload later it is offered back, whole.
    await frame.getByRole('button', { name: 'Close modal' }).click();
    await save.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(captionField(page)).toBeHidden();
    await page.reload();
    await openComposer(page);
    const banner = page.locator('[data-draft-banner="saved"]');
    await expect(banner).toContainText('Saved draft');
    // Opening and closing without deciding does not lose it.
    await frame.getByRole('button', { name: 'Close modal' }).click();
    await expect(captionField(page)).toBeHidden();
    await openComposer(page);
    await expect(banner).toContainText('Saved draft');
    await banner.locator('[data-draft-restore]').click();
    await expect(captionField(page)).toHaveValue(marker);
    await expect(frame.locator('[data-compose-hashtags]').getByText('#kept', { exact: true })).toBeVisible();
    await expect(thumbs(page)).toHaveCount(1, { timeout: 15_000 });

    // Discard: gone for good.
    await frame.getByRole('button', { name: 'Close modal' }).click();
    await save.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(captionField(page)).toBeHidden();
    await page.reload();
    await openComposer(page);
    await expect(page.locator('[data-draft-banner]')).toHaveCount(0);
    await expect(captionField(page)).toHaveValue('');
    await expect(thumbs(page)).toHaveCount(0);
  });
}

// ── Every screen size, every engine (docs/specs/ui-conventions.md) ───────────

/** Measured in the page: every way this screen fails to fit, in words. */
async function problems(page: Page, scopeSelector: string, scrolls = false): Promise<string[]> {
  return page.evaluate(({ sel, tall }) => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const doc = document.documentElement;
    if (doc.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${doc.scrollWidth} > ${vw})`);
    const scope = document.querySelector<HTMLElement>(sel);
    if (!scope) return [`no ${sel}`];
    const s = scope.getBoundingClientRect();
    if (s.left < -0.5 || s.right > vw + 0.5) out.push(`the dialog leaves the screen sideways (${Math.round(s.left)}–${Math.round(s.right)} of ${vw})`);
    if (!tall && (s.top < -0.5 || s.bottom > vh + 0.5)) out.push(`the dialog leaves the screen vertically (${Math.round(s.top)}–${Math.round(s.bottom)} of ${vh})`);
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const name = (el: Element) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 28);
    for (const el of scope.querySelectorAll('button, input, textarea, select, a, [data-slide-track]')) {
      if (!visible(el) || el.closest('[data-scroll-x]')) continue;
      const r = el.getBoundingClientRect();
      if (r.left < s.left - 0.5 || r.right > s.right + 0.5) out.push(`"${name(el)}" pokes out of the dialog (${Math.round(r.left)}–${Math.round(r.right)} in ${Math.round(s.left)}–${Math.round(s.right)})`);
    }
    // The footer: on screen, the eye key and the slide apart, each a real target.
    const footer = scope.querySelector('[data-compose-footer]');
    if (footer) {
      const f = footer.getBoundingClientRect();
      if (f.bottom > vh + 0.5 || f.top < 0) out.push(`the footer is off screen (${Math.round(f.top)}–${Math.round(f.bottom)} of ${vh})`);
      const controls = [...footer.querySelectorAll('[data-compose-preview-key], [data-slide-track]')].filter(visible);
      if (controls.length !== 2) out.push(`the footer shows ${controls.length} controls, not 2`);
      controls.forEach((a, i) => {
        const ra = a.getBoundingClientRect();
        if (ra.height < 43.5) out.push(`footer "${name(a)}" is ${Math.round(ra.height)} px tall`);
        if (ra.width < 43.5) out.push(`footer "${name(a)}" is ${Math.round(ra.width)} px wide`);
        for (const b of controls.slice(i + 1)) {
          const rb = b.getBoundingClientRect();
          if (ra.left < rb.right - 0.5 && rb.left < ra.right - 0.5 && ra.top < rb.bottom - 0.5 && rb.top < ra.bottom - 0.5) out.push(`footer "${name(a)}" overlaps "${name(b)}"`);
        }
      });
      const track = footer.querySelector<HTMLElement>('[data-slide-track]');
      const label = footer.querySelector<HTMLElement>('[data-slide-label]');
      if (track && label && track.getBoundingClientRect().width < 150) out.push(`the slide is ${Math.round(track.getBoundingClientRect().width)} px wide: no room for its words`);
    }
    // Keys a thumb must reach: 44 px tall (the thumbnail's own remove key is the spec's 28).
    for (const el of scope.querySelectorAll('[data-compose-capture], [data-compose-edit-key], [data-compose-suggest-key], [data-compose-tag-people], [data-mech-info], [data-mech-choice], [data-compose-preview-edit], [data-post-type-line] button')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5) out.push(`"${name(el)}" is ${Math.round(r.height)} px tall`);
    }
    // Fixed words are never cut: the capture keys, the edit keys, the dialog's keys.
    for (const el of scope.querySelectorAll<HTMLElement>('[data-compose-capture] span:last-child, [data-compose-edit-key] span:last-child, [data-mech-choice]')) {
      if (!visible(el) || getComputedStyle(el).display === 'inline') continue;
      if (el.scrollWidth > el.clientWidth + 1) out.push(`"${name(el)}" is cut (${el.scrollWidth} in ${el.clientWidth})`);
    }
    // The two columns never overlap, and a panel never leaves the dialog.
    for (const el of scope.querySelectorAll('.ea-mech-panel, [data-compose-media]')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.left < s.left - 0.5 || r.right > s.right + 0.5) out.push(`a panel pokes out of the dialog (${Math.round(r.left)}–${Math.round(r.right)})`);
    }
    return out;
  }, { sel: scopeSelector, tall: scrolls });
}

for (const tag of ['', ' @mobile']) {
  test(`the General post composer fits every screen size, on this engine${tag}`, async ({ page }) => {
    test.setTimeout(420_000);
    const found: string[] = [];
    await page.setViewportSize({ width: 390, height: 844 });
    await openComposer(page);
    const frame = page.locator(FRAME);

    await walkLadder(page, 'General post empty', found, () => problems(page, FRAME));

    // Filled: a caption, hashtags with the suggestions open, the info panel, three photos, one selected.
    await captionField(page).fill('A caption long enough to wrap onto a second line on the narrowest phone still in use today.');
    const tagInput = frame.locator('[data-compose-hashtag-input]');
    await tagInput.pressSequentially('training gameday recovery ');
    await frame.locator('[data-compose-suggest-key]').click();
    await frame.getByRole('button', { name: 'About media' }).click();
    await attachPhotos(page, 3);
    await selectThumb(page, 1);
    await walkLadder(page, 'General post filled', found, () => problems(page, FRAME));

    // The preview (it may be taller than the screen: it scrolls).
    await frame.locator('[data-compose-preview-key]').click();
    await expect(page.locator('[data-compose-preview] [data-testid="post-card"]')).toBeVisible({ timeout: 20_000 });
    await walkLadder(page, 'General post preview', found, () => problems(page, '[data-compose-preview] > div', true));
    await page.locator('[data-compose-preview-edit]').click();

    // Save draft.
    await frame.getByRole('button', { name: 'Close modal' }).click();
    await expect(page.locator('[data-mech-dialog="save-draft"]')).toBeVisible();
    await walkLadder(page, 'General post save draft', found, () => problems(page, '[data-mech-dialog="save-draft"] [role="dialog"]'));
    await page.locator('[data-mech-choice="discard"]').click();

    expect.soft(found, found.join('\n')).toEqual([]);
  });
}

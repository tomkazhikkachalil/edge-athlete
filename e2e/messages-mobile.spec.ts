import { test, expect, type Page } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The thread on a phone (Oct 14 2026, Tom's fix 6): the tab bar leaves while a
// thread is open, the shell is the visible strip and the composer sits on its
// bottom edge, the list scrolls and opens at the latest message, a send keeps
// the field focused, a message arriving while you read history shows a pill
// instead of yanking you down, older messages keep your place, the GIF sheet
// comes and goes without shifting the layout, and a shorter viewport (the
// keyboard's stand-in — Playwright cannot raise a software keyboard) keeps
// the composer on the bottom edge with the latest message in view. What only
// a real phone proves (the keyboard's own pan, the home-indicator inset with
// the keyboard open) is Tom's device pass — see docs/specs/messaging.md.

const SEED = 60; // over one page (50), so older messages are a real fetch

async function seedThread(): Promise<{ conversationId: string; texts: string[] }> {
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  try {
    const conv = await apiA.post('/api/messages', { data: { type: 'direct', participantId: userB.id } });
    expect(conv.ok(), await readErrorBody(conv)).toBe(true);
    const conversationId = (await conv.json()).conversationId as string;
    const texts: string[] = [];
    for (let i = 0; i < SEED; i++) {
      const api = i % 2 === 0 ? apiA : apiB;
      const text = `qa-thread-${stamp}-${String(i).padStart(2, '0')}`;
      const res = await api.post(`/api/messages/${conversationId}/messages`, { data: { type: 'text', content: text } });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      texts.push(text);
    }
    return { conversationId, texts };
  } finally {
    await apiA.dispose();
    await apiB.dispose();
  }
}

// Message text is read inside the thread list: the conversation list's preview repeats the last message.
const list = (page: Page) => page.locator('[data-thread-list]');
const metrics = (page: Page) => list(page).evaluate(el => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));

test('the thread on a phone: its own bottom edge, a list that scrolls and lands at the latest, a pill for history readers, older messages in place, the GIF sheet, the keyboard stand-in @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const { conversationId, texts } = await seedThread();
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
  const apiA = await apiAs('state.json');
  try {
    const page = await ctx.newPage();

    // 1. The list screen keeps the tab bar; the thread owns its bottom edge.
    await page.goto('/messages');
    await expect(page.locator('[data-tab-bar]')).toBeVisible({ timeout: 25_000 });
    await page.goto(`/messages?c=${conversationId}`);
    await expect(page.locator('[data-thread-shell]')).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('[data-tab-bar]')).toHaveCount(0);
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom))).toBe(0);

    // 2. The shell is the viewport; the composer sits on its bottom edge.
    const shell = (await page.locator('[data-thread-shell]').boundingBox())!;
    const vh = page.viewportSize()!.height;
    expect(Math.abs(shell.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(shell.y + shell.height - vh)).toBeLessThanOrEqual(1);
    const composer = (await page.locator('[data-composer]').boundingBox())!;
    expect(Math.abs(composer.y + composer.height - (shell.y + shell.height))).toBeLessThanOrEqual(1);

    // 3. The list scrolls and opens at the latest message.
    await expect(list(page).getByText(texts[SEED - 1], { exact: true })).toBeVisible({ timeout: 25_000 });
    const m0 = await metrics(page);
    expect(m0.scrollHeight).toBeGreaterThan(m0.clientHeight);
    expect(m0.scrollHeight - m0.clientHeight - m0.scrollTop).toBeLessThanOrEqual(2);
    await expect(list(page).getByText(texts[SEED - 1], { exact: true })).toBeInViewport();

    // 4. It scrolls up; the top fetches older messages and the view keeps its place.
    const box = (await list(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
    await expect.poll(async () => (await metrics(page)).scrollTop).toBeLessThan(m0.scrollTop);
    // Jump to the top (the sentinel fetches the older page) and, in the same
    // breath, note where a first-page row sits; after the prepend it must sit
    // exactly there — the restore, not a yank to the top of the new rows.
    const anchorText = texts[SEED - 20];
    const older = page.waitForResponse(r => r.url().includes(`/api/messages/${conversationId}`) && r.url().includes('cursor='), { timeout: 20_000 });
    const anchorYBefore = await page.evaluate((text) => {
      const l = document.querySelector('[data-thread-list]') as HTMLElement;
      l.scrollTop = 0;
      const el = Array.from(l.querySelectorAll('span, p')).find(e => e.textContent === text);
      return el ? el.getBoundingClientRect().y : NaN;
    }, anchorText);
    expect(Number.isFinite(anchorYBefore)).toBe(true);
    await older;
    await expect(list(page).getByText(texts[0], { exact: true })).toBeAttached({ timeout: 15_000 });
    await page.waitForTimeout(300);
    const anchorYAfter = (await list(page).getByText(anchorText, { exact: true }).boundingBox())!.y;
    expect(Math.abs(anchorYAfter - anchorYBefore), 'older messages keep your place').toBeLessThanOrEqual(2);

    // 5. Sending lands at the newest and keeps the field focused.
    const field = page.getByPlaceholder('Message…');
    const sent = `qa-sent-${Date.now()}`;
    await field.fill(sent);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(field).toHaveValue('', { timeout: 20_000 });
    await expect(list(page).getByText(sent, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(list(page).getByText(sent, { exact: true })).toBeInViewport();
    await expect(field).toBeFocused();

    // 6. Reading history while the other side writes: a pill, not a yank.
    await list(page).evaluate(el => { el.scrollTop = 0; });
    await page.waitForTimeout(400);
    const upTop = (await metrics(page)).scrollTop;
    const incoming = `qa-incoming-${Date.now()}`;
    const res = await apiA.post(`/api/messages/${conversationId}/messages`, { data: { type: 'text', content: incoming } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    await expect(page.locator('[data-new-messages-pill]')).toBeVisible({ timeout: 20_000 });
    expect(Math.abs((await metrics(page)).scrollTop - upTop)).toBeLessThanOrEqual(2);
    await page.locator('[data-new-messages-pill]').click();
    await expect(list(page).getByText(incoming, { exact: true })).toBeInViewport({ timeout: 10_000 });
    await expect(page.locator('[data-new-messages-pill]')).toHaveCount(0);

    // 7. The GIF sheet opens and closes without moving the composer.
    const composerBefore = (await page.locator('[data-composer]').boundingBox())!;
    const chevron = page.getByRole('button', { name: 'Show attachment and GIF buttons' });
    if (await chevron.isVisible().catch(() => false)) await chevron.click();
    await page.locator('[data-gif-picker-toggle]').click();
    await expect(page.getByRole('heading', { name: 'Send a GIF' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Send a GIF' })).toHaveCount(0);
    const composerAfter = (await page.locator('[data-composer]').boundingBox())!;
    expect(Math.abs(composerAfter.y + composerAfter.height - (composerBefore.y + composerBefore.height))).toBeLessThanOrEqual(1);
    const m7 = await metrics(page);
    expect(m7.scrollHeight).toBeGreaterThan(m7.clientHeight);

    // 8. The keyboard's stand-in: a shorter viewport keeps the composer on the
    //    bottom edge and the latest message in view; the shell says keyboard.
    await page.setViewportSize({ width: 390, height: 500 });
    await expect(page.locator('[data-thread-shell][data-keyboard-open]')).toHaveCount(1, { timeout: 10_000 });
    await expect.poll(async () => (await page.locator('[data-thread-shell]').boundingBox())!.height).toBeLessThanOrEqual(501);
    const c8 = (await page.locator('[data-composer]').boundingBox())!;
    expect(Math.abs(c8.y + c8.height - 500)).toBeLessThanOrEqual(1);
    await expect(list(page).getByText(incoming, { exact: true })).toBeInViewport({ timeout: 10_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-thread-shell][data-keyboard-open]')).toHaveCount(0, { timeout: 10_000 });

    // 9. The text box grows to its cap and scrolls inside itself.
    await field.fill(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n'));
    const ta = await field.evaluate(el => ({ clientHeight: el.clientHeight, scrollHeight: el.scrollHeight }));
    expect(ta.clientHeight).toBeLessThanOrEqual(120);
    expect(ta.scrollHeight).toBeGreaterThan(ta.clientHeight);
  } finally {
    await apiA.dispose();
    await ctx.close();
  }
});

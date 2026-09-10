import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Honest polling for ISR-backed public pages and the editor's autosave —
 * Site Builder hardening H1 (Sep 9 2026). The old per-spec `settleBody`
 * copies slept 2.5 s × N and RETURNED THE LAST BODY REGARDLESS, so a page
 * that never turned over left the spec green with nothing asserted. These
 * throw with the last value on exhaustion — a stale CDN document is a
 * failure that says so.
 */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  pred: (value: T) => boolean,
  opts: { attempts?: number; delayMs?: number; label?: string } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 12;
  const delayMs = opts.delayMs ?? 2500;
  let last: T | undefined;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    if (pred(last)) return last;
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  const shown = typeof last === 'string' ? last.slice(0, 400) : JSON.stringify(last)?.slice(0, 400);
  throw new Error(`pollUntil: ${opts.label ?? 'condition'} not met after ${attempts} attempts; last value: ${shown}`);
}

/** The public page at `url` once it does (or, with `shouldContain=false`,
 *  no longer does) contain `needle`. Throws when the ISR document never
 *  turns over; never returns a body that fails the check. */
export async function settleBody(
  request: Pick<APIRequestContext, 'get'>,
  url: string,
  needle: string,
  shouldContain = true,
  attempts = 12
): Promise<string> {
  return pollUntil(
    async () => (await request.get(url)).text(),
    body => body.includes(needle) === shouldContain,
    { attempts, label: `${url} ${shouldContain ? 'contains' : 'lacks'} ${JSON.stringify(needle)}` }
  );
}

/** One autosave cycle of the site editor, anchored on the PUT itself
 *  rather than on catching the transient dirty flag (which a fast save
 *  could outrun): wait for the draft PUT to answer, then for the chip to
 *  read saved and clean. Call it right AFTER the edit. */
export async function awaitDraftSaved(page: Page, timeoutMs = 20_000): Promise<void> {
  await page.waitForResponse(r => r.url().includes('/site/draft') && r.request().method() === 'PUT', { timeout: timeoutMs });
  await expect(page.locator('[data-sb-dirty="0"][data-sb-status="saved"]')).toBeVisible({ timeout: timeoutMs });
}

/** ISR + SWR settle on STATUS: after revalidateTag the first hit may serve
 *  the stale copy (and `?_cb=` never busts a document cache — ISR pages key
 *  by PATHNAME). Poll until the expected status lands; throw otherwise. */
export async function settleStatus(request: Pick<APIRequestContext, 'get'>, url: string, expected: number, attempts = 12): Promise<number> {
  return pollUntil(async () => (await request.get(url)).status(), status => status === expected, { attempts, label: `${url} → ${expected}` });
}

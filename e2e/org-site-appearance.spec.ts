import { test, expect, type Browser, type Page } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, previewBypassCookies, readErrorBody, resetRateBucket, E2E_BASE_URL } from './helpers/qa-user';
import { settleBody } from './helpers/isr';
import { publishSite } from './helpers/org-site';

// Club and league sites follow the visitor's light / dark theme, unless the
// site fixes its look (Oct 1 2026 — sites were light-only until then).
//
//   follows the visitor (default) — ONE cached document with no theme in it;
//       the visitor's device applies their Edge Athlete theme (the same
//       cookie / mirror the app uses), else the default schedule;
//   Always light / Always dark — server-rendered on the site's root, so every
//       visitor sees it whatever their own theme: an island in the page.
//
// A visitor's theme is planted in the device mirror (the public pages never
// refresh the cookie); colours are read back as computed styles.

const MIRROR = 'ea:theme:v1';
const DARK_CANVAS = 'rgb(23, 19, 16)'; // --background, dark (#171310)
const LIGHT_CANVAS = 'rgb(249, 250, 251)'; // --background, light (#f9fafb)
const NAVY = '#0b3d91'; // reads on white; far under 4.5:1 on the dark surface

async function visitor(browser: Browser, mode: 'on' | 'off'): Promise<Page> {
  const ctx = await browser.newContext({
    storageState: { cookies: await previewBypassCookies(), origins: [{ origin: E2E_BASE_URL, localStorage: [{ name: MIRROR, value: JSON.stringify({ mode }) }] }] },
  });
  return ctx.newPage();
}

/** What the visitor's device made of the page. */
const look = (page: Page) =>
  page.evaluate(() => {
    const scope = document.querySelector('.org-scope') as HTMLElement;
    const style = getComputedStyle(scope);
    // A token-coloured element — not the hero's heading, which is white on
    // the accent in both themes by design.
    const heading = scope.querySelector('.text-primary') as HTMLElement | null;
    return {
      page: document.documentElement.dataset.theme ?? 'light',
      site: scope.getAttribute('data-theme'),
      canvas: style.backgroundColor,
      text: style.color,
      heading: heading ? getComputedStyle(heading).color : null,
      link: style.getPropertyValue('--brand-fg').trim(),
      linkDark: style.getPropertyValue('--org-accent-fg-dark').trim(),
      linkLight: style.getPropertyValue('--org-accent-fg').trim(),
    };
  });
/** Light text has high channel values; dark text low. */
const isLightText = (rgb: string) => (rgb.match(/\d+/g) ?? []).slice(0, 3).map(Number).reduce((a, b) => a + b, 0) > 500;

test('a site follows the visitor by default; Always light and Always dark hold for every visitor @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const stamp = Date.now();
  const wordmark = `Look ${stamp}`;
  const league = await createQaOrg(admin, 'league', { name: `QA Look League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert({ org_id: league.id, profile_id: owner.id, role: 'owner' });
  const api = await apiAs('state-b.json');
  const setLook = async (appearance: 'light' | 'dark' | null) => {
    const res = await api.patch(`/api/leagues/${league.id}/site`, { data: { action: 'set_theme', accent: NAVY, wordmark, appearance } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await publishSite(api, 'league', league.id);
  };
  const dark = await visitor(browser, 'on');
  const light = await visitor(browser, 'off');
  try {
    let res = await api.post(`/api/leagues/${league.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = ((await res.json()).site as { subdomain: string }).subdomain;
    await setLook(null);
    res = await api.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const probe = await dark.context().request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const sitePath = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;

    // ── Follows the visitor: one document, no theme in it ──────────────────
    const auto = await settleBody(dark.context().request, sitePath, wordmark, true, 12);
    expect(auto).not.toContain('data-theme');
    await dark.goto(sitePath);
    let d = await look(dark);
    expect(d).toMatchObject({ page: 'dark', site: null, canvas: DARK_CANVAS });
    expect(isLightText(d.text)).toBe(true);
    // Link text switches to the colour that reads on the dark surface.
    expect(d.linkDark).not.toBe('');
    expect(d.link).toBe(d.linkDark);
    expect(d.link).not.toBe(d.linkLight);

    await light.goto(sitePath);
    let l = await look(light);
    expect(l).toMatchObject({ page: 'light', site: null, canvas: LIGHT_CANVAS });
    expect(isLightText(l.text)).toBe(false);
    expect(l.link).toBe(l.linkLight);

    // ── Always light: a light island for a dark visitor ────────────────────
    await setLook('light');
    await settleBody(dark.context().request, sitePath, 'data-theme="light"', true, 12);
    await dark.goto(sitePath);
    d = await look(dark);
    expect(d).toMatchObject({ page: 'dark', site: 'light', canvas: LIGHT_CANVAS });
    expect(isLightText(d.text)).toBe(false); // the island re-evaluates the inherited colour
    if (d.heading) expect(isLightText(d.heading)).toBe(false);
    expect(d.link).toBe(d.linkLight);

    // ── Always dark: dark for a light visitor ──────────────────────────────
    await setLook('dark');
    await settleBody(light.context().request, sitePath, 'data-theme="dark"', true, 12);
    await light.goto(sitePath);
    l = await look(light);
    expect(l).toMatchObject({ page: 'light', site: 'dark', canvas: DARK_CANVAS });
    expect(isLightText(l.text)).toBe(true);
    if (l.heading) expect(isLightText(l.heading)).toBe(true);
    expect(l.link).toBe(l.linkDark);

    // ── Back to following the visitor: the key is gone, the attribute too ──
    await setLook(null);
    const { data: row } = await admin.from('org_sites').select('theme_token_set').eq('subdomain', subdomain).single();
    expect((row!.theme_token_set as Record<string, unknown>).appearance).toBeUndefined();
  } finally {
    await dark.context().close();
    await light.context().close();
    await api.dispose();
    await deleteQaOrgs(admin, [league.id]);
  }
});

test('the club and league directories follow the visitor too @mobile', async ({ browser }) => {
  const dark = await visitor(browser, 'on');
  const light = await visitor(browser, 'off');
  try {
    // Both are served with the app's nonce policy, not the sites' static
    // one: the theme script is admitted there by its hash (csp.ts).
    // NOT the 404: for an unknown address Next sends an error shell and draws
    // the page in the browser, where an inline script never executes — the
    // site 404 stays light (a client component is what it would take, and
    // the (public) tree forbids one).
    for (const path of ['/clubs', '/leagues']) {
      await dark.goto(path);
      expect(await dark.evaluate(() => getComputedStyle(document.body).backgroundColor), path).toBe(DARK_CANVAS);
      await light.goto(path);
      expect(await light.evaluate(() => getComputedStyle(document.body).backgroundColor), path).toBe(LIGHT_CANVAS);
    }
  } finally {
    await dark.context().close();
    await light.context().close();
  }
});

test('the editor: Light and dark in the Theme panel previews on the canvas, saves, and survives a template change', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Look Editor ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert({ org_id: league.id, profile_id: owner.id, role: 'owner' });
  const api = await apiAs('state-b.json');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
  try {
    let res = await api.post(`/api/leagues/${league.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // Live first: a never-published site opens on the gallery's first-open offer.
    res = await api.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const page = await ctx.newPage();
    await page.goto(`/app/org/league/${league.id}/site/edit`);
    const canvas = page.locator('.sb-canvas.org-scope');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    // The QA users are pinned to light: the canvas follows the manager's own theme.
    await expect(canvas).not.toHaveAttribute('data-theme', /.+/);

    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    const panel = page.locator('[data-sb-theme-panel]');
    const control = panel.getByLabel('Light and dark');
    await expect(control).toHaveValue('');

    // Live preview: the canvas becomes a dark island in the light app.
    await control.selectOption('dark');
    await expect(canvas).toHaveAttribute('data-theme', 'dark');
    expect(await canvas.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(DARK_CANVAS);
    await panel.getByRole('button', { name: 'Save theme' }).click();
    const draftLook = async () => {
      const r = await api.get(`/api/leagues/${league.id}/site/canvas`);
      if (r.status() !== 200) return `HTTP ${r.status()}`;
      const body = (await r.json()) as { site?: { theme_token_set?: Record<string, unknown> } };
      return body.site?.theme_token_set?.appearance ?? null;
    };
    await expect.poll(draftLook, { timeout: 20_000 }).toBe('dark');

    // A template change keeps it (a colour decision, not a design key).
    res = await api.patch(`/api/leagues/${league.id}/site`, { data: { action: 'set_template', templateId: 'bold' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await draftLook()).toBe('dark');
  } finally {
    await ctx.close();
    await api.dispose();
    await deleteQaOrgs(admin, [league.id]);
  }
});

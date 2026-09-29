import { test, expect, type Page } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody } from './helpers/isr';
import { publishSite, revisionsSupported } from './helpers/org-site';

// Sports-team website program, V2 (Sep 28 2026): the live card on the public
// site. The home's "Next game" tile for a game being played renders the ISR
// snapshot first, then follows the site's live feed: a new score lands on
// the card WITHOUT a reload (and in the aria-live line). A hidden tab makes
// no requests; Save-Data offers a Refresh button instead of polling; with
// JavaScript off the snapshot stands on its own; no CSP violation. @mobile

type Widget = { id: string; key: string; x: number; y: number; w: number; h: number; cv: number; visibility: string; config: Record<string, unknown> };

async function cspWatch(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', e => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

test('live card: the snapshot first, then the feed updates the score without a reload; hidden tab quiet; Save-Data refresh; JS off @mobile', async ({ browser }) => {
  test.setTimeout(300_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  const probe = await admin.from('sport_event_teams').select('side').limit(1);
  test.skip(!!probe.error, `sport_event_teams missing — run migration 242 (${probe.error?.message})`);
  for (const b of ['org-site', 'org-site-draft'] as const) await resetRateBucket(admin, b, owner.id);
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Live Card ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([{ org_id: league.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' }]);
  const ownerApi = await apiAs('state-b.json');
  let eventId: string | null = null;
  const contexts: { close: () => Promise<void> }[] = [];
  try {
    let res = await ownerApi.post(`/api/leagues/${league.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain } = (await res.json()).site as { subdomain: string };
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', league.id)), 'org_site_revisions missing — run migration 180');
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'set_module', moduleKey: 'schedule', enabled: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // A game being played between the league's teams, 1–0.
    const { data: teams } = await admin.from('teams').insert([{ org_id: league.id, name: `Hawks ${stamp}` }, { org_id: league.id, name: `Storm ${stamp}` }]).select('id, name');
    const hawks = teams!.find(t => (t.name as string).startsWith('Hawks'))!.id as string;
    const storm = teams!.find(t => (t.name as string).startsWith('Storm'))!.id as string;
    const started = new Date(Date.now() - 20 * 60_000);
    const { data: ev, error: evError } = await admin
      .from('sport_events')
      .insert({ host_profile_id: owner.id, org_id: league.id, sport_key: 'ice_hockey', shape: 'game', name: `Card night ${stamp}`, visibility: 'public', status: 'live', format_config: { game: { side_names: [`Hawks ${stamp}`, `Storm ${stamp}`] } } })
      .select('id')
      .single();
    expect(evError, evError?.message).toBeNull();
    eventId = ev!.id as string;
    const { data: round } = await admin
      .from('sport_event_rounds')
      .insert({ sport_event_id: eventId, sequence: 1, scheduled_on: started.toISOString().slice(0, 10), starts_at: started.toISOString(), course_name: `QA Rink ${stamp}`, status: 'live', side1_score: 1, side2_score: 0 })
      .select('id')
      .single();
    await admin.from('sport_event_teams').insert([{ sport_event_id: eventId, side: 1, team_id: hawks }, { sport_event_id: eventId, side: 2, team_id: storm }]);

    // The Next game tile on the home, published.
    const canvas = (await (await ownerApi.get(`/api/leagues/${league.id}/site/canvas`)).json()) as { layout: { version: number; cols: number; widgets: Widget[] } };
    const bottom = Math.max(...canvas.layout.widgets.map(w => w.y + w.h));
    res = await ownerApi.put(`/api/leagues/${league.id}/site/draft`, {
      data: { layout: { ...canvas.layout, widgets: [...canvas.layout.widgets, { id: 'w_v2000000000000001', key: 'next_game', x: 0, y: bottom, w: 12, h: 4, cv: 1, visibility: 'public', config: {} }] } },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await publishSite(ownerApi, 'league', league.id);

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
    contexts.push(anon);
    const probeBase = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const base = probeBase.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
    await settleBody(anon.request, base, 'data-live-scoreboard="live"', true, 12);

    // The snapshot first; then the feed moves the score with no reload.
    const page = await anon.newPage();
    const cspViolations = await cspWatch(page);
    let feedHits = 0;
    page.on('request', r => {
      if (r.url().includes(`/api/public/org-sites/${subdomain}/live`)) feedHits += 1;
    });
    await page.goto(base);
    const card = page.locator('[data-live-scoreboard]');
    await expect(card).toHaveAttribute('data-live-scoreboard', 'live');
    await expect(card).toContainText(`Hawks ${stamp}`);
    await expect(card).toContainText('1');
    await admin.from('sport_event_rounds').update({ side1_score: 3, side2_score: 2 }).eq('id', round!.id);
    await expect(card.locator('[data-live-score-line]')).toHaveText(`Hawks ${stamp} 3, Storm ${stamp} 2`, { timeout: 90_000 });
    expect(feedHits).toBeGreaterThan(0);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);
    expect(await cspViolations()).toEqual([]);

    // A hidden tab makes no requests.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(2_000); // an in-flight tick may land
    const hiddenStart = feedHits;
    await page.waitForTimeout(25_000);
    expect(feedHits, 'no feed requests while the tab is hidden').toBe(hiddenStart);

    // Save-Data: no automatic polling — a Refresh button that asks once.
    const saver = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
    contexts.push(saver);
    const sp = await saver.newPage();
    await sp.addInitScript(() => Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: true }) }));
    let saverHits = 0;
    sp.on('request', r => {
      if (r.url().includes('/live')) saverHits += 1;
    });
    await sp.goto(base);
    const refresh = sp.locator('[data-live-refresh]');
    await expect(refresh).toBeVisible({ timeout: 15_000 });
    await sp.waitForTimeout(5_000);
    expect(saverHits, 'Save-Data: nothing automatic').toBe(0);
    await refresh.click();
    await expect.poll(() => saverHits, { timeout: 10_000 }).toBe(1);

    // JavaScript off: the snapshot stands on its own, with the way to follow the game.
    const nojs = await browser.newContext({ storageState: { cookies: [], origins: [] }, javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    contexts.push(nojs);
    const np = await nojs.newPage();
    await np.goto(base);
    await expect(np.locator('[data-live-scoreboard="live"]')).toContainText(`Storm ${stamp}`);
    await expect(np.getByRole('link', { name: 'Follow the game →' })).toBeVisible();
  } finally {
    for (const c of contexts) await c.close();
    await ownerApi.dispose();
    if (eventId) await admin.from('sport_events').delete().eq('id', eventId);
    await admin.from('org_sites').delete().eq('org_id', league.id);
    await deleteQaOrgs(admin, [league.id]);
  }
});

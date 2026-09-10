import { test, expect } from '@playwright/test';
import { adminClient, apiAs } from './helpers/qa-user';
import { seedContestLeague } from './helpers/contests';

// /event/[contestId] — a contest as a place (Contest Place E1). A public
// competition's contest is server-rendered for a stranger (scoreline in the
// HTML source, the API answers 200 signed-out); a private competition's
// contest is a 404 to a stranger and the same page to a member; a bad id
// is a 404. Seeds a league (owner = QA user B, member = QA user A) with two
// fixture competitions, one public and one private, each with one
// completed contest. Tagged @mobile: the body stacks, the scoreline and
// the way back are reachable at 390px.

const ANON = { cookies: [], origins: [] };

test('contest page (server path): a stranger reads a public contest — API 200 + scoreline in the HTML source; the private one and a bad id are 404s', async ({ request }) => {
  const admin = adminClient();
  const probe = await admin.from('contests').select('id').limit(1);
  test.skip(!!probe.error, `contests missing — run migration 152 (${probe.error?.message})`);
  const seeded = await seedContestLeague();
  try {
    const anon = await request.get(`/api/contests/${seeded.publicContest}`, { headers: { cookie: '' } });
    expect(anon.status()).toBe(200);
    const anonBody = await anon.json();
    expect(anonBody.access).toBe('public');
    expect(anonBody.view.outcome.scoreline).toBe('3–2');
    expect(anonBody.view.outcome.home.name).toBe(`Blazers ${seeded.stamp}`);
    expect(JSON.stringify(anonBody)).not.toContain(seeded.ownerEmail);
    expect((await request.get(`/api/contests/${seeded.privateContest}`, { headers: { cookie: '' } })).status()).toBe(404);
    expect((await request.get('/api/contests/not-a-uuid', { headers: { cookie: '' } })).status()).toBe(404);
    const html = await (await request.get(`/event/${seeded.publicContest}`, { headers: { cookie: '' } })).text();
    expect(html).toContain('data-contest-access="public"');
    expect(html).toContain(`Blazers ${seeded.stamp}`);
    expect(html).toContain('Final · 3–2');
    expect(html).toContain(`<title>Blazers ${seeded.stamp} vs Comets ${seeded.stamp} — public League`);
  } finally {
    await admin.from('leagues').delete().eq('id', seeded.leagueId);
  }
});

test('contest page: public SSR for a stranger, member-only for a private competition, 404s @mobile', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const probe = await admin.from('contests').select('id').limit(1);
  test.skip(!!probe.error, `contests missing — run migration 152 (${probe.error?.message})`);
  const seeded = await seedContestLeague();
  const { leagueId, stamp, publicContest, privateContest } = seeded;
  const owner = { email: seeded.ownerEmail };

  try {
    // A stranger: the API answers the public contest, refuses the private one and a bad id.
    const anon = await request.get(`/api/contests/${publicContest}`, { headers: { cookie: '' } });
    expect(anon.status()).toBe(200);
    const anonBody = await anon.json();
    expect(anonBody.access).toBe('public');
    expect(anonBody.view.outcome.scoreline).toBe('3–2');
    expect(anonBody.view.outcome.home.name).toBe(`Blazers ${stamp}`);
    expect(JSON.stringify(anonBody)).not.toContain(owner.email);
    expect((await request.get(`/api/contests/${privateContest}`, { headers: { cookie: '' } })).status()).toBe(404);
    expect((await request.get('/api/contests/not-a-uuid', { headers: { cookie: '' } })).status()).toBe(404);

    // The stranger's HTML: the scoreline is in the SOURCE (server-rendered).
    const html = await (await request.get(`/event/${publicContest}`, { headers: { cookie: '' } })).text();
    expect(html).toContain('data-contest-access="public"');
    expect(html).toContain(`Blazers ${stamp}`);
    expect(html).toContain('Final · 3–2');

    const anonCtx = await browser.newContext({ storageState: ANON });
    try {
      const page = await anonCtx.newPage();
      await page.goto(`/event/${publicContest}`);
      await expect(page.locator('[data-contest-access="public"]')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toContainText(`Blazers ${stamp} vs Comets ${stamp}`);
      await expect(page.locator('[data-contest-score="home"]')).toHaveText('3');
      await expect(page.getByRole('link', { name: 'Standings →' })).toBeVisible();
      // The private one is a real screen with a way in, never a blank page.
      await page.goto(`/event/${privateContest}`);
      await expect(page.locator('[data-contest-unavailable]')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
      expect(await page.locator('[data-contest-access]').count()).toBe(0);
    } finally {
      await anonCtx.close();
    }

    // A member: the private contest answers with access 'member', and the page renders it.
    const memberApi = await apiAs('state.json');
    try {
      const res = await memberApi.get(`/api/contests/${privateContest}`);
      expect(res.status()).toBe(200);
      expect((await res.json()).access).toBe('member');
    } finally {
      await memberApi.dispose();
    }
    const memberCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await memberCtx.newPage();
      await page.goto(`/event/${privateContest}#result`);
      await expect(page.locator('[data-contest-access="member"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-contest-score="away"]')).toHaveText('4');
      await expect(page.locator('#result')).toBeVisible();
      // Never a dead end: the org and standings links exist and fit the viewport.
      const standings = page.getByRole('link', { name: 'Standings →' });
      await expect(standings).toBeVisible();
      const box = await standings.boundingBox();
      const width = page.viewportSize()?.width ?? 1280;
      expect(box && box.x + box.width <= width + 1).toBe(true);
    } finally {
      await memberCtx.close();
    }
  } finally {
    // League delete cascades seasons → competitions → contests → participants → results.
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});

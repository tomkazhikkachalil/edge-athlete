import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite, revisionsSupported } from './helpers/org-site';

// Site Builder phase 11 — the template gallery. An entry is family + design
// tokens + a seed plan; `apply_gallery` writes it over the DRAFT, generating
// the welcome from the org's real facts and a map from its first venue with
// coordinates. 'keep' leaves the manager's tiles alone; 'clean' clears them.
// Skips (green) pre-180 — the layout has nowhere to live without revisions.
//
// P11-A drives the API; P11-B drives the gallery window on a FRESH site
// (never arranged, never published — the editor opens it by itself).

type CanvasWidget = { id: string; key: string; x: number; y: number; w: number; h: number; cv: number; config: Record<string, unknown>; visibility: string };
type Canvas = {
  site: { template_id: string; theme_token_set: Record<string, unknown> };
  layout: { version: 1; cols: 12; widgets: CanvasWidget[] };
  draft: unknown;
  gallery: { orgName: string; city: string | null; region: string | null; venues: { id: string; name: string; lat: number | null; lng: number | null }[] };
};

test('org site: a gallery entry re-lays the draft — family, tokens, a welcome in the org’s words, a map at the venue; clean clears the manager’s tiles', async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Start League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id, city: 'Kanata', region: 'ON' })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);

  try {
    // One venue WITH coordinates (mig 141 lat/lng) — the map's source.
    const { data: rink, error: venueError } = await admin
      .from('venues')
      .insert({ league_id: leagueId, name: `QA Rink ${stamp}`, city: 'Kanata', region: 'ON', lat: 45.3, lng: -75.9 })
      .select('id')
      .single();
    expect(venueError, venueError?.message).toBeNull();

    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');

    // The canvas carries the org facts the gallery writes from — the same the server applies.
    let canvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as Canvas;
    expect(canvas.gallery.orgName).toBe(`QA Start League ${stamp}`);
    expect(canvas.gallery.venues.find(v => v.id === rink!.id)).toMatchObject({ lat: 45.3, lng: -75.9 });
    expect(canvas.site.template_id).toBe('classic');

    // An unknown entry or mode is refused at the schema.
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'apply_gallery', entryId: 'nope' } });
    expect(res.status()).toBe(400);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'apply_gallery', entryId: 'simple', mode: 'wipe' } });
    expect(res.status()).toBe(400);

    // team-scoreboard: bold family, oswald + compact + tiles; the welcome and the map generated.
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'apply_gallery', entryId: 'team-scoreboard' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const applied = (await res.json()) as { ok: boolean; entryId: string; templateId: string | null; draft: unknown };
    expect(applied.entryId).toBe('team-scoreboard');
    expect(applied.templateId).toBe('bold');
    expect(applied.draft).not.toBeNull();
    canvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as Canvas;
    expect(canvas.site.template_id).toBe('bold');
    expect(canvas.site.theme_token_set).toMatchObject({ typeface: 'oswald', density: 'compact', teams: 'tiles' });
    const welcome = canvas.layout.widgets.find(w => w.id === 'seed:welcome');
    expect(welcome?.key).toBe('text');
    expect(JSON.stringify(welcome?.config)).toContain(`Welcome to QA Start League ${stamp}`);
    expect(JSON.stringify(welcome?.config)).toContain('ice hockey');
    expect(JSON.stringify(welcome?.config)).toContain('Kanata, ON');
    const map = canvas.layout.widgets.find(w => w.id === 'seed:map');
    expect(map?.key).toBe('embed');
    expect(map?.config).toMatchObject({ title: 'Where we play', embed: { provider: 'osm', marker: [45.3, -75.9] } });
    expect(canvas.layout.widgets[0].key).toBe('hero');
    // Module instances keep the legacy ids — nothing the org lacks was created.
    for (const w of canvas.layout.widgets) if (w.key !== 'text' && w.key !== 'embed') expect(w.id, w.key).toBe(`legacy:${w.key}`);

    // The manager adds a tile of their own, then re-applies 'simple' in keep mode: the tile survives,
    // the welcome keeps its id; clean mode clears the tile and regenerates the welcome.
    const bottom = Math.max(...canvas.layout.widgets.map(w => w.y + w.h));
    const mine: CanvasWidget = { id: 'w_00000000000011a1', key: 'text', x: 0, y: bottom, w: 12, h: 3, cv: 1, visibility: 'public', config: { blocks: [{ type: 'paragraph', text: `Mine ${stamp}` }] } };
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: { ...canvas.layout, widgets: [...canvas.layout.widgets, mine] } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'apply_gallery', entryId: 'simple', mode: 'keep' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    canvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as Canvas;
    expect(canvas.site.template_id).toBe('classic');
    // 'simple' names no typeface → the current one stays; the design keys were stripped.
    expect(canvas.site.theme_token_set.typeface).toBe('oswald');
    expect(canvas.site.theme_token_set.density).toBeUndefined();
    expect(canvas.layout.widgets.some(w => w.id === mine.id)).toBe(true);
    expect(canvas.layout.widgets.some(w => w.id === 'seed:welcome')).toBe(true);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'apply_gallery', entryId: 'simple', mode: 'clean' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    canvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as Canvas;
    expect(canvas.layout.widgets.some(w => w.id === mine.id)).toBe(false);
    expect(canvas.layout.widgets.some(w => w.id === 'seed:welcome')).toBe(true);
    // simple + clean = hero, welcome, schedule, contact — the rest omitted.
    expect(canvas.layout.widgets.map(w => w.key).sort()).toEqual(['contact', 'hero', 'schedule', 'text']);

    // Back to the scoreboard, published: the public page carries the welcome and the OSM frame.
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'apply_gallery', entryId: 'team-scoreboard', mode: 'clean' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await publishSite(ownerApi, 'league', leagueId);
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      let html = '';
      await expect
        .poll(async () => {
          html = await (await anon.request.get(`/org/${subdomain}`)).text();
          return html.includes(`Welcome to QA Start League ${stamp}`);
        }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
        .toBe(true);
      expect(html).toContain('Kanata, ON');
      expect(html).toContain('data-widget-id="seed:welcome"');
      expect(html).toContain('data-widget-id="seed:map"');
      expect(html).toContain('openstreetmap.org/export/embed.html');
      expect(html).toContain('data-template="bold"');
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});

test('org site: a fresh site’s first editor visit opens the gallery — skip keeps the seed; Start from → Use this re-lays the draft; publish; admin metrics are admin-only', async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Fresh League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id, city: 'Kanata', region: 'ON' })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);

  try {
    await admin.from('venues').insert({ league_id: leagueId, name: `QA Fresh Rink ${stamp}`, city: 'Kanata', region: 'ON', lat: 45.3, lng: -75.9 });
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');
    // The metrics route is admin-only: a league owner is refused.
    res = await ownerApi.get('/api/admin/site-metrics');
    expect(res.status()).toBe(403);

    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ownerCtx.newPage();
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      // Fresh site (no draft, not live, the seed layout): the gallery opens itself, with Skip.
      const gallery = page.locator('[data-larger-window="sb-gallery"]');
      await expect(gallery).toBeVisible({ timeout: 15_000 });
      const cards = gallery.locator('[data-sb-gallery-card]');
      expect(await cards.count()).toBeGreaterThanOrEqual(3);
      // A thumbnail shows the org's REAL words (the generated welcome heading).
      await expect(gallery.locator('[data-sb-gallery-card="team-scoreboard"]')).toContainText(`Welcome to QA Fresh League ${stamp}`);
      await expect(gallery.locator('[data-sb-gallery-card="team-scoreboard"]')).toContainText(`Map · QA Fresh Rink ${stamp}`);
      await gallery.locator('[data-sb-gallery-skip]').click();
      await expect(gallery).toBeHidden();
      // Skip wrote nothing: still no draft.
      let canvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as Canvas;
      expect(canvas.draft).toBeNull();

      // The pill reopens it (no Skip now — Close); Use this on the scoreboard.
      await page.getByRole('button', { name: 'Start from', exact: true }).click();
      await expect(gallery).toBeVisible();
      await expect(gallery.locator('[data-sb-gallery-skip]')).toHaveText('Close');
      await gallery.locator('[data-sb-gallery-mode="clean"]').check();
      await gallery.locator('[data-sb-gallery-card="team-scoreboard"] [data-sb-gallery-use]').click();
      await expect(gallery).toBeHidden({ timeout: 15_000 });
      // The editor reloaded from the server: bold family on the canvas, the welcome tile present, nothing unsaved.
      await expect(page.locator('[data-sb-canvas][data-template="bold"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-sb-instance="seed:welcome"]')).toBeVisible();
      await expect(page.locator('[data-sb-instance="seed:welcome"]')).toContainText(`Welcome to QA Fresh League ${stamp}`);
      await expect(page.locator('[data-sb-dirty="0"]')).toBeVisible();
      canvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as Canvas;
      expect(canvas.draft).not.toBeNull();
      expect(canvas.site.template_id).toBe('bold');
      // The arrange step is done (the checklist counts a design as arranging); the gallery is not re-offered on reload.
      await expect(page.locator('[data-sb-checklist-step="arrange"]')).toHaveAttribute('data-done', '1');
      await page.reload();
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      await expect(gallery).toHaveCount(0);
      // Publish from the editor (promotes the draft), then take the site live.
      await page.getByRole('button', { name: 'Publish changes' }).click();
      await expect
        .poll(async () => {
          const c = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { draft: { hasUnpublishedChanges: boolean } | null; published?: boolean };
          return c.draft === null || c.draft.hasUnpublishedChanges === false;
        }, { timeout: 20_000 })
        .toBe(true);
    } finally {
      await ownerCtx.close();
    }
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      let html = '';
      await expect
        .poll(async () => {
          html = await (await anon.request.get(`/org/${subdomain}`)).text();
          return html.includes(`Welcome to QA Fresh League ${stamp}`);
        }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
        .toBe(true);
      expect(html).toContain('data-template="bold"');
      expect(html).toContain('data-widget-id="seed:welcome"');
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});

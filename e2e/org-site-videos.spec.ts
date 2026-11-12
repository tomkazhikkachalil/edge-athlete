import { test, expect } from './helpers/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody } from './helpers/isr';
import { publishSite, revisionsSupported } from './helpers/org-site';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Videos program, Phase 1b: the public site's Videos tile. The owner links a
// full game to the club, places the `video_list` tile on the draft (the
// gallery module on), publishes — and a stranger's page carries the poster
// frame built from the YouTube id (no youtube request before the tap, the
// CSP untouched). A hidden video never reaches the page; the owner's own
// profile video never reaches it either (the tile is the org's rows only).
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
// Only the connected channel (Nov 11 2026): the links save because the owner's connection names those videos' channel.
withOwnChannel(['jNQXAC9IVRw', 'aqz-KE-bpKQ', '9bZkp7q19f0']);
type Widget = { id: string; key: string; x: number; y: number; w: number; h: number; cv: number; visibility: string; config: Record<string, unknown> };

test('public site Videos tile: the org\'s published linked game on the published home; hidden and profile-owned videos never', async ({ browser }) => {
  test.setTimeout(300_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  for (const b of ['org-site', 'org-site-draft', 'video-write'] as const) await resetRateBucket(admin, b, owner.id);
  const stamp = Date.now();
  const club = await createQaOrg(admin, 'club', { name: `QA Video Site Club ${stamp}`, sport_key: 'golf', owner_profile_id: owner.id, visibility: 'public' });
  await admin.from('memberships').insert([{ org_id: club.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' }]);
  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
  const videoIds: string[] = [];
  try {
    let res = await ownerApi.post(`/api/clubs/${club.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain } = (await res.json()).site as { subdomain: string };
    res = await ownerApi.patch(`/api/clubs/${club.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'club', club.id)), 'org_site_revisions missing — run migration 180');
    res = await ownerApi.patch(`/api/clubs/${club.id}/site`, { data: { action: 'set_module', moduleKey: 'gallery', enabled: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // Three videos: the club's published one (shows), the club's hidden one (never), the owner's own profile one (never).
    await seedOwnChannel(admin, { orgId: club.id }, owner.id);
    await seedOwnChannel(admin, { profileId: owner.id }, owner.id);
    res = await ownerApi.post('/api/videos', { data: { url: YT, title: `QA Site Final ${stamp}`, side: 'club', org_id: club.id } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoIds.push(((await res.json()).video as { id: string }).id);
    res = await ownerApi.post('/api/videos', { data: { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: `QA Site Hidden ${stamp}`, side: 'club', org_id: club.id, status: 'hidden' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoIds.push(((await res.json()).video as { id: string }).id);
    res = await ownerApi.post('/api/videos', { data: { url: 'https://www.youtube.com/watch?v=9bZkp7q19f0', title: `QA Site Personal ${stamp}` } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoIds.push(((await res.json()).video as { id: string }).id);

    // The tile on the draft, then published.
    const canvas = (await (await ownerApi.get(`/api/clubs/${club.id}/site/canvas`)).json()) as { layout: { version: number; cols: number; widgets: Widget[] } };
    const bottom = Math.max(...canvas.layout.widgets.map(w => w.y + w.h));
    const widgets: Widget[] = [...canvas.layout.widgets, { id: 'w_v1000000000000001', key: 'video_list', x: 0, y: bottom, w: 12, h: 4, cv: 1, visibility: 'public', config: { display: { count: 4 } } }];
    res = await ownerApi.put(`/api/clubs/${club.id}/site/draft`, { data: { layout: { ...canvas.layout, widgets } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await publishSite(ownerApi, 'club', club.id);

    const probe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const base = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
    const html = await settleBody(anon.request, base, 'data-site-videos', true, 12);
    expect(html).toContain(`QA Site Final ${stamp}`);
    expect(html).not.toContain(`QA Site Hidden ${stamp}`);
    expect(html).not.toContain(`QA Site Personal ${stamp}`);
    // The poster is a srcdoc frame from the id; no youtube-nocookie src before the tap.
    expect(html).toContain('data-site-video="jNQXAC9IVRw"');
    expect(html).toMatch(/srcdoc=/i);
    expect(html).not.toMatch(/src="https:\/\/www\.youtube-nocookie\.com/);

    const page = await anon.newPage();
    const violations: string[] = [];
    page.on('console', m => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
    await page.goto(base);
    await expect(page.locator('[data-site-video="jNQXAC9IVRw"]')).toBeVisible({ timeout: 20_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);
    expect(violations, 'the static CSP admits the poster frame').toEqual([]);
  } finally {
    for (const id of videoIds) await ownerApi.delete(`/api/videos/${id}`).catch(() => undefined);
    await anon.close();
    await ownerApi.dispose();
    await admin.from('youtube_connections').delete().eq('profile_id', owner.id);
    await admin.from('org_sites').delete().eq('org_id', club.id);
    await deleteQaOrgs(admin, [club.id]);
  }
});

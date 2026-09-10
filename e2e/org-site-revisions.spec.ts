import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody } from './helpers/isr';
import { publishSite, revisionsSupported } from './helpers/org-site';

// Site Builder phase 2 (P2-A…P2-C, mig 180): edits go to the DRAFT, the
// public page changes only on publish; the preview renders the draft in its
// own shell; history lists every published version; restore copies one into
// the draft; discard drops the draft. Skips (green) on a pre-180 database —
// the revisions GET says so (the 171 precedent).


test('org site revisions: draft → preview → publish → history → restore → discard; console at 375', async ({ browser }) => {
  test.setTimeout(300_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-site-revisions', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Revisions League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });

  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');

    // Take the site live (nothing drafted yet).
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const home = `/org/${subdomain}`;
    await settleBody(anon.request, home, `QA Revisions League ${stamp}`);

    const hero = (headline: string) =>
      ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_hero', headline, tagline: 'Drafted' } });
    const siteGet = async () => (await (await ownerApi.get(`/api/leagues/${leagueId}/site`)).json()) as {
      site: { hero_config: { headline?: string }; template_id: string };
      draft: { id: string; hasUnpublishedChanges: boolean } | null;
    };

    // 1. Edits land in the draft: the GET shows them, the public page does not.
    res = await hero(`Welcome A ${stamp}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(((await res.json()) as { draft?: { hasUnpublishedChanges: boolean } }).draft?.hasUnpublishedChanges).toBe(true);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_template', templateId: 'bold' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_theme', accent: '#0f766e' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    let view = await siteGet();
    expect(view.site.hero_config.headline).toBe(`Welcome A ${stamp}`);
    expect(view.site.template_id).toBe('bold');
    expect(view.draft?.hasUnpublishedChanges).toBe(true);
    const publicBefore = await (await anon.request.get(home)).text();
    expect(publicBefore).not.toContain(`Welcome A ${stamp}`);
    expect(publicBefore).toContain('data-template="classic"');

    // 2. The preview renders the DRAFT in its own shell (template + accent).
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/preview`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const previewUrl = (await res.json()).url as string;
    const preview = await (await anon.request.get(previewUrl)).text();
    expect(preview).toContain('Draft preview — not public');
    expect(preview).toContain(`Welcome A ${stamp}`);
    expect(preview).toContain('data-template="bold"');
    expect(preview).toContain('--org-accent:#0f766e');

    // 3. Publish changes (labelled) → the public page changes.
    await publishSite(ownerApi, 'league', leagueId, 'Version A');
    const publicA = await settleBody(anon.request, home, `Welcome A ${stamp}`);
    expect(publicA).toContain('data-template="bold"');
    view = await siteGet();
    expect(view.draft).toBeNull();

    // 4. A second version.
    res = await hero(`Welcome B ${stamp}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await publishSite(ownerApi, 'league', leagueId, 'Version B');
    await settleBody(anon.request, home, `Welcome B ${stamp}`);

    // 5. History lists both, newest first, the current one marked published.
    res = await ownerApi.get(`/api/leagues/${leagueId}/site/revisions`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const history = (await res.json()) as {
      supported: boolean;
      draft: unknown;
      revisions: { id: string; label: string | null; isPublished: boolean; isDraft: boolean; publishedAt: string | null }[];
    };
    expect(history.supported).toBe(true);
    expect(history.draft).toBeNull();
    const labels = history.revisions.map(r => r.label);
    expect(labels).toContain('Version A');
    expect(labels).toContain('Version B');
    const versionA = history.revisions.find(r => r.label === 'Version A')!;
    const versionB = history.revisions.find(r => r.label === 'Version B')!;
    expect(versionB.isPublished).toBe(true);
    expect(versionA.isPublished).toBe(false);
    expect(history.revisions.every(r => r.publishedAt)).toBe(true);

    // 6. Restore A → into the draft only; the public page stays B until publish.
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/revisions`, { data: { action: 'restore', revisionId: versionA.id } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    view = await siteGet();
    expect(view.site.hero_config.headline).toBe(`Welcome A ${stamp}`);
    expect(view.draft?.hasUnpublishedChanges).toBe(true);
    expect(await (await anon.request.get(home)).text()).toContain(`Welcome B ${stamp}`);
    await publishSite(ownerApi, 'league', leagueId);
    await settleBody(anon.request, home, `Welcome A ${stamp}`);

    // 7. Label a version; a foreign id 404s.
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/revisions`, { data: { action: 'label', revisionId: versionB.id, label: 'B (old)' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/revisions`, {
      data: { action: 'restore', revisionId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(res.status()).toBe(404);

    // 8. Discard: an edit, then the draft is gone and the GET shows the live rows.
    res = await hero(`Welcome C ${stamp}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/revisions`, { data: { action: 'discard' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    view = await siteGet();
    expect(view.draft).toBeNull();
    expect(view.site.hero_config.headline).toBe(`Welcome A ${stamp}`);

    // 9. The console at 375: the clean line, then the dirty line + History + Restore.
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 375, height: 812 } });
    try {
      const page = await ownerCtx.newPage();
      await page.goto(`/app/org/league/${leagueId}`);
      const state = page.locator('[data-site-draft-state]');
      await expect(state).toBeVisible({ timeout: 20_000 });
      await expect(state).toHaveAttribute('data-site-draft-state', 'clean');
      await expect(page.getByText('Everything is published.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Take site offline', exact: true })).toBeVisible();
      res = await hero(`Welcome D ${stamp}`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      await page.reload();
      await expect(page.locator('[data-site-draft-state="dirty"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Draft has unpublished changes')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Publish changes', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Discard draft', exact: true })).toBeVisible();
      await page.getByText('History', { exact: true }).click();
      await expect(page.getByRole('list', { name: 'Version history' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Restore' }).first()).toBeVisible();
      await expect(page.getByText('B (old)')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'console: no horizontal overflow at 375px').toBeLessThanOrEqual(1);
      // Publish changes from the console → the line goes clean, the page shows D.
      await page.getByRole('button', { name: 'Publish changes', exact: true }).click();
      await expect(page.locator('[data-site-draft-state="clean"]')).toBeVisible({ timeout: 20_000 });
      await settleBody(anon.request, home, `Welcome D ${stamp}`);
    } finally {
      await ownerCtx.close();
    }
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});

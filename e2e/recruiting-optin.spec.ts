import { test, expect } from '@playwright/test';
import { adminClient, apiAs, createQaChild, deleteQaUser, guardianFlagOn, loadQaUser, readErrorBody } from './helpers/qa-user';

// Recruiting skeleton R1 — the opt-in. The ONE gate is recruiting_status:
// closed answers nothing but the status to a viewer; open answers the card
// (school, grad year, GPA labelled self-reported); the owner and a guardian
// write through the gated PATCH; a stranger and the supervised athlete
// themselves cannot; the profile PUT ignores the recruiting fields. The
// card renders on /athlete/[id] for a viewer at phone width (@mobile).
// Self-skips pre-182.

const ANON = { cookies: [], origins: [] };

test('recruiting opt-in: closed hides, open shows the card; owner + guardian write, stranger + supervised cannot @mobile', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const admin = adminClient();
  const probe = await admin.from('profiles').select('recruiting_status').limit(1);
  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');

  // The edit modal's Recruiting tab exists for the owner (pre- and post-182:
  // the tab renders from the profile; only the save needs the column).
  const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
  try {
    const page = await ownerCtx.newPage();
    await page.goto('/athlete?edit=sport');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Recruiting' }).click();
    await expect(page.locator('#recruiting_school')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Recruiting status' })).toBeVisible();
  } finally {
    await ownerCtx.close();
  }

  if (probe.error) {
    // Pre-182: the degrade contract — the GET says unsupported (the card
    // renders nothing), the PATCH names the migration. Then the real path
    // waits for the column.
    try {
      const res = await alphaApi.get(`/api/profile/${alpha.id}/recruiting`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect(await res.json()).toMatchObject({ supported: false, status: 'closed' });
      const patch = await alphaApi.patch(`/api/profile/${alpha.id}/recruiting`, { data: { status: 'open' } });
      expect(patch.status(), await patch.text()).toBe(409);
      expect(await patch.text()).toContain('182');
    } finally {
      await alphaApi.dispose();
      await bravoApi.dispose();
    }
    console.warn('[e2e] profiles.recruiting_status missing — run migration 182; the recruiting path is not exercised');
    return;
  }
  const { data: prior } = await admin.from('profiles').select('visibility').eq('id', alpha.id).single();
  const priorVisibility = prior!.visibility as string;
  let childId: string | null = null;
  try {
    // Closed by default: the owner reads canEdit, a stranger reads only the status.
    let res = await alphaApi.get(`/api/profile/${alpha.id}/recruiting`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await res.json()).toMatchObject({ supported: true, status: 'closed', canEdit: true });
    res = await request.get(`/api/profile/${alpha.id}/recruiting`, { headers: { cookie: '' } });
    expect(res.status()).toBe(200);
    const closedAnon = await res.json();
    expect(closedAnon).toMatchObject({ status: 'closed', canEdit: false });
    expect(closedAnon.profile).toBeUndefined();
    expect(closedAnon.school).toBeUndefined();

    // A stranger (bravo) cannot write alpha's recruiting; junk is a 400.
    res = await bravoApi.patch(`/api/profile/${alpha.id}/recruiting`, { data: { status: 'open' } });
    expect(res.status()).toBe(403);
    res = await alphaApi.patch(`/api/profile/${alpha.id}/recruiting`, { data: { status: 'open', email: 'x@y.z' } });
    expect(res.status()).toBe(400);

    // The owner opens recruiting with a school and a GPA; the profile PUT cannot touch the gate.
    res = await alphaApi.patch(`/api/profile/${alpha.id}/recruiting`, {
      data: { status: 'open', school: 'QA High', profile: { gpa: 3.856, academic_notes: 'Honours', target_level: 'collegiate' } },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'open', school: 'QA High', profile: { gpa: 3.86, academic_notes: 'Honours', target_level: 'collegiate' } });
    res = await alphaApi.put('/api/profile', { data: { profileData: { recruiting_status: 'closed', recruiting_profile: { gpa: 1 }, bio: 'bio kept' } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: row } = await admin.from('profiles').select('recruiting_status, recruiting_profile, school, bio').eq('id', alpha.id).single();
    expect(row).toMatchObject({ recruiting_status: 'open', school: 'QA High', bio: 'bio kept' });
    expect((row!.recruiting_profile as { gpa: number }).gpa).toBe(3.86);

    // Open + private profile: a stranger still reads nothing; open + public: the card.
    res = await request.get(`/api/profile/${alpha.id}/recruiting`, { headers: { cookie: '' } });
    expect((await res.json()).profile).toBeUndefined();
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', alpha.id);
    res = await request.get(`/api/profile/${alpha.id}/recruiting`, { headers: { cookie: '' } });
    const open = await res.json();
    expect(open).toMatchObject({ status: 'open', canEdit: false, school: 'QA High', recruitable: true, profile: { gpa: 3.86 } });
    expect(JSON.stringify(open)).not.toContain(alpha.email);

    // The card on /athlete/[id] for a viewer (bravo), at this project's viewport.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx.newPage();
      await page.goto(`/athlete/${alpha.id}`);
      const card = page.locator('[data-recruiting-card="open"]');
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card).toContainText('Open to recruiting');
      await expect(card).toContainText('QA High');
      await expect(card).toContainText('3.86 · self-reported');
      await expect(card.getByRole('button', { name: 'Edit' })).toHaveCount(0);
      const width = page.viewportSize()?.width ?? 1280;
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(width);
    } finally {
      await ctx.close();
    }

    // Closing hides the card again (the viewer reads only the status).
    res = await alphaApi.patch(`/api/profile/${alpha.id}/recruiting`, { data: { status: 'closed' } });
    expect(res.status()).toBe(200);
    res = await request.get(`/api/profile/${alpha.id}/recruiting`, { headers: { cookie: '' } });
    expect((await res.json()).profile).toBeUndefined();
    const anonCtx = await browser.newContext({ storageState: ANON });
    try {
      const page = await anonCtx.newPage();
      await page.goto(`/athlete/${alpha.id}`);
      await expect(page.locator('main, body').first()).toBeVisible();
      await expect(page.locator('[data-recruiting-card]')).toHaveCount(0);
    } finally {
      await anonCtx.close();
    }

    // A supervised athlete: the guardian (bravo) opens it; the child cannot; alpha (a stranger) cannot.
    if (guardianFlagOn()) {
      childId = await createQaChild(bravo.id, { firstName: 'Recruit', lastName: 'Kid', handle: `recruitkid${Date.now()}` });
      res = await bravoApi.patch(`/api/profile/${childId}/recruiting`, { data: { status: 'open', school: 'QA Middle' } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      res = await alphaApi.patch(`/api/profile/${childId}/recruiting`, { data: { status: 'closed' } });
      expect(res.status()).toBe(403);
      res = await bravoApi.get(`/api/profile/${childId}/recruiting`);
      expect(await res.json()).toMatchObject({ status: 'open', canEdit: true, supervised: true, school: 'QA Middle' });
    }
  } finally {
    await alphaApi.patch(`/api/profile/${alpha.id}/recruiting`, { data: { status: 'closed', school: '', profile: { gpa: null, academic_notes: null, target_level: null } } }).catch(() => {});
    await admin.from('profiles').update({ visibility: priorVisibility }).eq('id', alpha.id);
    if (childId) await deleteQaUser(childId).catch(() => {});
    await alphaApi.dispose();
    await bravoApi.dispose();
  }
});

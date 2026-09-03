import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { cleanRoundPost, seedRoundPost } from './helpers/member-photos';

// M2 (program 10), part 1 — the member opts in, the manager curates.
// "Share my round photos with this club" writes photo_consent on the
// member's FOLLOW row (a separate grant from the roster one); a
// supervised member is refused; the manager's candidate list shows
// photos from the member's PUBLIC round posts only; a pick lands in the
// gallery module's config after the gate; an ineligible pick is 400.
// 375px: the club page switch and the console picker.

const stamp = Math.random().toString(36).slice(2, 8);

test('photo opt-in: follow-row consent, supervised 403, candidates = public posts only, pick/unpick with the gate; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json'); // the member
  await resetRateBucket(admin, 'org-site', owner.id);

  // QA users are minted PRIVATE and without a handle — the gate needs a
  // public profile. Restored in finally.
  const { data: alphaProfile } = await admin.from('profiles').select('visibility, supervision_state').eq('id', alpha.id).single();
  const priorVisibility = alphaProfile!.visibility as string;
  const priorSupervision = (alphaProfile!.supervision_state as string | null) ?? null;
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', alpha.id);

  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Optin Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id')
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
  ]);
  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  let pub: Awaited<ReturnType<typeof seedRoundPost>> | null = null;
  let priv: Awaited<ReturnType<typeof seedRoundPost>> | null = null;
  try {
    let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };

    // The switch: off → on, on the FOLLOW row; a manager can't read a member's switch for them.
    res = await alphaApi.get(`/api/clubs/${clubId}/photo-consent`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await res.json()).toEqual({ consent: false, eligible: true });
    res = await alphaApi.patch(`/api/clubs/${clubId}/photo-consent`, { data: { consent: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: rows } = await admin
      .from('memberships')
      .select('kind, photo_consent, photo_consent_by')
      .eq('club_id', clubId)
      .eq('profile_id', alpha.id);
    expect(rows!.map(r => [r.kind, r.photo_consent, r.photo_consent_by])).toEqual([['follow', true, alpha.id]]);

    // A supervised member is refused (the rail), and reads as ineligible.
    await admin.from('profiles').update({ supervision_state: 'supervised' }).eq('id', alpha.id);
    res = await alphaApi.patch(`/api/clubs/${clubId}/photo-consent`, { data: { consent: true } });
    expect(res.status()).toBe(403);
    res = await alphaApi.get(`/api/clubs/${clubId}/photo-consent`);
    expect((await res.json()).eligible).toBe(false);
    await admin.from('profiles').update({ supervision_state: priorSupervision }).eq('id', alpha.id);

    // Two round posts with a photo each: one public, one private.
    pub = await seedRoundPost(admin, alpha.id, { stamp, visibility: 'public' });
    priv = await seedRoundPost(admin, alpha.id, { stamp, visibility: 'private' });

    // Candidates: the public one only; a member can't browse.
    res = await ownerApi.get(`/api/clubs/${clubId}/site/photo-candidates`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    type Cand = { mediaId: string; picked: boolean; url: string; courseName: string | null; authorName: string };
    let list = (await res.json()).candidates as Cand[];
    expect(list.map(c => c.mediaId)).toEqual([pub.mediaId]);
    expect(list[0]).toMatchObject({ picked: false, courseName: `QA Links ${stamp}` });
    expect(list[0].url.startsWith('/api/media/')).toBe(true);
    expect((await alphaApi.get(`/api/clubs/${clubId}/site/photo-candidates`)).status()).toBe(403);

    // Picks: the private post's photo is refused; the public one lands; remove clears it.
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'set_gallery_pick', mediaId: priv.mediaId } });
    expect(res.status()).toBe(400);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'set_gallery_pick', mediaId: pub.mediaId } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: mod } = await admin.from('org_site_modules').select('config').eq('site_id', site.id).eq('module_key', 'gallery').single();
    const picks = (mod!.config as { picks: { mediaId: string; postId: string; profileId: string }[] }).picks;
    expect(picks.map(p => [p.mediaId, p.postId, p.profileId])).toEqual([[pub.mediaId, pub.postId, alpha.id]]);
    res = await ownerApi.get(`/api/clubs/${clubId}/site/photo-candidates`);
    list = (await res.json()).candidates as Cand[];
    expect(list[0].picked).toBe(true);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'remove_gallery_pick', mediaId: pub.mediaId } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: after } = await admin.from('org_site_modules').select('config').eq('site_id', site.id).eq('module_key', 'gallery').single();
    expect((after!.config as { picks: unknown[] }).picks).toEqual([]);

    // The member's club page at 375px: the switch reads "on".
    const memberCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await memberCtx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/club/${clubId}`);
      const box = page.locator('[data-round-photo-consent]');
      await expect(box).toBeVisible({ timeout: 20_000 });
      await expect(box).toHaveAttribute('data-round-photo-consent', 'on');
      await page.getByLabel('Share my round photos with this club').uncheck();
      await expect(box).toHaveAttribute('data-round-photo-consent', 'off', { timeout: 10_000 });
      await page.getByLabel('Share my round photos with this club').check();
      await expect(box).toHaveAttribute('data-round-photo-consent', 'on', { timeout: 10_000 });
      // The switch is optimistic — wait for the SAVED state before the console reads it.
      await expect
        .poll(async () => ((await (await alphaApi.get(`/api/clubs/${clubId}/photo-consent`)).json()) as { consent: boolean }).consent, { timeout: 10_000 })
        .toBe(true);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await memberCtx.close();
    }

    // The console picker at 375px: one candidate; Add → picked.
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ownerCtx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/app/org/club/${clubId}`);
      const picker = page.locator('[data-photo-candidates]');
      await expect(picker).toHaveAttribute('data-photo-candidates', '1', { timeout: 20_000 });
      await page.getByRole('button', { name: /^Add to gallery/ }).click();
      await expect(page.locator(`[data-candidate="${pub.mediaId}"]`)).toHaveAttribute('data-picked', '1', { timeout: 15_000 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ownerCtx.close();
    }
  } finally {
    await ownerApi.dispose();
    await alphaApi.dispose();
    await cleanRoundPost(admin, pub);
    await cleanRoundPost(admin, priv);
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('profiles').update({ visibility: priorVisibility, supervision_state: priorSupervision }).eq('id', alpha.id);
  }
});

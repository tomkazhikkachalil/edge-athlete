import { test, expect } from '@playwright/test';
import {
  adminClient,
  apiAs,
  createQaChild,
  deleteQaUser,
  guardianFlagOn,
  loadQaUser,
  readErrorBody, resetRateBucket } from './helpers/qa-user';

// The public gallery (phase 4, round 5, mig 160) — and the phase's photo
// exit proof on its PUBLIC surface. The bar: org publishes the item AND
// every actively tagged athlete is photo-consented. The streamer re-runs
// the gate per request, so a consent revoke stops the bytes immediately
// even while a stale ISR document still links them. Supervised athletes
// are never labeled on the page, consented photo or not.
test('org-site gallery: consent gate, streamer revoke, minor never labeled; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const clubManager = loadQaUser('user.json'); // adult athlete + guardian
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);

  const probe = await admin.from('contest_media').select('id').limit(1);
  test.skip(!!probe.error, `contest_media missing — run migration 158 (${probe.error?.message})`);
  const consentProbe = await admin.from('memberships').select('photo_consent').limit(1);
  test.skip(
    !!consentProbe.error,
    `photo_consent missing — run migration 159 (${consentProbe.error?.message})`
  );

  const stamp = Date.now();
  const name = `QA Gallery League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Gallery Club ${stamp}`, owner_profile_id: clubManager.id })
    .select()
    .single();
  const clubId = club!.id as string;
  let childId: string | null = null;
  const storagePaths: string[] = [];

  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
      { club_id: clubId, profile_id: clubManager.id, role: 'owner' },
    ]);
    const { data: season } = await admin
      .from('seasons')
      .insert({ league_id: leagueId, label: '2026-27' })
      .select()
      .single();
    const { data: homeTeam } = await admin
      .from('teams')
      .insert({ league_id: leagueId, name: `Blazers ${stamp}` })
      .select()
      .single();
    const { data: awayTeam } = await admin
      .from('teams')
      .insert({ club_id: clubId, name: `Comets ${stamp}` })
      .select()
      .single();
    await admin.from('memberships').insert([
      {
        club_id: clubId,
        profile_id: clubManager.id,
        kind: 'roster',
        status: 'active',
        scope_type: 'org',
      },
      {
        club_id: clubId,
        profile_id: clubManager.id,
        kind: 'roster',
        status: 'active',
        scope_type: 'team',
        scope_id: awayTeam!.id,
      },
    ]);
    const { data: comp } = await admin
      .from('competitions')
      .insert({
        league_id: leagueId,
        season_id: season!.id,
        sport_key: 'ice_hockey',
        name: `House League ${stamp}`,
        format: 'fixture',
        entrant_type: 'team',
        status: 'active',
        visibility: 'public',
      })
      .select()
      .single();
    const compId = comp!.id as string;
    const { data: entries } = await admin
      .from('competition_entries')
      .insert([
        { competition_id: compId, team_id: homeTeam!.id, status: 'approved' },
        { competition_id: compId, team_id: awayTeam!.id, status: 'approved' },
      ])
      .select();
    const { data: contest } = await admin
      .from('contests')
      .insert({ competition_id: compId, status: 'scheduled' })
      .select()
      .single();
    const contestId = contest!.id as string;
    await admin.from('contest_participants').insert([
      {
        contest_id: contestId,
        entry_id: entries!.find(e => e.team_id === homeTeam!.id)!.id,
        side: 'home',
      },
      {
        contest_id: contestId,
        entry_id: entries!.find(e => e.team_id === awayTeam!.id)!.id,
        side: 'away',
      },
    ]);

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const leagueMedia = `/api/leagues/${leagueId}/competitions/${compId}/media`;

    const ownerApi = await apiAs('state-b.json');
    const clubApi = await apiAs('state.json');
    let subdomain = '';
    try {
      // The league's public site with the gallery module enabled.
      let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      subdomain = (await res.json()).site.subdomain as string;
      // Gallery module row present ⇔ migration 160 ran.
      const { data: galleryRow } = await admin
        .from('org_site_modules')
        .select('id')
        .eq('module_key', 'gallery')
        .eq('site_id', (await (await ownerApi.get(`/api/leagues/${leagueId}/site`)).json()).site.id)
        .maybeSingle();
      test.skip(!galleryRow, 'gallery module row missing — run migration 160');
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'set_module', moduleKey: 'gallery', enabled: true },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // Consent FIRST (adult self-consent with the CLUB — consent follows
      // the membership through which the athlete participates), THEN the
      // media, THEN publish — so the site's first render is already right.
      res = await clubApi.patch(`/api/clubs/${clubId}/roster`, {
        data: { action: 'set_photo_consent', consent: true },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // Guardian half (when the guardian feature is live here): a
      // supervised child, rostered, tagged, guardian-consented — the
      // photo may appear; the child's name never does.
      if (guardianFlagOn()) {
        childId = await createQaChild(clubManager.id, {
          firstName: `Kid${stamp}`,
          lastName: 'Gallery',
          handle: `gallerykid${stamp}`,
        });
        await admin.from('memberships').insert([
          {
            club_id: clubId,
            profile_id: childId,
            kind: 'roster',
            status: 'active',
            scope_type: 'org',
            photo_consent: true,
            photo_consent_at: new Date().toISOString(),
            photo_consent_by: clubManager.id,
          },
          {
            club_id: clubId,
            profile_id: childId,
            kind: 'roster',
            status: 'active',
            scope_type: 'team',
            scope_id: awayTeam!.id,
          },
        ]);
      }

      // Upload, tag, publish the item; publish the site.
      res = await ownerApi.post(leagueMedia, {
        multipart: {
          contestId,
          file: { name: 'photo.png', mimeType: 'image/png', buffer: png },
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const mediaId = ((await res.json()).media as { id: string }).id;
      const tagIds = [clubManager.id, ...(childId ? [childId] : [])];
      res = await ownerApi.post(`${leagueMedia}/tags`, {
        data: { mediaId, profileIds: tagIds },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect((await res.json()).tagged).toBe(tagIds.length);
      res = await ownerApi.patch(leagueMedia, { data: { mediaId, published: true } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'publish' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // The anonymous surface: gallery in the nav, the item rendered, the
      // adult labeled, the supervised child NEVER labeled. Explicit empty
      // storageState — the config default would sign this context in.
      const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      try {
        const page = await anonCtx.newPage();
        await page.goto(`/org/${subdomain}/gallery`);
        await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible({
          timeout: 20_000,
        });
        const streamerPath = `/api/media/contest-media/${mediaId}`;
        await expect(page.locator(`img[src="${streamerPath}"]`)).toBeVisible();
        const html = await page.content();
        expect(html).toContain(`House League ${stamp}`);
        if (childId) {
          expect(html, 'supervised athlete never labeled').not.toContain(`Kid${stamp}`);
        }

        // The streamer serves the bytes to anonymous…
        const served = await anonCtx.request.get(streamerPath);
        expect(served.status(), 'gate passes → bytes flow').toBe(200);

        // …until a consent revoke — the gate re-runs per request, so the
        // bytes stop immediately even while the ISR document is stale.
        const revoke = await clubApi.patch(`/api/clubs/${clubId}/roster`, {
          data: { action: 'set_photo_consent', consent: false },
        });
        expect(revoke.status(), await readErrorBody(revoke)).toBe(200);
        const refused = await anonCtx.request.get(`${streamerPath}?cb=${stamp}`);
        expect(refused.status(), 'revoke → the streamer refuses').toBe(404);

        // 375px parity on the public page.
        await page.setViewportSize({ width: 375, height: 812 });
        await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
      } finally {
        await anonCtx.close();
      }
    } finally {
      const { data: mediaRows } = await admin
        .from('contest_media')
        .select('storage_path')
        .eq('contest_id', contestId);
      for (const m of mediaRows ?? []) storagePaths.push(m.storage_path as string);
      await ownerApi.dispose();
      await clubApi.dispose();
    }
  } finally {
    if (storagePaths.length) {
      await admin.storage.from('uploads').remove(storagePaths);
    }
    await admin.from('leagues').delete().eq('id', leagueId);
    await admin.from('clubs').delete().eq('id', clubId);
    if (childId) await deleteQaUser(childId);
  }
});

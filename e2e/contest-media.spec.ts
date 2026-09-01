import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Contest media (phase 4, round 3): org-side library + roster-scoped
// attribution. The owner uploads and tags a rostered athlete; the tag
// fills the athlete's profile surface automatically (the exit condition's
// photo half, private surface); untag is a TOMBSTONE the org cannot
// resurrect; the participant club uploads for its own team but cannot
// curate the gallery; the proxy serves bytes to the tagged athlete and
// refuses anonymous viewers.
test('contest media: upload, roster tag, athlete surface, tombstone, proxy gate', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const clubManager = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('contest_media').select('id').limit(1);
  test.skip(!!probe.error, `contest_media missing — run migration 158 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Media League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Media Club ${stamp}`, owner_profile_id: clubManager.id })
    .select()
    .single();
  const clubId = club!.id as string;
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
        league_id: leagueId,
        profile_id: owner.id,
        kind: 'roster',
        status: 'active',
        scope_type: 'team',
        scope_id: homeTeam!.id,
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
        visibility: 'private',
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

    const leagueMedia = `/api/leagues/${leagueId}/competitions/${compId}/media`;
    const clubMedia = `/api/clubs/${clubId}/competitions/${compId}/media`;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    const ownerApi = await apiAs('state-b.json');
    const clubApi = await apiAs('state.json');
    let mediaUrl: string | null = null;
    try {
      // Owner uploads into the contest's library.
      let res = await ownerApi.post(leagueMedia, {
        multipart: {
          contestId,
          file: { name: 'photo.png', mimeType: 'image/png', buffer: png },
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const uploaded = (await res.json()).media as { id: string; url: string | null };
      expect(uploaded.url, 'proxy url minted').toBeTruthy();
      const mediaId = uploaded.id;
      mediaUrl = uploaded.url;

      // Tag the CLUB's rostered athlete from the roster picker set.
      res = await ownerApi.post(`${leagueMedia}/tags`, {
        data: { mediaId, profileIds: [clubManager.id] },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect(await res.json()).toMatchObject({ tagged: 1, skipped: 0 });

      // Off-roster tagging is refused (the attribution gate).
      const { data: stranger } = await admin
        .from('profiles')
        .select('id')
        .neq('id', owner.id)
        .neq('id', clubManager.id)
        .limit(1)
        .maybeSingle();
      if (stranger) {
        res = await ownerApi.post(`${leagueMedia}/tags`, {
          data: { mediaId, profileIds: [stranger.id] },
        });
        expect(res.status(), await readErrorBody(res)).toBe(400);
      }

      // The athlete's profile surface fills automatically — and the
      // PRIVATE competition's name is withheld.
      res = await clubApi.get(`/api/profile/${clubManager.id}/contest-media`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const profileItems = (await res.json()).items as {
        id: string;
        competitionName: string | null;
        canUntag: boolean;
        url: string | null;
      }[];
      expect(profileItems).toHaveLength(1);
      expect(profileItems[0].competitionName).toBeNull();
      expect(profileItems[0].canUntag).toBe(true);

      // Proxy gate: the tagged athlete gets bytes; anonymous does not.
      const asAthlete = await clubApi.get(profileItems[0].url!);
      expect(asAthlete.status(), 'tagged athlete sees the bytes').toBe(200);
      const anonCtx = await browser.newContext();
      try {
        const anon = await anonCtx.request.get(mediaUrl!);
        expect(anon.status(), 'anonymous is refused').not.toBe(200);
      } finally {
        await anonCtx.close();
      }

      // Untag → tombstone: the surface empties and a re-tag is a no-op.
      res = await clubApi.delete(
        `/api/profile/${clubManager.id}/contest-media?mediaId=${mediaId}`
      );
      expect(res.status(), await readErrorBody(res)).toBe(200);
      res = await ownerApi.post(`${leagueMedia}/tags`, {
        data: { mediaId, profileIds: [clubManager.id] },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect(await res.json()).toMatchObject({ tagged: 0, skipped: 1 });
      res = await clubApi.get(`/api/profile/${clubManager.id}/contest-media`);
      expect((await res.json()).items).toHaveLength(0);

      // Participant: the club uploads for its own team's contest…
      res = await clubApi.post(clubMedia, {
        multipart: {
          contestId,
          file: { name: 'photo2.png', mimeType: 'image/png', buffer: png },
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const clubUpload = (await res.json()).media as { id: string };

      // …but only the OWNER curates the gallery bit.
      res = await clubApi.patch(clubMedia, {
        data: { mediaId: clubUpload.id, published: true },
      });
      expect(res.status(), await readErrorBody(res)).toBe(403);
      res = await ownerApi.patch(leagueMedia, {
        data: { mediaId: clubUpload.id, published: true },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // DB truth: two media rows, tombstoned tag preserved.
      const { data: mediaRows } = await admin
        .from('contest_media')
        .select('id, storage_path, published')
        .eq('contest_id', contestId);
      expect(mediaRows).toHaveLength(2);
      for (const m of mediaRows!) storagePaths.push(m.storage_path as string);
      const { data: tombstone } = await admin
        .from('contest_media_tags')
        .select('status')
        .eq('media_id', mediaId)
        .eq('profile_id', clubManager.id)
        .single();
      expect(tombstone!.status).toBe('removed');
    } finally {
      await ownerApi.dispose();
      await clubApi.dispose();
    }

    // Owner console: the media panel renders and holds at 375px.
    const ctxOwner = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctxOwner.newPage();
      await page.goto(`/app/org/league/${leagueId}/competitions/${compId}`);
      await expect(
        page.getByRole('heading', { name: `House League ${stamp}` })
      ).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Media', exact: true }).click();
      await expect(page.getByLabel('Upload game media')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Unpublish' })).toBeVisible();

      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByLabel('Upload game media')).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctxOwner.close();
    }
  } finally {
    if (storagePaths.length) {
      await admin.storage.from('uploads').remove(storagePaths);
    }
    await admin.from('leagues').delete().eq('id', leagueId);
    await admin.from('clubs').delete().eq('id', clubId);
  }
});

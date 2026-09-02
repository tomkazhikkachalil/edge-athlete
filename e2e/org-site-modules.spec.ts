import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Builder depth, part 3 (phase 6b B3): the three masterplan modules that
// were still unbuilt — divisions (teams grouped by division for the
// current seasons), stat leaders (from contest_stat_lines, names masked,
// supervised omitted, golf says "not available"), and documents (stored
// PDFs + https links). Zero DDL: 169 already admitted the keys.

async function settleBody(
  request: { get: (u: string) => Promise<{ text: () => Promise<string> }> },
  url: string,
  needle: string,
  shouldContain = true,
  attempts = 8
): Promise<string> {
  let body = '';
  for (let i = 0; i < attempts; i++) {
    body = await (await request.get(url)).text();
    if (body.includes(needle) === shouldContain) return body;
    await new Promise(r => setTimeout(r, 2500));
  }
  return body;
}

/** The smallest valid single-page PDF (enough for a content-type probe). */
const TINY_PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n160\n%%EOF\n'
);

test('org site modules: divisions, stat leaders (masked; golf degrades), documents (PDF + link); 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'upload', owner.id);

  const stamp = Date.now();
  const name = `QA Modules League ${stamp}`;
  const { data: league } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert({ league_id: leagueId, profile_id: owner.id, role: 'owner' });

  // Structure: a current season → division → team → entry.
  const { data: season } = await admin
    .from('seasons')
    .insert({ league_id: leagueId, label: `2026-27 ${stamp}`, starts_on: '2026-09-01' })
    .select()
    .single();
  const { data: division } = await admin
    .from('divisions')
    .insert({
      league_id: leagueId,
      season_id: season!.id,
      sport_key: 'ice_hockey',
      name: `U13 A ${stamp}`,
      age_band: 'U13',
      tier: 'A',
    })
    .select()
    .single();
  const { data: team } = await admin
    .from('teams')
    .insert({ league_id: leagueId, name: `Blazers ${stamp}` })
    .select()
    .single();
  const teamId = team!.id as string;
  await admin.from('team_entries').insert({ team_id: teamId, division_id: division!.id });

  // A public hockey competition with one contest and a stat line for the
  // owner (2 G, 1 A) → Goals/Assists/Points leaders.
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
  const { data: contest } = await admin
    .from('contests')
    .insert({ competition_id: comp!.id, status: 'completed' })
    .select()
    .single();
  await admin.from('contest_stat_lines').insert({
    contest_id: contest!.id,
    team_id: teamId,
    profile_id: owner.id,
    stats: { goals: 2, assists: 1 },
    provenance: 'league_verified',
    entered_by: owner.id,
  });
  // A golf competition with a line → the leaders module degrades honestly.
  const { data: golfComp } = await admin
    .from('competitions')
    .insert({
      league_id: leagueId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Club Championship ${stamp}`,
      format: 'fixture',
      entrant_type: 'team',
      status: 'active',
      visibility: 'public',
    })
    .select()
    .single();
  const { data: golfContest } = await admin
    .from('contests')
    .insert({ competition_id: golfComp!.id, status: 'completed' })
    .select()
    .single();
  await admin.from('contest_stat_lines').insert({
    contest_id: golfContest!.id,
    team_id: teamId,
    profile_id: owner.id,
    stats: { strokes: 72 },
    provenance: 'league_verified',
    entered_by: owner.id,
  });

  const ownerApi = await apiAs('state-b.json');
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    const subdomain = site.subdomain;

    for (const key of ['divisions', 'leaders', 'documents']) {
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'set_module', moduleKey: key, enabled: true },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    }

    // Documents: a stored PDF + a link; a foreign path is refused.
    const upload = await ownerApi.post(`/api/leagues/${leagueId}/site/assets`, {
      multipart: { document: { name: 'code.pdf', mimeType: 'application/pdf', buffer: TINY_PDF } },
    });
    expect(upload.status(), await readErrorBody(upload)).toBe(200);
    const pdfPath = (await upload.json()).path as string;
    expect(pdfPath).toMatch(new RegExp(`^org-media/${site.id}/[a-f0-9-]+\\.pdf$`));
    const foreign = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
      data: {
        action: 'set_documents',
        documents: [{ title: 'Foreign', path: 'org-media/00000000-0000-4000-8000-000000000000/x.pdf' }],
      },
    });
    expect(foreign.status()).toBe(400);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
      data: {
        action: 'set_documents',
        documents: [
          { title: `Code of conduct ${stamp}`, path: pdfPath },
          { title: 'Hockey Canada policies', url: 'https://www.hockeycanada.ca/policies' },
        ],
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const canonicalProbe = await anonCtx.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
      const sitePath = canonicalProbe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;

      // Home carries all three sections.
      const home = await settleBody(anonCtx.request, sitePath, `U13 A ${stamp}`, true, 12);
      expect(home).toContain('aria-label="Divisions"');
      expect(home).toContain('aria-label="Stat leaders"');
      expect(home).toContain('aria-label="Documents"');
      expect(home).toContain(`Code of conduct ${stamp}`);

      // /divisions: the division with its age band/tier and the team chip.
      const divisions = await settleBody(anonCtx.request, `${sitePath}/divisions`, `Blazers ${stamp}`, true, 12);
      expect(divisions).toContain(`U13 A ${stamp}`);
      expect(divisions).toContain('U13 · A');
      expect(divisions).toContain(`${sitePath}/teams/${teamId}`);

      // /leaders: hockey Goals/Assists/Points for the owner; golf degrades.
      const leaders = await settleBody(anonCtx.request, `${sitePath}/leaders`, `House League ${stamp}`, true, 12);
      expect(leaders).toContain('>Goals<');
      expect(leaders).toContain('>Points<');
      expect(leaders).toContain(`Blazers ${stamp}`);
      // The owner's public display name (a claimed public QA profile shows
      // the full first name; the reader never emits email/handle).
      const { data: ownerProfile } = await admin
        .from('profiles')
        .select('first_name')
        .eq('id', owner.id)
        .single();
      expect(leaders).toContain(ownerProfile!.first_name as string);
      expect(leaders).toContain('Stat leaders aren’t available for');

      // /documents: the PDF streams inline as application/pdf; the link is https.
      const documents = await settleBody(anonCtx.request, `${sitePath}/documents`, `Code of conduct ${stamp}`, true, 12);
      expect(documents).toContain('https://www.hockeycanada.ca/policies');
      const streamUrl = documents.match(/href="(\/api\/media\/org-media\/[^"]+\.pdf)"/)?.[1];
      expect(streamUrl, 'PDF streamer link present').toBeTruthy();
      const pdf = await anonCtx.request.get(streamUrl!);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()['content-type']).toContain('application/pdf');
      expect(pdf.headers()['content-disposition']).toContain('inline');

      // 375px: the leaders tables scroll inside their containers.
      const page = await anonCtx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${sitePath}/leaders`);
      await expect(page.getByRole('heading', { name: 'Stat leaders', level: 1 })).toBeVisible({ timeout: 15_000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        'no horizontal overflow at 375px'
      ).toBeLessThanOrEqual(375);
    } finally {
      await anonCtx.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('league_id', leagueId);
    await admin.from('contest_stat_lines').delete().eq('profile_id', owner.id);
    await admin.from('competitions').delete().eq('league_id', leagueId);
    await admin.from('team_entries').delete().eq('team_id', teamId);
    await admin.from('teams').delete().eq('league_id', leagueId);
    await admin.from('seasons').delete().eq('league_id', leagueId);
    await admin.from('memberships').delete().eq('league_id', leagueId);
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});

import { test, expect } from '@playwright/test';
import { adminClient, apiAs, deleteQaUser, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Data foundation F6 (Sep 13 2026): the scout search reads
// athlete_performances. A hockey stat line makes alpha findable with
// `since` on or before its day and not after; "Verified only"
// (minProvenance=club_recorded) excludes an athlete with self-reported rows
// only and includes them once a club-recorded row exists; the headline
// floor cuts both ways; the form's two controls are disabled without a
// sport chip and enabled with one. Skips pre-182 / pre-194.
test('scout search: performance filters — since, verified only, a headline floor; the controls follow the sport chip', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const probe182 = await admin.from('profiles').select('scout_affiliation').limit(1);
  test.skip(!!probe182.error, `profiles.scout_affiliation missing — run migration 182 (${probe182.error?.message})`);
  const probe194 = await admin.from('athlete_performances').select('id').limit(1);
  test.skip(!!probe194.error, `athlete_performances missing — run migration 194 (${probe194.error?.message})`);

  const api = await apiAs('state.json');
  const { data: prior } = await admin.from('profiles').select('visibility, sport').eq('id', alpha.id).single();
  const rand = Math.random().toString(36).slice(2, 10);
  const scoutEmail = `edgeqa-scout-${rand}@example.com`;
  const scoutPassword = `Qa!${Math.random().toString(36).slice(2, 12)}9`;
  const verifiedKey = `contest_stat_line:e2e-${rand}`;
  let scoutId: string | null = null;
  let postId = '';
  try {
    await resetRateBucket(admin, 'signup', '');
    let res = await request.post('/api/signup', { data: { email: scoutEmail, password: scoutPassword, actorRole: 'scout', profileData: { first_name: 'Sam', last_name: 'Scout' } } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    scoutId = ((await admin.from('profiles').select('id').eq('email', scoutEmail).single()).data!.id as string);
    const scoutCtx = await browser.newContext({ storageState: await mintStorageState({ id: scoutId, email: scoutEmail, password: scoutPassword }) });
    try {
      // Alpha starts with NO hockey rows: the suite's user is shared, and an
      // earlier spec in the same run (an org stat line dated today) leaves
      // rows whose origin went with its org — the `since` floor then finds
      // them (the Sep 25 prod probe). QA data, never facts.
      await admin.from('athlete_performances').delete().eq('profile_id', alpha.id).eq('sport_key', 'ice_hockey');
      // Alpha: open, public, a hockey athlete with one self-reported line on 2026-09-10 (headline 3).
      await admin.from('profiles').update({ visibility: 'public', sport: 'Ice Hockey' }).eq('id', alpha.id);
      res = await api.patch(`/api/profile/${alpha.id}/recruiting`, { data: { status: 'open', school: 'QA High' } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const post = await api.post('/api/posts', {
        data: {
          caption: `Scout hockey ${rand}`,
          visibility: 'public',
          postType: 'ice_hockey',
          stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2026-09-10', stats: { goals: 2, assists: 1 } },
        },
      });
      expect(post.ok(), await readErrorBody(post)).toBe(true);
      postId = (await post.json()).post.id;
      for (let i = 0; i < 20; i++) {
        const { data } = await admin.from('athlete_performances').select('id').eq('natural_key', `post:${postId}`).maybeSingle();
        if (data) break;
        await new Promise(r => setTimeout(r, 500));
      }

      const ids = async (qs: string) => {
        const r = await scoutCtx.request.get(`/api/scout/search?${qs}`);
        expect(r.ok(), await readErrorBody(r)).toBe(true);
        const body = (await r.json()) as { performanceFilters: boolean; athletes: { id: string }[] };
        expect(body.performanceFilters).toBe(true);
        return body.athletes.map(a => a.id);
      };
      expect(await ids('sport=ice_hockey&since=2026-09-01')).toContain(alpha.id);
      expect(await ids('sport=ice_hockey&since=2026-09-10')).toContain(alpha.id);
      expect(await ids('sport=ice_hockey&since=2026-09-11')).not.toContain(alpha.id);
      expect(await ids('sport=ice_hockey&minHeadline=3')).toContain(alpha.id);
      expect(await ids('sport=ice_hockey&minHeadline=4')).not.toContain(alpha.id);
      // Self-reported only → "Verified only" excludes; a club-recorded row includes.
      expect(await ids('sport=ice_hockey&minProvenance=club_recorded')).not.toContain(alpha.id);
      const { error: insertError } = await admin.from('athlete_performances').insert({
        profile_id: alpha.id,
        sport_key: 'ice_hockey',
        occurred_on: '2026-09-05',
        source: 'org_entry',
        source_table: 'contest_stat_lines',
        source_id: '00000000-0000-4000-8000-000000000000',
        natural_key: verifiedKey,
        provenance: 'club_recorded',
        metrics: { goals: 1 },
        headline: 1,
      });
      expect(insertError, insertError?.message).toBeNull();
      expect(await ids('sport=ice_hockey&minProvenance=club_recorded')).toContain(alpha.id);
      // Without a sport the performance filters are ignored, never an error.
      expect(await ids('q=Edge&since=2999-01-01')).toContain(alpha.id);

      // The form: disabled without a chip, enabled with one, and the query narrows.
      const page = await scoutCtx.newPage();
      await page.goto('/app/scout/search');
      await expect(page.locator('[data-scout-search]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('#scout-since')).toBeDisabled();
      await expect(page.locator('#scout-verified')).toBeDisabled();
      await page.getByRole('tab', { name: 'Ice Hockey' }).click();
      await expect(page.locator('#scout-since')).toBeEnabled();
      await page.locator('#scout-since').fill('2026-09-11');
      await expect(page.locator('[data-scout-results="0"]')).toBeVisible({ timeout: 15_000 });
      await page.locator('#scout-since').fill('2026-09-01');
      await expect(page.locator(`a[href="/athlete/${alpha.id}"]`)).toBeVisible({ timeout: 15_000 });
    } finally {
      await scoutCtx.close();
    }
  } finally {
    if (postId) await api.delete(`/api/posts?postId=${postId}`).catch(() => {});
    await admin.from('athlete_performances').delete().eq('natural_key', verifiedKey);
    await api.patch(`/api/profile/${alpha.id}/recruiting`, { data: { status: 'closed', school: '' } }).catch(() => {});
    await admin.from('profiles').update({ visibility: prior!.visibility as string, sport: (prior!.sport as string | null) ?? null }).eq('id', alpha.id);
    if (scoutId) await deleteQaUser(scoutId).catch(() => {});
    await api.dispose();
  }
});

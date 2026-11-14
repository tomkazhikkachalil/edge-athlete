import { test, expect } from './helpers/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, bypassHeaders, deleteQaUser, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Game film round 2, PR 3 (Nov 13 2026) — a player without an account. Most
// of a roster is not on the app: a CLUB or LEAGUE adds the player from the
// tag form — a private roster placeholder (the roster import's own stub, with
// its claim invite) — tags them like anyone, and their stats carry across the
// club's games. A person's own video cannot (a typed name there); a manager
// of someone else's video cannot; a stranger never reads the name.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
withOwnChannel(['jNQXAC9IVRw']);

interface Candidate { id: string; name: string; group: string }

test('a club adds a player with no account from the tag form, tags them, and a stranger reads "Player 1"; a person\'s video cannot — at 375 px', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const person = loadQaUser('user.json');
  for (const id of [owner.id, person.id]) {
    await resetRateBucket(admin, 'video-write', id);
    await resetRateBucket(admin, 'tag-placeholder', id);
  }
  const stamp = `${Date.now()}`;
  const club = await createQaOrg(admin, 'club', { name: `QA Phantom Club ${stamp}`, owner_profile_id: owner.id, sport_key: 'basketball', visibility: 'public' });
  const api = await apiAs('state-b.json');
  const personApi = await apiAs('state.json');
  const strangerApi = await apiAs('state-c.json');
  const ctx = await browser.newContext({ storageState: await mintStorageState(owner), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  const stubIds: string[] = [];
  let videoId: string | null = null;
  let ownVideoId: string | null = null;
  try {
    const seeded = await admin.from('memberships').insert([{ org_id: club.id, profile_id: owner.id, role: 'owner', kind: 'follow', status: 'active' }]);
    expect(seeded.error?.message ?? null).toBeNull();
    // A team with no season: the side is linked, the player still lands — on the organization's roster.
    const team = await admin.from('teams').insert({ org_id: club.id, name: `QA Phantoms ${stamp}` }).select('id').single();
    expect(team.error?.message ?? null).toBeNull();
    await seedOwnChannel(admin, { orgId: club.id }, owner.id);
    let res = await api.post('/api/videos', { data: { url: YT, title: `QA Phantom game ${stamp}`, side: 'club', org_id: club.id, sport_key: 'basketball' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;
    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', played_on: null, side1: { team_id: (team.data as { id: string }).id }, side2: { name: 'QA Visitors' }, coverage: 'highlights', stats_hidden: false } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // 1. Refusals: no name; a stranger who can see the video is not its manager.
    expect((await api.post(`/api/videos/${videoId}/people`, { data: { name: '  ' } })).status()).toBe(400);
    expect((await strangerApi.post(`/api/videos/${videoId}/people`, { data: { name: 'Nope Nope' } })).status()).toBe(403);

    // 2. The player: a private placeholder on the club's roster, in the form's list from now on.
    const name = `Phantom ${stamp.slice(-6)}`;
    res = await api.post(`/api/videos/${videoId}/people`, { data: { name: `  ${name}  `, side: 1 } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const made = (await res.json()).person as Candidate;
    stubIds.push(made.id);
    expect(made).toMatchObject({ name, group: 'roster' });
    const { data: profile } = await admin.from('profiles').select('visibility, email, first_name, last_name').eq('id', made.id).single();
    expect(profile).toMatchObject({ visibility: 'private', first_name: 'Phantom', last_name: stamp.slice(-6) });
    expect((profile as { email: string }).email).toContain('@stubs.invalid');
    const { data: rows } = await admin.from('memberships').select('kind, scope_type').eq('org_id', club.id).eq('profile_id', made.id);
    expect((rows ?? []).map(r => `${(r as { kind: string }).kind}:${(r as { scope_type: string }).scope_type}`).sort()).toEqual(['follow:org', 'roster:org']);
    const { data: invites } = await admin.from('athlete_claim_invites').select('id').eq('profile_id', made.id);
    expect(invites ?? []).toHaveLength(1);
    res = await api.get(`/api/videos/${videoId}/people`);
    expect(((await res.json()).people as Candidate[]).map(p => p.id)).toContain(made.id);

    // 3. Tagged like anyone: named to the manager, "Player 1" to a stranger — never the name.
    res = await api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: 1000, label: 'Three', event_key: 'fg3_made', side: 1, period: 1, people: [{ profile_id: made.id, role: 'scorer' }] } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const strangerText = await (await strangerApi.get(`/api/videos/${videoId}`)).text();
    expect(strangerText).toContain('Player 1');
    expect(strangerText).not.toContain(name);
    expect(strangerText).not.toContain(made.id);

    // 4. On the page: type a name nobody has, add them as a player, and they are on the tag.
    const page = await ctx.newPage();
    await page.goto(`/videos/${videoId}`);
    await page.locator('[data-highlight-add]').first().click();
    await page.locator('[data-tag-add-person="in_clip"]').click();
    const picker = page.locator('[data-tag-picker="org"]');
    await expect(picker.locator(`[data-tag-pick="${made.id}"]`)).toBeVisible({ timeout: 20_000 });
    const second = `Ghost ${stamp.slice(-6)}`;
    await picker.locator('[data-tag-picker-input]').fill(second);
    await expect(picker.locator('[data-tag-add-player]')).toContainText('no account yet');
    expect(await fitsViewportWidth(page)).toBe(true);
    await picker.locator('[data-tag-add-player]').click();
    const chip = page.locator('[data-tag-people] [data-tag-person]').first();
    await expect(chip).toContainText(second, { timeout: 30_000 });
    const chipId = await chip.getAttribute('data-tag-person');
    expect(chipId).toMatch(/^[0-9a-f-]{36}$/);
    stubIds.push(chipId!);

    // 5. A person's own video: no placeholders — the picker has no such door and the API refuses.
    const { data: prior } = await admin.from('profiles').select('visibility').eq('id', person.id).single();
    await seedOwnChannel(admin, { profileId: person.id }, person.id);
    await admin.from('videos').delete().eq('profile_id', person.id).eq('provider_video_id', 'jNQXAC9IVRw');
    res = await personApi.post('/api/videos', { data: { url: YT, title: `QA Own game ${stamp}`, sport_key: 'basketball' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    ownVideoId = ((await res.json()).video as { id: string }).id;
    res = await personApi.post(`/api/videos/${ownVideoId}/people`, { data: { name: 'Nope Nope' } });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toContain('Only a club or league');
    if (prior) await admin.from('profiles').update({ visibility: (prior as { visibility: string }).visibility }).eq('id', person.id);
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    if (ownVideoId) await personApi.delete(`/api/videos/${ownVideoId}`).catch(() => undefined);
    await admin.from('youtube_connections').delete().eq('profile_id', person.id);
    await api.dispose();
    await personApi.dispose();
    await strangerApi.dispose();
    await ctx.close();
    for (const id of stubIds) await deleteQaUser(id).catch(() => undefined);
    await deleteQaOrgs(admin, [club.id]);
  }
});

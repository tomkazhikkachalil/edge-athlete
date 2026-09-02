import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, resetRateBucket } from './helpers/qa-user';
import { DEFAULT_MODULE_ORDER, GOLF_MODULE_ORDER, GOLF_TAGLINE } from '../src/lib/org-sites/validate';

// Phase 7 C3 — the PGA shape. A GOLF club's site (clubs.primary_sport,
// migration 174) is minted in the golf order — season standings, leaders,
// the week's play, news and media first — with the golf tagline;
// reset_order comes back to it; the public page speaks tour ("Season
// standings", "Leaders", "Rounds & events"). A club without a sport keeps
// the classic order. 375px on the public home.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('golf club site: golf order + tagline at creation → reset_order restores → public headings speak golf; classic club unchanged; 375px', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');

  const probe = await admin.from('clubs').select('primary_sport').limit(1);
  test.skip(!!probe.error, `clubs.primary_sport missing — run migration 174 (${probe.error?.message})`);

  const { data: golfClub, error: golfErr } = await admin
    .from('clubs')
    .insert({
      name: `QA Golf Order Club ${stamp}`,
      owner_profile_id: owner.id,
      primary_sport: 'golf',
      approved_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  expect(golfErr, 'golf club seeded').toBeNull();
  const { data: plainClub } = await admin
    .from('clubs')
    .insert({ name: `QA Classic Order Club ${stamp}`, owner_profile_id: owner.id, approved_at: new Date().toISOString() })
    .select('id')
    .single();
  const golfId = golfClub!.id as string;
  const plainId = plainClub!.id as string;
  // The site route gates on the org membership, not the owner column.
  await admin.from('memberships').insert([
    { club_id: golfId, profile_id: owner.id, role: 'owner' },
    { club_id: plainId, profile_id: owner.id, role: 'owner' },
  ]);
  await resetRateBucket(admin, 'org-site', owner.id);

  const moduleOrder = async (clubId: string) => {
    const { data: site } = await admin.from('org_sites').select('id, subdomain, hero_config').eq('club_id', clubId).single();
    const { data: mods } = await admin
      .from('org_site_modules')
      .select('module_key, sort_order')
      .eq('site_id', site!.id)
      .order('sort_order', { ascending: true });
    return { site: site!, keys: (mods ?? []).map(m => m.module_key as string) };
  };

  const ownerApi = await apiAs('state-b.json');
  try {
    // Creation: the golf order and the golf tagline.
    const created = await ownerApi.post(`/api/clubs/${golfId}/site`);
    expect(created.status(), await readErrorBody(created)).toBe(200);
    const fresh = await moduleOrder(golfId);
    expect(fresh.keys).toEqual([...GOLF_MODULE_ORDER.club]);
    expect((fresh.site.hero_config as { tagline?: string })?.tagline).toBe(GOLF_TAGLINE);

    // A scramble, then reset_order → the golf order again (no labels involved).
    const scrambled = await ownerApi.patch(`/api/clubs/${golfId}/site`, {
      data: { action: 'set_nav', items: [{ key: 'contact' }, { key: 'courses' }, { key: 'standings' }] },
    });
    expect(scrambled.status(), await readErrorBody(scrambled)).toBe(200);
    const reset = await ownerApi.patch(`/api/clubs/${golfId}/site`, { data: { action: 'reset_order' } });
    expect(reset.status(), await readErrorBody(reset)).toBe(200);
    expect((await moduleOrder(golfId)).keys).toEqual([...GOLF_MODULE_ORDER.club]);

    // Publish → the public page speaks golf.
    const published = await ownerApi.patch(`/api/clubs/${golfId}/site`, { data: { action: 'publish' } });
    expect(published.status(), await readErrorBody(published)).toBe(200);
    const slug = fresh.site.subdomain as string;
    let html = '';
    await expect
      .poll(
        async () => {
          const res = await request.get(`/org/${slug}`);
          html = res.ok() ? await res.text() : '';
          return res.status();
        },
        { timeout: 30_000, intervals: [1000, 2000, 3000] }
      )
      .toBe(200);
    const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
    expect(h2s[0], 'the first section after the hero').toBe('Season standings');
    expect(h2s.slice(0, 3)).toEqual(['Season standings', 'Leaders', 'Rounds &amp; events']);
    expect(html).toContain(GOLF_TAGLINE.replace(/'/g, '&#x27;'));
    const leaders = await request.get(`/org/${slug}/leaders`);
    expect(leaders.status()).toBe(200);
    expect(await leaders.text()).toMatch(/<h1[^>]*>\s*Leaders\s*<\/h1>/);

    // 375px: the golf home has no horizontal overflow.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/org/${slug}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Season standings' })).toBeVisible({ timeout: 20_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);

    // A club without a sport keeps the classic shape.
    const classic = await ownerApi.post(`/api/clubs/${plainId}/site`);
    expect(classic.status(), await readErrorBody(classic)).toBe(200);
    const plain = await moduleOrder(plainId);
    expect(plain.keys).toEqual([...DEFAULT_MODULE_ORDER.club]);
    expect((plain.site.hero_config as { tagline?: string } | null)?.tagline ?? '').toBe('');
  } finally {
    await ownerApi.dispose();
    await admin.from('org_sites').delete().in('club_id', [golfId, plainId]);
    await admin.from('clubs').delete().in('id', [golfId, plainId]);
  }
});

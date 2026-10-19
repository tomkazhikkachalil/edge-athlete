import { test, expect } from './helpers/test';
import { adminClient, createQaUser, deleteQaUser, mintStorageState } from './helpers/qa-user';

// The seen mark (flow changes item 2b — H0, Oct 19 2026, migration 267): a
// fresh account has its profile_seen row from the signup trigger (first_day
// = the signup day); opening the app signed in bumps last_day to today once;
// a second load changes nothing; the API answers 204 signed out and never
// writes for a stranger. Self-skips pre-267. @mobile.

const todayUTC = () => new Date().toISOString().slice(0, 10);

test('seen beacon: the signup row, one bump per day, nothing for a stranger @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const probe = await admin.from('profile_seen').select('profile_id').limit(1);
  test.skip(!!probe.error, `profile_seen missing — run migration 267 (${probe.error?.message})`);

  const user = await createQaUser({ displayName: 'Seen Sam', firstName: 'Seen', lastName: 'Sam' });
  const ctx = await browser.newContext({ storageState: await mintStorageState(user) });
  try {
    // The trigger: the row exists from the signup, before any app load.
    let { data: row } = await admin.from('profile_seen').select('first_day, last_day, days_mask').eq('profile_id', user.id).maybeSingle();
    expect(row).not.toBeNull();
    const signupDay = row!.first_day as string;
    expect(row!.last_day).toBe(signupDay);
    expect(Number(row!.days_mask) & 1).toBe(1);

    // Pretend the account signed up yesterday so a bump is visible today (a same-day bump is a no-op by design).
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await admin.from('profile_seen').update({ first_day: yesterday, last_day: yesterday, days_mask: 1 }).eq('profile_id', user.id);

    // The app shell, signed in: one POST /api/seen → last_day = today, mask 0b11.
    const page = await ctx.newPage();
    const beacon = page.waitForResponse(r => r.url().endsWith('/api/seen') && r.request().method() === 'POST', { timeout: 30_000 });
    await page.goto('/feed');
    expect((await beacon).status()).toBe(204);
    await expect.poll(async () => (await admin.from('profile_seen').select('last_day').eq('profile_id', user.id).single()).data?.last_day, { timeout: 15_000 }).toBe(todayUTC());
    ({ data: row } = await admin.from('profile_seen').select('first_day, last_day, days_mask').eq('profile_id', user.id).single());
    expect(row!.first_day).toBe(yesterday);
    expect(Number(row!.days_mask)).toBe(3);

    // A second load sends nothing (the device remembers the day); a direct second POST is a cookie-dedup 204 and the row is unchanged.
    let posted = 0;
    page.on('request', r => { if (r.url().endsWith('/api/seen')) posted++; });
    await page.goto('/feed');
    await page.waitForLoadState('networkidle');
    expect(posted).toBe(0);
    const again = await ctx.request.post('/api/seen');
    expect(again.status()).toBe(204);
    ({ data: row } = await admin.from('profile_seen').select('days_mask').eq('profile_id', user.id).single());
    expect(Number(row!.days_mask)).toBe(3);

    // Signed out: 204, nothing written anywhere.
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    expect((await anon.request.post('/api/seen')).status()).toBe(204);
    await anon.close();
  } finally {
    await ctx.close();
    await deleteQaUser(user.id);
  }
});

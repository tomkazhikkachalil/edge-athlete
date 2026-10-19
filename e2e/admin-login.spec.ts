import { test, expect } from './helpers/test';
import { adminClient, adminEmailForE2E, createQaUser, deleteQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';
import { adminContext, adminDoorConfigured, adminSignIn, resetAdminLoginBuckets } from './helpers/admin';

// The admin console's own door (flow changes item 2 — B1, Oct 19 2026):
// /admin/login takes an admin account's email + password and sets the
// ea_admin cookie; a wrong password is one sentence; the cookie alone (no
// app session) opens /api/admin/me and an owner route; a moderator's
// cookie opens the queue; /admin without the cookie goes to the login; Sign
// out clears it; `?next=` never leaves the console. Needs E2E_ADMIN_EMAIL
// (an address the build lists in ADMIN_EMAILS) and ADMIN_SESSION_SECRET on
// the target — skips with the reason otherwise. @mobile.

const adminEmail = adminEmailForE2E();

test.describe('admin login (admin-positive)', () => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');

  test('the door, the cookie, the moderator, sign-out, the next guard @mobile', async ({ browser }) => {
    test.setTimeout(180_000);
    const admin = adminClient();
    const { data: leftover } = await admin.from('profiles').select('id').eq('email', adminEmail!).maybeSingle();
    if (leftover?.id) await deleteQaUser(leftover.id);
    const owner = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
    const mod = await createQaUser({ displayName: 'Mod Morgan', firstName: 'Mod', lastName: 'Morgan' });
    const plain = await createQaUser({ displayName: 'Plain Pat', firstName: 'Plain', lastName: 'Pat' });
    // The two login buckets are IP-keyed (5 per IP + email, 20 per IP, 15 min): three projects in a row would meet their own hits.
    const resetLoginBuckets = resetAdminLoginBuckets;
    await resetLoginBuckets();
    const probeCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const configured = await adminDoorConfigured(probeCtx);
    await probeCtx.close();
    try {
      test.skip(!configured, 'ADMIN_SESSION_SECRET unset on the target — the console\'s own door is off');
      const { error: roleError } = await admin.from('platform_admins').upsert({ profile_id: mod.id, role: 'moderator' }, { onConflict: 'profile_id' });
      expect(roleError).toBeNull();

      // Signed out: /admin → the login; a wrong password → one sentence; a plain member → the same sentence.
      const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await ctx.newPage();
      await page.goto('/admin');
      await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin$/);
      await expect(page.locator('[data-admin-login]')).toBeVisible();
      let res = await ctx.request.post('/api/admin/session', { data: { email: owner.email, password: 'not-the-password' } });
      expect(res.status()).toBe(401);
      expect(((await res.json()) as { error: string }).error).toContain('did not open the console');
      res = await ctx.request.post('/api/admin/session', { data: { email: plain.email, password: plain.password } });
      expect(res.status()).toBe(401);

      // The form: the right password → the console home with the header naming the owner.
      await page.locator('[data-admin-login-email]').fill(owner.email);
      await page.locator('[data-admin-login-password]').fill('wrong');
      await page.locator('[data-admin-login-submit]').click();
      await expect(page.locator('[data-admin-login-error]')).toContainText('did not open the console');
      await page.locator('[data-admin-login-password]').fill(owner.password);
      await page.locator('[data-admin-login-submit]').click();
      await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
      await expect(page.locator('[data-admin-header]')).toBeVisible();
      await expect(page.locator('[data-support-queue-tile]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-admin-who="owner"]')).toContainText(owner.email);
      const cookie = (await ctx.cookies()).find(c => c.name === 'ea_admin');
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe('Strict');

      // The cookie alone (no app session in this context) opens the probe and an owner route.
      res = await ctx.request.get('/api/admin/me');
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect(await res.json()).toMatchObject({ admin: true, role: 'owner', door: 'console' });
      res = await ctx.request.get('/api/admin/contacts?page=1');
      expect(res.status(), await readErrorBody(res)).toBe(200);
      res = await ctx.request.get('/api/admin/session');
      expect(((await res.json()) as { email: string }).email).toBe(owner.email);

      // The login page with a cookie skips the form; `?next=` outside the console is ignored.
      await page.goto('/admin/login?next=https%3A%2F%2Fevil.example');
      await expect(page).toHaveURL(/\/admin$/);
      await page.goto('/admin/login?next=%2Ffeed');
      await expect(page).toHaveURL(/\/admin$/);

      // Sign out clears the cookie: the probe refuses, /admin goes back to the login.
      await page.locator('[data-admin-signout]').click();
      await expect(page).toHaveURL(/\/admin\/login/);
      expect((await ctx.cookies()).find(c => c.name === 'ea_admin')?.value ?? '').toBe('');
      res = await ctx.request.get('/api/admin/me');
      expect(res.status()).toBe(401); // no cookie → no door
      await ctx.close();

      // A moderator's cookie: the queue yes, the owner routes no.
      const modCtx = await adminContext(browser, mod);
      res = await modCtx.request.get('/api/admin/me');
      expect(await res.json()).toMatchObject({ admin: false, role: 'moderator', door: 'console' });
      res = await modCtx.request.get('/api/admin/tickets/stats');
      expect(res.status(), await readErrorBody(res)).toBe(200);
      res = await modCtx.request.get('/api/admin/contacts?page=1');
      expect(res.status()).toBe(403);
      // Removed from the table, the same cookie stops opening the queue at once.
      await admin.from('platform_admins').delete().eq('profile_id', mod.id);
      res = await modCtx.request.get('/api/admin/tickets/stats');
      expect(res.status()).toBe(403);
      await modCtx.close();

      // The app session and the console cookie are two doors: an owner's APP session alone never opens the console (B3) — the cookie does.
      const appCtx = await browser.newContext({ storageState: await mintStorageState(owner) });
      res = await appCtx.request.get('/api/admin/me');
      expect(res.status()).toBe(401);
      res = await appCtx.request.get('/api/admin/contacts?page=1');
      expect(res.status()).toBe(401);
      await adminSignIn(appCtx, owner);
      res = await appCtx.request.get('/api/admin/me');
      expect(((await res.json()) as { door?: string }).door).toBe('console');
      await appCtx.close();
    } finally {
      await resetLoginBuckets();
      await admin.from('platform_admins').delete().eq('profile_id', mod.id);
      await deleteQaUser(plain.id);
      await deleteQaUser(mod.id);
      await deleteQaUser(owner.id);
    }
  });
});

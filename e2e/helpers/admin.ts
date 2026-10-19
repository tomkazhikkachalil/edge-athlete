import type { APIRequestContext, Browser, BrowserContext } from '@playwright/test';
import { adminClient, bypassHeaders, resetRateBucket, type QaUser } from './qa-user';
import { runnerPublicIps } from './runner-ip';

// The admin console's own door (flow changes item 2, Oct 19 2026): a spec
// that acts as an owner or a moderator signs in HERE — email + password of
// a QA user the target build lists in ADMIN_EMAILS (or a platform_admins
// row) → the ea_admin cookie in the context. The app session is never
// consulted by the console (from B3 on), so minting a storage state is not
// enough; both can live in one context when a spec needs the app too.

let runnerIps: Promise<string[]> | null = null;

/** The two login buckets (per IP, per IP + email) for this runner — a run signs the same QA admin in from many specs. */
export async function resetAdminLoginBuckets(): Promise<void> {
  runnerIps ??= runnerPublicIps();
  const admin = adminClient();
  for (const ip of ['::1', '127.0.0.1', 'unknown', ...(await runnerIps)]) {
    await resetRateBucket(admin, 'admin-login-ip', ip);
    await resetRateBucket(admin, 'admin-login', ip);
  }
}

export async function adminSignIn(ctx: BrowserContext | APIRequestContext, user: Pick<QaUser, 'email' | 'password'>): Promise<{ role: 'owner' | 'moderator' }> {
  const api: APIRequestContext = 'request' in ctx ? ctx.request : ctx;
  await resetAdminLoginBuckets();
  const res = await api.post('/api/admin/session', { data: { email: user.email, password: user.password } });
  if (res.status() === 503) throw new Error('admin sign-in is not configured on the target (ADMIN_SESSION_SECRET unset)');
  if (!res.ok()) throw new Error(`admin sign-in failed for ${user.email}: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { role: 'owner' | 'moderator' };
}

/** A context signed in to the CONSOLE only (no app session), with the preview bypass headers. */
export async function adminContext(browser: Browser, user: Pick<QaUser, 'email' | 'password'>, extra: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders(), ...extra });
  await adminSignIn(ctx, user);
  return ctx;
}

/** Whether the target can sign an admin in at all (a 503 from the door means the secret is unset). */
export async function adminDoorConfigured(ctx: BrowserContext): Promise<boolean> {
  const res = await ctx.request.post('/api/admin/session', { data: { email: 'probe@example.com', password: 'x' } });
  return res.status() !== 503;
}

/**
 * The console's sign-in (flow changes program, item 2): the email and the
 * password of an account on the admin list, checked against Supabase Auth
 * with a THROWAWAY client (nothing persists; the app session is never
 * touched), the role from the same sources the gates use, and the result
 * is the admin cookie's token. A refusal never says which part was wrong.
 */
import { createClient } from '@supabase/supabase-js';
import { platformRoleFor } from '@/lib/auth-server';
import { mintAdminToken } from './session-server';
import type { AdminRole } from './session';

export type SignInOutcome =
  | { ok: true; token: string; role: AdminRole; userId: string; email: string }
  | { ok: false; reason: 'invalid' | 'not_admin' };

export async function signInAdmin(email: string, password: string, secret: string): Promise<SignInOutcome> {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { ok: false, reason: 'invalid' };
  // The session that came back is discarded on purpose: this door mints its own cookie.
  await anon.auth.signOut({ scope: 'local' }).catch(() => undefined);
  const role = await platformRoleFor({ id: data.user.id, email: data.user.email ?? email });
  if (!role) return { ok: false, reason: 'not_admin' };
  const token = await mintAdminToken({ sub: data.user.id, email: (data.user.email ?? email).toLowerCase(), role }, secret);
  return { ok: true, token, role, userId: data.user.id, email: (data.user.email ?? email).toLowerCase() };
}

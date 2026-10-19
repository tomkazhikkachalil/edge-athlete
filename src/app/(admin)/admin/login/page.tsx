import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, safeAdminNext } from '@/lib/admin/session';
import { adminSecret, readAdminToken } from '@/lib/admin/session-server';
import AdminLoginForm from '@/components/admin/AdminLoginForm';

// /admin/login — the console's own sign-in (flow changes item 2). A valid
// admin cookie skips the form; `?next=` is honoured only inside /admin.

export const metadata: Metadata = { title: 'Sign in' };

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeAdminNext(next);
  const secret = adminSecret();
  if (secret) {
    const token = (await cookies()).get(ADMIN_COOKIE)?.value;
    if (await readAdminToken(token, secret)) redirect(target);
  }
  return <AdminLoginForm next={target} configured={!!secret} />;
}

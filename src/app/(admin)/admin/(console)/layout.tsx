import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, ADMIN_LOGIN_PATH } from '@/lib/admin/session';
import { adminSecret, readAdminToken } from '@/lib/admin/session-server';
import { AdminSessionProvider } from '@/lib/admin/use-admin-auth';
import { GlobalToasts } from '@/components/Toast';

// The console's pages (flow changes item 2, B2): everything under /admin
// but the login. The server reads the cookie first so a signed-out visitor
// never sees a flash of the console (the login page is the one exception,
// outside this group); the client provider then probes the session once
// for every page's `useAdminAuth()`. Toasts: the app's global store, so the
// console's panels keep theirs.

export default async function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const secret = adminSecret();
  const token = secret ? (await cookies()).get(ADMIN_COOKIE)?.value : undefined;
  const claims = secret ? await readAdminToken(token, secret) : null;
  if (!claims) redirect(`${ADMIN_LOGIN_PATH}?next=${encodeURIComponent('/admin')}`);
  return (
    <AdminSessionProvider>
      {children}
      <GlobalToasts />
    </AdminSessionProvider>
  );
}

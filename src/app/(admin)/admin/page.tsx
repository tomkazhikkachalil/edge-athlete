import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, ADMIN_LOGIN_PATH } from '@/lib/admin/session';
import { adminSecret, readAdminToken } from '@/lib/admin/session-server';
import AdminHeader from '@/components/admin/AdminHeader';

// /admin — the console's home (flow changes item 2, B1). B1 opens the door
// and proves the session; B2 moves the console's pages in under it. Until
// then the home names who is signed in and links to the pages where they
// still live.

export default async function AdminHomePage() {
  const secret = adminSecret();
  const token = secret ? (await cookies()).get(ADMIN_COOKIE)?.value : undefined;
  const claims = secret ? await readAdminToken(token, secret) : null;
  if (!claims) redirect(`${ADMIN_LOGIN_PATH}?next=${encodeURIComponent('/admin')}`);
  return (
    <div className="min-h-screen bg-canvas">
      <AdminHeader email={claims.email} role={claims.role} />
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4" data-admin-home>
        <h1 className="text-2xl font-bold text-primary">Admin</h1>
        <p className="text-sm text-secondary">You are signed in to the console as {claims.email} ({claims.role}).</p>
        <section className="grid sm:grid-cols-2 gap-4">
          {claims.role === 'owner' && (
            <Link href="/dashboard" className="ea-interactive bg-surface rounded-lg shadow-sm border border-border p-4 text-left block" data-admin-link="console">
              <p className="text-sm font-semibold text-primary">The console</p>
              <p className="text-xs text-muted mt-1">Support, contacts, help articles, orgs, structure, usage — moving here next.</p>
            </Link>
          )}
          <Link href="/dashboard/tickets" className="ea-interactive bg-surface rounded-lg shadow-sm border border-border p-4 text-left block" data-admin-link="tickets">
            <p className="text-sm font-semibold text-primary">Support queue</p>
            <p className="text-xs text-muted mt-1">Help requests, reports and suggestions.</p>
          </Link>
        </section>
      </main>
    </div>
  );
}

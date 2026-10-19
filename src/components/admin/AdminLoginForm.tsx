'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The console's sign-in form (flow changes item 2): an admin account's
 * email and password → POST /api/admin/session → the ea_admin cookie → the
 * `next` the page vetted. One refusal sentence whatever was wrong; the
 * attempts copy when the bucket closes; a plain line when the door is not
 * configured on this deployment.
 */
const FIELD = 'w-full rounded-lg border border-border bg-surface px-4 py-3 text-base text-primary min-h-[48px]';

export default function AdminLoginForm({ next, configured }: { next: string; configured: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Could not sign in.');
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-canvas flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm" data-admin-login>
        <Image src="/logo-mark.png" alt="" width={56} height={56} className="mx-auto mb-5" priority />
        <h1 className="text-center text-2xl font-bold text-primary">Edge Athlete admin</h1>
        <p className="mt-2 text-center text-sm text-secondary">Sign in with an admin account. This is separate from your app sign-in.</p>
        {configured ? (
          <form onSubmit={submit} className="mt-8 flex flex-col gap-3">
            <label className="block">
              <span className="sr-only">Email</span>
              <input type="email" required autoComplete="username" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className={FIELD} data-admin-login-email="" />
            </label>
            <label className="block">
              <span className="sr-only">Password</span>
              <input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className={FIELD} data-admin-login-password="" />
            </label>
            <button type="submit" disabled={busy} className="ea-cta rounded-lg px-5 py-3 font-semibold min-h-[48px] disabled:opacity-60" data-admin-login-submit="">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            {error && (
              <p className="text-sm text-danger-fg" role="alert" data-admin-login-error="">
                {error}
              </p>
            )}
          </form>
        ) : (
          <p className="mt-8 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-secondary" role="status" data-admin-login-unconfigured="">
            Admin sign-in is not configured on this deployment. Set <code>ADMIN_SESSION_SECRET</code> and redeploy.
          </p>
        )}
        <p className="mt-8 text-center text-sm text-muted">
          <Link href="/" className="font-semibold text-brand-fg underline">
            Back to Edge Athlete
          </Link>
        </p>
      </div>
    </main>
  );
}

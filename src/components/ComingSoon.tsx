'use client';

// The coming-soon page's body (the launch gate, Sep 30 2026): the mark,
// one line, a waitlist email (the existing /api/waitlist), and the
// sign-in link for an existing account (`/?signin=1` — the one query the
// gate lets through to the login form).

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { SIGNIN_QUERY } from '@/lib/launch-gate';

export default function ComingSoon() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('busy');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), userType: 'guest' }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setState('error');
        setMessage(body.error ?? 'Please try again.');
        return;
      }
      setState('done');
    } catch {
      setState('error');
      setMessage('Check your connection and try again.');
    }
  };

  return (
    <main className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center" data-coming-soon>
        <Image src="/logo-mark.png" alt="" width={72} height={72} className="mx-auto mb-6" priority />
        <h1 className="text-[32px] font-bold text-primary leading-tight">Edge Athlete is coming soon</h1>
        <p className="mt-3 text-base text-secondary">
          One home for athletes, clubs and leagues — profiles, results, live rounds and events, every sport.
          We’re putting the finishing touches on it.
        </p>

        {state === 'done' ? (
          <p className="mt-8 rounded-lg bg-success-soft px-4 py-3 text-sm font-semibold text-success-fg">
            You’re on the list — we’ll email you when the doors open.
          </p>
        ) : (
          <form onSubmit={join} className="mt-8 flex flex-col sm:flex-row gap-3">
            <label className="sr-only" htmlFor="coming-soon-email">
              Email
            </label>
            <input
              id="coming-soon-email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="flex-1 rounded-lg border border-border bg-surface px-4 py-3 text-base text-primary min-h-[48px]"
            />
            <button type="submit" disabled={state === 'busy'} className="ea-cta rounded-lg px-5 py-3 font-semibold min-h-[48px] disabled:opacity-60">
              Notify me
            </button>
          </form>
        )}
        {state === 'error' && message && <p className="mt-2 text-sm text-danger-fg">{message}</p>}

        <p className="mt-10 text-sm text-muted">
          Have an account?{' '}
          <Link href={`/?${SIGNIN_QUERY}=1`} className="font-semibold text-brand-fg underline" data-coming-soon-signin>
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

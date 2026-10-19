'use client';

// The coming-soon page's body (the launch gate, Sep 30 2026): the mark, one
// line, and — since the contact list (Oct 19 2026, migration 266) — a
// sign-up with an optional name and an explicit consent box, or an inquiry
// with a message, both through POST /api/contacts, each answered with a
// confirmation the person reads. The sign-in link for an existing account
// (`/?signin=1`) is the one query the gate lets through to the login form.

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { SIGNIN_QUERY } from '@/lib/launch-gate';
import { COPY } from '@/lib/copy';
import { MARKETING_CONSENT_TEXT, type ContactSource } from '@/lib/contacts/rules';

type State = 'idle' | 'busy' | 'done' | 'error';

/** The confirmation's words, filled in. */
export function contactDoneCopy(source: ContactSource, name: string, email: string): { title: string; body: string } {
  const who = name.trim() ? `, ${name.trim()}` : '';
  const c = COPY.CONTACTS;
  return source === 'inquiry'
    ? { title: c.DONE_INQUIRY_TITLE.replace('{name}', who), body: c.DONE_INQUIRY_BODY.replace('{email}', email) }
    : { title: who ? `${c.DONE_SIGNUP_TITLE}${who}` : c.DONE_SIGNUP_TITLE, body: c.DONE_SIGNUP_BODY.replace('{email}', email) };
}

const FIELD = 'w-full rounded-lg border border-border bg-surface px-4 py-3 text-base text-primary min-h-[48px]';

export default function ComingSoon() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [inquiry, setInquiry] = useState(false);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ source: ContactSource; email: string } | null>(null);

  const source: ContactSource = inquiry ? 'inquiry' : 'notify_signup';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inquiry && !message.trim()) {
      setState('error');
      setError(COPY.CONTACTS.MESSAGE_REQUIRED);
      return;
    }
    setState('busy');
    setError(null);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          source,
          name: name.trim() || undefined,
          message: inquiry ? message.trim() : undefined,
          marketingConsent: consent,
          // The words the checkbox showed — the row keeps them.
          consentText: MARKETING_CONSENT_TEXT,
          userType: 'athlete',
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; email?: string };
      if (!res.ok) {
        setState('error');
        setError(body.error ?? COPY.CONTACTS.ERROR_GENERIC);
        return;
      }
      setDone({ source, email: body.email ?? email.trim().toLowerCase() });
      setState('done');
    } catch {
      setState('error');
      setError(COPY.CONTACTS.ERROR_OFFLINE);
    }
  };

  const doneCopy = done ? contactDoneCopy(done.source, name, done.email) : null;

  return (
    <main className="min-h-screen bg-canvas flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md text-center" data-coming-soon>
        <Image src="/logo-mark.png" alt="" width={72} height={72} className="mx-auto mb-6" priority />
        <h1 className="text-[32px] font-bold text-primary leading-tight">Edge Athlete is coming soon</h1>
        <p className="mt-3 text-base text-secondary">
          One home for athletes, clubs and leagues — profiles, results, live rounds and events, every sport.
          We’re putting the finishing touches on it.
        </p>

        {state === 'done' && doneCopy ? (
          <div className="mt-8 rounded-lg bg-success-soft px-4 py-4 text-left" role="status" data-coming-soon-done={done?.source}>
            <p className="text-base font-semibold text-success-fg">{doneCopy.title}</p>
            <p className="mt-1 text-sm text-success-fg">{doneCopy.body}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 flex flex-col gap-3 text-left" noValidate={false}>
            <label className="block">
              <span className="sr-only">{COPY.CONTACTS.NAME_LABEL}</span>
              <input
                type="text"
                autoComplete="name"
                maxLength={100}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={COPY.CONTACTS.NAME_LABEL}
                className={FIELD}
                data-coming-soon-name=""
              />
            </label>
            <label className="block">
              <span className="sr-only">{COPY.CONTACTS.EMAIL_LABEL}</span>
              <input
                id="coming-soon-email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={FIELD}
              />
            </label>
            {inquiry && (
              <label className="block">
                <span className="sr-only">{COPY.CONTACTS.MESSAGE_LABEL}</span>
                <textarea
                  required
                  rows={4}
                  maxLength={5000}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={COPY.CONTACTS.MESSAGE_PLACEHOLDER}
                  className={`${FIELD} min-h-[112px]`}
                  data-coming-soon-message=""
                />
              </label>
            )}
            <label className="flex min-h-[44px] items-start gap-3 py-1 text-sm text-secondary">
              <input
                type="checkbox"
                checked={consent}
                onChange={e => setConsent(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0"
                data-coming-soon-consent=""
              />
              <span>
                <span className="block text-primary">{COPY.CONTACTS.CONSENT_LABEL}</span>
                <span className="block text-xs text-muted">{COPY.CONTACTS.CONSENT_HINT}</span>
              </span>
            </label>
            <button
              type="submit"
              disabled={state === 'busy'}
              className="ea-cta rounded-lg px-5 py-3 font-semibold min-h-[48px] disabled:opacity-60"
              data-coming-soon-submit={source}
            >
              {state === 'busy' ? COPY.CONTACTS.SENDING : inquiry ? COPY.CONTACTS.SEND_CTA : COPY.CONTACTS.NOTIFY_CTA}
            </button>
            {state === 'error' && error && (
              <p className="text-sm text-danger-fg" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setInquiry(v => !v);
                setState('idle');
                setError(null);
              }}
              className="mx-auto min-h-[44px] px-2 text-sm font-medium text-brand-fg underline"
              data-coming-soon-inquiry={inquiry ? 'on' : 'off'}
            >
              {inquiry ? COPY.CONTACTS.INQUIRY_BACK : COPY.CONTACTS.INQUIRY_OFFER}
            </button>
          </form>
        )}

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

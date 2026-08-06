'use client';

import { useState } from 'react';
import Link from 'next/link';
import BrandBar from '@/components/BrandBar';

// Public contact form — wires the (previously caller-less) /api/contact
// endpoint to an actual page. Works logged-in or logged-out.
export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), message: message.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Could not send your message. Please try again.');
        return;
      }
      setSent(true);
    } catch (err) {
      console.error('Contact submit failed:', err);
      setError('Could not send your message. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 min-h-[44px] border border-border-strong rounded-md text-sm text-primary focus:outline-none focus:ring-2 focus:ring-violet-500';

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar />

      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-surface rounded-lg shadow-lg p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">Contact us</h2>

          {sent ? (
            <div>
              <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-md text-sm mb-6">
                Message sent — we&apos;ll get back to you at{' '}
                <span className="font-semibold">{email.trim()}</span>.
              </div>
              <Link href="/" className="text-brand-fg hover:text-brand-fg-strong text-sm font-medium">
                ← Back to Edge Athlete
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm text-tertiary mb-6">
                Questions, feedback, or something broken? Tell us and we&apos;ll reply by email.
              </p>

              {error && (
                <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-4">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-secondary mb-1">Name</label>
                  <input id="name" type="text" value={name} onChange={e => setName(e.target.value)}
                    className={inputClass} autoComplete="name" maxLength={100} required />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-secondary mb-1">Email</label>
                  <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                    className={inputClass} autoComplete="email" required />
                </div>
                <div>
                  <label htmlFor="message" className="block text-sm font-medium text-secondary mb-1">Message</label>
                  <textarea id="message" rows={5} value={message} onChange={e => setMessage(e.target.value)}
                    className="w-full px-3 py-2 border border-border-strong rounded-md text-sm text-primary focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                    maxLength={2000} required />
                  <p className="mt-1 text-xs text-faint text-right">{message.length}/2000</p>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition font-medium disabled:opacity-50"
                >
                  {submitting ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i>Sending…</>
                  ) : (
                    'Send message'
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link href="/" className="text-brand-fg hover:text-brand-fg-strong text-sm font-medium">
                  ← Back to Edge Athlete
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

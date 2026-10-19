'use client';

// The landing page's Club / League / Fan / Guest popup (shown while the gate
// is off): since the contact list (Oct 19 2026, migration 266) a
// notification sign-up through POST /api/contacts — an optional name, the
// interest type, an explicit consent box — with the same confirmation the
// coming-soon page gives.

import { useState } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { COPY } from '@/lib/copy';
import { MARKETING_CONSENT_TEXT } from '@/lib/contacts/rules';
import { contactDoneCopy } from '@/components/ComingSoon';

interface WaitlistPopupProps {
  isOpen: boolean;
  onClose: () => void;
  userType: string;
}

const TYPES = [
  { value: 'club', label: 'Club' },
  { value: 'league', label: 'League' },
  { value: 'fan', label: 'Fan' },
  { value: 'guest', label: 'Guest Explorer' },
] as const;

const FIELD = 'w-full px-3 py-2 min-h-[44px] border border-border-strong rounded-md bg-surface text-primary';

export default function WaitlistPopup({ isOpen, onClose, userType }: WaitlistPopupProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [selectedType, setSelectedType] = useState(userType.toLowerCase());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          source: 'notify_signup',
          name: name.trim() || undefined,
          marketingConsent: consent,
          consentText: MARKETING_CONSENT_TEXT,
          userType: selectedType,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string; email?: string };
      if (!response.ok) {
        setError(result.error || COPY.CONTACTS.ERROR_GENERIC);
        return;
      }
      setSubmittedEmail(result.email ?? email.trim().toLowerCase());
    } catch {
      setError(COPY.CONTACTS.ERROR_OFFLINE);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setName('');
    setEmail('');
    setConsent(false);
    setSelectedType(userType.toLowerCase());
    setSubmittedEmail(null);
    setError('');
    onClose();
  };

  // Lock background scroll while open (iOS scroll-chaining behind overlays)
  useBodyScrollLock(isOpen);

  if (!isOpen) return null;

  const typeLabel = TYPES.find(t => t.value === selectedType)?.label.toLowerCase() ?? selectedType;
  const done = submittedEmail ? contactDoneCopy('notify_signup', name, submittedEmail) : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-raised rounded-lg shadow-xl max-w-md w-full max-h-modal overflow-y-auto" role="dialog" aria-modal="true" data-waitlist-popup="">
        {!done ? (
          <div className="p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold text-primary mb-2">Thank you for your enthusiasm!</h2>
                <p className="text-tertiary text-sm">
                  We&apos;re not quite ready for {typeLabel} profiles yet, but we&apos;d love to notify you when we launch.
                </p>
              </div>
              <button onClick={handleClose} className="ea-icon-btn text-faint hover:text-tertiary text-xl leading-none" aria-label="Close popup">
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="waitlist-name" className="block text-sm font-medium text-secondary mb-1">
                  {COPY.CONTACTS.NAME_LABEL}
                </label>
                <input id="waitlist-name" type="text" autoComplete="name" maxLength={100} value={name} onChange={e => setName(e.target.value)} className={FIELD} data-waitlist-name="" />
              </div>
              <div>
                <label htmlFor="waitlist-email" className="block text-sm font-medium text-secondary mb-1">
                  {COPY.CONTACTS.EMAIL_LABEL}
                </label>
                <input id="waitlist-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} className={FIELD} placeholder="you@example.com" required />
              </div>
              <div>
                <label htmlFor="waitlist-type" className="block text-sm font-medium text-secondary mb-1">
                  Profile Type
                </label>
                <select id="waitlist-type" value={selectedType} onChange={e => setSelectedType(e.target.value)} className={FIELD} required>
                  {TYPES.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex min-h-[44px] items-start gap-3 text-sm text-secondary">
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" data-waitlist-consent="" />
                <span>
                  <span className="block text-primary">{COPY.CONTACTS.CONSENT_LABEL}</span>
                  <span className="block text-xs text-muted">{COPY.CONTACTS.CONSENT_HINT}</span>
                </span>
              </label>

              {error && (
                <div className="bg-danger-soft border border-border text-danger-fg px-3 py-2 rounded-md text-sm" role="alert">
                  {error}
                </div>
              )}

              <div className="flex space-x-3 pt-2">
                <button type="button" onClick={handleClose} className="flex-1 px-4 py-2 min-h-[44px] border border-border-strong text-secondary rounded-md hover:bg-surface-muted transition duration-200">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="ea-cta flex-1 px-4 py-2 min-h-[44px] rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center" data-waitlist-submit="">
                  {isSubmitting ? COPY.CONTACTS.SENDING : COPY.CONTACTS.NOTIFY_CTA}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="p-6 text-center" role="status" data-waitlist-done="">
            <div className="w-16 h-16 bg-success-soft rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-check text-success-fg text-2xl" aria-hidden="true"></i>
            </div>
            <h3 className="text-lg font-bold text-primary mb-2">{done.title}</h3>
            <p className="text-tertiary mb-6">{done.body}</p>
            <p className="text-sm text-muted mb-6">In the meantime, you can still sign up as an Athlete to explore the platform!</p>
            <button onClick={handleClose} className="ea-cta px-6 py-2 min-h-[44px] rounded-md">
              Got it!
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

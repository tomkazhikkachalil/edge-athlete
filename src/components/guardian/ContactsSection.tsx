'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import ConfirmModal from '@/components/ConfirmModal';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { VOLUME_BAND_LABEL, type ContactState, type VolumeBand } from '@/lib/contact-roster';

// ── Contacts roster (Wave 3) ─────────────────────────────────────────────────
// Who the child has direct conversations with — identity, first contact,
// volume band, standing state. NEVER content (no DM transcripts, ever).
// Structural clone of BlockedUsersList: person row + metadata + one action.
// `highlightId` (from ?contact=, the escalation deep-link) rings that row.

interface ContactRow {
  profileId: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  handle: string | null;
  avatarUrl: string | null;
  firstContactAt: string | null;
  volumeBand: VolumeBand;
  state: ContactState;
  source: string | null;
}

const STATE_CHIP: Record<ContactState, { label: string; cls: string }> = {
  approved: { label: 'Approved', cls: 'bg-violet-100 dark:bg-violet-950/60 text-brand-fg-strong' },
  held: { label: 'Waiting for you', cls: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300' },
  denied: { label: 'Denied', cls: 'bg-surface-sunken text-tertiary' },
  blocked: { label: 'Blocked', cls: 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300' },
};

export default function ContactsSection({
  profileId,
  subjectName,
  highlightId,
}: {
  profileId: string;
  subjectName: string;
  highlightId: string | null;
}) {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [acting, setActing] = useState('');
  const [pendingDeny, setPendingDeny] = useState<ContactRow | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/guardian/athletes/${profileId}/contacts`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load contacts');
        if (cancelled) return;
        setContacts(data.contacts ?? []);
        setError('');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load contacts');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, retryKey]);

  const decide = async (contact: ContactRow, decision: 'approve' | 'deny') => {
    setActing(contact.profileId);
    setError('');
    try {
      const res = await fetch(`/api/guardian/athletes/${profileId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactProfileId: contact.profileId, decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not record the decision');
      setContacts(prev =>
        prev.map(c =>
          c.profileId === contact.profileId
            ? { ...c, state: decision === 'approve' ? 'approved' : 'denied' }
            : c
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the decision');
    } finally {
      setActing('');
    }
  };

  return (
    <section className="bg-surface border border-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-bold text-primary mb-1">Contacts</h2>
      <p className="text-xs text-tertiary mb-4">
        People {subjectName} has direct conversations with. You see who and how
        often — never what was said.
      </p>

      {error && (
        <div role="alert" className="text-sm text-red-600 dark:text-red-400 mb-3">
          {error}{' '}
          <button type="button" onClick={() => setRetryKey(k => k + 1)} className="underline font-semibold">
            Retry
          </button>
        </div>
      )}

      {!loaded ? (
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand mx-auto my-4"></div>
      ) : contacts.length === 0 && !error ? (
        <p className="text-sm text-muted">No direct conversations yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {contacts.map(contact => {
            const name = formatDisplayName(contact.firstName, null, contact.lastName, contact.fullName);
            const chip = STATE_CHIP[contact.state];
            const highlighted = highlightId === contact.profileId;
            return (
              <li
                key={contact.profileId}
                className={`py-3 ${highlighted ? 'ring-2 ring-brand rounded-lg px-2 -mx-2' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className="relative w-10 h-10 rounded-full overflow-hidden bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center shrink-0">
                    {contact.avatarUrl ? (
                      <Image
                        src={contact.avatarUrl}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-cover"
                        unoptimized={!isOptimizableImageSrc(contact.avatarUrl)}
                      />
                    ) : (
                      <span className="text-xs font-semibold text-brand-fg-strong">{getInitials(name)}</span>
                    )}
                  </div>
                  <div className="flex-grow min-w-0">
                    <p className="text-sm font-semibold text-primary truncate">
                      {name}
                      {contact.handle && <span className="font-normal text-muted"> @{contact.handle}</span>}
                    </p>
                    {/* Meta on its OWN line — chips in truncating rows
                        collapse at 375px (the Wave-2 lesson). */}
                    <p className="text-xs text-muted">
                      {contact.firstContactAt
                        ? `First contact ${new Date(contact.firstContactAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · `
                        : ''}
                      {VOLUME_BAND_LABEL[contact.volumeBand]}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${chip.cls}`}>
                    {chip.label}
                  </span>
                </div>
                {contact.state === 'held' && (
                  <div className="flex gap-2 mt-2 ml-13 pl-0.5">
                    <button
                      type="button"
                      disabled={acting === contact.profileId}
                      onClick={() => decide(contact, 'approve')}
                      className="px-3 py-2 min-h-[44px] inline-flex items-center bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={acting === contact.profileId}
                      onClick={() => setPendingDeny(contact)}
                      className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors disabled:opacity-50"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmModal
        isOpen={pendingDeny !== null}
        title="Deny this contact?"
        message={`The conversation is removed quietly — ${pendingDeny ? formatDisplayName(pendingDeny.firstName, null, pendingDeny.lastName, pendingDeny.fullName) : 'they'} won't be told. If they try again, you'll be asked again. To stop them permanently, use Blocked users below.`}
        confirmText="Deny"
        onConfirm={() => {
          if (pendingDeny) void decide(pendingDeny, 'deny');
          setPendingDeny(null);
        }}
        onCancel={() => setPendingDeny(null)}
      />
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { ORG_SECTIONS, type OrgSection } from '@/lib/orgs/authz';
import { SECTION_LABELS } from '@/lib/orgs/staff-validate';

// ── Invite someone to manage sections (org staff program, round 5) ───────────
// Opened from any node of the Hierarchy section with that node as the
// scope. Email + "Admin (every section)" toggle (org scope only) or the
// nine section checkboxes + an optional season. On success the single-use
// link is shown with a copy button — the link is the guaranteed channel;
// the email and the bell are conveniences the response reports. A bottom
// sheet at phone width, a centred dialog above it. Discarding a started
// form asks first (useDirtyClose).

export interface InviteScopeOption {
  type: 'division' | 'team';
  id: string;
  name: string;
}

interface Props {
  side: 'league' | 'club';
  orgId: string;
  seasons: Array<{ id: string; label: string }>;
  scopeOptions: InviteScopeOption[];
  /** The node the Invite button was pressed on (null = whole org). */
  initialScope: InviteScopeOption | null;
  onClose: () => void;
  onInvited: () => void;
}

export default function StaffInviteModal({ side, orgId, seasons, scopeOptions, initialScope, onClose, onInvited }: Props) {
  const plural = side === 'league' ? 'leagues' : 'clubs';
  const [email, setEmail] = useState('');
  const [admin, setAdmin] = useState(false);
  const [sections, setSections] = useState<OrgSection[]>([]);
  const [scopeKey, setScopeKey] = useState<string>(initialScope ? `${initialScope.type}:${initialScope.id}` : 'org');
  const [seasonId, setSeasonId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ inviteUrl: string; emailSent: boolean; belled: boolean; summary: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const isDirty = () => !result && (email.trim() !== '' || sections.length > 0 || admin);
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose, submitting]);

  const orgScope = scopeKey === 'org';
  const toggle = (s: OrgSection) => setSections(cur => (cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Enter the email address to invite.');
      return;
    }
    if (!admin && sections.length === 0) {
      setError('Pick at least one section, or make them an admin.');
      return;
    }
    setSubmitting(true);
    try {
      const [scopeType, scopeId] = orgScope ? ['org', null] : scopeKey.split(':');
      const res = await fetch(`/api/${plural}/${orgId}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          grant: {
            role: admin ? 'admin' : 'staff',
            ...(admin ? {} : { sections }),
            scopeType,
            ...(scopeId ? { scopeId } : {}),
            ...(seasonId ? { seasonId } : {}),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not create the invite');
        return;
      }
      setResult({ inviteUrl: data.inviteUrl, emailSent: !!data.emailSent, belled: !!data.belled, summary: data.summary ?? '' });
      onInvited();
    } catch {
      setError('Could not create the invite');
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.inviteUrl);
      setCopied(true);
    } catch {
      /* the link is selectable below */
    }
  };

  const scopeLabel = orgScope ? `the whole ${side}` : (scopeOptions.find(o => `${o.type}:${o.id}` === scopeKey)?.name ?? 'this scope');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !submitting && requestClose()} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Invite to manage sections"
        className="relative bg-surface-raised rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-lg max-h-modal overflow-y-auto safe-bottom"
      >
        <div className="px-5 pt-5 pb-3 border-b border-border-subtle flex items-center justify-between">
          <h2 className="text-lg font-semibold text-primary">Invite someone to help</h2>
          <button type="button" onClick={requestClose} aria-label="Close" className="ea-icon-btn text-muted hover:text-secondary">
            <i className="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>

        {result ? (
          <div className="px-5 py-5 space-y-3">
            <p className="text-sm text-primary">
              Invite created for <span className="font-semibold">{email.trim()}</span> — {result.summary}.
            </p>
            <p className="text-xs text-tertiary">
              {result.emailSent ? 'We emailed them the link.' : 'Email is not configured here — share the link yourself.'}
              {result.belled ? ' They already have an account, so they got a notification too.' : ''} The link is single-use and expires in 30 days.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input readOnly value={result.inviteUrl} onFocus={e => e.currentTarget.select()} className="flex-1 min-w-0 px-3 py-2 text-xs border border-border-strong rounded-md bg-surface text-primary" aria-label="Invite link" />
              <button type="button" onClick={copyLink} className="ea-interactive min-h-[44px] px-4 rounded-lg bg-brand text-white text-sm font-medium">
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <button type="button" onClick={onClose} className="ea-interactive min-h-[44px] w-full rounded-lg border border-border-strong text-sm font-medium text-primary">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="px-5 py-4 space-y-4">
            <p className="text-sm text-tertiary">
              They get the sections you pick for <span className="font-medium text-secondary">{scopeLabel}</span> — and nothing else. Owners keep the {side}&apos;s settings and identity.
            </p>
            <div>
              <label htmlFor="staff-invite-email" className="block text-sm font-medium text-secondary mb-1">Email</label>
              <input id="staff-invite-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2 text-sm border border-border-strong rounded-md bg-surface text-primary" placeholder="coach@example.com" />
            </div>
            <div>
              <label htmlFor="staff-invite-scope" className="block text-sm font-medium text-secondary mb-1">Where</label>
              <select
                id="staff-invite-scope"
                value={scopeKey}
                onChange={e => {
                  setScopeKey(e.target.value);
                  if (e.target.value !== 'org') setAdmin(false);
                }}
                className="w-full max-w-full px-3 py-2 text-sm border border-border-strong rounded-md bg-surface text-primary"
              >
                <option value="org">The whole {side}</option>
                {scopeOptions.map(o => (
                  <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>
                    {o.type === 'division' ? 'Division' : 'Team'}: {o.name}
                  </option>
                ))}
              </select>
            </div>
            {orgScope && (
              <label className="flex items-center gap-3 min-h-[44px] text-sm text-primary">
                <input type="checkbox" checked={admin} onChange={e => setAdmin(e.target.checked)} />
                <span>
                  <span className="font-medium">Admin</span> — every section (still not the {side}&apos;s settings, owners or roles)
                </span>
              </label>
            )}
            {!admin && (
              <fieldset>
                <legend className="text-sm font-medium text-secondary mb-1">Sections</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                  {ORG_SECTIONS.map(s => (
                    <label key={s} className="flex items-center gap-3 min-h-[44px] text-sm text-primary">
                      <input type="checkbox" checked={sections.includes(s)} onChange={() => toggle(s)} />
                      {SECTION_LABELS[s]}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {seasons.length > 0 && (
              <div>
                <label htmlFor="staff-invite-season" className="block text-sm font-medium text-secondary mb-1">Season (optional)</label>
                <select id="staff-invite-season" value={seasonId} onChange={e => setSeasonId(e.target.value)} className="w-full max-w-full px-3 py-2 text-sm border border-border-strong rounded-md bg-surface text-primary">
                  <option value="">No season — until revoked</option>
                  {seasons.map(s => (
                    <option key={s.id} value={s.id}>{s.label} — ends at rollover</option>
                  ))}
                </select>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-600">{error}</p>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
              <button type="button" onClick={requestClose} className="ea-interactive min-h-[44px] px-4 rounded-lg border border-border-strong text-sm font-medium text-primary">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="ea-interactive min-h-[44px] px-4 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-60">
                {submitting ? 'Creating…' : 'Create invite'}
              </button>
            </div>
          </form>
        )}
      </div>
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        overlayZClass="z-[60]"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </div>
  );
}

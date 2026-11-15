'use client';

/**
 * The unclaimed page's banner (Sprint 4 PR 6b, migration 312). Tom, Nov 15
 * 2026: a tagged player who has not claimed their profile has a page marked
 * "Unclaimed", and claiming is a request the person starts here. For the
 * organization that tagged the games: the open requests, and the switch
 * that keeps this page private.
 */
import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { REQUEST_COPY, UNCLAIMED_COPY } from '@/lib/sport-profile/unclaimed';
import type { UnclaimedView } from '@/lib/sport-profile/unclaimed-server';

interface Props {
  view: UnclaimedView;
  /** Something changed (a request, an answer, the switch): read the page again. */
  onChanged: () => void;
}

const BTN = 'ea-interactive min-h-[44px] rounded-lg border border-border bg-surface px-4 text-sm font-medium text-primary disabled:opacity-60';
const CTA = 'ea-cta inline-flex min-h-[44px] items-center rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-60';

export default function UnclaimedBanner({ view, onChanged }: Props) {
  const { showError } = useToast();
  const [busy, setBusy] = useState(false);
  const send = async (url: string, method: 'POST' | 'PATCH', body?: unknown) => {
    setBusy(true);
    try {
      const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        showError(b?.error ?? 'Could not save that. Check your connection and try again.');
        return;
      }
      onChanged();
    } catch {
      showError('Could not save that. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  const base = `/api/profile/${view.profile_id}`;
  const statusFor = (id: string) => view.mine.find(m => m.for_id === id)?.status ?? null;

  return (
    <aside className="mb-6 space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-6" data-unclaimed="" data-unclaimed-listed={view.listed ? 'yes' : 'no'}>
      <div className="space-y-2">
        <p><span className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-wide text-secondary" data-unclaimed-mark="">{UNCLAIMED_COPY.mark}</span></p>
        <p className="text-sm text-secondary">{UNCLAIMED_COPY.intro}{view.org ? ` Tagged by ${view.org.name}.` : ''}</p>
        {!view.listed && <p className="text-sm font-medium text-primary" data-unclaimed-private="">{UNCLAIMED_COPY.keptPrivate}</p>}
      </div>

      {/* The person: "this is me", or "this is <my child>". A manager of the organization does not ask their own organization. */}
      {view.listed && !view.can_manage && view.org && view.sports.length === 0 && view.mine.length === 0 && (
        <p className="text-sm text-secondary" data-unclaimed-nothing="">There are no tagged games left on this page to ask for.</p>
      )}
      {view.listed && !view.can_manage && view.org && (view.sports.length > 0 || view.mine.length > 0) && (
        <div className="space-y-3" data-unclaimed-ask="">
          {view.candidates.map(c => {
            const status = statusFor(c.id);
            return (
              <div key={c.id} className="space-y-1" data-unclaimed-candidate={c.self ? 'self' : c.id}>
                {status ? (
                  <p className="text-sm text-secondary" data-unclaimed-request={status}>{c.self ? '' : `${c.name}: `}{REQUEST_COPY[status]}</p>
                ) : view.sports.length === 0 ? null : (
                  <button type="button" disabled={busy} onClick={() => void send(`${base}/claim-request${c.self ? '' : `?for=${c.id}`}`, 'POST')} className={c.self ? CTA : BTN} data-unclaimed-ask-button="">
                    {c.self ? UNCLAIMED_COPY.ask : UNCLAIMED_COPY.askFor(c.name)}
                  </button>
                )}
              </div>
            );
          })}
          <p className="text-xs text-muted">{UNCLAIMED_COPY.whatHappens}</p>
        </div>
      )}

      {view.can_manage && (
        <div className="space-y-3 border-t border-border-subtle pt-4" data-unclaimed-manage="">
          <h2 className="text-base font-bold text-primary">For {view.org?.name ?? 'your organization'}</h2>
          {view.requests.length === 0 ? (
            <p className="text-sm text-secondary" data-unclaimed-requests="0">Nobody has asked for this profile.</p>
          ) : (
            <ul className="space-y-3" data-unclaimed-requests={view.requests.length}>
              {view.requests.map(r => (
                <li key={r.id} className="space-y-2 rounded-lg border border-border-subtle p-3" data-unclaimed-request-row={r.id}>
                  <p className="text-sm text-primary"><span className="font-semibold">{r.requester.name}</span> says they are this player.</p>
                  <p className="text-xs text-muted">Approving moves this player&apos;s clips and stats from your videos to their profile. The roster spot stays as it is. It cannot be undone from here.</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={() => void send(`${base}/claim-request/${r.id}`, 'PATCH', { action: 'approve' })} className={CTA} data-unclaimed-approve="">Approve</button>
                    <button type="button" disabled={busy} onClick={() => void send(`${base}/claim-request/${r.id}`, 'PATCH', { action: 'decline' })} className={BTN} data-unclaimed-decline="">Decline</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-1">
            <button type="button" disabled={busy} onClick={() => void send(`${base}/unclaimed`, 'PATCH', { listed: !view.listed })} className={BTN} data-unclaimed-listed-toggle="">
              {view.listed ? 'Keep this page private' : 'Open this page again'}
            </button>
            <p className="text-xs text-muted">{view.listed ? 'Open: anyone signed in can see this player\'s short name, stats and clips from your public games, and ask for the profile.' : 'Private: only your organization\'s managers see this page, and nobody can ask for it.'}</p>
          </div>
        </div>
      )}
    </aside>
  );
}

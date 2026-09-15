'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ConfirmModal from '@/components/ConfirmModal';
import { CARD_STATUS_LABEL, cardRows, notFinalNames, type CardRow, type ScorecardParticipant } from '@/lib/sport-events/cards-view';
import type { EventApi } from '@/lib/sport-events/client';
import type { SportEventViewPayload } from '@/lib/sport-events/view';

/**
 * The Scorecard tab (Events program, PR 13). A player: their card's
 * status, "Open my scorecard" (the live round), "Submit my card". An
 * organizer: every card with its status chip, Mark final / Reopen per
 * card, and Complete event with the not-final list in the confirm.
 * Reads the round's scorecard payload; refetches after every action and
 * after the shell's own actions (`version`).
 */
interface Props {
  view: SportEventViewPayload;
  api: EventApi;
  version: number;
  onCompleted: () => Promise<void>;
  onChanged: () => void;
}

const TONE: Record<CardRow['status'], string> = {
  in_progress: 'bg-surface-muted text-secondary border-border',
  submitted: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
  final: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
};
const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

export default function EventScorecardTab({ view, api, version, onCompleted, onChanged }: Props) {
  const round = view.rounds[0] ?? null;
  const gp = round?.group_post_id ?? null;
  const { viewer, event } = view;
  const [cards, setCards] = useState<ScorecardParticipant[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    if (!gp) return;
    const res = await api.scorecard(gp);
    if (res.ok && res.data) { setCards(res.data.scorecard.participants); setState('ready'); } else setState('error');
  }, [api, gp]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!gp) return;
      const res = await api.scorecard(gp);
      if (cancelled) return;
      if (res.ok && res.data) { setCards(res.data.scorecard.participants); setState('ready'); } else setState('error');
    })();
    return () => { cancelled = true; };
  }, [api, gp, version]);

  if (!gp) return <p className="text-sm text-muted">The scorecards open when the event goes live.</p>;
  if (state === 'loading' && !cards) return <div className="flex justify-center py-8" aria-busy="true"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand" /></div>;
  if (state === 'error' && !cards) return <p className="text-sm text-red-700 dark:text-red-300">The scorecards could not be loaded.</p>;

  const rows = cardRows(cards ?? [], view.participants, { profileId: viewer.profile_id, canManage: viewer.can_manage });
  const mine = rows.find(r => r.isSelf) ?? null;
  const pending = notFinalNames(rows);
  const over = event.status === 'completed' || event.status === 'cancelled';

  const act = async (key: string, fn: () => Promise<{ ok: boolean; error: string | null }>) => {
    setBusy(key);
    setError(null);
    const res = await fn();
    if (!res.ok) setError(res.error ?? 'That did not go through.');
    await load();
    onChanged();
    setBusy(null);
  };

  const chip = (r: CardRow) => <span className={`px-2 py-0.5 rounded-md border text-xs font-semibold ${TONE[r.status]}`} data-card-status={r.status}>{CARD_STATUS_LABEL[r.status]}</span>;
  const line = (r: CardRow) => `${r.holesCompleted} of ${round?.holes ?? 18} holes${r.total !== null ? ` · ${r.total}` : ''}`;

  return (
    <div className="space-y-5" data-event-scorecard-tab="">
      {mine && (
        <section className="bg-surface-muted rounded-lg p-4 space-y-3" data-my-card={mine.status}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-primary">My card</p>
              <p className="text-xs text-secondary">{line(mine)}</p>
            </div>
            {chip(mine)}
          </div>
          <div className="flex flex-wrap gap-2">
            {!over && mine.status !== 'final' && (
              <Link href={`/live/${gp}`} className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center" data-open-my-scorecard="">Open my scorecard</Link>
            )}
            {!over && mine.canSubmit && (
              <button type="button" disabled={busy !== null} onClick={() => act('submit', () => api.submitCard(mine.pid))} className={BTN} data-submit-my-card="">Submit my card</button>
            )}
          </div>
          {mine.status === 'submitted' && <p className="text-xs text-muted">Submitted — a new score of yours reopens it; the organizer marks it final.</p>}
        </section>
      )}

      <section>
        <h2 className="text-sm font-bold text-primary mb-1">{viewer.can_manage ? `Cards (${rows.length})` : 'The field'}</h2>
        <ul className="divide-y divide-border-subtle">
          {rows.map(r => (
            <li key={r.pid} className="flex flex-wrap items-center justify-between gap-2 py-2" data-card-row={r.profileId}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary truncate">{r.name}{r.isSelf ? <span className="ml-1 text-xs font-normal text-muted">(you)</span> : null}</p>
                <p className="text-xs text-secondary">{line(r)}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {chip(r)}
                {!over && r.canFinalize && <button type="button" disabled={busy !== null} onClick={() => act(r.pid, () => api.finalizeCard(r.pid))} className={BTN} data-mark-final={r.profileId}>Mark final</button>}
                {!over && r.canReopen && <button type="button" disabled={busy !== null} onClick={() => act(r.pid, () => api.finalizeCard(r.pid, true))} className={BTN} data-reopen={r.profileId}>Reopen</button>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {viewer.can_manage && event.status === 'live' && (
        <div className="space-y-2">
          <button type="button" disabled={busy !== null} onClick={() => setConfirm(true)} className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-complete-event="">Complete event</button>
          <p className="text-xs text-muted">{pending.length === 0 ? 'Every card is final.' : `${pending.length} card${pending.length === 1 ? ' is' : 's are'} not final: ${pending.join(', ')}.`}</p>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300" data-scorecard-error="">{error}</p>}
      {confirm && (
        <ConfirmModal
          isOpen
          title="Complete the event?"
          message={pending.length === 0 ? 'Every card is final. Results post to each player\'s profile unless they opted out.' : `Not final yet: ${pending.join(', ')}. Completing finalizes them as they stand. Results post to each player's profile unless they opted out.`}
          confirmText="Complete"
          onConfirm={async () => { setConfirm(false); await onCompleted(); }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  );
}

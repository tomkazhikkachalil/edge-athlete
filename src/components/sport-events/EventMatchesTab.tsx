'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ConfirmModal from '@/components/ConfirmModal';
import LargerWindow from '@/components/bubbles/LargerWindow';
import type { EventApi } from '@/lib/sport-events/client';
import type { EventMatchesPayload, MatchView } from '@/lib/sport-events/match-view';
import { confirmCopyFor } from '@/lib/sport-events/page-rules';
import { activeRounds } from '@/lib/sport-events/rounds';
import { offersBracket, type RoundSelection } from '@/lib/sport-events/tabs';
import type { SportEventViewPayload } from '@/lib/sport-events/view';
import BracketView from './BracketView';
import RoundSwitcher from './RoundSwitcher';

interface Props {
  view: SportEventViewPayload;
  api: EventApi;
  /** Bumped by the shell after any action so the matches refetch. */
  version: number;
  /** 'bracket' (every round, stacked) or a round id. */
  selected: RoundSelection | null;
  onSelect: (next: RoundSelection) => void;
  onCompleteRound: (round: SportEventViewPayload['rounds'][number]) => Promise<void>;
  onChanged: () => void;
}

const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

/**
 * The Matches tab (Events program, phase 3, PR 7): the round's matches as
 * rows — "Ann vs Bob · Ann 2 UP thru 14" / "Ann wins 3&2" (the winner
 * bold) — computed by the route on every read and refreshed every 15 s
 * while the round is live; the undecided list; "Complete round n" with the
 * matches-undecided copy (the route refuses until every match has a
 * winner — never an override); the organizer's Decide sheet on an open
 * match. `?round=bracket` draws the whole bracket (`BracketView`: a column
 * per round, stacked on a phone).
 * The same component at 390 and on a desktop.
 */
export default function EventMatchesTab({ view, api, version, selected, onSelect, onCompleteRound, onChanged }: Props) {
  const { viewer, event } = view;
  const bracket = selected === 'bracket';
  const round = !bracket && selected ? view.rounds.find(r => r.id === selected) ?? null : null;
  const roundId = round?.id ?? null;
  const many = activeRounds(view.rounds).length > 1;
  const [data, setData] = useState<EventMatchesPayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [decide, setDecide] = useState<MatchView | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = round?.status === 'live' || (bracket && view.rounds.some(r => r.status === 'live'));

  useEffect(() => {
    if (!bracket && !roundId) return;
    let cancelled = false;
    const load = async () => {
      const res = await api.matches(bracket ? null : roundId);
      if (cancelled) return;
      if (res.ok && res.data) { setData(res.data); setState('ready'); } else setState('error');
    };
    void load();
    // Hidden tabs do not poll; a return to the tab loads once (Round 3).
    const tick = live ? window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15_000) : null;
    const onVisible = () => { if (live && document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; if (tick !== null) window.clearInterval(tick); document.removeEventListener('visibilitychange', onVisible); };
  }, [api, bracket, roundId, version, live]);

  const switcher = <RoundSwitcher rounds={view.rounds} selected={selected} onChange={onSelect} includeBracket={offersBracket('matches', view.rounds, !!event.match?.bracket)} label="Matches round" />;
  if (!bracket && !round) return <div className="space-y-3">{switcher}<p className="text-sm text-muted">No round yet.</p></div>;
  if (state === 'loading' && !data) return <div className="space-y-3">{switcher}<div className="flex justify-center py-8" aria-busy="true"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand" /></div></div>;
  if (state === 'error' && !data) return <div className="space-y-3">{switcher}<p className="text-sm text-red-700 dark:text-red-300">The matches could not be loaded.</p></div>;

  const matches = data?.matches ?? [];
  const undecided = matches.filter(m => m.state.status !== 'completed');
  const completeCopy = round ? confirmCopyFor('complete', round, view.rounds, { matchPlay: true }) : null;
  const decideWrite = async (m: MatchView, winner: 1 | 2 | null) => {
    setBusy(true);
    setError(null);
    const res = await api.decideMatch(m.id, { winner_side: winner, version: m.version });
    if (!res.ok) setError(res.error ?? 'That did not go through.');
    else setDecide(null);
    onChanged();
    setBusy(false);
  };

  const row = (m: MatchView) => {
    const w = m.state.winnerSide;
    const gp = data?.rounds.find(r => r.id === m.round_id)?.group_post_id ?? null;
    const side = (i: 0 | 1) => {
      const s = m.sides[i];
      const names = s.members.map(x => x.name).join(' & ') || (m.bye ? '—' : 'TBD');
      return <span className={w === s.side ? 'font-bold text-primary' : 'text-primary'} data-match-side={s.side}>{names}</span>;
    };
    return (
      <li key={m.id} className="rounded-lg border border-border bg-surface px-4 py-3 space-y-1" data-match-row={m.id} data-match-status={m.state.status}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">{m.title}{bracket ? ` · Round ${data?.rounds.find(r => r.id === m.round_id)?.sequence ?? ''}` : ''}</p>
          {m.state.status === 'completed' && <span className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">final</span>}
        </div>
        <p className="text-sm">{side(0)} <span className="text-muted">vs</span> {side(1)}</p>
        <p className="text-sm text-secondary" data-match-summary="">{m.state.summary}</p>
        {(viewer.can_manage || gp) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {gp && <Link href={`/live/${gp}`} className={BTN} data-match-scorecard="">Scorecard</Link>}
            {viewer.can_manage && live && m.state.status !== 'completed' && (
              <button type="button" onClick={() => setDecide(m)} className={BTN} data-match-decide={m.id}>Decide</button>
            )}
            {viewer.can_manage && live && m.stored.decided_by === 'organizer' && (
              <button type="button" disabled={busy} onClick={() => decideWrite(m, null)} className={BTN} data-match-undecide={m.id}>Clear decision</button>
            )}
          </div>
        )}
      </li>
    );
  };

  if (bracket && data) {
    return (
      <div className="space-y-4" data-event-matches="bracket">
        {switcher}
        <BracketView data={data} />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-event-matches={bracket ? 'bracket' : round!.id}>
      {switcher}
      {round?.status === 'completed' && <p className="text-sm text-muted" data-matches-final-note="">{many ? `Round ${round.sequence} is final.` : 'The event is final.'}</p>}
      {matches.length === 0 && (
        <p className="text-sm text-muted">
          {round && round.status === 'scheduled' ? (viewer.can_manage ? 'Set the draw on the Groups tab — every match needs its two sides before the round starts.' : 'The draw appears once the organizer sets it and the round starts.') : 'No matches.'}
        </p>
      )}
      <ul className="space-y-2">{matches.map(row)}</ul>
      {viewer.can_manage && round && round.status === 'live' && (
        <div className="space-y-2">
          <button type="button" disabled={busy || undecided.length > 0} onClick={() => setConfirm(true)} className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-complete-round="">{many ? `Complete round ${round.sequence}` : 'Complete event'}</button>
          <p className="text-xs text-muted" data-matches-undecided-note="">{undecided.length === 0 ? 'Every match is decided.' : `${undecided.length} match${undecided.length === 1 ? ' is' : 'es are'} still open: ${undecided.map(m => m.title).join(', ')}. Play them out, concede, or decide them.`}</p>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300" data-matches-error="">{error}</p>}
      {decide && (
        <LargerWindow title={decide.title} subtitle={decide.line} onClose={() => setDecide(null)} windowKey="match-decide">
          <div className="space-y-3" data-match-decide-sheet="">
            <p className="text-sm text-secondary">Decide the match by hand — a no-show, a disqualification, a ruling. The holes played stay on the cards. You can clear it again while the round is live.</p>
            {decide.sides.map(s => (
              <button key={s.side} type="button" disabled={busy} onClick={() => decideWrite(decide, s.side)} className="ea-interactive w-full text-left border border-border-strong rounded-lg px-4 min-h-[44px] text-sm font-semibold text-primary disabled:opacity-60" data-decide-side={s.side}>
                {s.members.map(x => x.name).join(' & ') || `Side ${s.side}`} wins
              </button>
            ))}
            <div className="flex justify-end">
              <button type="button" onClick={() => setDecide(null)} className={BTN}>Cancel</button>
            </div>
          </div>
        </LargerWindow>
      )}
      {confirm && round && completeCopy && (
        <ConfirmModal
          isOpen
          title={completeCopy.title}
          message={completeCopy.message}
          confirmText={completeCopy.confirmText}
          onConfirm={async () => { setConfirm(false); await onCompleteRound(round); }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  );
}

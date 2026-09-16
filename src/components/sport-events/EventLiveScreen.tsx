'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { useRoundStats } from '@/hooks/useRoundStats';
import { useStatOutbox } from '@/hooks/useStatOutbox';
import { eventApi } from '@/lib/sport-events/client';
import { formatDateOnly, formatTeeTime } from '@/lib/sport-events/format';
import { lineState, overlayStats } from '@/lib/sport-events/stat-outbox';
import { statSchemaFor } from '@/lib/sport-events/stats';
import type { StatLineView } from '@/lib/sport-events/stats-server';
import type { SportEventViewPayload } from '@/lib/sport-events/view';
import ScoreControl from './ScoreControl';
import StatEntryStrip from './StatEntryStrip';

interface Props {
  eventId: string;
  /** The public view from the server, or null (a link / private / unknown event → fetched with the session). */
  initialView: SportEventViewPayload | null;
  token: string | null;
  roundParam: string | null;
}

const DOT: Record<string, string> = { saved: 'bg-emerald-500', pending: 'bg-amber-400', conflict: 'bg-red-500', error: 'bg-red-500' };

/**
 * /events/[id]/live — the live stat screen (Events program, phase 4): the
 * round's score and every player's line, polled 5 s while live, with the
 * entry strip for whoever has rights (the server's `viewer.can_enter`:
 * an organizer / recorder for everyone, a player for their own line under
 * self entry) and the score control for a recorder / organizer on a game.
 * A public event renders signed out (watch); the strip owns the bottom
 * edge (the tab bar hides here). Never a dead end: back to the event.
 */
export default function EventLiveScreen({ eventId, initialView, token, roundParam }: Props) {
  const { user, loading: authLoading, initialAuthCheckComplete } = useAuth();
  const api = useMemo(() => eventApi(eventId, token), [eventId, token]);
  const [view, setView] = useState<SportEventViewPayload | null>(initialView);
  const [gate, setGate] = useState<'loading' | 'ready' | 'unavailable'>(initialView ? 'ready' : 'loading');

  useEffect(() => {
    if (initialView || !initialAuthCheckComplete || authLoading) return;
    let cancelled = false;
    (async () => {
      const res = await api.view();
      if (cancelled) return;
      if (!res.ok || !res.data) { setGate('unavailable'); return; }
      setView(res.data);
      setGate('ready');
    })();
    return () => { cancelled = true; };
  }, [api, initialView, initialAuthCheckComplete, authLoading, user?.id]);

  const rounds = useMemo(() => (view?.rounds ?? []).filter(r => r.status !== 'cancelled'), [view]);
  const round = useMemo(() => {
    const byParam = roundParam ? rounds.find(r => r.id === roundParam) : undefined;
    if (byParam) return byParam;
    return rounds.find(r => r.status === 'live') ?? rounds.find(r => r.status === 'scheduled') ?? (rounds.length > 0 ? rounds[rounds.length - 1] : null);
  }, [rounds, roundParam]);
  const roundId = round?.id ?? null;
  const live = round?.status === 'live';
  const { data, state, refresh } = useRoundStats(api, roundId, live, gate === 'ready');
  const outbox = useStatOutbox(eventId, roundId ?? 'none', refresh);
  const [selected, setSelected] = useState<string | null>(null);
  const schema = useMemo(() => statSchemaFor(view?.event.sport_key), [view]);

  const lines = useMemo(() => (data ? overlayStats(data.lines, outbox.entries) : []), [data, outbox.entries]);
  const canEnter = (l: StatLineView) => !!data && !!user && live && (data.viewer.can_enter === 'all' || data.viewer.can_enter.includes(l.id));
  const selectedLine = selected ? lines.find(l => l.id === selected) ?? null : null;
  const serverLine = selected && data ? data.lines.find(l => l.id === selected) ?? null : null;

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className={`max-w-2xl mx-auto px-4 py-4 ${selectedLine ? 'pb-48' : 'pb-8'}`} data-live-stats="">
        <Link href={`/events/${eventId}?tab=stats`} className="inline-flex items-center gap-2 text-sm font-semibold text-brand-fg-strong min-h-[44px]" data-live-stats-back="">
          <i className="fas fa-chevron-left text-xs" aria-hidden="true"></i>
          {view?.event.name ?? 'Event'}
        </Link>
        {body}
      </main>
    </div>
  );

  if (gate === 'loading') return shell(<div className="flex items-center justify-center py-16" aria-busy="true"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" /></div>);
  if (gate === 'unavailable' || !view) {
    return shell(
      <div className="bg-surface rounded-lg border border-border p-6 text-center" data-event-unavailable="">
        <h1 className="text-h3 font-bold text-primary mb-2">This event isn&apos;t available</h1>
        <p className="text-tertiary mb-4">{user ? 'It may have been cancelled or removed, or you\'re not on its list yet.' : 'Log in to see an event you were invited to.'}</p>
        <Link href={user ? '/feed' : '/'} className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center">{user ? 'Back to feed' : 'Log in'}</Link>
      </div>
    );
  }
  if (view.event.shape === 'round' || !round) {
    return shell(<p className="mt-4 text-sm text-muted">This event has no live stats — it&apos;s a golf round.</p>);
  }

  const sides = data?.sides ?? null;
  const bySide = (side: 1 | 2 | null) => lines.filter(l => l.side === side);
  const row = (l: StatLineView) => {
    const enterable = canEnter(l);
    const st = lineState(outbox.entries, l.id);
    return (
      <li key={l.id}>
        <button
          type="button"
          onClick={() => enterable && setSelected(l.id)}
          disabled={!enterable}
          aria-pressed={selected === l.id}
          className={`w-full text-left flex items-center gap-3 px-3 min-h-[52px] rounded-lg ${selected === l.id ? 'bg-brand-soft border border-brand' : 'bg-surface border border-border'} disabled:opacity-100`}
          data-live-line={l.participant_id}
          data-live-line-enterable={enterable ? '1' : '0'}
          data-line-state={st}
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[st]}`} aria-hidden="true"></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-primary truncate">{l.name}</span>
            <span className="block text-xs text-muted truncate" data-live-line-headline="">{l.headline ?? 'Nothing yet'}</span>
          </span>
          {schema && (
            <span className="flex gap-2 text-xs tabular-nums text-secondary shrink-0">
              {schema.fields.slice(0, 3).map(f => <span key={f.key} data-live-cell={`${l.participant_id}:${f.key}`}>{f.shortLabel} {l.stats[f.key] ?? 0}</span>)}
            </span>
          )}
        </button>
      </li>
    );
  };

  return shell(
    <div className="mt-3 space-y-4">
      <div>
        <h1 className="text-h3 font-bold text-primary">{round.name?.trim() || (rounds.length > 1 ? `Round ${round.sequence}` : view.event.shape === 'game' ? 'The game' : 'The session')}</h1>
        <p className="text-xs text-muted">{formatDateOnly(round.scheduled_on, { weekday: true })} · {round.course_name}{round.starts_at ? ` · ${formatTeeTime(round.starts_at)}` : ''}{live ? ' · live' : round.status === 'completed' ? ' · final' : ' · not started'}</p>
      </div>
      {data && sides && roundId && (
        <ScoreControl eventId={eventId} roundId={roundId} score={data.round.score} sides={sides} canScore={!!user && live && data.viewer.can_score} onSaved={refresh} />
      )}
      {state === 'error' && <p className="text-sm text-red-700 dark:text-red-300">Could not load the stats.</p>}
      {data && lines.length === 0 && <p className="text-sm text-muted">{round.status === 'scheduled' ? 'The lines are minted when the round starts.' : 'Nobody was fielded for this round.'}</p>}
      {lines.length > 0 && (
        <div className="space-y-4">
          {sides
            ? (
              <>
                {([1, 2] as const).map(side => bySide(side).length > 0 && (
                  <section key={side} className="space-y-2" data-live-side={side}>
                    <h2 className="text-sm font-bold text-primary">{sides[side - 1]}</h2>
                    <ul className="space-y-2">{bySide(side).map(row)}</ul>
                  </section>
                ))}
                {bySide(null).length > 0 && <section className="space-y-2" data-live-side="0"><h2 className="text-sm font-bold text-primary">Not yet on a side</h2><ul className="space-y-2">{bySide(null).map(row)}</ul></section>}
              </>
            )
            : <ul className="space-y-2">{lines.map(row)}</ul>}
        </div>
      )}
      {!user && <p className="text-xs text-muted">Log in to enter stats.</p>}
      {selectedLine && serverLine && schema && (
        <StatEntryStrip
          name={selectedLine.name}
          schema={schema}
          stats={selectedLine.stats}
          entry={outbox.entries.find(e => e.lineId === selectedLine.id) ?? null}
          onChange={next => outbox.commit(selectedLine.id, next, serverLine.version)}
          onResolve={choice => { void outbox.resolveConflict(selectedLine.id, choice); }}
          onRetry={() => outbox.retry(selectedLine.id)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

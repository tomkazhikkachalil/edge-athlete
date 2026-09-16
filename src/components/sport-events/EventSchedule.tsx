'use client';

import Link from 'next/link';
import type { SportEventViewPayload } from '@/lib/sport-events/view';
import { formatDateOnly, formatTeeTime, holesLabel, ROUND_STATUS_LABEL } from '@/lib/sport-events/format';
import { ROUND_ACTION_LABEL, roundActionsFor, type RoundAction } from '@/lib/sport-events/page-rules';
import { activeRounds, MAX_ROUNDS } from '@/lib/sport-events/rounds';

/**
 * The Schedule tab (Events program): every round as a card — its date,
 * course, holes, rating, groups and, once minted, the door to the live
 * round. Phase 2: a status chip per round, the organizer's actions on the
 * card (Start · Complete · Edit · Remove · Cancel round — only what the
 * lifecycle would accept, page-rules.ts), "Add a round" and, for everyone,
 * "Add to calendar" (the .ics download, phase 2b).
 */
const TONE: Record<string, string> = {
  scheduled: 'bg-surface-muted text-secondary border-border',
  live: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900',
  completed: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
  cancelled: 'bg-surface-muted text-muted border-border',
};
const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

interface Props {
  view: SportEventViewPayload;
  busy?: boolean;
  onRoundAction?: (round: SportEventViewPayload['rounds'][number], action: RoundAction) => void;
  onAddRound?: () => void;
}

export default function EventSchedule({ view, busy = false, onRoundAction, onAddRound }: Props) {
  const { rounds, groups, participants, event, viewer } = view;
  const nameOf = (participantId: string) => participants.find(p => p.id === participantId)?.name ?? 'Player';
  if (rounds.length === 0) return <p className="text-sm text-muted">No round yet.</p>;
  const many = activeRounds(rounds).length > 1;
  const canAdd = viewer.can_manage && !!onAddRound && ['draft', 'open', 'live'].includes(event.status) && activeRounds(rounds).length < MAX_ROUNDS;
  return (
    <div className="space-y-4">
      {[...rounds].sort((a, b) => a.sequence - b.sequence).map(round => {
        const roundGroups = groups.filter(g => g.sport_event_round_id === round.id);
        const actions = viewer.can_manage && onRoundAction ? roundActionsFor(round, rounds, event) : [];
        return (
          <section key={round.id} className={`bg-surface-muted rounded-lg p-4 space-y-3 ${round.status === 'cancelled' ? 'opacity-60' : ''}`} data-event-round={round.id} data-round-status={round.status}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-primary">{many ? `Round ${round.sequence} · ` : ''}{round.name ? `${round.name} · ` : ''}{formatDateOnly(round.scheduled_on, { weekday: true })}</p>
                  {(many || round.status !== 'scheduled') && (
                    <span className={`px-2 py-0.5 rounded-md border text-xs font-semibold ${TONE[round.status] ?? TONE.scheduled}`} data-round-chip={round.status}>
                      {round.status === 'live' && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-600 ea-live-dot align-middle" aria-hidden="true" />}
                      {ROUND_STATUS_LABEL[round.status]}
                    </span>
                  )}
                </div>
                {view.event.shape === 'round'
                  ? <p className="text-sm text-secondary">{round.course_name}{round.tee ? ` · ${round.tee} tees` : ''} · {holesLabel(round.holes, round.starting_hole)}</p>
                  : <p className="text-sm text-secondary" data-event-place-line="">{round.course_name}{round.starts_at ? ` · ${formatTeeTime(round.starts_at)}` : ''}</p>}
                {(round.course_rating !== null || round.slope_rating !== null) && (
                  <p className="text-xs text-muted">{round.course_rating !== null ? `Rating ${round.course_rating}` : ''}{round.course_rating !== null && round.slope_rating !== null ? ' · ' : ''}{round.slope_rating !== null ? `Slope ${round.slope_rating}` : ''}</p>
                )}
              </div>
              {round.group_post_id && round.status !== 'cancelled' && (
                <Link href={`/live/${round.group_post_id}`} className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center" data-event-open-round="">
                  {round.status === 'completed' ? 'View round' : 'Open live round'}
                </Link>
              )}
            </div>
            {roundGroups.length > 0 && (
              <ol className="space-y-2">
                {roundGroups.map(g => (
                  <li key={g.id} className="bg-surface rounded-lg border border-border px-3 py-2">
                    <p className="text-xs font-semibold text-secondary">
                      {g.name ?? `Group ${g.sequence}`}
                      {g.tee_time ? ` · ${formatTeeTime(g.tee_time)}` : ''}
                      {g.starting_hole !== 1 ? ` · hole ${g.starting_hole}` : ''}
                    </p>
                    <p className="text-sm text-primary">{g.members.map(m => nameOf(m.participant_id)).join(' · ') || 'No players yet'}</p>
                  </li>
                ))}
              </ol>
            )}
            {actions.length > 0 && (
              <div className="flex flex-wrap gap-2" data-round-actions={round.id}>
                {actions.map(a => (
                  <button
                    key={a}
                    type="button"
                    disabled={busy}
                    onClick={() => onRoundAction?.(round, a)}
                    className={a === 'start' || a === 'complete' ? 'ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60' : BTN}
                    data-round-action={a}
                  >
                    {a === 'start' ? (many ? `Start round ${round.sequence}` : 'Go live') : a === 'complete' ? (many ? `Complete round ${round.sequence}` : 'Complete') : ROUND_ACTION_LABEL[a]}
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <div className="flex flex-wrap gap-2">
        {canAdd && (
          <button type="button" disabled={busy} onClick={onAddRound} className={BTN} data-round-add=""><i className="fas fa-plus mr-2" aria-hidden="true"></i>Add a round</button>
        )}
        {event.status !== 'cancelled' && activeRounds(rounds).length > 0 && (
          // The .ics download (phase 2b): one entry per round; cookie-authed, so a plain link.
          <a href={`/api/sport-events/${event.id}/ics`} className={`${BTN} inline-flex items-center`} data-event-ics=""><i className="fas fa-calendar-plus mr-2" aria-hidden="true"></i>Add to calendar</a>
        )}
      </div>
    </div>
  );
}

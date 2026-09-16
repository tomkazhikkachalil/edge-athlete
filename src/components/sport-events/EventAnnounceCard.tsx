'use client';

import Link from 'next/link';
import { postEventState, roundLabelOf, type PostSportEvent } from '@/lib/sport-events/feed';
import { formatDateOnly, formatLabel, holesLabel, joinLine, STATUS_LABEL } from '@/lib/sport-events/format';
import { isMatchFormat } from '@/lib/sport-events/types';

/**
 * The feed's announce card (Events program, PR 15 — the freeze lift, this
 * branch only): a sport-event post with no scores yet leads with the event
 * — name, date, course, the joining line, Live now when it is — and one
 * door to the event's place, where the join control lives.
 */
export default function EventAnnounceCard({ event }: { event: PostSportEvent }) {
  // Phase 2: the ROUND's state — a round-2 card is announced while round 1 is live.
  const state = postEventState(event, false);
  const live = state === 'live';
  const over = state === 'results' || state === 'cancelled';
  const roundLabel = roundLabelOf(event);
  return (
    <Link href={`/events/${event.id}`} onClick={e => e.stopPropagation()} className="ea-surface ea-surface-raised block rounded-lg p-4 mb-3" data-event-announce-card={event.id}>
      <div className="flex items-center gap-2 text-xs mb-1">
        <span className={`px-2 py-0.5 rounded-md font-semibold ${live ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200' : over ? 'bg-surface-muted text-secondary' : 'bg-brand-soft text-brand-fg'}`}>
          {live && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-600 ea-live-dot align-middle" aria-hidden="true" />}
          {live ? 'Live now' : state === 'results' ? 'Final' : state === 'cancelled' ? 'Cancelled' : STATUS_LABEL[event.status as keyof typeof STATUS_LABEL] ?? event.status}
        </span>
        <span className="text-muted"><i className="fas fa-flag-checkered mr-1" aria-hidden="true"></i>Event</span>
        {roundLabel && <span className="text-muted" data-event-announce-round={event.sequence}>{roundLabel}{event.round_name ? ` · ${event.round_name}` : ''}</span>}
        {!roundLabel && event.round_name && <span className="text-muted" data-event-announce-round-name="">{event.round_name}</span>}
      </div>
      <p className="text-base font-bold text-primary">{event.name}</p>
      <p className="text-sm text-secondary">{formatDateOnly(event.scheduled_on, { weekday: true })} · {event.course_name} · {holesLabel(event.holes, event.starting_hole)}</p>
      {isMatchFormat(event.format) && <p className="text-xs text-secondary" data-event-announce-format="">{formatLabel(event.format, event.match)}</p>}
      {!over && <p className="text-xs text-muted mt-1">{event.status === 'open' && event.join_mode === 'open' ? 'Open to everyone — join with one tap' : event.join_mode === 'request' && event.status === 'open' ? 'Open to requests — ask to join' : joinLine(event.join_mode as 'invite' | 'request' | 'open')}</p>}
      <span className="mt-3 inline-flex items-center min-h-[36px] text-sm font-semibold text-brand-fg">{live ? (isMatchFormat(event.format) ? 'Follow the matches →' : 'Follow the leaderboard →') : over ? 'See the results →' : 'See the event →'}</span>
    </Link>
  );
}

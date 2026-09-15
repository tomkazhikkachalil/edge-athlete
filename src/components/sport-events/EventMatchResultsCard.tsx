'use client';

import Link from 'next/link';
import { roundLabelOf, type PostSportEvent } from '@/lib/sport-events/feed';
import { formatDateOnly, formatLabel } from '@/lib/sport-events/format';

/**
 * The feed's results card for a MATCH round (Events program, phase 3,
 * PR 11): the event, the round, the format line and one line per match —
 * the winner first in bold, "def.", the loser, the result ("3&2" · "2 up"
 * · "10 holes" · "conceded" · "decided") — a bye names its side. The
 * StatHighlightCard's stroke totals are wrong for a match, so this branch
 * replaces it. One door: the event's Matches tab (the bracket on a
 * bracket event).
 */
export default function EventMatchResultsCard({ event }: { event: PostSportEvent }) {
  const roundLabel = roundLabelOf(event);
  const lines = event.match_results ?? [];
  const href = `/events/${event.id}?tab=matches${event.match?.bracket ? '&round=bracket' : `&round=${event.round_id}`}`;
  return (
    <Link href={href} onClick={e => e.stopPropagation()} className="ea-surface ea-surface-raised block rounded-lg p-4 mb-3" data-event-match-results={event.id}>
      <div className="flex items-center gap-2 text-xs mb-1">
        <span className="px-2 py-0.5 rounded-md font-semibold bg-surface-muted text-secondary">Final</span>
        <span className="text-muted"><i className="fas fa-flag-checkered mr-1" aria-hidden="true"></i>Match play</span>
        {roundLabel && <span className="text-muted" data-event-announce-round={event.sequence}>{roundLabel}{event.round_name ? ` · ${event.round_name}` : ''}</span>}
        {!roundLabel && event.round_name && <span className="text-muted">{event.round_name}</span>}
      </div>
      <p className="text-base font-bold text-primary">{event.name}</p>
      <p className="text-sm text-secondary">{formatDateOnly(event.scheduled_on, { weekday: true })} · {event.course_name} · {formatLabel(event.format, event.match)}</p>
      {lines.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm" data-event-match-results-list="">
          {lines.map(l => (
            <li key={l.match_id} className="text-primary" data-event-match-line={l.match_id}>
              {l.kind === 'bye' ? <><span className="font-bold">{l.winner}</span> <span className="text-muted">· bye</span></>
                : l.kind === 'open' ? <>{l.winner} <span className="text-muted">vs</span> {l.loser} <span className="text-muted">· {l.result}</span></>
                : <><span className="font-bold">{l.winner}</span> <span className="text-muted">def.</span> {l.loser} <span className="text-muted">· {l.result}</span></>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">No matches were played.</p>
      )}
      <span className="mt-3 inline-flex items-center min-h-[36px] text-sm font-semibold text-brand-fg">{event.match?.bracket ? 'See the bracket →' : 'See the matches →'}</span>
    </Link>
  );
}

'use client';

import Link from 'next/link';
import { roundLabelOf, type PostSportEvent } from '@/lib/sport-events/feed';
import { formatDateOnly } from '@/lib/sport-events/format';
import { scoreLabel } from '@/lib/sport-events/game';
import type { SportEventResultsData } from '@/lib/sport-events/stat-results';

/**
 * The feed's results card for a TEAM round (Events program, phase 4): the
 * event, the round, the final score on a game, each side's players with
 * their headline, the top lines on a session. One door: the event's Stats
 * tab. Names are the masked names the mirror wrote.
 */
export default function EventResultsCard({ event, results }: { event: PostSportEvent; results: SportEventResultsData }) {
  const roundLabel = roundLabelOf(event);
  const sides = results.sides.filter(s => s.players.length > 0);
  const names: [string, string] = [results.sides[0]?.name ?? 'Home', results.sides[1]?.name ?? 'Away'];
  return (
    <Link href={`/events/${event.id}?tab=stats&round=${event.round_id}`} onClick={e => e.stopPropagation()} className="ea-surface ea-surface-raised block rounded-lg p-4 mb-3" data-event-results-card={event.id}>
      <div className="flex items-center gap-2 text-xs mb-1">
        <span className="px-2 py-0.5 rounded-md font-semibold bg-surface-muted text-secondary">Final</span>
        <span className="text-muted"><i className="fas fa-flag-checkered mr-1" aria-hidden="true"></i>{results.shape === 'game' ? 'Game' : 'Session'}</span>
        {roundLabel && <span className="text-muted" data-event-announce-round={event.sequence}>{roundLabel}{event.round_name ? ` · ${event.round_name}` : ''}</span>}
        {!roundLabel && event.round_name && <span className="text-muted">{event.round_name}</span>}
      </div>
      <p className="text-base font-bold text-primary">{event.name}</p>
      <p className="text-sm text-secondary">{formatDateOnly(event.scheduled_on, { weekday: true })} · {event.course_name}</p>
      {results.score && <p className="mt-2 text-lg font-bold text-primary" data-event-results-score="">{scoreLabel(results.score, names)}</p>}
      {sides.length > 0 ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2" data-event-results-sides="">
          {sides.map(s => (
            <div key={s.side}>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">{s.name}</p>
              <ul className="text-sm text-primary">
                {s.players.map((p, i) => <li key={i}>{p.name}{p.headline ? <span className="text-muted"> · {p.headline}</span> : null}</li>)}
              </ul>
            </div>
          ))}
        </div>
      ) : results.top.length > 0 ? (
        <ul className="mt-2 text-sm text-primary" data-event-results-top="">
          {results.top.map((p, i) => <li key={i}><span className="font-bold">{p.name}</span>{p.headline ? <span className="text-muted"> · {p.headline}</span> : null}</li>)}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">No stats were entered.</p>
      )}
      <span className="mt-3 inline-flex items-center min-h-[36px] text-sm font-semibold text-brand-fg">See the stats →</span>
    </Link>
  );
}

'use client';

import Link from 'next/link';
import type { SportEventViewPayload } from '@/lib/sport-events/view';
import { formatDateOnly, formatTeeTime, holesLabel } from '@/lib/sport-events/format';

export default function EventSchedule({ view }: { view: SportEventViewPayload }) {
  const { rounds, groups, participants } = view;
  const nameOf = (participantId: string) => participants.find(p => p.id === participantId)?.name ?? 'Player';
  if (rounds.length === 0) return <p className="text-sm text-muted">No round yet.</p>;
  return (
    <div className="space-y-4">
      {rounds.map(round => {
        const roundGroups = groups.filter(g => g.sport_event_round_id === round.id);
        return (
          <section key={round.id} className="bg-surface-muted rounded-lg p-4 space-y-3" data-event-round={round.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-primary">{rounds.length > 1 ? `Round ${round.sequence} · ` : ''}{formatDateOnly(round.scheduled_on, { weekday: true })}</p>
                <p className="text-sm text-secondary">{round.course_name}{round.tee ? ` · ${round.tee} tees` : ''} · {holesLabel(round.holes, round.starting_hole)}</p>
                {(round.course_rating !== null || round.slope_rating !== null) && (
                  <p className="text-xs text-muted">{round.course_rating !== null ? `Rating ${round.course_rating}` : ''}{round.course_rating !== null && round.slope_rating !== null ? ' · ' : ''}{round.slope_rating !== null ? `Slope ${round.slope_rating}` : ''}</p>
                )}
              </div>
              {round.group_post_id && (
                <Link href={`/live/${round.group_post_id}`} className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center" data-event-open-round="">
                  Open live round
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
          </section>
        );
      })}
    </div>
  );
}

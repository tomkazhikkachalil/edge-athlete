import type { PublicMeetBlock } from '@/lib/competitions/public-standings';

/** The public meet (track 2 PR 8): each event with its winner and mark, names masked by the reader; an event links to its contest place. Server-safe. */
export default function MeetWinners({ meet, basePath }: { meet: PublicMeetBlock; basePath?: string }) {
  return (
    <div className="mt-4" data-standings-meet="">
      <h3 className="text-sm font-semibold text-primary mb-2">Events</h3>
      <ul className="divide-y divide-border-subtle text-sm">
        {meet.events.map(ev => {
          const href = `${basePath ? `${basePath}/schedule` : '/event'}/${ev.contestId}`;
          return (
            <li key={ev.contestId} className="py-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5" data-meet-event={ev.round}>
              <a href={href} className="font-medium text-primary hover:underline">{ev.round}</a>
              <span className="text-secondary tabular-nums">{ev.winner ? `${ev.winner.name} · ${ev.winner.mark}` : ev.completed ? 'No mark' : 'Not yet run'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

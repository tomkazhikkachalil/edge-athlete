'use client';

import Link from 'next/link';
import { fieldLine, formatDateOnly, STATUS_LABEL } from '@/lib/sport-events/format';

/** One event in a list (the Events and Leaderboards places): the status chip, your part in it, the date and the field size. */
export interface ListedEvent {
  id: string;
  name: string;
  status: keyof typeof STATUS_LABEL;
  starts_on: string | null;
  visibility: string;
  capacity: number | null;
  my_role: string;
  my_status: string | null;
  can_manage: boolean;
  /** Phase 2: the rounds at a glance (absent on an older payload). */
  rounds?: { count: number; completed: number; live_sequence: number | null };
}

/** "Round 2 of 3 live" · "Final · 3 rounds" · "3 rounds" — nothing on a single round. */
export function roundsLine(event: Pick<ListedEvent, 'status' | 'rounds'>): string | null {
  const r = event.rounds;
  if (!r || r.count <= 1) return null;
  if (r.live_sequence !== null) return `Round ${r.live_sequence} of ${r.count} live`;
  if (event.status === 'completed') return `Final · ${r.count} rounds`;
  if (r.completed > 0) return `${r.completed} of ${r.count} rounds played`;
  return `${r.count} rounds`;
}

/** The leaderboards place's link: the overall board on a tournament. */
export function leaderboardHref(event: Pick<ListedEvent, 'id' | 'rounds'>): string {
  return `/events/${event.id}?tab=leaderboard${(event.rounds?.count ?? 1) > 1 ? '&round=overall' : ''}`;
}

const CHIP: Record<string, string> = {
  live: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200',
  open: 'bg-brand-soft text-brand-fg',
  completed: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  draft: 'bg-surface-muted text-secondary',
  cancelled: 'bg-surface-muted text-muted',
};

export default function EventCard({ event, href }: { event: ListedEvent; href?: string }) {
  const role = event.can_manage ? 'Organizing' : event.my_role === 'follower' ? 'Following' : event.my_status === 'accepted' ? 'Playing' : event.my_status === 'invited' ? 'Invited' : event.my_status === 'waitlisted' ? 'Waitlisted' : event.my_status === 'requested' ? 'Requested' : null;
  return (
    <li>
      <Link href={href ?? `/events/${event.id}`} className="ea-surface ea-surface-raised block rounded-lg p-4 min-h-[44px]" data-events-card={event.id}>
        <div className="flex items-center gap-2 text-xs mb-1">
          <span className={`px-2 py-0.5 rounded-md font-semibold ${CHIP[event.status] ?? CHIP.draft}`}>{STATUS_LABEL[event.status]}</span>
          {role && <span className="text-muted">{role}</span>}
        </div>
        <p className="text-sm font-bold text-primary truncate">{event.name}</p>
        <p className="text-xs text-secondary">{event.starts_on ? formatDateOnly(event.starts_on, { weekday: true }) : 'Date to be set'}{event.capacity !== null ? ` · ${fieldLine({ playing: 0, waitlisted: 0 }, event.capacity).replace('0 of ', 'up to ').replace(' playing', ' players')}` : ''}</p>
        {roundsLine(event) && <p className="text-xs text-secondary" data-events-card-rounds="">{roundsLine(event)}</p>}
      </Link>
    </li>
  );
}

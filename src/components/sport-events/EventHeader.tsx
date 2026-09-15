'use client';

import Link from 'next/link';
import type { SportEventViewPayload } from '@/lib/sport-events/view';
import { fieldLine, headerRoundLine, STATUS_LABEL } from '@/lib/sport-events/format';
import type { JoinControl } from '@/lib/sport-events/join-state';
import EventJoinButton from './EventJoinButton';

const STATUS_TONE: Record<string, string> = {
  draft: 'bg-surface-muted text-secondary border-border',
  open: 'bg-brand-soft text-brand-fg border-border',
  live: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900',
  completed: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
  cancelled: 'bg-surface-muted text-muted border-border',
};

interface Props {
  view: SportEventViewPayload;
  hostName: string;
  control: JoinControl;
  busy: boolean;
  actions: React.ComponentProps<typeof EventJoinButton> extends infer P ? Omit<P, 'control' | 'busy'> : never;
  /** Organizer lifecycle controls, rendered under the title. */
  organizerControls?: React.ReactNode;
  /** The viewer's local day (YYYY-MM-DD) — "today" on the round line. */
  todayKey?: string | null;
}

export default function EventHeader({ view, hostName, control, busy, actions, organizerControls, todayKey = null }: Props) {
  const { event, rounds, counts } = view;
  const line = headerRoundLine(rounds, todayKey);
  return (
    <header className="bg-surface rounded-lg border border-border p-4 sm:p-6" data-event-id={event.id} data-event-status={event.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`px-2 py-0.5 rounded-md border font-semibold ${STATUS_TONE[event.status] ?? STATUS_TONE.draft}`} data-event-status-chip="">
              {event.status === 'live' && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-600 ea-live-dot align-middle" aria-hidden="true" />}
              {STATUS_LABEL[event.status]}
            </span>
            <span className="px-2 py-0.5 rounded-md border border-border text-secondary">Golf</span>
          </div>
          <h1 className="mt-2 text-xl sm:text-2xl font-bold text-primary break-words">{event.name}</h1>
          <p className="mt-1 text-sm text-secondary">
            Hosted by <Link href={`/athlete/${event.host_profile_id}`} className="text-brand-fg hover:text-brand-fg-strong font-medium">{hostName}</Link>
          </p>
          {line.primary && <p className="mt-2 text-sm text-secondary" data-event-round-line="">{line.primary}</p>}
          {line.secondary && <p className="text-sm text-tertiary" data-event-round-next="">{line.secondary}</p>}
          <p className="text-sm text-tertiary">{fieldLine(counts, event.capacity)}{counts.followers > 0 ? ` · ${counts.followers} following` : ''}</p>
        </div>
        <div className="shrink-0">
          <EventJoinButton control={control} busy={busy} {...actions} />
        </div>
      </div>
      {organizerControls}
    </header>
  );
}

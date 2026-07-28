'use client';

import { format } from 'date-fns';
import { categoryColor } from '@/lib/calendar/categories';
import type { EventListItem } from './types';

// Visual-state rules (Google/Outlook convention, per the product brief):
//   pending invite  → outlined + dashed + faded (holds the slot, needs a reply)
//   accepted/owner  → solid category fill
//   maybe           → solid with a leading "?" marker
// Declined events never reach the client (server-filtered).

export function eventTimeLabel(event: EventListItem): string {
  if (event.all_day) return 'All day';
  return format(new Date(Date.parse(event.starts_at)), 'h:mm a');
}

/** Compact one-line entry for Month cells and the Agenda list. */
export function EventChip({
  event,
  onClick,
  showTime = true,
}: {
  event: EventListItem;
  onClick: () => void;
  showTime?: boolean;
}) {
  const color = categoryColor(event.category);
  const pending = event.my_status === 'invited';
  const maybe = event.my_status === 'maybe';
  return (
    <button
      type="button"
      onClick={onClick}
      title={event.title}
      className={`w-full text-left rounded px-1.5 py-0.5 text-xs leading-tight truncate transition border ${
        pending
          ? `bg-white border-dashed ${color.border} ${color.text} opacity-70`
          : `${color.bg} border-transparent text-white`
      }`}
    >
      {maybe && <span className="font-bold mr-0.5">?</span>}
      {showTime && !event.all_day && (
        <span className={`mr-1 ${pending ? '' : 'text-white/80'}`}>{eventTimeLabel(event)}</span>
      )}
      <span className="font-medium">{event.title}</span>
      {event.series_id && <i className="fas fa-arrows-rotate ml-1 text-[9px] opacity-70"></i>}
    </button>
  );
}

/** Absolutely-positioned block for the Week/Day time grid. */
export function EventBlock({
  event,
  topPct,
  heightPct,
  leftPct,
  widthPct,
  onClick,
}: {
  event: EventListItem;
  topPct: number;
  heightPct: number;
  leftPct: number;
  widthPct: number;
  onClick: () => void;
}) {
  const color = categoryColor(event.category);
  const pending = event.my_status === 'invited';
  const maybe = event.my_status === 'maybe';
  return (
    <button
      type="button"
      onClick={onClick}
      title={event.title}
      style={{
        top: `${topPct}%`,
        height: `${Math.max(heightPct, 1.5)}%`,
        left: `${leftPct}%`,
        width: `${widthPct}%`,
      }}
      className={`absolute rounded-md px-1.5 py-0.5 text-xs text-left overflow-hidden border transition z-10 ${
        pending
          ? `bg-white border-dashed ${color.border} ${color.text} opacity-70`
          : `${color.bg} border-white/20 text-white`
      }`}
    >
      <span className="font-medium block truncate">
        {maybe && <span className="font-bold mr-0.5">?</span>}
        {event.title}
        {event.series_id && <i className="fas fa-arrows-rotate ml-1 text-[9px] opacity-70"></i>}
      </span>
      {!event.all_day && (
        <span className={`block truncate ${pending ? '' : 'text-white/80'}`}>
          {format(new Date(Date.parse(event.starts_at)), 'h:mm a')}
        </span>
      )}
    </button>
  );
}

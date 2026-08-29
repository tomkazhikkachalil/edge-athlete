'use client';

import { format } from 'date-fns';
import { categoryColor } from '@/lib/calendar/categories';
import { venueTimeLabel } from '@/lib/calendar/venue-time';
import type { EventListItem } from './types';

// Visual-state rules (Google/Outlook convention, per the product brief):
//   pending invite  → outlined + dashed + faded (holds the slot, needs a reply)
//   accepted/owner  → solid category fill
//   maybe           → solid with a leading "?" marker
// Declined events never reach the client (server-filtered).
// Org-merged events (my_status null) render solid — they're the org's
// schedule, not a pending invite — with a small people marker.

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
  // Dual display: position/time are viewer-local, but a cross-zone event
  // also names the venue's wall clock ("the 10am game" stays recognizable).
  const venue = venueTimeLabel(event);
  return (
    <button
      type="button"
      onClick={onClick}
      title={venue ? `${event.title} · ${venue}` : event.title}
      className={`w-full text-left rounded px-1.5 py-0.5 text-xs leading-tight truncate transition border ${
        pending
          ? `bg-surface border-dashed ${color.border} ${color.text} opacity-70`
          : `${color.bg} border-transparent text-white`
      }`}
    >
      {maybe && <span className="font-bold mr-0.5">?</span>}
      {showTime && !event.all_day && (
        <span className={`mr-1 ${pending ? '' : 'text-white/80'}`}>
          {eventTimeLabel(event)}
          {venue && <span className="opacity-80"> · {venue}</span>}
        </span>
      )}
      <span className="font-medium">{event.title}</span>
      {event.series_id && <i className="fas fa-arrows-rotate ml-1 text-[9px] opacity-70"></i>}
      {event.is_org_event && <i className="fas fa-people-group ml-1 text-[9px] opacity-70" title={event.org_name ?? undefined}></i>}
      {event.personDots?.map((dot, i) => (
        <span
          key={i}
          className={`inline-block w-1.5 h-1.5 rounded-full ml-1 align-middle ring-1 ring-white/70 ${dot}`}
        />
      ))}
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
  const venue = venueTimeLabel(event);
  return (
    <button
      type="button"
      onClick={onClick}
      title={venue ? `${event.title} · ${venue}` : event.title}
      style={{
        top: `${topPct}%`,
        height: `${Math.max(heightPct, 1.5)}%`,
        left: `${leftPct}%`,
        width: `${widthPct}%`,
      }}
      className={`absolute rounded-md px-1.5 py-0.5 text-xs text-left overflow-hidden border transition z-10 ${
        pending
          ? `bg-surface border-dashed ${color.border} ${color.text} opacity-70`
          : `${color.bg} border-white/20 text-white`
      }`}
    >
      <span className="font-medium block truncate">
        {maybe && <span className="font-bold mr-0.5">?</span>}
        {event.title}
        {event.series_id && <i className="fas fa-arrows-rotate ml-1 text-[9px] opacity-70"></i>}
        {event.is_org_event && <i className="fas fa-people-group ml-1 text-[9px] opacity-70"></i>}
        {event.personDots?.map((dot, i) => (
          <span
            key={i}
            className={`inline-block w-1.5 h-1.5 rounded-full ml-1 align-middle ring-1 ring-white/70 ${dot}`}
          />
        ))}
      </span>
      {!event.all_day && (
        <span className={`block truncate ${pending ? '' : 'text-white/80'}`}>
          {format(new Date(Date.parse(event.starts_at)), 'h:mm a')}
          {venue && <span className="opacity-80"> · {venue}</span>}
        </span>
      )}
    </button>
  );
}

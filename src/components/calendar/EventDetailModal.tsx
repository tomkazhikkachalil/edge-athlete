'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { format } from 'date-fns';
import { X, CalendarDays } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import ScopeChooserModal from './ScopeChooserModal';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { categoryColor, CATEGORY_LABELS } from '@/lib/calendar/categories';
import { allDayDayLabels } from '@/lib/calendar/grid';
import { describeRecurrence } from '@/lib/calendar/recurrence';
import { REMINDER_OPTIONS, REMINDER_LABELS } from '@/lib/calendar/reminders';
import type { EventDetail, EventGuest, MyStatus } from './types';

// The event's home: full details, live guest list with per-person status,
// the organizer's running tally, and the viewer's respond buttons. The
// organizer's copy is the single source of truth — this modal always
// re-fetches on open.

const STATUS_PILLS: Record<string, { label: string; classes: string }> = {
  accepted: { label: 'Going', classes: 'bg-emerald-100 text-emerald-700' },
  declined: { label: 'Declined', classes: 'bg-red-100 text-red-600' },
  maybe: { label: 'Maybe', classes: 'bg-amber-100 text-amber-700' },
  invited: { label: 'Pending', classes: 'bg-gray-100 text-gray-600' },
};

function whenLines(event: EventDetail): { primary: string; secondary: string | null } {
  if (event.all_day) {
    const days = allDayDayLabels(event);
    const label = (key: string) => {
      const [y, m, d] = key.split('-').map(Number);
      return format(new Date(y, m - 1, d), 'EEE, MMM d, yyyy');
    };
    const primary = days.length === 1
      ? `${label(days[0])} · All day`
      : `${label(days[0])} – ${label(days[days.length - 1])} · All day`;
    return { primary, secondary: null };
  }
  const start = new Date(Date.parse(event.starts_at));
  const end = new Date(Date.parse(event.ends_at));
  const sameDay = start.toDateString() === end.toDateString();
  const primary = sameDay
    ? `${format(start, 'EEE, MMM d, yyyy')} · ${format(start, 'h:mm a')} – ${format(end, 'h:mm a')}`
    : `${format(start, 'EEE, MMM d, h:mm a')} – ${format(end, 'EEE, MMM d, h:mm a')}`;
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let secondary: string | null = null;
  if (event.timezone !== viewerTz) {
    const inEventTz = new Intl.DateTimeFormat('en-US', {
      timeZone: event.timezone, hour: 'numeric', minute: '2-digit',
    });
    secondary = `${inEventTz.format(start)} – ${inEventTz.format(end)} in ${event.timezone.replace(/_/g, ' ')}`;
  }
  return { primary, secondary };
}

function guestName(guest: EventGuest): string {
  if (guest.invited_email) return guest.invited_email;
  return formatDisplayName(
    guest.profiles?.first_name, null, guest.profiles?.last_name, guest.profiles?.full_name
  ) || 'Someone';
}

export default function EventDetailModal({
  eventId,
  isOpen,
  onClose,
  onChanged,
  onEdit,
}: {
  eventId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (event: EventDetail) => void;
}) {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [responding, setResponding] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [pendingResponse, setPendingResponse] = useState<MyStatus | null>(null);
  const [savingReminder, setSavingReminder] = useState(false);
  useBodyScrollLock(isOpen);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/calendar/events/${eventId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError('Event unavailable', data.error || 'This event could not be loaded.');
        onClose();
        return;
      }
      setEvent(data.event);
    } catch {
      showError('Event unavailable', 'This event could not be loaded.');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [eventId, onClose, showError]);

  useEffect(() => {
    if (isOpen && eventId) {
      setEvent(null);
      load();
    }
  }, [isOpen, eventId, load]);

  if (!isOpen) return null;

  const isOrganizer = !!event && !!user && event.organizer_id === user.id;
  const myGuestRow = event?.guests.find(g => g.profile_id === user?.id) ?? null;
  const cancelled = event?.status === 'cancelled';

  const respond = async (status: MyStatus, scope: 'this' | 'series') => {
    if (!event || responding) return;
    setResponding(true);
    try {
      const res = await fetch(`/api/calendar/events/${event.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, scope }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showError('Could not respond', data.error || 'Please try again.'); return; }
      await load();
      onChanged();
      if (status === 'declined') {
        showSuccess('Declined', scope === 'series'
          ? 'The series was removed from your calendar.'
          : 'The event was removed from your calendar.');
      }
    } catch {
      showError('Could not respond', 'Please try again.');
    } finally {
      setResponding(false);
    }
  };

  const handleRespondTap = (status: MyStatus) => {
    // Recurring events ask the scope question (series is the default —
    // "invitations cover the whole series"); one-off events respond directly.
    if (event?.series_id) setPendingResponse(status);
    else respond(status, 'this');
  };

  const setReminder = async (minutes: number) => {
    if (!event || savingReminder) return;
    setSavingReminder(true);
    try {
      const res = await fetch(`/api/calendar/events/${event.id}/reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showError('Could not save', data.error || 'Please try again.'); return; }
      await load();
    } catch {
      showError('Could not save', 'Please try again.');
    } finally {
      setSavingReminder(false);
    }
  };

  const cancelEvent = async (scope: 'this' | 'following' | 'series') => {
    if (!event) return;
    setConfirmingCancel(false);
    try {
      const res = await fetch(`/api/calendar/events/${event.id}?scope=${scope}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showError('Could not cancel', data.error || 'Please try again.'); return; }
      showSuccess(
        scope === 'this' ? 'Event cancelled' : scope === 'following' ? 'Events cancelled' : 'Series cancelled',
        'Every guest has been notified.'
      );
      onChanged();
      onClose();
    } catch {
      showError('Could not cancel', 'Please try again.');
    }
  };

  const tally = event
    ? {
        going: event.guests.filter(g => g.status === 'accepted').length,
        maybe: event.guests.filter(g => g.status === 'maybe').length,
        pending: event.guests.filter(g => g.status === 'invited').length,
        declined: event.guests.filter(g => g.status === 'declined').length,
      }
    : null;
  const when = event ? whenLines(event) : null;
  const color = event ? categoryColor(event.category) : null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${color ? color.bg : 'bg-violet-600'}`}>
              <CalendarDays className="w-5 h-5 text-white" />
            </span>
            <h2 className="text-lg font-bold text-gray-900 truncate">
              {event?.title ?? 'Event'}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading || !event ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-violet-600"></div>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {cancelled && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm font-medium">
                This event was cancelled by the organizer.
              </div>
            )}

            <div className="space-y-1.5 text-sm">
              <p className="text-gray-900 font-medium">{when!.primary}</p>
              {when!.secondary && <p className="text-gray-500 text-xs">{when!.secondary}</p>}
              {event.location && (
                <p className="text-gray-700">
                  <i className="fas fa-location-dot text-gray-400 mr-1.5"></i>
                  {event.location}
                </p>
              )}
              <p className="text-gray-500 text-xs">
                <span className={`inline-block w-2 h-2 rounded-full mr-1 ${color!.dot}`} />
                {CATEGORY_LABELS[event.category] ?? event.category}
              </p>
              {event.series && (
                <p className="text-gray-500 text-xs">
                  <i className="fas fa-arrows-rotate text-gray-400 mr-1"></i>
                  {describeRecurrence(event.series, event.timezone)}
                </p>
              )}
              {!cancelled && (
                <p className="text-xs pt-0.5">
                  <a
                    href={`/api/calendar/events/${event.id}/ics`}
                    className="text-violet-600 hover:underline font-medium"
                  >
                    <i className="fas fa-download mr-1"></i>
                    Add to calendar
                  </a>
                </p>
              )}
            </div>

            {event.description && (
              <p className="text-sm text-gray-700 whitespace-pre-wrap border-t border-gray-100 pt-3">
                {event.description}
              </p>
            )}

            {/* Respond (guests only, not on cancelled events) */}
            {myGuestRow && myGuestRow.role !== 'organizer' && !cancelled && (
              <div className="border-t border-gray-100 pt-3">
                <p className="text-sm font-semibold text-gray-900 mb-2">Are you going?</p>
                <div className="flex gap-2">
                  {([
                    { value: 'accepted', label: 'Yes' },
                    { value: 'maybe', label: 'Maybe' },
                    { value: 'declined', label: 'No' },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={responding}
                      onClick={() => handleRespondTap(opt.value)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition min-h-[44px] disabled:opacity-50 ${
                        myGuestRow.status === opt.value
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-violet-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Reminder (any viewer with a guest row, organizer included) */}
            {myGuestRow && !cancelled && (
              <div className="border-t border-gray-100 pt-3 flex items-center gap-2 flex-wrap">
                <label htmlFor="ev-reminder" className="text-sm font-semibold text-gray-900">
                  <i className="fas fa-bell text-gray-400 mr-1.5"></i>
                  Remind me
                </label>
                <select
                  id="ev-reminder"
                  value={myGuestRow.reminder_minutes}
                  disabled={savingReminder}
                  onChange={e => setReminder(Number(e.target.value))}
                  className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:outline-none disabled:opacity-50"
                >
                  {REMINDER_OPTIONS.map(m => (
                    <option key={m} value={m}>{REMINDER_LABELS[m]}</option>
                  ))}
                </select>
                {event.series_id && (
                  <span className="text-xs text-gray-400">This event only</span>
                )}
              </div>
            )}

            {/* Guest list + tally */}
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-900">
                  Guests ({event.guests.length})
                </p>
                {tally && (
                  <p className="text-xs text-gray-500">
                    {tally.going} going · {tally.maybe} maybe · {tally.pending} pending · {tally.declined} declined
                  </p>
                )}
              </div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {event.guests.map(guest => {
                  const name = guestName(guest);
                  const pill = STATUS_PILLS[guest.status] ?? STATUS_PILLS.invited;
                  return (
                    <div key={guest.id} className="flex items-center gap-2">
                      <span className="relative w-7 h-7 rounded-full overflow-hidden bg-violet-100 flex items-center justify-center shrink-0">
                        {guest.invited_email ? (
                          <i className="fas fa-envelope text-gray-400 text-xs"></i>
                        ) : guest.profiles?.avatar_url ? (
                          <Image src={guest.profiles.avatar_url} alt="" fill sizes="28px" className="object-cover" />
                        ) : (
                          <span className="text-[10px] font-semibold text-violet-700">{getInitials(name)}</span>
                        )}
                      </span>
                      <span className="text-sm text-gray-900 truncate flex-grow min-w-0">
                        {name}
                        {guest.role === 'organizer' && (
                          <span className="ml-1.5 text-xs text-violet-600 font-medium">Organizer</span>
                        )}
                      </span>
                      {guest.role !== 'organizer' && (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${pill.classes}`}>
                          {pill.label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Organizer controls */}
            {isOrganizer && !cancelled && (
              <div className="border-t border-gray-100 pt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => onEdit(event)}
                  className="flex-1 bg-violet-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-violet-700 transition min-h-[44px]"
                >
                  Edit event
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(true)}
                  className="flex-1 border border-red-300 text-red-600 py-2 rounded-lg text-sm font-medium hover:bg-red-50 transition min-h-[44px]"
                >
                  Cancel event
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* One-off events keep the binary confirm; series get the scope question. */}
      <ConfirmModal
        isOpen={confirmingCancel && !event?.series_id}
        title="Cancel this event?"
        message="Every guest will be notified and the event will leave their calendars. This cannot be undone."
        confirmText="Yes, cancel it"
        cancelText="Keep the event"
        onConfirm={() => cancelEvent('this')}
        onCancel={() => setConfirmingCancel(false)}
      />
      <ScopeChooserModal
        isOpen={confirmingCancel && !!event?.series_id}
        title="Cancel repeating event"
        message="Guests will be notified. This cannot be undone."
        options={[
          { value: 'this', label: 'This event only' },
          { value: 'following', label: 'This and following events' },
          { value: 'series', label: 'The entire series' },
        ]}
        defaultValue="this"
        confirmText="Cancel event"
        destructive
        onConfirm={scope => cancelEvent(scope)}
        onCancel={() => setConfirmingCancel(false)}
      />
      <ScopeChooserModal
        isOpen={pendingResponse !== null}
        title="This is a repeating event"
        message={
          pendingResponse === 'accepted' ? 'Say yes to…'
          : pendingResponse === 'declined' ? 'Say no to…'
          : 'Answer maybe for…'
        }
        options={[
          { value: 'series', label: 'All events in the series' },
          { value: 'this', label: 'Just this event' },
        ]}
        defaultValue="series"
        confirmText="Send response"
        onConfirm={scope => {
          const status = pendingResponse!;
          setPendingResponse(null);
          respond(status, scope as 'this' | 'series');
        }}
        onCancel={() => setPendingResponse(null)}
      />
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { X, CalendarPlus } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useToast } from '@/components/Toast';
import { EVENT_CATEGORIES } from '@/lib/calendar/events';
import { describeRecurrence, MAX_OCCURRENCES } from '@/lib/calendar/recurrence';
import { buildEventTimestamps, formPartsFromEvent } from '@/lib/calendar/form-times';
import { listTimeZones, viewerTimeZone, zoneShortName } from '@/lib/calendar/venue-time';
import { CATEGORY_LABELS, categoryColor } from '@/lib/calendar/categories';
import GuestPicker, { type GuestChip } from './GuestPicker';
import ScopeChooserModal from './ScopeChooserModal';
import ConfirmModal from '@/components/ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { formatDisplayName } from '@/lib/formatters';
import type { WorkoutRoutine } from '@/lib/workouts/routines';
import { useAuth } from '@/lib/auth';
import { FEATURE_FLAGS } from '@/lib/features';
import type { EditScope, EventDetail } from './types';

// Quick-create by default (title + when), everything else behind
// "More options" — the Google Calendar pattern from the product brief.
// ISO timestamps are built from numeric parts (never new Date('YYYY-MM-DD')).

interface FormState {
  title: string;
  date: string;      // YYYY-MM-DD (native date input)
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  allDay: boolean;
  /** IANA zone the typed wall clock is anchored in — the VENUE's zone, not
   *  necessarily the browser's (venue-entry contract, form-times.ts). */
  timezone: string;
  description: string;
  location: string;
  category: string;
  // Inside FormState (not separate state) so the dirty-close snapshot
  // covers it automatically.
  routineId: string | null;
  /** Org linkage (119): at most one of these. */
  leagueId: string | null;
  clubId: string | null;
  /** "Who is this for?" — supervised children to add as guests on create.
   *  A guest row is what makes the event visible to EVERY guardian (the
   *  parity contract), so this is sugar over guests.profile_ids, not a new
   *  mechanism; the organizer stays the caller (attribution doctrine). */
  forChildIds: string[];
}

type RepeatFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
interface RepeatState {
  freq: RepeatFreq;
  interval: number;
  byweekday: number[];
  endsKind: 'never' | 'until' | 'count';
  until: string;  // YYYY-MM-DD
  count: number;
}

const DOW_CHIP_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const emptyRepeat = (): RepeatState => ({
  freq: 'none', interval: 1, byweekday: [], endsKind: 'never', until: '', count: 10,
});

/** Day-of-week of a YYYY-MM-DD form date (local, parsed from parts). */
function formDateDow(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return new Date().getDay();
  return new Date(y, m - 1, d).getDay();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function nextHalfHour(): Date {
  const now = new Date();
  now.setSeconds(0, 0);
  const add = 30 - (now.getMinutes() % 30);
  now.setMinutes(now.getMinutes() + (add === 0 ? 30 : add));
  return now;
}

function emptyForm(defaultDay?: Date, defaultRange?: { start: Date; end: Date }): FormState {
  // A drag-selected range wins over the plain day default; an end at
  // next-day midnight yields endTime '00:00', which buildTimestamps already
  // treats as past-midnight.
  const start = defaultRange ? new Date(defaultRange.start) : nextHalfHour();
  if (!defaultRange && defaultDay) {
    start.setFullYear(defaultDay.getFullYear(), defaultDay.getMonth(), defaultDay.getDate());
  }
  const end = defaultRange ? new Date(defaultRange.end) : new Date(start.getTime() + 3_600_000);
  return {
    title: '',
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    startTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
    allDay: false,
    timezone: viewerTimeZone(),
    description: '',
    location: '',
    category: 'general',
    routineId: null,
    leagueId: null,
    clubId: null,
    forChildIds: [],
  };
}

function formFromEvent(event: EventDetail): FormState {
  // Venue-anchored editing: show the wall clock in the EVENT's zone (an
  // event created courtside stays "10:00" for a parent editing from home).
  const parts = formPartsFromEvent(event);
  return {
    title: event.title,
    date: parts.date,
    startTime: parts.startTime,
    endTime: parts.endTime,
    allDay: event.all_day,
    timezone: event.timezone,
    description: event.description ?? '',
    location: event.location ?? '',
    category: event.category,
    routineId: event.routine_id ?? null,
    leagueId: event.league_id ?? null,
    clubId: event.club_id ?? null,
    // Edit mode: children already on the event are ordinary GuestPicker
    // chips (chipsFromEvent); the create-only "for" row stays empty.
    forChildIds: [],
  };
}

function chipsFromEvent(event: EventDetail): GuestChip[] {
  return event.guests
    .filter(g => g.role !== 'organizer')
    .map(g =>
      g.profile_id
        ? {
            kind: 'profile' as const,
            id: g.profile_id,
            label: formatDisplayName(g.profiles?.first_name, null, g.profiles?.last_name, g.profiles?.full_name),
            handle: g.profiles?.handle,
            avatarUrl: g.profiles?.avatar_url,
          }
        : { kind: 'email' as const, id: g.invited_email!, label: g.invited_email! }
    );
}

export default function EventFormModal({
  isOpen,
  onClose,
  onSaved,
  editing,
  defaultDay,
  defaultRange,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing?: EventDetail | null;
  defaultDay?: Date;
  /** Drag-selected start/end (grid drag-to-create). Must be referentially
   *  stable for the modal's lifetime — the seeding compares by identity. */
  defaultRange?: { start: Date; end: Date };
}) {
  const { showSuccess } = useToast();
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [repeat, setRepeat] = useState<RepeatState>(() => emptyRepeat());
  const [chips, setChips] = useState<GuestChip[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [scopeOpen, setScopeOpen] = useState(false);
  // Zone select is collapsed behind a text affordance — most events are in
  // the creator's own zone. UI state only; not part of the dirty snapshot.
  const [tzOpen, setTzOpen] = useState(false);
  const snapRef = useRef<string | null>(null);
  useBodyScrollLock(isOpen);

  // Saved routines for the "Workout routine" picker — fetched once, the
  // first time More options opens. Inlined cancellable IIFE (not a callback
  // call) so it stays out of the set-state-in-effect warning list. null =
  // not yet loaded; [] = loaded, none (picker hides itself).
  const [routines, setRoutines] = useState<WorkoutRoutine[] | null>(null);
  // Orgs the user can schedule for (owner/manager only) — same lazy pattern
  // as routines; the picker hides itself entirely when there are none.
  interface ManagedOrg { kind: 'league' | 'club'; id: string; name: string; role: string }
  const { user: authUser } = useAuth();
  const [managedOrgs, setManagedOrgs] = useState<ManagedOrg[] | null>(null);
  useEffect(() => {
    if (!isOpen || !moreOpen || routines !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/workout-routines', { credentials: 'include' });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        if (!cancelled) setRoutines(data.routines ?? []);
      } catch {
        if (!cancelled) setRoutines([]); // picker hides; attach still possible via edit later
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, moreOpen, routines]);

  // "Who is this for?" roster — the caller's supervised children (guardian
  // seats only; a readOnly viewer account gets an empty list and the row
  // hides itself). Same lazy cancellable-IIFE pattern; fetched when the
  // CREATE form opens (the row lives in quick create, not More options).
  const [familyRoster, setFamilyRoster] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    if (!isOpen || editing || familyRoster !== null || !FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/guardian/athletes', { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) {
          if (data.readOnly) {
            setFamilyRoster([]); // view-only seats never place children on events
            return;
          }
          const athletes = (data.athletes ?? []) as {
            id: string;
            first_name: string | null;
            display_name: string | null;
            supervision_state: string | null;
            deletion_requested_at: string | null;
          }[];
          setFamilyRoster(
            athletes
              .filter(a => a.supervision_state === 'supervised' && !a.deletion_requested_at)
              .map(a => ({ id: a.id, name: a.first_name || a.display_name || 'Athlete' }))
          );
        }
      } catch {
        if (!cancelled) setFamilyRoster([]); // row hides; guests still work via the picker
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, editing, familyRoster]);

  useEffect(() => {
    if (!isOpen || !moreOpen || managedOrgs !== null || !authUser?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/profile/${authUser.id}/organizations`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) {
          const all = (data.organizations ?? []) as ManagedOrg[];
          setManagedOrgs(all.filter(o => o.role === 'owner' || o.role === 'manager'));
        }
      } catch {
        if (!cancelled) setManagedOrgs([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, moreOpen, managedOrgs, authUser?.id]);

  // Seeding the form is state synchronisation — done during render so the
  // previous values never paint for a frame.
  const [syncedOpen, setSyncedOpen] = useState({ isOpen, editing, defaultDay, defaultRange });
  if (
    syncedOpen.isOpen !== isOpen ||
    syncedOpen.editing !== editing ||
    syncedOpen.defaultDay !== defaultDay ||
    syncedOpen.defaultRange !== defaultRange
  ) {
    setSyncedOpen({ isOpen, editing, defaultDay, defaultRange });
    // Nested, NOT an early return: this runs in the component body now, so a
    // `return` here would skip every hook below it.
    if (isOpen) {
      if (editing) {
        setForm(formFromEvent(editing));
        setChips(chipsFromEvent(editing));
        setMoreOpen(true);
      } else {
        setForm(emptyForm(defaultDay, defaultRange));
        setChips([]);
        setMoreOpen(false);
      }
      setRepeat(emptyRepeat());
      setScopeOpen(false);
      setTzOpen(false);
      setError('');
    }
  }

  // The discard-guard baseline is written to a REF, which must not happen
  // during render — this effect runs immediately after the seeding render.
  useEffect(() => {
    if (!isOpen) return;
    snapRef.current = JSON.stringify({
      form: editing ? formFromEvent(editing) : emptyForm(defaultDay, defaultRange),
      chips: editing ? chipsFromEvent(editing) : [],
      repeat: emptyRepeat(),
    });
  }, [isOpen, editing, defaultDay, defaultRange]);

  // The start day is always part of a weekly repeat and follows date changes.
  // This is an invariant over current state, so it is enforced during render.
  const startDow = formDateDow(form.date);
  if (repeat.freq === 'weekly' && !repeat.byweekday.includes(startDow)) {
    setRepeat(prev => ({
      ...prev,
      byweekday: [...prev.byweekday, startDow].sort((a, b) => a - b),
    }));
  }

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(
    () => snapRef.current !== null && snapRef.current !== JSON.stringify({ form, chips, repeat }),
    onClose
  );

  if (!isOpen) return null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // Wall clock → instants anchored in the PICKED zone (form-times.ts owns
  // the math, including the past-midnight roll and all-day zone-midnights).
  const buildTimestamps = (): { starts_at: string; ends_at: string } | null =>
    buildEventTimestamps(form, form.timezone);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError('');
    if (!form.title.trim()) { setError('Please give the event a title.'); return; }
    if (!buildTimestamps()) { setError('Please provide a valid date and time.'); return; }
    // Editing an occurrence of a series: ask the classic scope question first.
    if (editing?.series_id) {
      setScopeOpen(true);
      return;
    }
    await doSubmit('this');
  };

  const doSubmit = async (scope: EditScope) => {
    const times = buildTimestamps();
    if (!times) { setError('Please provide a valid date and time.'); return; }

    const eventFields = {
      title: form.title,
      description: form.description,
      location: form.location,
      ...times,
      all_day: form.allDay,
      timezone: form.timezone,
      category: form.category,
      routine_id: form.routineId,
      league_id: form.leagueId,
      club_id: form.clubId,
    };

    setSaving(true);
    try {
      let res: Response;
      if (editing) {
        const originalChips = chipsFromEvent(editing);
        const removed = editing.guests.filter(g =>
          g.role !== 'organizer' &&
          !chips.some(c => (g.profile_id ? c.kind === 'profile' && c.id === g.profile_id : c.kind === 'email' && c.id === g.invited_email))
        );
        const added = chips.filter(c =>
          !originalChips.some(o => o.kind === c.kind && o.id === c.id)
        );
        res = await fetch(`/api/calendar/events/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...eventFields,
            scope,
            add_guests: {
              profile_ids: added.filter(c => c.kind === 'profile').map(c => c.id),
              emails: added.filter(c => c.kind === 'email').map(c => c.id),
            },
            remove_guest_ids: removed.map(g => g.id),
          }),
        });
      } else {
        res = await fetch('/api/calendar/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...eventFields,
            ...(repeat.freq !== 'none'
              ? {
                  recurrence: {
                    freq: repeat.freq,
                    interval: repeat.interval,
                    ...(repeat.freq === 'weekly' ? { byweekday: repeat.byweekday } : {}),
                    ends:
                      repeat.endsKind === 'until'
                        ? { kind: 'until', until: repeat.until }
                        : repeat.endsKind === 'count'
                          ? { kind: 'count', count: repeat.count }
                          : { kind: 'never' },
                  },
                }
              : {}),
            guests: {
              // "For" children ride the same guest mechanism — one deduped
              // list; the server treats them like any invited profile.
              profile_ids: [...new Set([
                ...chips.filter(c => c.kind === 'profile').map(c => c.id),
                ...form.forChildIds,
              ])],
              emails: chips.filter(c => c.kind === 'email').map(c => c.id),
            },
          }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Could not save the event.'); return; }
      showSuccess(editing ? 'Event updated' : 'Event created', form.title.trim());
      onSaved();
      onClose();
    } catch {
      setError('Could not save the event. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      {/* max-h-modal + flex-col: the whole panel used to scroll, so the
          submit button sat below title/date/repeat/guests/category — off
          screen on every phone. The fields scroll; header and footer don't. */}
      <div className="bg-surface-raised rounded-lg shadow-xl max-w-lg w-full max-h-modal flex flex-col">
        <div className="shrink-0 flex items-center justify-between p-4 sm:p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-full bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center">
              <CalendarPlus className="w-5 h-5 text-brand-fg" />
            </span>
            <h2 className="text-lg font-bold text-primary">
              {editing ? 'Edit event' : 'New event'}
            </h2>
          </div>
          <button type="button" onClick={requestClose} aria-label="Close" className="ea-icon-btn inline-flex items-center justify-center text-faint hover:text-tertiary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4">
          {error && (
            <div role="alert" className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="ev-title" className="block text-sm font-semibold text-primary mb-1">Title</label>
            <input
              id="ev-title"
              type="text"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              maxLength={120}
              required
              placeholder="Team practice"
              className="w-full px-3 py-2 border border-border-strong rounded-lg text-base focus:ring-2 focus:ring-violet-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="ev-date" className="block text-sm font-semibold text-primary mb-1">Date</label>
              <input
                id="ev-date"
                type="date"
                value={form.date}
                onChange={e => set('date', e.target.value)}
                required
                className="w-full px-3 py-2 border border-border-strong rounded-lg text-base focus:ring-2 focus:ring-violet-500 focus:outline-none"
              />
            </div>
            {!form.allDay && (
              <>
                <div>
                  <label htmlFor="ev-start" className="block text-sm font-semibold text-primary mb-1">Starts</label>
                  <input
                    id="ev-start"
                    type="time"
                    value={form.startTime}
                    onChange={e => set('startTime', e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-border-strong rounded-lg text-base focus:ring-2 focus:ring-violet-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="ev-end" className="block text-sm font-semibold text-primary mb-1">Ends</label>
                  <input
                    id="ev-end"
                    type="time"
                    value={form.endTime}
                    onChange={e => set('endTime', e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-border-strong rounded-lg text-base focus:ring-2 focus:ring-violet-500 focus:outline-none"
                  />
                </div>
              </>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={e => set('allDay', e.target.checked)}
              className="accent-violet-600 w-4 h-4"
            />
            All day
          </label>

          {/* Time zone — venue-anchored: the typed wall clock lives in this
              zone (a 10am game is 10am AT the venue). Collapsed by default;
              immutable on series events (the cron re-anchors stepping on the
              stored zone — see the PATCH guard). */}
          {editing?.series_id ? (
            <p className="text-xs text-muted">
              Times are in {form.timezone.replace(/_/g, ' ')}. A repeating
              event&apos;s time zone can&apos;t be changed.
            </p>
          ) : (
            !tzOpen ? (
              <button
                type="button"
                onClick={() => setTzOpen(true)}
                className="inline-flex min-h-[44px] items-center text-sm text-brand-fg hover:underline active:underline"
              >
                {(() => {
                  // Short name at the EVENT's date (MDT vs MST); the zone id
                  // itself when the date field is momentarily unparseable.
                  const [y, m, d] = form.date.split('-').map(Number);
                  return y && m && d
                    ? zoneShortName(form.timezone, Date.UTC(y, m - 1, d, 12, 0))
                    : form.timezone.replace(/_/g, ' ');
                })()}{' '}
                — change time zone
              </button>
            ) : (
              <div>
                <label htmlFor="ev-tz" className="block text-sm font-semibold text-primary mb-1">
                  Time zone
                </label>
                <p className="text-xs text-muted mb-2">
                  The times above are local to this zone — pick the venue&apos;s.
                </p>
                <select
                  id="ev-tz"
                  value={form.timezone}
                  onChange={e => set('timezone', e.target.value)}
                  className="w-full px-3 py-2 border border-border-strong rounded-lg text-base focus:ring-2 focus:ring-violet-500 focus:outline-none"
                >
                  {listTimeZones(form.timezone).map(z => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            )
          )}

          {/* Repeat — create only; the rule can't change after creation. */}
          {editing ? (
            editing.series && (
              <p className="text-sm text-muted">
                <i className="fas fa-arrows-rotate text-faint mr-1.5"></i>
                {describeRecurrence(editing.series, editing.timezone)}
                <span className="block text-xs text-faint mt-0.5">
                  The repeat schedule can&apos;t be changed — cancel the series and
                  create a new one instead.
                </span>
              </p>
            )
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label htmlFor="ev-repeat" className="text-sm font-semibold text-primary">Repeat</label>
                <select
                  id="ev-repeat"
                  value={repeat.freq}
                  onChange={e => {
                    const freq = e.target.value as RepeatFreq;
                    setRepeat(prev => ({
                      ...prev,
                      freq,
                      byweekday: freq === 'weekly' ? [startDow] : [],
                    }));
                  }}
                  className="px-3 py-2 border border-border-strong rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:outline-none"
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>

              {repeat.freq !== 'none' && (
                <div className="rounded-lg border border-border bg-surface-muted/60 p-3 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-secondary">
                    Every
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={repeat.interval}
                      onChange={e =>
                        setRepeat(prev => ({
                          ...prev,
                          interval: Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 12),
                        }))
                      }
                      className="w-16 px-2 py-1.5 border border-border-strong rounded-lg text-sm text-center focus:ring-2 focus:ring-violet-500 focus:outline-none"
                    />
                    {repeat.freq === 'daily' && (repeat.interval === 1 ? 'day' : 'days')}
                    {repeat.freq === 'weekly' && (repeat.interval === 1 ? 'week' : 'weeks')}
                    {repeat.freq === 'monthly' && (repeat.interval === 1 ? 'month' : 'months')}
                    {repeat.freq === 'yearly' && (repeat.interval === 1 ? 'year' : 'years')}
                  </div>

                  {repeat.freq === 'weekly' && (
                    // flex-wrap: 7 chips + gaps brush the 320px body width;
                    // wrapping beats clipping if the fit ever changes.
                    <div className="flex flex-wrap gap-1.5">
                      {DOW_CHIP_LABELS.map((label, dow) => {
                        const active = repeat.byweekday.includes(dow);
                        const locked = dow === startDow;
                        return (
                          <button
                            key={dow}
                            type="button"
                            disabled={locked}
                            title={locked ? "The event's start day always repeats" : undefined}
                            onClick={() =>
                              setRepeat(prev => ({
                                ...prev,
                                byweekday: active
                                  ? prev.byweekday.filter(d => d !== dow)
                                  : [...prev.byweekday, dow].sort((a, b) => a - b),
                              }))
                            }
                            className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full text-xs font-semibold transition ${
                              active
                                ? 'bg-brand text-white'
                                : 'bg-surface border border-border-strong text-tertiary hover:border-violet-400'
                            } ${locked ? 'opacity-90 cursor-default ring-1 ring-violet-300' : ''}`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="space-y-1.5 text-sm text-secondary">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="repeat-ends"
                        checked={repeat.endsKind === 'never'}
                        onChange={() => setRepeat(prev => ({ ...prev, endsKind: 'never' }))}
                        className="accent-violet-600"
                      />
                      Never ends
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="repeat-ends"
                        checked={repeat.endsKind === 'until'}
                        onChange={() => setRepeat(prev => ({ ...prev, endsKind: 'until' }))}
                        className="accent-violet-600"
                      />
                      Until
                      <input
                        type="date"
                        value={repeat.until}
                        onChange={e => setRepeat(prev => ({ ...prev, until: e.target.value, endsKind: 'until' }))}
                        className="px-2 py-1 border border-border-strong rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:outline-none"
                      />
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="repeat-ends"
                        checked={repeat.endsKind === 'count'}
                        onChange={() => setRepeat(prev => ({ ...prev, endsKind: 'count' }))}
                        className="accent-violet-600"
                      />
                      After
                      <input
                        type="number"
                        min={1}
                        max={MAX_OCCURRENCES}
                        value={repeat.count}
                        onChange={e =>
                          setRepeat(prev => ({
                            ...prev,
                            count: Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), MAX_OCCURRENCES),
                            endsKind: 'count',
                          }))
                        }
                        className="w-16 px-2 py-1 border border-border-strong rounded-lg text-sm text-center focus:ring-2 focus:ring-violet-500 focus:outline-none"
                      />
                      times
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Who is this for? — create-only, hides itself for non-guardians.
              A child chip = a guest row = the event on the child's calendar,
              which is exactly what makes it visible to every co-guardian. */}
          {!editing && familyRoster !== null && familyRoster.length > 0 && (
            <div>
              <label className="block text-sm font-semibold text-primary mb-1">Who is this for?</label>
              <div className="flex flex-wrap gap-2">
                {familyRoster.map(child => {
                  const active = form.forChildIds.includes(child.id);
                  return (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() =>
                        set(
                          'forChildIds',
                          active
                            ? form.forChildIds.filter(id => id !== child.id)
                            : [...form.forChildIds, child.id]
                        )
                      }
                      className={`inline-flex min-h-[44px] items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                        active
                          ? 'border-brand bg-brand-soft text-brand-fg-strong'
                          : 'border-border-strong text-tertiary hover:border-violet-300 dark:hover:border-violet-700'
                      }`}
                    >
                      {active && <i className="fas fa-check text-xs"></i>}
                      {child.name}
                    </button>
                  );
                })}
              </div>
              {form.forChildIds.length > 0 && (
                <p className="text-xs text-muted mt-1">
                  Adds them as a guest — every guardian sees it on their schedule.
                </p>
              )}
            </div>
          )}

          {!moreOpen ? (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="inline-flex min-h-[44px] items-center text-sm text-brand-fg hover:underline active:underline"
            >
              More options — guests, location, details…
            </button>
          ) : (
            <>
              <div>
                <label className="block text-sm font-semibold text-primary mb-1">Guests</label>
                <GuestPicker chips={chips} onChange={setChips} />
              </div>
              <div>
                <label htmlFor="ev-location" className="block text-sm font-semibold text-primary mb-1">Location</label>
                <input
                  id="ev-location"
                  type="text"
                  value={form.location}
                  onChange={e => set('location', e.target.value)}
                  maxLength={200}
                  placeholder="Riverside Field, or a video link"
                  className="w-full px-3 py-2 border border-border-strong rounded-lg text-base focus:ring-2 focus:ring-violet-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="ev-desc" className="block text-sm font-semibold text-primary mb-1">Details</label>
                <textarea
                  id="ev-desc"
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="Bring both jerseys…"
                  className="w-full px-3 py-2 border border-border-strong rounded-lg text-base focus:ring-2 focus:ring-violet-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-primary mb-1">Category</label>
                <div className="flex flex-wrap gap-2">
                  {EVENT_CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => set('category', cat)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                        form.category === cat
                          ? 'border-brand bg-brand-soft text-brand-fg-strong'
                          : 'border-border-strong text-tertiary hover:border-violet-300 dark:hover:border-violet-700'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${categoryColor(cat).dot}`} />
                      {CATEGORY_LABELS[cat]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Organization (119) — attach this event to a league/club the
                  user manages. Hidden entirely when they manage none. */}
              {managedOrgs !== null && managedOrgs.length > 0 && (
                <div>
                  <label htmlFor="ev-org" className="block text-sm font-semibold text-primary mb-1">
                    Organization
                  </label>
                  <p className="text-xs text-muted mb-2">
                    Shows the event on the league or club page&apos;s schedule.
                  </p>
                  <select
                    id="ev-org"
                    value={form.leagueId ? `league:${form.leagueId}` : form.clubId ? `club:${form.clubId}` : ''}
                    onChange={e => {
                      const v = e.target.value;
                      if (!v) {
                        set('leagueId', null);
                        set('clubId', null);
                      } else {
                        const [kind, id] = v.split(':');
                        set('leagueId', kind === 'league' ? id : null);
                        set('clubId', kind === 'club' ? id : null);
                      }
                    }}
                    className="w-full px-3 py-2 border border-border-strong rounded-lg text-base focus:ring-2 focus:ring-violet-500 focus:outline-none"
                  >
                    <option value="">None</option>
                    {managedOrgs.map(o => (
                      <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>
                        {o.name} ({o.kind})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Workout routine — schedule a session for this event. Hidden
                  entirely for users with no saved routines. */}
              {routines !== null && routines.length > 0 && (
                <div>
                  <label className="block text-sm font-semibold text-primary mb-1">
                    Workout routine
                  </label>
                  <p className="text-xs text-muted mb-2">
                    Attach a routine so the workout is ready to start from this event.
                  </p>
                  {routines.length > 8 ? (
                    <select
                      value={form.routineId ?? ''}
                      onChange={e => {
                        const id = e.target.value || null;
                        set('routineId', id);
                        if (id) set('category', 'workout');
                      }}
                      aria-label="Workout routine"
                      className="w-full px-3 py-2 border border-border-strong rounded-lg text-sm bg-surface focus:ring-2 focus:ring-violet-500 focus:outline-none"
                    >
                      <option value="">None</option>
                      {routines.map(routine => (
                        <option key={routine.id} value={routine.id}>{routine.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => set('routineId', null)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                          form.routineId === null
                            ? 'border-brand bg-brand-soft text-brand-fg-strong'
                            : 'border-border-strong text-tertiary hover:border-violet-300 dark:hover:border-violet-700'
                        }`}
                      >
                        None
                      </button>
                      {routines.map(routine => (
                        <button
                          key={routine.id}
                          type="button"
                          onClick={() => {
                            set('routineId', routine.id);
                            set('category', 'workout');
                          }}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                            form.routineId === routine.id
                              ? 'border-brand bg-brand-soft text-brand-fg-strong'
                              : 'border-border-strong text-tertiary hover:border-violet-300 dark:hover:border-violet-700'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${categoryColor('workout').dot}`} />
                          {routine.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          </div>

          {/* Non-scrolling footer: the primary action is always reachable */}
          <div className="shrink-0 p-4 sm:p-6 pt-3 sm:pt-3 border-t border-border safe-bottom">
            <button
              type="submit"
              disabled={saving}
              className="w-full bg-brand text-white py-3 px-4 rounded-lg hover:bg-brand-hover transition flex items-center justify-center text-sm font-medium disabled:opacity-50 min-h-[44px]"
            >
              {saving ? (
                <><i className="fas fa-spinner fa-spin mr-2"></i> Saving…</>
              ) : editing ? 'Save changes' : 'Create event'}
            </button>
          </div>
        </form>
      </div>

      <ScopeChooserModal
        isOpen={scopeOpen}
        title="Edit repeating event"
        options={[
          { value: 'this', label: 'This event only', description: 'Other events in the series stay as they are.' },
          { value: 'following', label: 'This and following events' },
          { value: 'series', label: 'All events in the series' },
        ]}
        defaultValue="this"
        confirmText="Save changes"
        onConfirm={scope => {
          setScopeOpen(false);
          doSubmit(scope);
        }}
        onCancel={() => setScopeOpen(false)}
      />
    </div>
  );
}

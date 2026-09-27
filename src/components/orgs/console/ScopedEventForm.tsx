'use client';

import { useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { buildEventTimestamps } from '@/lib/calendar/form-times';

// ── Put an event on a team's or a division's calendar (teams & divisions PR 10) ─
// The coach's door: a practice, a game, a meeting — on the scope they run.
// POSTs the calendar's own event route (its scope gate — calendar/
// scope-authz-server.ts — admits a grant that runs or schedules this team /
// division). The time is read in the viewer's zone, the calendar's rule.

interface Props {
  scope: { type: 'team' | 'division'; id: string; name: string };
  onSaved: (message: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

const CATEGORIES = [
  { value: 'practice', label: 'Practice' },
  { value: 'game', label: 'Game' },
  { value: 'training', label: 'Training' },
  { value: 'social', label: 'Team social' },
  { value: 'other', label: 'Other' },
] as const;

export default function ScopedEventForm({ scope, onSaved, onError, onClose }: Props) {
  const [form, setForm] = useState({ title: '', date: '', startTime: '18:00', endTime: '19:30', location: '', category: 'practice' });
  const [saving, setSaving] = useState(false);
  const dirty = () => !!(form.title.trim() || form.date || form.location.trim());
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(dirty, onClose);

  const save = async () => {
    if (saving) return;
    if (!form.title.trim()) return onError('Give the event a title');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const times = buildEventTimestamps({ date: form.date, startTime: form.startTime, endTime: form.endTime, allDay: false }, timezone);
    if (!times) return onError('Pick a date and a start and end time');
    setSaving(true);
    try {
      const res = await fetch('/api/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          location: form.location.trim() || null,
          ...times,
          all_day: false,
          timezone,
          category: form.category,
          [scope.type === 'team' ? 'team_id' : 'division_id']: scope.id,
        }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return onError(out.error || 'Could not add the event');
      onSaved(`Added to ${scope.name}'s calendar`);
      onClose();
    } catch {
      onError('Could not add the event');
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full min-h-[44px] px-3 border border-border-strong rounded-md text-sm';
  const id = (k: string) => `scoped-event-${k}-${scope.id}`;
  return (
    <div className="mt-2 border-t border-border-subtle pt-3 space-y-3" data-scoped-event={scope.id}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={id('title')} className="block text-xs font-medium text-secondary mb-1">Event title</label>
          <input id={id('title')} value={form.title} maxLength={120} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Tuesday practice" className={field} />
        </div>
        <div>
          <label htmlFor={id('date')} className="block text-xs font-medium text-secondary mb-1">Date</label>
          <input id={id('date')} type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className={field} />
        </div>
        <div>
          <label htmlFor={id('category')} className="block text-xs font-medium text-secondary mb-1">Kind</label>
          <select id={id('category')} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={field}>
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={id('start')} className="block text-xs font-medium text-secondary mb-1">Starts</label>
          <input id={id('start')} type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} className={field} />
        </div>
        <div>
          <label htmlFor={id('end')} className="block text-xs font-medium text-secondary mb-1">Ends</label>
          <input id={id('end')} type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} className={field} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={id('location')} className="block text-xs font-medium text-secondary mb-1">Where (optional)</label>
          <input id={id('location')} value={form.location} maxLength={200} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className={field} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving} onClick={() => void save()} className="min-h-[44px] px-4 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50">
          {saving ? 'Adding…' : 'Add event'}
        </button>
        <button type="button" onClick={requestClose} className="min-h-[44px] px-4 rounded-lg border border-border-strong text-sm text-secondary">
          Cancel
        </button>
      </div>
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </div>
  );
}

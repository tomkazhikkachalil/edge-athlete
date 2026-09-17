'use client';

import { useMemo } from 'react';
import type { RoundDraft } from '@/lib/sport-events/wizard';
import { listTimeZones } from '@/lib/calendar/venue-time';

const FIELD_INPUT = 'w-full min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-primary text-base';

/**
 * A team round's fields (Events program, phase 4): the date, an optional
 * name, the PLACE (the rink, the field, the court — stored as the round's
 * `course_name`), an optional start time and its zone (221). No course, no tees, no holes.
 */
export default function GameFields({ value: d, onChange, idPrefix = 'event-game' }: { value: RoundDraft; onChange: (patch: Partial<RoundDraft>) => void; idPrefix?: string }) {
  // Leftovers PR 12 (221): the round's own zone — the start time is read on the venue's clock (the list always holds the current pick and the viewer's zone).
  const zones = useMemo(() => listTimeZones(d.timezone), [d.timezone]);
  return (
    <div className="space-y-4" data-game-fields={idPrefix}>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-secondary">Date</span>
        <input type="date" value={d.scheduled_on} onChange={e => onChange({ scheduled_on: e.target.value })} className={FIELD_INPUT} data-event-wizard-date="" data-round-date="" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-secondary">Where</span>
        <input value={d.place} onChange={e => onChange({ place: e.target.value })} maxLength={200} className={FIELD_INPUT} placeholder="The rink, the field, the court" data-wizard-place="" />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-secondary">Start time <span className="text-muted font-normal">(optional)</span></span>
          <input type="time" value={d.starts_at} onChange={e => onChange({ starts_at: e.target.value })} className={FIELD_INPUT} data-wizard-time="" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-secondary">Time zone <span className="text-muted font-normal">(the venue&apos;s)</span></span>
          <select value={d.timezone} onChange={e => onChange({ timezone: e.target.value })} className={FIELD_INPUT} data-wizard-zone="">
            {zones.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-secondary">Name <span className="text-muted font-normal">(optional — &ldquo;Game 2&rdquo;, &ldquo;Tuesday skate&rdquo;)</span></span>
        <input value={d.name} onChange={e => onChange({ name: e.target.value })} maxLength={40} className={FIELD_INPUT} placeholder="Round name" data-round-name="" />
      </label>
    </div>
  );
}

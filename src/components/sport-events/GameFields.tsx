'use client';

import type { RoundDraft } from '@/lib/sport-events/wizard';

const FIELD_INPUT = 'w-full min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-primary text-base';

/**
 * A team round's fields (Events program, phase 4): the date, an optional
 * name, the PLACE (the rink, the field, the court — stored as the round's
 * `course_name`) and an optional start time. No course, no tees, no holes.
 */
export default function GameFields({ value: d, onChange, idPrefix = 'event-game' }: { value: RoundDraft; onChange: (patch: Partial<RoundDraft>) => void; idPrefix?: string }) {
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
      <label className="block space-y-1">
        <span className="text-sm font-medium text-secondary">Start time <span className="text-muted font-normal">(optional)</span></span>
        <input type="time" value={d.starts_at} onChange={e => onChange({ starts_at: e.target.value })} className={FIELD_INPUT} data-wizard-time="" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-secondary">Name <span className="text-muted font-normal">(optional — &ldquo;Game 2&rdquo;, &ldquo;Tuesday skate&rdquo;)</span></span>
        <input value={d.name} onChange={e => onChange({ name: e.target.value })} maxLength={40} className={FIELD_INPUT} placeholder="Round name" data-round-name="" />
      </label>
    </div>
  );
}

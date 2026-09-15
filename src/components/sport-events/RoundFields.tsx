'use client';

import CourseSearchField from '@/components/golf/CourseSearchField';
import { wizardCourseFrom, type RoundDraft } from '@/lib/sport-events/wizard';

/**
 * One round's inputs (Events program, phase 2): the date, the course (the
 * composer's search, or a typed name), the tees, the holes and the start.
 * Extracted from the creation wizard's round step so the event page's add /
 * edit window (RoundEditWindow) and the wizard's rounds list edit the SAME
 * fields with the same rules (wizard.ts validateRoundDraft). Single column,
 * 44px controls.
 */
export const FIELD_INPUT = 'w-full min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-primary text-base';

/** A radio group drawn as cards — the wizard's choice control, shared. */
export function Choice<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: Array<{ value: T; label: string; hint?: string }>; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2 sm:grid-cols-2">
      {options.map(o => (
        <label key={o.value} className={`flex items-start gap-3 rounded-lg border p-3 min-h-[44px] cursor-pointer ${value === o.value ? 'border-brand bg-brand-soft' : 'border-border-strong bg-surface'}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1 h-4 w-4" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-primary">{o.label}</span>
            {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

interface Props {
  value: RoundDraft;
  onChange: (patch: Partial<RoundDraft>) => void;
  /** Distinguishes the controls' ids and names when two rounds are on screen. */
  idPrefix?: string;
}

export default function RoundFields({ value: d, onChange, idPrefix = 'event-round' }: Props) {
  return (
    <div className="space-y-4" data-round-fields={idPrefix}>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-secondary">Date</span>
        <input type="date" value={d.scheduled_on} onChange={e => onChange({ scheduled_on: e.target.value })} className={FIELD_INPUT} data-event-wizard-date="" data-round-date="" />
      </label>
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-course`} className="text-sm font-medium text-secondary">Course</label>
        <CourseSearchField
          id={`${idPrefix}-course`}
          value={d.course ? { id: d.course.id, name: d.course.name } : null}
          onSelect={(course, typed) => {
            if (course) {
              const wc = wizardCourseFrom(course);
              onChange({ course: wc, tee: wc.tees[0] ?? '', holes: wc.holesCount === 9 ? 9 : d.holes });
            } else if (typed) {
              onChange({ course: { id: null, name: typed, tees: [], holesCount: null }, tee: '' });
            } else {
              onChange({ course: null, tee: '' });
            }
          }}
        />
        <p className="text-xs text-muted">Not in the catalog? Type the name and press Enter — the round scores against par 4.</p>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-secondary">Tees <span className="text-muted font-normal">(optional)</span></span>
        {d.course && d.course.tees.length > 0 ? (
          <select value={d.tee} onChange={e => onChange({ tee: e.target.value })} className={FIELD_INPUT}>
            <option value="">Any</option>
            {d.course.tees.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : (
          <input value={d.tee} onChange={e => onChange({ tee: e.target.value })} maxLength={40} className={FIELD_INPUT} placeholder="White" />
        )}
      </label>
      <div className="space-y-1">
        <span className="text-sm font-medium text-secondary">Holes</span>
        <Choice name={`${idPrefix}-holes`} value={String(d.holes) as '9' | '18'} onChange={v => onChange({ holes: v === '9' ? 9 : 18, starting_hole: v === '9' ? d.starting_hole : 1 })} options={[{ value: '18', label: '18 holes' }, { value: '9', label: '9 holes' }]} />
      </div>
      {d.holes === 9 && (
        <div className="space-y-1">
          <span className="text-sm font-medium text-secondary">Start on</span>
          <Choice name={`${idPrefix}-start`} value={String(d.starting_hole) as '1' | '10'} onChange={v => onChange({ starting_hole: v === '10' ? 10 : 1 })} options={[{ value: '1', label: 'Hole 1 (front nine)' }, { value: '10', label: 'Hole 10 (back nine)' }]} />
        </div>
      )}
    </div>
  );
}

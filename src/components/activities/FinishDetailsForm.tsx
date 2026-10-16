'use client';

// The Finish's questions (activities details, Oct 16 2026): effort 1–10 as
// two rows of five chips (each ≥ 44 px — Tom's review), the type's own
// questions (details.ts — at most three shown, the rest behind "More
// details"), and notes. Every answer is optional. Used by the recorder's
// Finish sheet and by the activity page's edit form, so the two never
// disagree.

import { useState } from 'react';
import type { ActivityType } from '@/lib/activities/catalog';
import { EFFORT_LABELS, EFFORT_MAX, fieldVisible, NOTES_MAX, splitFields, type DetailField, type Details } from '@/lib/activities/details';
import { fromInput, QUANTITY_UNITS, toDisplay, type UnitSystem } from '@/lib/activities/units';

export interface FinishFormValue {
  effort: number | null;
  notes: string;
  details: Details;
}

const chip = (on: boolean) =>
  `ea-interactive min-h-[44px] rounded-lg border px-3 text-sm font-semibold ${on ? 'border-brand bg-brand-soft text-brand-fg' : 'border-border text-primary'}`;

/** A number field keeps its own text while typing (so "1." or "" survive a render). */
function NumberField({ f, value, sys, onChange }: { f: Extract<DetailField, { kind: 'number' }>; value: number | undefined; sys: UnitSystem; onChange: (v: number | undefined) => void }) {
  const shown = (v: number | undefined) => (v === undefined ? '' : String(Math.round((f.quantity ? toDisplay(f.quantity, v, sys) : v) * 10) / 10));
  const [text, setText] = useState(() => shown(value));
  const unit = f.quantity ? QUANTITY_UNITS[f.quantity][sys] : f.unit;
  return (
    <label className="block min-w-0" data-detail-field={f.key}>
      <span className="text-sm font-medium text-secondary">{f.label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={text}
          onChange={e => {
            setText(e.target.value);
            const raw = Number(e.target.value.replace(',', '.'));
            if (e.target.value.trim() === '' || !Number.isFinite(raw)) return onChange(undefined);
            const stored = f.quantity ? fromInput(f.quantity, raw, sys) : raw;
            onChange(f.integer ? Math.round(stored) : Math.round(stored * 100) / 100);
          }}
          className="min-h-[44px] w-28 rounded-lg border border-border-strong bg-surface px-3 text-base text-primary tabular-nums"
        />
        {unit && <span className="text-sm text-secondary">{unit}</span>}
      </span>
    </label>
  );
}

function Field({ f, value, sys, onChange }: { f: DetailField; value: Details[string] | undefined; sys: UnitSystem; onChange: (v: Details[string] | undefined) => void }) {
  if (f.kind === 'number') return <NumberField f={f} value={typeof value === 'number' ? value : undefined} sys={sys} onChange={onChange} />;
  if (f.kind === 'text') {
    return (
      <label className="block" data-detail-field={f.key}>
        <span className="text-sm font-medium text-secondary">{f.label}</span>
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          maxLength={f.max}
          placeholder={f.placeholder}
          onChange={e => onChange(e.target.value.trim() ? e.target.value : undefined)}
          className="mt-1 w-full min-h-[44px] rounded-lg border border-border-strong bg-surface px-3 text-base text-primary"
        />
      </label>
    );
  }
  if (f.kind === 'bool') {
    return (
      <fieldset data-detail-field={f.key}>
        <legend className="text-sm font-medium text-secondary">{f.label}</legend>
        <div className="mt-1 flex gap-2">
          {([true, false] as const).map(v => (
            <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(value === v ? undefined : v)} className={chip(value === v)} data-detail-option={String(v)}>
              {v ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }
  const multi = f.kind === 'multi';
  const picked = multi ? (Array.isArray(value) ? value : []) : [];
  // A yard pool leads for an imperial swimmer (Tom's review: units follow the athlete).
  const options = f.key === 'pool' && sys === 'imperial' ? [...f.options].sort((a, b) => Number(b.value === '25yd') - Number(a.value === '25yd')) : f.options;
  return (
    <fieldset data-detail-field={f.key}>
      <legend className="text-sm font-medium text-secondary">{f.label}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map(o => {
          const on = multi ? picked.includes(o.value) : value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => {
                if (!multi) return onChange(on ? undefined : o.value);
                const next = on ? picked.filter(x => x !== o.value) : [...picked, o.value];
                onChange(next.length > 0 ? next : undefined);
              }}
              className={chip(on)}
              data-detail-option={o.value}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function FinishDetailsForm({
  type,
  value,
  onChange,
  sys,
  disabled,
  showNotes = true,
}: {
  type: ActivityType;
  value: FinishFormValue;
  onChange: (v: FinishFormValue) => void;
  sys: UnitSystem;
  disabled?: boolean;
  /** The activity page's edit form keeps its own notes field. */
  showNotes?: boolean;
}) {
  const { shown, more } = splitFields(type);
  const answeredMore = more.some(f => value.details[f.key] !== undefined);
  const [moreOpen, setMoreOpen] = useState(answeredMore);
  const setDetail = (key: string, v: Details[string] | undefined) => {
    const next = { ...value.details };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange({ ...value, details: next });
  };
  const render = (f: DetailField) =>
    fieldVisible(f, value.details) ? <Field key={f.key} f={f} value={value.details[f.key]} sys={sys} onChange={v => setDetail(f.key, v)} /> : null;
  return (
    <fieldset className="space-y-4" disabled={disabled} data-finish-details={type}>
      <div data-finish-effort={value.effort ?? ''}>
        <p className="text-sm font-medium text-secondary" id="finish-effort-label">
          How hard was it? <span className="font-normal text-muted">optional</span>
        </p>
        <div className="mt-1 grid grid-cols-5 gap-1.5" role="radiogroup" aria-labelledby="finish-effort-label">
          {Array.from({ length: EFFORT_MAX }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value.effort === n}
              aria-label={`${n}${EFFORT_LABELS[n] ? ` — ${EFFORT_LABELS[n]}` : ''}`}
              onClick={() => onChange({ ...value, effort: value.effort === n ? null : n })}
              className={`${chip(value.effort === n)} min-w-[44px] tabular-nums`}
              data-effort={n}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="mt-1 flex justify-between text-xs text-muted" aria-hidden="true">
          <span>1 · {EFFORT_LABELS[1]}</span>
          <span>5 · {EFFORT_LABELS[5]}</span>
          <span>10 · {EFFORT_LABELS[10]}</span>
        </p>
      </div>
      {shown.map(render)}
      {more.length > 0 && (
        <div>
          <button type="button" onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen} className="ea-interactive inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-brand-fg" data-finish-more="">
            <i className={`fas fa-chevron-${moreOpen ? 'up' : 'down'}`} aria-hidden="true"></i>
            More details
          </button>
          {moreOpen && <div className="mt-2 space-y-4">{more.map(render)}</div>}
        </div>
      )}
      {showNotes && (
      <label className="block">
        <span className="text-sm font-medium text-secondary">Notes <span className="font-normal text-muted">optional</span></span>
        <textarea
          value={value.notes}
          maxLength={NOTES_MAX}
          rows={2}
          onChange={e => onChange({ ...value, notes: e.target.value })}
          className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base text-primary"
          data-finish-notes=""
        />
      </label>
      )}
    </fieldset>
  );
}

/** The form's value → the POST / PATCH body's answers. */
export function finishPayload(v: FinishFormValue): { effort: number | null; notes: string | null; details: Details | null } {
  return { effort: v.effort, notes: v.notes.trim() ? v.notes.trim() : null, details: Object.keys(v.details).length > 0 ? v.details : null };
}

'use client';

// The climbs of a climbing session (activities details A8, Oct 16 2026): the
// grade scale (chosen once, before the first climb — changing it later would
// drop climbs that are not grades there), the list, and a sheet to log or
// edit one — grade, Sent or Attempt, tries. Controlled: the recorder wires it
// to its events (each climb is in the stored recording at once), the Finish
// sheet and the activity page's edit form to their answers.

import { useState } from 'react';
import {
  ATTEMPTS_MAX,
  CLIMB_GRADES,
  CLIMB_SCALE_LABELS,
  CLIMB_SCALES,
  CLIMBS_MAX,
  climbLine,
  gradeLabel,
  summarizeClimbs,
  type Climb,
  type ClimbScale,
} from '@/lib/activities/climbing';

export type ClimbDraft = { grade: string; sent: boolean; attempts?: number };

const chip = (on: boolean) =>
  `ea-interactive min-h-[44px] rounded-lg border px-2 text-sm font-semibold ${on ? 'border-brand bg-brand-soft text-brand-fg' : 'border-border text-primary'}`;

function ClimbSheet({ scale, initial, onSave, onClose }: { scale: ClimbScale; initial: ClimbDraft | null; onSave: (c: ClimbDraft) => void; onClose: () => void }) {
  const [grade, setGrade] = useState<string | null>(initial?.grade ?? null);
  const [sent, setSent] = useState(initial?.sent ?? true);
  const [tries, setTries] = useState(initial?.attempts ?? 1);
  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/40" role="dialog" aria-modal="true" aria-label={initial ? 'Edit the climb' : 'Log a climb'} data-climb-sheet="">
      <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl">
        <h2 className="text-lg font-bold text-primary">{initial ? 'Edit the climb' : 'Log a climb'}</h2>
        <p className="mt-1 text-sm text-secondary">{CLIMB_SCALE_LABELS[scale]}</p>
        <div className="mt-3 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Grade">
          {CLIMB_GRADES[scale].map(g => (
            <button key={g} type="button" role="radio" aria-checked={grade === g} onClick={() => setGrade(g)} className={chip(grade === g)} data-climb-grade={g}>
              {gradeLabel(scale, g)}
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Did you send it?">
          {([true, false] as const).map(v => (
            <button key={String(v)} type="button" role="radio" aria-checked={sent === v} onClick={() => setSent(v)} className={`${chip(sent === v)} min-h-[48px] text-base`} data-climb-sent={String(v)}>
              {v ? 'Sent' : 'Attempt'}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-secondary">Tries</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setTries(t => Math.max(1, t - 1))} className="ea-icon-btn inline-flex items-center justify-center border border-border" aria-label="One fewer try">
              <i className="fas fa-minus" aria-hidden="true"></i>
            </button>
            <span className="w-8 text-center text-lg font-bold tabular-nums text-primary" data-climb-tries={tries}>
              {tries}
            </span>
            <button type="button" onClick={() => setTries(t => Math.min(ATTEMPTS_MAX, t + 1))} className="ea-icon-btn inline-flex items-center justify-center border border-border" aria-label="One more try">
              <i className="fas fa-plus" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <button
          type="button"
          disabled={!grade}
          onClick={() => grade && onSave({ grade, sent, ...(tries > 1 ? { attempts: tries } : {}) })}
          className="ea-cta mt-4 min-h-[48px] w-full rounded-lg text-base font-semibold text-white disabled:opacity-50"
          data-climb-save=""
        >
          {initial ? 'Save' : 'Log it'}
        </button>
      </div>
    </div>
  );
}

export default function ClimbLog({
  scale,
  scales = CLIMB_SCALES,
  climbs,
  coloursOrdered = false,
  onScale,
  onAdd,
  onEdit,
  onRemove,
  disabled,
}: {
  scale: ClimbScale | null;
  /** The scales the session's style offers (all five when no style is known). */
  scales?: readonly ClimbScale[];
  climbs: readonly Climb[];
  coloursOrdered?: boolean;
  onScale: (s: ClimbScale) => void;
  onAdd: (c: ClimbDraft) => void;
  onEdit: (index: number, c: ClimbDraft) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  const [sheet, setSheet] = useState<{ index: number | null } | null>(null);
  const full = climbs.length >= CLIMBS_MAX;
  const sum = scale ? summarizeClimbs(scale, climbs, coloursOrdered) : null;
  return (
    <section className="space-y-3" data-climb-log={climbs.length}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-primary">Climbs</h3>
        {sum && sum.climbs > 0 && (
          <p className="text-sm text-secondary tabular-nums" data-climb-summary="">
            {sum.climbs} · {sum.sends} sent{sum.hardest ? ` · hardest ${gradeLabel(scale!, sum.hardest)}` : ''}
          </p>
        )}
      </div>
      {/* The scale is chosen before the first climb; afterwards it is the session's. */}
      {climbs.length === 0 ? (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Grade scale" data-climb-scales="">
          {scales.map(s => (
            <button key={s} type="button" role="radio" aria-checked={scale === s} disabled={disabled} onClick={() => onScale(s)} className={chip(scale === s)} data-climb-scale={s}>
              {CLIMB_SCALE_LABELS[s]}
            </button>
          ))}
        </div>
      ) : (
        <ol className="space-y-1.5">
          {climbs.map((c, i) => (
            <li key={`${i}-${c.grade}-${c.at_s ?? ''}`} className="flex items-center gap-2 rounded-lg bg-surface-muted pl-3" data-climb={i}>
              <span className="w-6 text-sm text-muted tabular-nums">{i + 1}</span>
              <span className={`flex-1 text-sm font-semibold ${c.sent ? 'text-primary' : 'text-secondary'}`}>{climbLine(scale!, c)}</span>
              <button type="button" disabled={disabled} onClick={() => setSheet({ index: i })} className="ea-icon-btn inline-flex items-center justify-center text-secondary" aria-label={`Edit climb ${i + 1}`} data-climb-edit={i}>
                <i className="fas fa-pen" aria-hidden="true"></i>
              </button>
              <button type="button" disabled={disabled} onClick={() => onRemove(i)} className="ea-icon-btn inline-flex items-center justify-center text-secondary" aria-label={`Remove climb ${i + 1}`} data-climb-remove={i}>
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        disabled={disabled || !scale || full}
        onClick={() => setSheet({ index: null })}
        className="ea-interactive ea-surface flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-primary disabled:opacity-50"
        data-climb-add=""
      >
        <i className="fas fa-plus text-brand-fg" aria-hidden="true"></i>
        {full ? `${CLIMBS_MAX} climbs logged — the limit` : !scale ? 'Choose the grades first' : 'Log climb'}
      </button>
      {sheet && scale && (
        <ClimbSheet
          scale={scale}
          initial={sheet.index !== null ? climbs[sheet.index] ?? null : null}
          onClose={() => setSheet(null)}
          onSave={c => {
            if (sheet.index !== null) onEdit(sheet.index, c);
            else onAdd(c);
            setSheet(null);
          }}
        />
      )}
    </section>
  );
}

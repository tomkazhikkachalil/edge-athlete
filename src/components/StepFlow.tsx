'use client';

import type { ReactNode } from 'react';

/**
 * The shared step shell (Program D, Oct 2026): "Step n of N · {label}", a dot
 * row, a scrolling body and a sticky footer with Back / Next — on the last
 * step the caller's finish button (e.g. "Save"), and an optional Skip on a
 * step the caller marks skippable. It owns NO data: the caller holds the
 * index and the values; this draws the frame. Every target is ≥ 44 px, one
 * column at 375 px, and it never sets display or width on a shared class.
 * The event, org and registration wizards keep their own frames for now.
 *
 * Oct 28 2026 (the golf round as steps): a refused Next or finish says WHY
 * beside the button (`refusal`) — a dead grey button with no reason read as
 * broken, the composer's footer hint lesson; the finish can wear the live
 * red (`finishTone="live"`, the Go Live button) and name its own busy line.
 *
 * Nov 23 2026 (Tom's visual spec — the mechanical dialect): `variant="mech"`
 * is the SAME frame in the golf round's look, for a caller inside an
 * `.ea-mech` scope: the caller's `lead` (the sport row) and the step counter
 * share one 44 px row, the dots become equal segments (one per step), Back
 * is 92 × 48 and Next 132 × 48, and `footerCenter` sits between them. Every
 * hook and every rule above is unchanged; the default variant renders as
 * before.
 *
 * Nov 24 2026 (golf part 2): on the last step a mech caller may hand over
 * its own finish control (`finishControl` — the slide to go live). It takes
 * the place of the finish button and fills the row; Back narrows to 72 × 56
 * beside it, and a refusal is said on a line above the row. The control
 * carries `data-step-finish` itself and calls the caller's own finish.
 */
export interface StepFlowStep {
  id: string;
  label: string;
  /** Skip is offered on this step (Next without touching it). */
  skippable?: boolean;
}

interface StepFlowProps {
  id: string;
  steps: StepFlowStep[];
  index: number;
  onIndex: (next: number) => void;
  finishLabel: ReactNode;
  onFinish: () => void;
  /** Next / the finish button wait (a save in flight). */
  busy?: boolean;
  /** What the finish button says while busy; "Saving…" by default. */
  busyLabel?: string;
  /** Next (and the finish) is refused on this step until it is true (a required answer). */
  canAdvance?: boolean;
  /** Why Next is refused, shown beside the button while `canAdvance` is false. */
  refusal?: string;
  /** The finish button's colour: the brand CTA, or the live red. */
  finishTone?: 'brand' | 'live';
  /** The frame's look: the house frame, or the mechanical dialect (inside `.ea-mech`). */
  variant?: 'default' | 'mech';
  /** mech only: what shares the header row with the step counter (the sport row). */
  lead?: ReactNode;
  /** mech only: a small line between Back and Next (a credit). */
  footerCenter?: ReactNode;
  /** mech only, last step: the caller's own finish control, in place of the finish button. */
  finishControl?: ReactNode;
  children: ReactNode;
  className?: string;
}

const FINISH_TONE: Record<NonNullable<StepFlowProps['finishTone']>, string> = {
  brand: 'ea-cta',
  live: 'bg-red-600 hover:bg-red-700 transition-colors',
};

/** One segment of the mech progress bar, by its place against the current step. */
function segmentColour(i: number, index: number): string {
  if (i === index) return 'var(--mech-progress-current)';
  return i < index ? 'var(--mech-progress-done)' : 'var(--mech-progress-empty)';
}

export default function StepFlow({ id, steps, index, onIndex, finishLabel, onFinish, busy = false, busyLabel = 'Saving…', canAdvance = true, refusal, finishTone = 'brand', variant = 'default', lead, footerCenter, finishControl, children, className = '' }: StepFlowProps) {
  const step = steps[index] ?? steps[0];
  const last = index >= steps.length - 1;
  const back = () => onIndex(Math.max(0, index - 1));
  const next = () => onIndex(Math.min(steps.length - 1, index + 1));
  const mech = variant === 'mech';
  const ownFinish = mech && last && !!finishControl;

  const backClass = mech
    ? ownFinish ? 'ea-mech-back h-14 w-[72px] shrink-0 !rounded-2xl' : 'ea-mech-back min-h-[44px] h-12 w-[92px] shrink-0'
    : 'ea-interactive min-h-[44px] rounded-lg border border-border-strong px-4 text-sm font-medium text-secondary disabled:opacity-50';
  const skipClass = mech
    ? 'ea-mech-btn min-h-[44px] h-12 rounded-[14px] px-3 text-[15px] font-medium text-[color:var(--mech-text-soft)] disabled:opacity-50'
    : 'ea-interactive min-h-[44px] rounded-lg px-3 text-sm font-medium text-secondary disabled:opacity-50';
  const nextClass = mech
    ? 'ea-mech-next min-h-[44px] h-12 min-w-[132px] shrink-0 px-4'
    : 'ea-cta min-h-[44px] rounded-lg px-5 text-base font-semibold text-white disabled:opacity-50';
  const finishClass = mech
    ? nextClass
    : `${FINISH_TONE[finishTone]} min-h-[44px] rounded-lg px-5 text-base font-semibold text-white disabled:opacity-50`;

  return (
    <div className={`flex flex-col ${className}`} data-step-flow={id} data-step={step.id} data-step-variant={variant}>
      {mech ? (
        <div className="px-4 sm:px-5 pb-2.5 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-x-3 min-h-[44px]">
            <div className="min-w-0">{lead}</div>
            {/* The words a reader (and the specs) know — "Step n of N · label" —
                stay in the text; the engraved "n / N" is what is drawn. */}
            <p className="ea-mech-micro shrink-0" data-step-header="">
              <span className="sr-only">Step {index + 1} of {steps.length} · {step.label}</span>
              <span aria-hidden="true">Step {index + 1} / {steps.length} · {step.label}</span>
            </p>
          </div>
          <ol className="flex items-center gap-1" aria-label="Steps">
            {steps.map((s, i) => (
              <li
                key={s.id}
                data-step-dot={s.id}
                aria-current={i === index ? 'step' : undefined}
                className="h-1.5 flex-1 rounded-[2px] transition-colors"
                style={{ backgroundColor: segmentColour(i, index) }}
              >
                <span className="sr-only">{s.label}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="px-4 pt-3 pb-2">
          <p className="text-sm font-semibold text-secondary" data-step-header="">
            Step {index + 1} of {steps.length} · <span className="text-primary">{step.label}</span>
          </p>
          <ol className="mt-2 flex items-center gap-1.5" aria-label="Steps">
            {steps.map((s, i) => (
              <li
                key={s.id}
                data-step-dot={s.id}
                aria-current={i === index ? 'step' : undefined}
                className={`h-1.5 rounded-full transition-colors ${i === index ? 'w-6 bg-brand' : i < index ? 'w-3 bg-brand/50' : 'w-3 bg-border-strong'}`}
              >
                <span className="sr-only">{s.label}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className={`flex-1 min-h-0 overflow-y-auto ${mech ? 'px-4 sm:px-5 py-2.5' : 'px-4 py-2'}`} data-step-body="">
        {children}
      </div>

      <div
        className={mech
          ? `sticky bottom-0 flex items-center gap-2 px-4 sm:px-5 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-0 shrink-0 bg-[color:var(--mech-surface)] ${ownFinish ? 'flex-wrap' : ''}`
          : 'sticky bottom-0 flex items-center gap-2 border-t border-border bg-surface px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]'}
        data-step-footer=""
      >
        {ownFinish && !canAdvance && refusal ? (
          <p className="basis-full text-center text-xs text-[color:var(--mech-text-soft)]" data-step-refusal="" aria-live="polite">{refusal}</p>
        ) : null}
        <button
          type="button"
          onClick={back}
          disabled={busy || index === 0}
          className={backClass}
          data-step-back=""
        >
          Back
        </button>
        {step.skippable && !last && (
          <button type="button" onClick={next} disabled={busy} className={skipClass} data-step-skip="">
            Skip
          </button>
        )}
        {/* The reason Next is grey, in the space between the buttons; a
            calm line, not a red error before anything was tried. */}
        {ownFinish ? (
          <div className="min-w-0 flex-1">{finishControl}</div>
        ) : (
        <span className={`flex-1 min-w-0 text-xs ${mech ? 'text-center text-[color:var(--mech-text-soft)]' : 'text-secondary'}`} data-step-refusal={!canAdvance && refusal ? '' : undefined} aria-live="polite">
          {!canAdvance && refusal ? refusal : null}
          {mech && (canAdvance || !refusal) ? footerCenter : null}
        </span>
        )}
        {ownFinish ? null : last ? (
          <button type="button" onClick={onFinish} disabled={busy || !canAdvance} className={finishClass} data-tone={mech ? finishTone : undefined} data-step-finish="">
            {busy ? busyLabel : finishLabel}
          </button>
        ) : (
          <button type="button" onClick={next} disabled={busy || !canAdvance} className={nextClass} data-step-next="">
            Next
          </button>
        )}
      </div>
    </div>
  );
}

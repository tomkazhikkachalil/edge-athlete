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
  children: ReactNode;
  className?: string;
}

const FINISH_TONE: Record<NonNullable<StepFlowProps['finishTone']>, string> = {
  brand: 'ea-cta',
  live: 'bg-red-600 hover:bg-red-700 transition-colors',
};

export default function StepFlow({ id, steps, index, onIndex, finishLabel, onFinish, busy = false, busyLabel = 'Saving…', canAdvance = true, refusal, finishTone = 'brand', children, className = '' }: StepFlowProps) {
  const step = steps[index] ?? steps[0];
  const last = index >= steps.length - 1;
  const back = () => onIndex(Math.max(0, index - 1));
  const next = () => onIndex(Math.min(steps.length - 1, index + 1));
  return (
    <div className={`flex flex-col ${className}`} data-step-flow={id} data-step={step.id}>
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

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2" data-step-body="">
        {children}
      </div>

      <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-surface px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]" data-step-footer="">
        <button
          type="button"
          onClick={back}
          disabled={busy || index === 0}
          className="ea-interactive min-h-[44px] rounded-lg border border-border-strong px-4 text-sm font-medium text-secondary disabled:opacity-50"
          data-step-back=""
        >
          Back
        </button>
        {step.skippable && !last && (
          <button type="button" onClick={next} disabled={busy} className="ea-interactive min-h-[44px] rounded-lg px-3 text-sm font-medium text-secondary disabled:opacity-50" data-step-skip="">
            Skip
          </button>
        )}
        {/* The reason Next is grey, in the space between the buttons; a
            calm line, not a red error before anything was tried. */}
        <span className="flex-1 min-w-0 text-xs text-secondary" data-step-refusal={!canAdvance && refusal ? '' : undefined} aria-live="polite">
          {!canAdvance && refusal ? refusal : null}
        </span>
        {last ? (
          <button type="button" onClick={onFinish} disabled={busy || !canAdvance} className={`${FINISH_TONE[finishTone]} min-h-[44px] rounded-lg px-5 text-base font-semibold text-white disabled:opacity-50`} data-step-finish="">
            {busy ? busyLabel : finishLabel}
          </button>
        ) : (
          <button type="button" onClick={next} disabled={busy || !canAdvance} className="ea-cta min-h-[44px] rounded-lg px-5 text-base font-semibold text-white disabled:opacity-50" data-step-next="">
            Next
          </button>
        )}
      </div>
    </div>
  );
}

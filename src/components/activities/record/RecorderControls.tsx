'use client';

import type { RecordingStatus } from '@/lib/activities/record/recording';

/** The fixed bottom bar — the screen owns its bottom edge (no tab bar here). */
export default function RecorderControls({
  status,
  openSegment,
  busy,
  onStart,
  onPause,
  onResume,
  onMark,
  onFinish,
}: {
  status: RecordingStatus;
  /** Seconds the open segment has run, or null when none is open. */
  openSegment: number | null;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onMark: () => void;
  onFinish: () => void;
}) {
  const btn = 'inline-flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl px-3 text-base font-semibold disabled:opacity-50';
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]" data-record-controls={status}>
      <div className="mx-auto flex max-w-xl gap-2">
        {status === 'idle' && (
          <button type="button" onClick={onStart} disabled={busy} className={`${btn} ea-cta text-white`} data-record-start="">
            <i className="fas fa-play" aria-hidden="true"></i> Start
          </button>
        )}
        {status === 'recording' && (
          <>
            <button type="button" onClick={onPause} disabled={busy} className={`${btn} ea-interactive border border-border-strong text-primary`} data-record-pause="">
              <i className="fas fa-pause" aria-hidden="true"></i> Pause
            </button>
            <button
              type="button"
              onClick={onMark}
              disabled={busy}
              aria-pressed={openSegment !== null}
              className={`${btn} ${openSegment !== null ? 'bg-red-600 text-white' : 'ea-interactive border border-border-strong text-primary'}`}
              data-record-mark={openSegment !== null ? 'open' : 'closed'}
            >
              <i className="fas fa-flag" aria-hidden="true"></i>
              {openSegment !== null ? `End · ${Math.floor(openSegment / 60)}:${String(openSegment % 60).padStart(2, '0')}` : 'Mark'}
            </button>
            <button type="button" onClick={onFinish} disabled={busy} className={`${btn} ea-cta text-white`} data-record-finish="">
              <i className="fas fa-stop" aria-hidden="true"></i> Finish
            </button>
          </>
        )}
        {status === 'paused' && (
          <>
            <button type="button" onClick={onResume} disabled={busy} className={`${btn} ea-cta text-white`} data-record-resume="">
              <i className="fas fa-play" aria-hidden="true"></i> Resume
            </button>
            <button type="button" onClick={onFinish} disabled={busy} className={`${btn} ea-interactive border border-border-strong text-primary`} data-record-finish="">
              <i className="fas fa-stop" aria-hidden="true"></i> Finish
            </button>
          </>
        )}
      </div>
    </div>
  );
}

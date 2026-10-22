'use client';

import { useState } from 'react';
import LargerWindow from '@/components/bubbles/LargerWindow';
import StartSessionRows from '@/components/workouts/StartSessionRows';

/**
 * The header's Create sheet (Create menu redesign, Oct 13 2026): the house
 * bottom sheet with FOUR doors, each with a one-line description and its own
 * icon, in Tom's order — Post (a General post, no sport fields: the page's
 * own composer, else the feed's ?create=1 handoff), Sport (the composer with
 * the sport picker already open; picking golf is the live-round setup),
 * Event (the wizard) and Record Activity, which is a SECOND STEP in the same
 * window: Start a workout (the ONE start path Training uses — useStartWorkout)
 * or Record activity (the GPS recorder, the same door as Training'). The two
 * rows are StartSessionRows — Training's Start opens the SAME pair (Oct 22
 * 2026) — and their icons are the resume pill's (PILL_KIND_ICON), so the
 * menu, Training and the pill agree. The drawer opens this same sheet; it is the one Create
 * menu at every width.
 */
export default function CreateSheet({ onPost, onSport, onEvent, onWorkout, onRecording, onClose }: { onPost: () => void; onSport: () => void; onEvent: () => void; onWorkout: () => void; onRecording: () => void; onClose: () => void }) {
  const [step, setStep] = useState<'root' | 'record'>('root');
  const row = 'ea-interactive flex items-center gap-4 w-full text-left rounded-lg px-4 py-3 min-h-[56px] hover:bg-surface-muted';
  const icon = 'w-10 h-10 rounded-full bg-brand-soft text-brand-fg flex items-center justify-center shrink-0';

  if (step === 'record') {
    return (
      <LargerWindow title="Record Activity" onClose={onClose} windowKey="create">
        <div className="space-y-1" data-create-sheet="" data-create-step="record">
          <button type="button" onClick={() => setStep('root')} className="ea-icon-btn text-secondary mb-1" aria-label="Back" data-create-back="">
            <i className="fas fa-arrow-left" aria-hidden="true"></i>
          </button>
          <StartSessionRows onWorkout={onWorkout} onActivity={onRecording} />
        </div>
      </LargerWindow>
    );
  }

  return (
    <LargerWindow title="Create" onClose={onClose} windowKey="create">
      <div className="space-y-1" data-create-sheet="" data-create-step="root">
        <button type="button" onClick={onPost} className={row} data-create-post="">
          <span className={icon}><i className="fas fa-pen" aria-hidden="true"></i></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-primary">Post</span>
            <span className="block text-xs text-muted">Text, photos and video.</span>
          </span>
        </button>
        <button type="button" onClick={onSport} className={row} data-create-sport="">
          <span className={icon}><i className="fas fa-medal" aria-hidden="true"></i></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-primary">Sport</span>
            <span className="block text-xs text-muted">Pick a sport and start a session, like a golf round.</span>
          </span>
        </button>
        <button type="button" onClick={onEvent} className={row} data-create-event="">
          <span className={icon}><i className="fas fa-flag-checkered" aria-hidden="true"></i></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-primary">Event</span>
            <span className="block text-xs text-muted">Invite players, go live, keep a leaderboard.</span>
          </span>
        </button>
        <button type="button" onClick={() => setStep('record')} className={row} data-create-record-activity="" aria-haspopup="true">
          <span className={icon}><i className="fas fa-stopwatch" aria-hidden="true"></i></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-primary">Record Activity</span>
            <span className="block text-xs text-muted">Time a workout, or record a walk, run or ride with GPS.</span>
          </span>
          <i className="fas fa-chevron-right text-muted shrink-0" aria-hidden="true"></i>
        </button>
      </div>
    </LargerWindow>
  );
}

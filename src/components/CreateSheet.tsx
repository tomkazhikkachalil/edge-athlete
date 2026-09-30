'use client';

import LargerWindow from '@/components/bubbles/LargerWindow';

/**
 * The header's Create sheet (Events program): the house bottom sheet with
 * three doors — Post (today's exact composer path), Event (the wizard) and
 * Activity (the file import, 245). The drawer keeps its own rows; this is
 * the desktop / icon-cluster route to the same set.
 */
export default function CreateSheet({ onPost, onEvent, onActivity, onClose }: { onPost: () => void; onEvent: () => void; onActivity: () => void; onClose: () => void }) {
  const row = 'ea-interactive flex items-center gap-4 w-full text-left rounded-lg px-4 py-3 min-h-[56px] hover:bg-surface-muted';
  return (
    <LargerWindow title="Create" onClose={onClose} windowKey="create">
      <div className="space-y-1" data-create-sheet="">
        <button type="button" onClick={onPost} className={row} data-create-post="">
          <span className="w-10 h-10 rounded-full bg-brand-soft text-brand-fg flex items-center justify-center shrink-0"><i className="fas fa-pen" aria-hidden="true"></i></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-primary">Post</span>
            <span className="block text-xs text-muted">A photo, a round, a stat line, a thought.</span>
          </span>
        </button>
        <button type="button" onClick={onEvent} className={row} data-create-event="">
          <span className="w-10 h-10 rounded-full bg-brand-soft text-brand-fg flex items-center justify-center shrink-0"><i className="fas fa-flag-checkered" aria-hidden="true"></i></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-primary">Event</span>
            <span className="block text-xs text-muted">Invite players, go live, keep a leaderboard.</span>
          </span>
        </button>
        <button type="button" onClick={onActivity} className={row} data-create-activity="">
          <span className="w-10 h-10 rounded-full bg-brand-soft text-brand-fg flex items-center justify-center shrink-0"><i className="fas fa-person-running" aria-hidden="true"></i></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-primary">Activity</span>
            <span className="block text-xs text-muted">Import a run, ride or hike from your watch or app.</span>
          </span>
        </button>
      </div>
    </LargerWindow>
  );
}

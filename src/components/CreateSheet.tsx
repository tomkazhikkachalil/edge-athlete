'use client';

import LargerWindow from '@/components/bubbles/LargerWindow';
import StartSessionRows from '@/components/workouts/StartSessionRows';
import FaIcon from '@/components/FaIcon';
import { faFilm } from '@/lib/icons/fa/film';
import { faFlagCheckered } from '@/lib/icons/fa/flag-checkered';
import { faMedal } from '@/lib/icons/fa/medal';
import { faPen } from '@/lib/icons/fa/pen';

/**
 * The header's Create sheet: the house bottom sheet with SIX doors on ONE
 * screen, each with a one-line description and its own icon, in Tom's order
 * (Nov 20 2026) — Post (a General post, no sport fields: the page's own
 * composer, else the feed's ?create=1 handoff), Sport (the composer with the
 * sport picker already open; picking golf is the live-round setup), Workout
 * (the ONE start path Training uses — useStartWorkout), Activity (the
 * recorder, the same door as Training's), Event (the wizard) and Full game
 * (a YouTube link, /videos/new). There is no second step: "Record Activity"
 * used to hold Workout and Activity behind one more tap (Oct 13 – Nov 20
 * 2026). The Workout and Activity rows are StartSessionRows — Training's
 * Start opens the SAME pair (Oct 22 2026) — and their icons are the resume
 * pill's (PILL_KIND_ICON), so the menu, Training and the pill agree. The
 * drawer opens this same sheet; it is the one Create menu at every width.
 */
export default function CreateSheet({ onPost, onSport, onEvent, onFullGame, onWorkout, onRecording, onClose }: { onPost: () => void; onSport: () => void; onEvent: () => void; onFullGame: () => void; onWorkout: () => void; onRecording: () => void; onClose: () => void }) {
  const row = 'ea-interactive flex items-center gap-4 w-full text-left rounded-lg px-4 py-3 min-h-[56px] hover:bg-surface-muted';
  const icon = 'w-10 h-10 rounded-full bg-brand-soft text-brand-fg flex items-center justify-center shrink-0';

  return (
    <LargerWindow title="Create" onClose={onClose} windowKey="create">
      <div className="space-y-1" data-create-sheet="" data-create-step="root">
        <button type="button" onClick={onPost} className={row} data-create-post="">
          <span className={icon}><FaIcon icon={faPen} /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-primary">Post</span>
            <span className="block text-xs text-muted">Text, photos and video.</span>
          </span>
        </button>
        <button type="button" onClick={onSport} className={row} data-create-sport="">
          <span className={icon}><FaIcon icon={faMedal} /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-primary">Sport</span>
            <span className="block text-xs text-muted">Pick a sport and start a session, like a golf round.</span>
          </span>
        </button>
        {/* Workout, then Activity: the pair Training's Start opens. */}
        <StartSessionRows onWorkout={onWorkout} onActivity={onRecording} />
        <button type="button" onClick={onEvent} className={row} data-create-event="">
          <span className={icon}><FaIcon icon={faFlagCheckered} /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-primary">Event</span>
            <span className="block text-xs text-muted">Invite players, go live, keep a leaderboard.</span>
          </span>
        </button>
        {/* Videos program (296): the last door — a game, a tournament, a broadcast is a YouTube link, not an upload. */}
        <button type="button" onClick={onFullGame} className={row} data-create-full-game="">
          <span className={icon}><FaIcon icon={faFilm} /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-primary">Full game</span>
            <span className="block text-xs text-muted">Link a YouTube game or tournament and mark the highlights.</span>
          </span>
        </button>
      </div>
    </LargerWindow>
  );
}

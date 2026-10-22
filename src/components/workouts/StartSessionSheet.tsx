'use client';

import LargerWindow from '@/components/bubbles/LargerWindow';
import StartSessionRows from './StartSessionRows';

/**
 * Training's Start (Training: three changes, Oct 22 2026): the house window
 * with the two rows — Workout (the start screen, `/app/workout/start`:
 * nothing is written before its Start) or Activity (the recorder,
 * `/activities/record`). The host closes the sheet and opens the door; the
 * rows are the Create sheet's (StartSessionRows), so the two doors agree.
 */
interface Props {
  onWorkout: () => void;
  onActivity: () => void;
  onClose: () => void;
}

export default function StartSessionSheet({ onWorkout, onActivity, onClose }: Props) {
  return (
    <LargerWindow title="Start" subtitle="What are you doing today?" onClose={onClose} windowKey="start-session">
      <div className="space-y-1" data-start-session-sheet="">
        <StartSessionRows onWorkout={onWorkout} onActivity={onActivity} trainingDoor />
      </div>
    </LargerWindow>
  );
}

'use client';

/**
 * The two ways to start a session (Training: three changes, Oct 22 2026) —
 * Tom: "When the user taps Training and then Start, offer two options:
 * Workout (sets, reps, weight) or Activity (run, yoga, climb and so on)."
 * ONE pair of rows for every door that offers the choice: the header's
 * Create → Record Activity step (CreateSheet) and Training's Start
 * (StartSessionSheet), so the two can never disagree. The hooks keep the
 * Create sheet's names (`data-create-workout` / `data-create-recording`);
 * Training's Activity row also carries `data-training-record-activity`, the
 * recorder door's hook since Live Activities PR 6.
 */
interface Props {
  onWorkout: () => void;
  onActivity: () => void;
  /** Training's door marks its Activity row for the doors spec. */
  trainingDoor?: boolean;
}

const ROW = 'ea-interactive flex items-center gap-4 w-full text-left rounded-lg px-4 py-3 min-h-[56px] hover:bg-surface-muted';
const ICON = 'w-10 h-10 rounded-full bg-brand-soft text-brand-fg flex items-center justify-center shrink-0';

export default function StartSessionRows({ onWorkout, onActivity, trainingDoor = false }: Props) {
  return (
    <>
      <button type="button" onClick={onWorkout} className={ROW} data-create-workout="">
        <span className={ICON}><i className="fas fa-dumbbell" aria-hidden="true"></i></span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-primary">Workout</span>
          <span className="block text-xs text-muted">Sets, reps and weight — the timer, supersets and circuits.</span>
        </span>
      </button>
      <button type="button" onClick={onActivity} className={ROW} data-create-recording="" {...(trainingDoor ? { 'data-training-record-activity': '' } : {})}>
        <span className={ICON}><i className="fas fa-person-walking" aria-hidden="true"></i></span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-primary">Activity</span>
          <span className="block text-xs text-muted">A run, a ride, yoga, a climb — live, with a timer or a map.</span>
        </span>
      </button>
    </>
  );
}

'use client';

import RoutineManager from '../workouts/RoutineManager';

/**
 * Settings → Routines. A thin section shell around the shared RoutineManager
 * (also reachable from the Vitals quick-settings modal).
 */
export default function WorkoutRoutinesSettings() {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold text-primary mb-1">Workout Routines</h3>
        <p className="text-sm text-tertiary mb-4">
          Saved presets for starting workouts faster.
        </p>
        <div className="bg-surface rounded-xl p-6 border border-border">
          <RoutineManager />
        </div>
      </div>
    </div>
  );
}

'use client';

import RoutineManager, { ROUTINES_HELP } from '../workouts/RoutineManager';
import SectionInfo from '@/components/SectionInfo';

/**
 * Settings → Routines. A thin section shell around the shared RoutineManager
 * (also reachable from the Training quick-settings modal).
 */
export default function WorkoutRoutinesSettings() {
  return (
    <div className="space-y-8">
      <div>
        <SectionInfo as="h3" heading="Workout Routines" className="mb-4">
          <p>Saved presets for starting workouts faster.</p>
          <p className="mt-2">{ROUTINES_HELP}</p>
        </SectionInfo>
        <div className="bg-surface rounded-xl p-6 border border-border">
          <RoutineManager />
        </div>
      </div>
    </div>
  );
}

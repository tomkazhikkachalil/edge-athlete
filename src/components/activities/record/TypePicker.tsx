'use client';

import { ACTIVITY_GROUP_LABELS, ACTIVITY_TYPE_DEFS, activityTypesInGroup, type ActivityGroup, type ActivityType } from '@/lib/activities/catalog';

const GROUPS: ActivityGroup[] = ['outdoor', 'indoor', 'duration'];
const RECORDING_CHIP: Record<string, string> = { gps: 'GPS', timer: 'Timer', duration: 'Timer' };

/** The grouped grid of every timed activity (Tom: a broad, grouped list). */
export default function TypePicker({ onPick }: { onPick: (type: ActivityType) => void }) {
  return (
    <div className="space-y-6" data-record-type-picker="">
      {GROUPS.map(group => (
        <section key={group} aria-labelledby={`record-group-${group}`}>
          <h2 id={`record-group-${group}`} className="text-xs font-semibold uppercase tracking-wide text-secondary mb-3">
            {ACTIVITY_GROUP_LABELS[group]}
            <span className="ml-2 font-normal normal-case tracking-normal text-muted">
              {group === 'outdoor' ? 'a map of where you went' : group === 'indoor' ? 'a timer; distance at the end' : 'a timer'}
            </span>
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {activityTypesInGroup(group).map(type => {
              const def = ACTIVITY_TYPE_DEFS[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onPick(type)}
                  data-record-type={type}
                  className="ea-interactive ea-surface flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-center"
                >
                  <i className={`fas fa-${def.icon} text-xl text-brand-fg`} aria-hidden="true"></i>
                  <span className="text-sm font-semibold text-primary leading-tight">{def.label}</span>
                  <span className="text-[11px] text-muted">{RECORDING_CHIP[def.recording]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

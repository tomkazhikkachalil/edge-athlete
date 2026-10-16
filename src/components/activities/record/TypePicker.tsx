'use client';

import { useState } from 'react';
import { ACTIVITY_GROUP_LABELS, ACTIVITY_TYPE_DEFS, activityTypesInGroup, type ActivityGroup, type ActivityType } from '@/lib/activities/catalog';
import { readRecentTypes, rememberRecentType } from '@/lib/activities/record/recent-types';

const GROUPS: ActivityGroup[] = ['outdoor', 'indoor', 'duration', 'sport'];
const RECORDING_CHIP: Record<string, string> = { gps: 'GPS', timer: 'Timer', duration: 'Timer', gps_optional: 'Timer · map optional' };

function TypeTile({ type, onPick, recent }: { type: ActivityType; onPick: (type: ActivityType) => void; recent?: boolean }) {
  const def = ACTIVITY_TYPE_DEFS[type];
  return (
    <button
      type="button"
      onClick={() => {
        rememberRecentType(type);
        onPick(type);
      }}
      // The Recent row has its own attribute: data-record-type stays unique per type.
      {...(recent ? { 'data-record-recent-type': type } : { 'data-record-type': type })}
      className="ea-interactive ea-surface flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-center"
    >
      <i className={`fas fa-${def.icon} text-xl text-brand-fg`} aria-hidden="true"></i>
      <span className="text-sm font-semibold text-primary leading-tight">{def.label}</span>
      <span className="text-[11px] text-muted">{RECORDING_CHIP[def.recording]}</span>
    </button>
  );
}

/** The grouped grid of every timed activity (Tom: a broad, grouped list), the last-used first (Oct 16 2026). */
export default function TypePicker({ onPick }: { onPick: (type: ActivityType) => void }) {
  // Read once on mount (client-only: the recorder renders after the auth check).
  const [recent] = useState<ActivityType[]>(() => (typeof window === 'undefined' ? [] : readRecentTypes()));
  return (
    <div className="space-y-6" data-record-type-picker="">
      {recent.length > 0 && (
        <section aria-labelledby="record-group-recent" data-record-recent={recent.length}>
          <h2 id="record-group-recent" className="text-xs font-semibold uppercase tracking-wide text-secondary mb-3">Recent</h2>
          <div className="grid grid-cols-3 gap-2">
            {recent.map(type => (
              <TypeTile key={type} type={type} onPick={onPick} recent />
            ))}
          </div>
        </section>
      )}
      {GROUPS.map(group => (
        <section key={group} aria-labelledby={`record-group-${group}`}>
          <h2 id={`record-group-${group}`} className="text-xs font-semibold uppercase tracking-wide text-secondary mb-3">
            {ACTIVITY_GROUP_LABELS[group]}
            <span className="ml-2 font-normal normal-case tracking-normal text-muted">
              {group === 'outdoor' ? 'a map of where you went' : group === 'indoor' ? 'a timer; distance at the end' : group === 'sport' ? 'a practice or a game — counts toward your week' : 'a timer'}
            </span>
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {activityTypesInGroup(group).map(type => (
              <TypeTile key={type} type={type} onPick={onPick} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

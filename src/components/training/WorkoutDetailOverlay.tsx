'use client';

import { useMemo, useState } from 'react';
import TrainingOverlay from './TrainingOverlay';
import WorkoutCard from '../workouts/WorkoutCard';
import MultiSelectDropdown from '../filters/MultiSelectDropdown';
import { deriveYearOptions, matchesYearFilter } from '@/lib/profile-filters';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';

/**
 * The full training diary — the month-grouped WorkoutCard log that used to
 * live on the main screen, now behind the Recent Workouts bubble. The year
 * filter moved here with it: the main screen stays clean, the dense list
 * keeps its narrowing tools.
 */

interface WorkoutDetailOverlayProps {
  /** Completed sessions, newest first (the API's order). */
  sessions: ServerWorkoutSession[];
  isOwnProfile: boolean;
  onOpenPost: (postId: string) => void;
  onEdit: (sessionId: string) => void;
  onShare: (sessionId: string) => void;
  onDeleted: (sessionId: string) => void;
  /** The overlay's close; absent when the list is `inline`. */
  onClose?: () => void;
  /** Training redesign PR 3 (Nov 11 2026): the diary is the History view's own list, not a window over the page. */
  inline?: boolean;
}

export default function WorkoutDetailOverlay({
  sessions, isOwnProfile, onOpenPost, onEdit, onShare, onDeleted, onClose, inline = false,
}: WorkoutDetailOverlayProps) {
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const yearOptions = useMemo(
    () => deriveYearOptions(sessions.map(s => s.started_at)),
    [sessions]
  );
  const visible = sessions.filter(s => matchesYearFilter(s.started_at, selectedYears));

  const groups = visible.reduce<Array<{ month: string; sessions: ServerWorkoutSession[] }>>(
    (acc, session) => {
      const month = new Date(session.started_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const last = acc[acc.length - 1];
      if (last && last.month === month) last.sessions.push(session);
      else acc.push({ month, sessions: [session] });
      return acc;
    },
    []
  );

  const content = (
    <>
      {yearOptions.length > 1 && (
        <div className="mb-4">
          <MultiSelectDropdown<number>
            allLabel="All Years"
            itemNounPlural="years"
            searchPlaceholder="Search years..."
            options={yearOptions.map(year => ({ value: year, label: String(year) }))}
            selected={selectedYears}
            onChange={setSelectedYears}
          />
        </div>
      )}

      {visible.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-tertiary">{sessions.length === 0 ? 'No workouts yet.' : 'No workouts match your filters.'}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(group => (
            <div key={group.month}>
              <h4 className="text-xs font-bold text-muted uppercase tracking-wide mb-2">{group.month}</h4>
              <div className="space-y-2">
                {group.sessions.map(session => (
                  <WorkoutCard
                    key={session.id}
                    session={session}
                    onOpenPost={onOpenPost}
                    isOwnProfile={isOwnProfile}
                    onEdit={() => onEdit(session.id)}
                    onShare={() => onShare(session.id)}
                    onDeleted={() => onDeleted(session.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (inline) {
    return (
      <section data-training-workouts={visible.length}>
        <div className="mb-4">
          <h3 className="text-base font-bold text-primary">Workouts</h3>
          {sessions.length > 0 && <p className="text-xs text-muted mt-0.5">{visible.length} workout{visible.length !== 1 ? 's' : ''}</p>}
        </div>
        {content}
      </section>
    );
  }

  return (
    <TrainingOverlay
      title="Workouts"
      subtitle={`${visible.length} session${visible.length !== 1 ? 's' : ''}`}
      onClose={onClose ?? (() => {})}
    >
      {content}
    </TrainingOverlay>
  );
}

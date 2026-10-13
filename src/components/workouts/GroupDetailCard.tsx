'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import RoundsTrack from './RoundsTrack';
import SetMediaStrip from './SetMediaStrip';
import { formatSetLine, formatVolume } from '@/lib/workouts/summary';
import { groupLine, groupVolumeLbs } from '@/lib/workouts/groups';
import type { EntryExercise, ExerciseGroupKind } from '@/lib/workouts/entries';

// ── A finished workout's superset / circuit — compact, swipeable (Oct 13 2026)
// Tom: "the finished post shows groups as a compact swipeable card with the
// round count and a summary line, expanding on tap." One renderer for the
// feed post (WorkoutPostCard) AND the history card (WorkoutCard), so the two
// can never disagree. The header — "Circuit · 4 rounds · 1,200 lbs" — is a
// button: collapsed, the rounds ride a RoundsTrack (one slide per round, each
// member's name · line); expanded, every round vertically, the Oct 12 list.
// Single exercises never come here; a workout without groups renders exactly
// as before.

interface Props {
  kind: ExerciseGroupKind;
  rounds: number;
  members: EntryExercise[];
  /** The host's text tones (the post is violet; the history card is neutral). */
  tone?: 'post' | 'history';
}

export default function GroupDetailCard({ kind, rounds, members, tone = 'post' }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [slide, setSlide] = useState(0);
  const volume = groupVolumeLbs(members);
  const count = Math.max(1, rounds);
  const nameClass = tone === 'post' ? 'text-primary' : 'text-secondary';

  const roundLines = (k: number) => (
    <div className="space-y-1 px-0.5">
      {members.map(m => {
        const set = m.sets[k];
        return (
          <div key={m.clientId}>
            <p className="text-xs text-tertiary">
              <span className={`font-bold ${nameClass}`}>{m.name}</span>
              {' · '}
              {set ? formatSetLine(set) : '—'}
            </p>
            {set && set.media.length > 0 && <SetMediaStrip media={set.media} />}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="rounded-lg border border-violet-200/70 dark:border-violet-800/60 bg-violet-50/30 dark:bg-violet-950/20 p-2" data-post-group-card={kind} data-post-group-expanded={expanded ? 'true' : 'false'}>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 text-left"
      >
        <p className="flex-1 min-w-0 text-[11px] font-semibold uppercase tracking-wide text-brand-fg-strong truncate" data-detail-group={kind}>
          {groupLine(kind, rounds)}
          {volume > 0 ? <span className="normal-case tracking-normal font-medium text-secondary"> · {formatVolume(volume)}</span> : null}
        </p>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-tertiary shrink-0" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5 text-tertiary shrink-0" aria-hidden="true" />}
      </button>
      {expanded ? (
        <div className="mt-2 space-y-2" data-post-group-list="">
          {members.map(m => (
            <div key={m.clientId}>
              <p className={`text-xs font-bold ${nameClass}`}>{m.name}</p>
              {m.notes && <p className="text-xs text-muted italic">{m.notes}</p>}
              <div className="mt-0.5 space-y-1">
                {m.sets.map((set, i) => (
                  <div key={i}>
                    <p className="text-xs text-tertiary">
                      <span className="text-faint">Round {set.setNumber}</span> · {formatSetLine(set)}
                    </p>
                    {set.media.length > 0 && <SetMediaStrip media={set.media} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <RoundsTrack className="mt-1" count={count} index={slide} onIndexChange={setSlide} renderSlide={roundLines} />
      )}
    </div>
  );
}

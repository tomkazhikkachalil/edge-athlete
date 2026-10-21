'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import RoundsTrack from './RoundsTrack';
import SetImageStack from './SetImageStack';
import { formatSetLine, formatVolume } from '@/lib/workouts/summary';
import { groupLine, groupVolumeLbs } from '@/lib/workouts/groups';
import { setMediaId } from '@/lib/workouts/collage';
import type { EntryExercise, ExerciseGroupKind } from '@/lib/workouts/entries';

// ── A finished workout's superset / circuit — compact, swipeable (Oct 13 2026)
// Tom: "the finished post shows groups as a compact swipeable card with the
// round count and a summary line, expanding on tap." One renderer for the
// feed post (WorkoutPostCard) AND the history card (WorkoutCard), so the two
// can never disagree. The header — "Circuit · 4 rounds · 1,200 lbs" — is a
// button: collapsed, the rounds ride a RoundsTrack (one slide per round, each
// member's name · line); expanded, every round vertically, the Oct 12 list.
// Single exercises never come here (WorkoutDetailItems gives them their own
// card). Oct 17 2026 (Tom): a round's images sit BELOW the round's lines,
// inside the card — swiping the rounds shows each round's images under it —
// and a tap opens the host's viewer, never a new window.

interface Props {
  kind: ExerciseGroupKind;
  rounds: number;
  members: EntryExercise[];
  /** The host's text tones (the post is violet; the history card is neutral). */
  tone?: 'post' | 'history';
  /** Opens the host's viewer at one image (`setMediaId`). */
  onOpenMedia: (id: string) => void;
}

export default function GroupDetailCard({ kind, rounds, members, tone = 'post', onOpenMedia }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [slide, setSlide] = useState(0);
  const volume = groupVolumeLbs(members);
  const count = Math.max(1, rounds);
  const nameClass = tone === 'post' ? 'text-primary' : 'text-secondary';

  // Oct 21 2026 (Training fixes, item 3 — "uniform set bubbles"): a round is
  // a bubble per member; a member's images for that round sit at its bubble's
  // right as one stack (the viewer opens at the first), every bubble the
  // thumb's height when the round carries any media. `data-post-round-images`
  // marks a round that has images (the specs count its stacks).
  const roundLines = (k: number) => {
    const withMedia = members.some(m => (m.sets[k]?.media.length ?? 0) > 0);
    return (
      <div className="space-y-1" {...(withMedia ? { 'data-post-round-images': k + 1 } : {})}>
        {members.map(m => {
          const set = m.sets[k];
          const media = set?.media ?? [];
          return (
            <div key={m.clientId} className="flex items-stretch gap-2" data-post-round-member={m.clientId}>
              <p className={`flex flex-1 min-w-0 items-center rounded-lg bg-violet-100/60 px-2.5 text-xs text-tertiary dark:bg-violet-900/30 ${withMedia ? 'min-h-16' : 'py-1.5'}`}>
                <span className="min-w-0 truncate">
                  <span className={`font-bold ${nameClass}`}>{m.name}</span>
                  {' · '}
                  {set ? formatSetLine(set) : '—'}
                </span>
              </p>
              {media.length > 0 ? (
                <SetImageStack media={media} size="round" onOpen={() => onOpenMedia(setMediaId(m.clientId, k, 0))} />
              ) : withMedia ? (
                <span className="w-16 shrink-0" aria-hidden="true" data-post-set-slot="" />
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

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
          {members.some(m => m.notes) && (
            <div className="space-y-0.5">
              {members.filter(m => m.notes).map(m => (
                <p key={m.clientId} className="text-xs text-muted italic"><span className={`not-italic font-bold ${nameClass}`}>{m.name}:</span> {m.notes}</p>
              ))}
            </div>
          )}
          {Array.from({ length: count }, (_, k) => (
            <div key={k} data-post-group-round={k + 1}>
              <p className="text-xs text-faint">Round {k + 1}</p>
              {roundLines(k)}
            </div>
          ))}
        </div>
      ) : (
        <RoundsTrack className="mt-1" count={count} index={slide} onIndexChange={setSlide} renderSlide={roundLines} />
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import RoundsTrack from './RoundsTrack';
import ExerciseMediaStrip from './ExerciseMediaStrip';
import { formatSetLine, formatVolume } from '@/lib/workouts/summary';
import { GROUP_LABEL, groupLine, groupVolumeLbs } from '@/lib/workouts/groups';
import { roundMedia, roundMediaIdAt } from '@/lib/workouts/collage';
import type { EntryExercise, ExerciseGroupKind } from '@/lib/workouts/entries';

// ── A finished workout's superset / circuit — compact, swipeable (Oct 13 2026)
// Tom: "the finished post shows groups as a compact swipeable card with the
// round count and a summary line, expanding on tap." One renderer for the
// feed post (WorkoutPostCard) AND the history card (WorkoutCard), so the two
// can never disagree. The header — "Circuit · 4 rounds · 1,200 lbs" — is a
// button: collapsed, the rounds ride a RoundsTrack (one slide per round);
// expanded, every round vertically, the Oct 12 list. Single exercises never
// come here (WorkoutDetailItems gives them their own card).
// Training: three changes (Oct 22 2026, items 2 and 3): the card is the
// group's ONE outer bubble; a round is ONE inner bubble holding every
// member's line (name · line) — never a bubble per member — with the round's
// clips together in one strip at its right (ExerciseMediaStrip), so the
// bubble grows only with more members, never for media. Swiping the rounds
// shows each round's clips beside it. A tap opens the host's viewer.

interface Props {
  kind: ExerciseGroupKind;
  rounds: number;
  members: EntryExercise[];
  /** The host's text tones (the post is violet; the history card is neutral). */
  tone?: 'post' | 'history';
  /** Opens the host's viewer at one image (`setMediaId`); null is ignored. */
  onOpenMedia: (id: string | null) => void;
}

export default function GroupDetailCard({ kind, rounds, members, tone = 'post', onOpenMedia }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [slide, setSlide] = useState(0);
  const volume = groupVolumeLbs(members);
  const count = Math.max(1, rounds);
  const nameClass = tone === 'post' ? 'text-primary' : 'text-secondary';
  const cardClass = tone === 'post'
    ? 'border-violet-200/70 dark:border-violet-800/60 bg-violet-50/30 dark:bg-violet-950/20'
    : 'border-border bg-surface';
  const bubbleClass = tone === 'post' ? 'bg-violet-100/60 dark:bg-violet-900/30' : 'bg-surface-muted';

  // One inner bubble per round, the round's strip at its right.
  // `data-post-round-images` marks a round that has clips (the specs count its tiles).
  const roundLines = (k: number) => {
    const media = roundMedia(members, k);
    return (
      <div className="flex items-start gap-2" {...(media.length > 0 ? { 'data-post-round-images': k + 1 } : {})}>
        <div className={`flex-1 min-w-0 rounded-lg px-2.5 py-1.5 ${bubbleClass} ${media.length > 0 ? 'min-h-16' : ''}`} data-post-round-bubble={k + 1}>
          {members.map(m => {
            const set = m.sets[k];
            return (
              <p key={m.clientId} className="truncate text-xs leading-5 text-tertiary" data-post-round-member={m.clientId}>
                <span className={`font-bold ${nameClass}`}>{m.name}</span>
                {' · '}
                {set ? formatSetLine(set) : '—'}
              </p>
            );
          })}
        </div>
        {media.length > 0 && (
          <ExerciseMediaStrip media={media} name={`${GROUP_LABEL[kind]} round ${k + 1}`} onOpen={i => onOpenMedia(roundMediaIdAt(members, k, i))} />
        )}
      </div>
    );
  };

  return (
    <div className={`rounded-lg border ${cardClass} p-2`} data-post-group-card={kind} data-post-group-expanded={expanded ? 'true' : 'false'}>
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

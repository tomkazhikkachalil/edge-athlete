'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import MediaLightbox from '@/components/media/MediaLightbox';
import GroupDetailCard from './GroupDetailCard';
import SetImageStack from './SetImageStack';
import ExerciseName from './ExerciseName';
import { formatSetLine } from '@/lib/workouts/summary';
import { renderItems } from '@/lib/workouts/groups';
import { setMediaId, workoutCollageItems } from '@/lib/workouts/collage';
import type { EntryExercise } from '@/lib/workouts/entries';

// ── A finished workout's exercises, one renderer (Oct 17 2026) ──────────────
// The feed post (WorkoutPostCard) and the Training history card (WorkoutCard)
// both draw their details here, so the two never disagree. Tom:
//  - a single exercise is ONE bordered card (styled like the circuit card),
//    a row per set, that set's images on the right — one alone, several as a
//    stack with "+N";
//  - a superset / circuit keeps its swipeable card, each round's images under
//    the round (GroupDetailCard);
//  - a tap on any image opens the app's own viewer over the post (close,
//    Escape, swipe through every image of the workout) — never a new window.
// Oct 21 2026 (Training fixes, item 3 — Tom chose "uniform set bubbles"):
// every set is a BUBBLE; in an exercise that carries any media every bubble
// is the thumb's height (64 px) and the thumb sits at its right (an empty
// 64 px slot keeps the lines aligned on a set without media), so the sets
// stack with the same gap whether or not a set has a photo. An exercise
// with no media keeps compact bubbles. The viewer's order is unchanged.

interface Props {
  exercises: EntryExercise[];
  /** The host's text tones (the post is violet; the history card is neutral). */
  tone: 'post' | 'history';
}

export default function WorkoutDetailItems({ exercises, tone }: Props) {
  const items = useMemo(() => workoutCollageItems(exercises), [exercises]);
  const [viewing, setViewing] = useState<number | null>(null);
  const open = (id: string) => {
    const index = items.findIndex(item => item.id === id);
    if (index >= 0) setViewing(index);
  };
  const nameClass = tone === 'post' ? 'text-primary' : 'text-secondary';
  const cardClass = tone === 'post'
    ? 'border-violet-200/70 dark:border-violet-800/60 bg-violet-50/30 dark:bg-violet-950/20'
    : 'border-border bg-surface';
  // The set bubble: a shade deeper than its card (the post is violet; the history card is neutral).
  const bubbleClass = tone === 'post' ? 'bg-violet-100/60 dark:bg-violet-900/30' : 'bg-surface-muted';

  return (
    <>
      {renderItems(exercises).map(item => item.type === 'group' ? (
        <GroupDetailCard key={item.group.groupId} kind={item.group.kind} rounds={item.group.rounds} members={item.group.members} tone={tone} onOpenMedia={open} />
      ) : (
        <div key={item.index} className={`rounded-lg border ${cardClass} p-2`} data-post-exercise-card="">
          <ExerciseName as="p" name={item.exercise.name} className={`text-xs font-bold ${nameClass}`} />
          {item.exercise.notes && <p className="text-xs text-muted italic">{item.exercise.notes}</p>}
          <div className="mt-1 space-y-1" data-post-set-bubbles={item.exercise.sets.some(s => s.media.length > 0) ? 'media' : 'plain'}>
            {item.exercise.sets.map((set, setIndex) => {
              const withMedia = item.exercise.sets.some(s => s.media.length > 0);
              return (
                <div key={setIndex} className="flex items-stretch gap-2" data-post-set-row={set.setNumber}>
                  <p className={`flex flex-1 min-w-0 items-center rounded-lg px-2.5 text-xs text-tertiary ${bubbleClass} ${withMedia ? 'min-h-16' : 'py-1.5'}`}>
                    <span className="min-w-0 truncate"><span className="text-faint">Set {set.setNumber}</span> · {formatSetLine(set)}</span>
                  </p>
                  {set.media.length > 0 ? (
                    <SetImageStack media={set.media} onOpen={() => open(setMediaId(item.exercise.clientId, setIndex, 0))} />
                  ) : withMedia ? (
                    <span className="w-16 shrink-0" aria-hidden="true" data-post-set-slot="" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {/* Portalled: a fixed layer inside a card is caught by any transformed
          ancestor (the feed card), and the body's end sits above the post
          detail modal (both z-[60]; the later one wins). React still bubbles
          the portal's clicks to the card, so they stop at its edge. */}
      {viewing !== null && items[viewing] && typeof document !== 'undefined' && createPortal(
        <div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        <MediaLightbox
          items={items}
          index={viewing}
          onIndexChange={setViewing}
          onClose={() => setViewing(null)}
          footerFor={item => items.find(i => i.id === item.id)?.label ?? null}
        />
        </div>,
        document.body,
      )}
    </>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import MediaLightbox from '@/components/media/MediaLightbox';
import GroupDetailCard from './GroupDetailCard';
import ExerciseMediaStrip from './ExerciseMediaStrip';
import ExerciseName from './ExerciseName';
import { formatSetLine } from '@/lib/workouts/summary';
import { renderItems } from '@/lib/workouts/groups';
import { exerciseMedia, exerciseMediaIdAt, workoutCollageItems } from '@/lib/workouts/collage';
import type { EntryExercise } from '@/lib/workouts/entries';

// ── A finished workout's exercises, one renderer (Oct 17 2026) ──────────────
// The feed post (WorkoutPostCard) and the Training history card (WorkoutCard)
// both draw their details here, so the two never disagree.
// Training: three changes (Oct 22 2026, items 2 and 3 — Tom):
//  - a single exercise is ONE outer bubble (light violet) holding its name
//    and everything for it, with ONE inner bubble (a shade deeper) holding
//    ALL of its sets together — never a bubble or a border per set;
//  - the exercise's media sits together at the inner bubble's right as one
//    strip (ExerciseMediaStrip: 64 px tiles, one on a phone, up to three
//    from sm:, "+N" for the rest) — a clip belongs to the exercise, not to
//    the set it was taken during; the bubble grows only with more sets
//    (`min-h-16` keeps a one-set bubble the strip's height), never for media;
//  - a superset / circuit keeps its swipeable card with one inner bubble
//    per round and the round's strip at its right (GroupDetailCard);
//  - a tap on any image opens the app's own viewer over the post (close,
//    Escape, swipe through every image of the workout) — never a new window.
// Supersedes the Oct 17 "a row per set, its images at the right" and the
// Oct 21 "uniform set bubbles" layouts.

interface Props {
  exercises: EntryExercise[];
  /** The host's text tones (the post is violet; the history card is neutral). */
  tone: 'post' | 'history';
}

export default function WorkoutDetailItems({ exercises, tone }: Props) {
  const items = useMemo(() => workoutCollageItems(exercises), [exercises]);
  const [viewing, setViewing] = useState<number | null>(null);
  const open = (id: string | null) => {
    if (!id) return;
    const index = items.findIndex(item => item.id === id);
    if (index >= 0) setViewing(index);
  };
  const nameClass = tone === 'post' ? 'text-primary' : 'text-secondary';
  // The outer bubble: one per exercise.
  const cardClass = tone === 'post'
    ? 'border-violet-200/70 dark:border-violet-800/60 bg-violet-50/30 dark:bg-violet-950/20'
    : 'border-border bg-surface';
  // The inner bubble — all the sets — a shade deeper than its card.
  const bubbleClass = tone === 'post' ? 'bg-violet-100/60 dark:bg-violet-900/30' : 'bg-surface-muted';

  return (
    <>
      {renderItems(exercises).map(item => item.type === 'group' ? (
        <GroupDetailCard key={item.group.groupId} kind={item.group.kind} rounds={item.group.rounds} members={item.group.members} tone={tone} onOpenMedia={open} />
      ) : (
        <div key={item.index} className={`rounded-lg border ${cardClass} p-2`} data-post-exercise-card="">
          <ExerciseName as="p" name={item.exercise.name} className={`text-xs font-bold ${nameClass}`} />
          {item.exercise.notes && <p className="text-xs text-muted italic">{item.exercise.notes}</p>}
          {(() => {
            const media = exerciseMedia(item.exercise);
            return (
              <div className="mt-1 flex items-start gap-2">
                <div
                  className={`flex-1 min-w-0 rounded-lg px-2.5 py-1.5 ${bubbleClass} ${media.length > 0 ? 'min-h-16' : ''}`}
                  data-post-sets-bubble={item.exercise.sets.length}
                >
                  {item.exercise.sets.map(set => (
                    <p key={set.setNumber} className="truncate text-xs leading-5 text-tertiary" data-post-set-row={set.setNumber}>
                      <span className="text-faint">Set {set.setNumber}</span> · {formatSetLine(set)}
                    </p>
                  ))}
                </div>
                {media.length > 0 && (
                  <ExerciseMediaStrip media={media} name={item.exercise.name} onOpen={i => open(exerciseMediaIdAt(item.exercise, i))} />
                )}
              </div>
            );
          })()}
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

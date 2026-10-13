'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Layers, Minus, Plus, Repeat, X } from 'lucide-react';
import ActionMenu from '@/components/ActionMenu';
import ExerciseCard from './ExerciseCard';
import RoundsTrack from './RoundsTrack';
import type { SetMediaUploads } from './useSetMediaUploads';
import type { EntryExercise } from '@/lib/workouts/entries';
import { MAX_GROUP_ROUNDS } from '@/lib/workouts/entries';
import { currentRound, GROUP_LABEL, roundHasData, roundsCompleted, type ExerciseGroup } from '@/lib/workouts/groups';
import { advanceAfterComplete, completionSignature, initialSlide, type GroupView } from '@/lib/workouts/rounds-view';
import { readSwipeHintSeen, writeSwipeHintSeen } from '@/lib/workouts/timer-prefs';

// ── A superset or circuit on the workout screen (PR 3, Oct 12 2026) ─────────
// Tom: "Each group shows its exercises visually linked, with a round counter.
// Each exercise in a group still records its own reps and weight per round."
// The header names the kind, the round in front of the athlete and the
// rounds stepper. Every edit goes through groups.ts (pure) in the editor;
// this component only renders.
//
// Rounds as a swipe (Oct 13 2026): Tom — "circuits and repeated rounds make
// the screen very long". In SWIPE view (the default) the members sit on ONE
// slide per round (RoundsTrack — each member an ExerciseCard rendering only
// that round's row), the header's "Round k of R" names the slide in view,
// completing the round in view advances to the next, "Copy previous round"
// fills an empty round from the one before, and a one-time hint says how.
// LIST view is the Oct 12 rendering — every round vertically. The view is a
// device preference (timer-prefs.ts) the editor owns and passes down.

interface Props {
  group: ExerciseGroup;
  uploads: SetMediaUploads;
  view: GroupView;
  onSetView: (view: GroupView) => void;
  onChangeMember: (clientId: string, next: EntryExercise) => void;
  onRemoveMember: (clientId: string) => void;
  onAddExercise: () => void;
  onSetRounds: (rounds: number) => void;
  onAddRound: () => void;
  onDeleteRound: (roundIndex: number) => void;
  onCopyRound: (roundIndex: number) => void;
  onUngroup: () => void;
  onRemoveGroup: () => void;
}

export default function ExerciseGroupCard({ group, uploads, view, onSetView, onChangeMember, onRemoveMember, onAddExercise, onSetRounds, onAddRound, onDeleteRound, onCopyRound, onUngroup, onRemoveGroup }: Props) {
  const done = roundsCompleted(group);
  const Icon = group.kind === 'superset' ? Layers : Repeat;
  const swipe = view === 'swipe';

  // The slide in view: the first incomplete round on mount; clamped when rounds go.
  const [slide, setSlide] = useState(() => initialSlide(group.members, group.rounds));
  const safeSlide = Math.min(slide, Math.max(0, group.rounds - 1));

  // Completing the round in view advances to the next — on the false → true edge only.
  const signature = completionSignature(group.members, group.rounds);
  const previousSignature = useRef(signature);
  useEffect(() => {
    const before = previousSignature.current;
    previousSignature.current = signature;
    if (before === signature) return;
    setSlide(s => advanceAfterComplete(before, signature, Math.min(s, group.rounds - 1), group.rounds));
  }, [signature, group.rounds]);

  // The one-time hint (this device).
  const [hint, setHint] = useState(() => !readSwipeHintSeen());
  const dismissHint = () => {
    if (!hint) return;
    setHint(false);
    writeSwipeHintSeen();
  };

  // The header's round: the slide in view (swipe), else the first incomplete (list).
  const current = swipe ? safeSlide + 1 : currentRound(group);

  const member = (m: EntryExercise, onlyRound?: number) => (
    <ExerciseCard
      key={m.clientId}
      exercise={m}
      onChange={next => onChangeMember(m.clientId, next)}
      onDelete={() => onRemoveMember(m.clientId)}
      uploads={uploads}
      grouped={{ onDeleteRound, onRemoveFromGroup: () => onRemoveMember(m.clientId), ...(onlyRound === undefined ? {} : { onlyRound }) }}
    />
  );

  return (
    <section className="rounded-xl border-2 border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-950/20 p-2 sm:p-3" data-exercise-group={group.groupId} data-group-kind={group.kind} data-group-rounds={group.rounds} data-group-view={view}>
      <div className="flex items-center gap-2 px-1 pb-2">
        <Icon className="w-4 h-4 text-brand-fg-strong shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-primary">{GROUP_LABEL[group.kind]}</p>
          <p className="text-xs text-secondary" data-group-round={current} {...(swipe ? { 'data-rounds-current': current } : {})}>
            Round {current} of {group.rounds}
            {done > 0 ? ` · ${done} done` : ''}
          </p>
        </div>
        {/* The rounds stepper — the same count on every member. */}
        <div className="flex items-center gap-1" aria-label="Rounds">
          <button type="button" onClick={() => onSetRounds(group.rounds - 1)} disabled={group.rounds <= 1} className="ea-interactive inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong text-primary disabled:opacity-40" aria-label="One round fewer" data-group-rounds-minus="">
            <Minus className="w-4 h-4" aria-hidden="true" />
          </button>
          <span className="w-6 text-center text-sm font-bold tabular-nums text-primary">{group.rounds}</span>
          <button type="button" onClick={() => onSetRounds(group.rounds + 1)} disabled={group.rounds >= MAX_GROUP_ROUNDS} className="ea-interactive inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong text-primary disabled:opacity-40" aria-label="One round more" data-group-rounds-plus="">
            <Plus className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <ActionMenu
          ariaLabel={`Options for this ${GROUP_LABEL[group.kind].toLowerCase()}`}
          triggerTestAttr="group-menu"
          triggerClassName="text-tertiary"
          items={[
            { key: 'add', label: 'Add exercise to this group', icon: 'fa-plus', onSelect: onAddExercise, testId: 'group-menu-add' },
            swipe
              ? { key: 'view', label: 'List view', icon: 'fa-list', onSelect: () => onSetView('list'), testId: 'group-menu-view' }
              : { key: 'view', label: 'Swipe view', icon: 'fa-arrows-left-right', onSelect: () => onSetView('swipe'), testId: 'group-menu-view' },
            { key: 'ungroup', label: 'Turn into separate exercises', icon: 'fa-object-ungroup', onSelect: onUngroup, testId: 'group-menu-ungroup' },
            { key: 'remove', label: 'Remove group', icon: 'fa-trash', tone: 'danger', onSelect: onRemoveGroup, testId: 'group-menu-remove' },
          ]}
        />
      </div>

      {swipe ? (
        <>
          {hint && group.rounds > 1 && (
            <div className="mx-1 mb-2 flex items-center gap-2 rounded-lg bg-violet-100/70 dark:bg-violet-900/40 px-2.5 py-1.5 text-xs text-brand-fg-strong" data-rounds-hint="">
              <span className="flex-1">Swipe to move between rounds →</span>
              <button type="button" onClick={dismissHint} className="ea-icon-btn !h-7 !w-7 text-brand-fg-strong" aria-label="Dismiss hint" data-rounds-hint-dismiss="">
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
          <RoundsTrack
            count={group.rounds}
            index={safeSlide}
            onIndexChange={setSlide}
            onUserSwipe={dismissHint}
            label={false}
            renderSlide={k => (
              <div className="relative space-y-2 pl-3 pr-0.5">
                <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-violet-300 dark:bg-violet-700" aria-hidden="true" />
                {group.members.map(m => member(m, k))}
                {k >= 1 && (
                  <button
                    type="button"
                    onClick={() => onCopyRound(k)}
                    disabled={roundHasData(group.members, k)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-surface hover:bg-surface-muted border border-border text-secondary rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
                    data-group-copy-round={k + 1}
                  >
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    Copy previous round
                  </button>
                )}
              </div>
            )}
          />
        </>
      ) : (
        <div className="relative space-y-2 pl-3">
          <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-violet-300 dark:bg-violet-700" aria-hidden="true" />
          {group.members.map(m => member(m))}
        </div>
      )}

      <button
        type="button"
        onClick={onAddRound}
        disabled={group.rounds >= MAX_GROUP_ROUNDS}
        className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2.5 bg-surface-muted hover:bg-surface-sunken text-secondary rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
        data-group-add-round=""
      >
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        Add round
      </button>
    </section>
  );
}

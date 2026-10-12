'use client';

import { Layers, Minus, Plus, Repeat } from 'lucide-react';
import ActionMenu from '@/components/ActionMenu';
import ExerciseCard from './ExerciseCard';
import type { SetMediaUploads } from './useSetMediaUploads';
import type { EntryExercise } from '@/lib/workouts/entries';
import { MAX_GROUP_ROUNDS } from '@/lib/workouts/entries';
import { currentRound, GROUP_LABEL, roundsCompleted, type ExerciseGroup } from '@/lib/workouts/groups';

// ── A superset or circuit on the workout screen (PR 3, Oct 12 2026) ─────────
// Tom: "Each group shows its exercises visually linked, with a round counter.
// Each exercise in a group still records its own reps and weight per round."
// The header names the kind, the round in front of the athlete and the
// rounds stepper; the members are ExerciseCards in their grouped mode (one
// row per round, labelled R1 · R2 …, no Add set of their own — Add round is
// the group's, and deleting a round takes it from every member). Every edit
// goes through groups.ts (pure) in the editor; this component only renders.

interface Props {
  group: ExerciseGroup;
  uploads: SetMediaUploads;
  onChangeMember: (clientId: string, next: EntryExercise) => void;
  onRemoveMember: (clientId: string) => void;
  onAddExercise: () => void;
  onSetRounds: (rounds: number) => void;
  onAddRound: () => void;
  onDeleteRound: (roundIndex: number) => void;
  onUngroup: () => void;
  onRemoveGroup: () => void;
}

export default function ExerciseGroupCard({ group, uploads, onChangeMember, onRemoveMember, onAddExercise, onSetRounds, onAddRound, onDeleteRound, onUngroup, onRemoveGroup }: Props) {
  const done = roundsCompleted(group);
  const current = currentRound(group);
  const Icon = group.kind === 'superset' ? Layers : Repeat;
  return (
    <section className="rounded-xl border-2 border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-950/20 p-2 sm:p-3" data-exercise-group={group.groupId} data-group-kind={group.kind} data-group-rounds={group.rounds}>
      <div className="flex items-center gap-2 px-1 pb-2">
        <Icon className="w-4 h-4 text-brand-fg-strong shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-primary">{GROUP_LABEL[group.kind]}</p>
          <p className="text-xs text-secondary" data-group-round={current}>
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
            { key: 'ungroup', label: 'Turn into separate exercises', icon: 'fa-object-ungroup', onSelect: onUngroup, testId: 'group-menu-ungroup' },
            { key: 'remove', label: 'Remove group', icon: 'fa-trash', tone: 'danger', onSelect: onRemoveGroup, testId: 'group-menu-remove' },
          ]}
        />
      </div>
      {/* The members, linked by a rail. */}
      <div className="relative space-y-2 pl-3">
        <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-violet-300 dark:bg-violet-700" aria-hidden="true" />
        {group.members.map(member => (
          <ExerciseCard
            key={member.clientId}
            exercise={member}
            onChange={next => onChangeMember(member.clientId, next)}
            onDelete={() => onRemoveMember(member.clientId)}
            uploads={uploads}
            grouped={{ onDeleteRound, onRemoveFromGroup: () => onRemoveMember(member.clientId) }}
          />
        ))}
      </div>
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

'use client';

import ActionMenu, { type ActionMenuItem } from '@/components/ActionMenu';

/**
 * The post card's owner actions (pin / edit / hide / delete) as ONE "…"
 * button at EVERY width (Oct 9 2026 appearance round — desktop used to show
 * up to four unlabelled icons while a phone showed this menu, and a stranger's
 * card already had a "…" there). Since Spec 2 the menu itself is the shared
 * ActionMenu (the portal, the placement and the dismissal live there); this
 * file keeps the owner's rows.
 */
interface Props {
  isPinned: boolean;
  pinBusy: boolean;
  onTogglePin: () => void;
  onEdit: () => void;
  /** A posted workout: open the workout editor (Training fixes PR 5). */
  onEditWorkout?: () => void;
  /** Absent when the mount did not wire onDelete — no dead Delete row. */
  onDelete?: () => void;
  /** Results-kept (241): a result is hidden, not deleted — the row says so. */
  deleteLabel?: string;
  /** The result is hidden from the profile: the row that brings it back. */
  onShowAgain?: () => void;
  /** A for-fun result can be deleted for real (Oct 2026) — beside Hide, never instead of it. */
  onDeleteForGood?: () => void;
}

export default function PostOwnerMenu({ isPinned, pinBusy, onTogglePin, onEdit, onEditWorkout, onDelete, deleteLabel, onShowAgain, onDeleteForGood }: Props) {
  const items: ActionMenuItem[] = [
    { key: 'pin', label: isPinned ? 'Unpin from profile' : 'Pin to profile', icon: 'fa-thumbtack', onSelect: onTogglePin, disabled: pinBusy },
    { key: 'edit', label: 'Edit post', icon: 'fa-edit', onSelect: onEdit },
    // A posted WORKOUT (Training fixes PR 5, Oct 21 2026): the sets and media change in the workout editor; the post's summary follows.
    ...(onEditWorkout ? [{ key: 'edit-workout', label: 'Edit workout', icon: 'fa-dumbbell', onSelect: onEditWorkout }] : []),
    ...(onShowAgain ? [{ key: 'show', label: 'Show on profile', icon: 'fa-eye', onSelect: onShowAgain }] : []),
    ...(onDelete ? [{ key: 'delete', label: deleteLabel ?? 'Delete post', icon: deleteLabel ? 'fa-eye-slash' : 'fa-trash', onSelect: onDelete, ...(deleteLabel ? {} : { tone: 'danger' as const }) }] : []),
    ...(onDeleteForGood ? [{ key: 'delete-for-good', label: 'Delete for good', icon: 'fa-trash', onSelect: onDeleteForGood, tone: 'danger' as const }] : []),
  ];
  return <ActionMenu items={items} ariaLabel="Post options" />;
}

'use client';

import ActionMenu, { type ActionMenuItem } from '@/components/ActionMenu';

/**
 * The post card's owner actions (pin / edit / delete) as ONE "…" button
 * below `sm`. From `sm` up PostCard renders the three 44px buttons and this
 * component's trigger is `sm:hidden`. Since Spec 2 the menu itself is the
 * shared ActionMenu (the portal, the placement and the dismissal live
 * there); this file keeps the owner's rows.
 */
interface Props {
  isPinned: boolean;
  pinBusy: boolean;
  onTogglePin: () => void;
  onEdit: () => void;
  /** Absent when the mount did not wire onDelete — no dead Delete row. */
  onDelete?: () => void;
  /** Results-kept (241): a result is hidden, not deleted — the row says so. */
  deleteLabel?: string;
}

export default function PostOwnerMenu({ isPinned, pinBusy, onTogglePin, onEdit, onDelete, deleteLabel }: Props) {
  const items: ActionMenuItem[] = [
    { key: 'pin', label: isPinned ? 'Unpin from profile' : 'Pin to profile', icon: 'fa-thumbtack', onSelect: onTogglePin, disabled: pinBusy },
    { key: 'edit', label: 'Edit post', icon: 'fa-edit', onSelect: onEdit },
    ...(onDelete ? [{ key: 'delete', label: deleteLabel ?? 'Delete post', icon: deleteLabel ? 'fa-eye-slash' : 'fa-trash', onSelect: onDelete, tone: 'danger' as const }] : []),
  ];
  return <ActionMenu items={items} ariaLabel="Post options" triggerClassName="sm:hidden" />;
}

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
}

export default function PostOwnerMenu({ isPinned, pinBusy, onTogglePin, onEdit, onDelete }: Props) {
  const items: ActionMenuItem[] = [
    { key: 'pin', label: isPinned ? 'Unpin from profile' : 'Pin to profile', icon: 'fa-thumbtack', onSelect: onTogglePin, disabled: pinBusy },
    { key: 'edit', label: 'Edit post', icon: 'fa-edit', onSelect: onEdit },
    ...(onDelete ? [{ key: 'delete', label: 'Delete post', icon: 'fa-trash', onSelect: onDelete, tone: 'danger' as const }] : []),
  ];
  return <ActionMenu items={items} ariaLabel="Post options" triggerClassName="sm:hidden" />;
}

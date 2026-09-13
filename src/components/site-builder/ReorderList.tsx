'use client';

import { useState } from 'react';

/**
 * The reorder control — Site Builder program 3, D1 (Sep 13 2026). ONE
 * control for every "my own order" list (a section's teams, staff, venues,
 * documents… later sponsors, news, contact fields): Move up / Move down
 * buttons at EVERY width (44px targets, the Sections list's precedent —
 * iOS drag stays parked) plus pointer drag on a desktop through native
 * HTML5 drag and drop, which needs no dependency. Emits the full id list
 * on every change; the caller commits it (one undo step per move).
 */
export interface ReorderItem {
  id: string;
  label: string;
}

const ICON = 'inline-flex h-11 w-11 items-center justify-center rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export default function ReorderList({
  items,
  onChange,
  label,
  idBase,
}: {
  /** In the CURRENT order (the caller applies the stored order first). */
  items: ReorderItem[];
  onChange: (ids: string[]) => void;
  label: string;
  idBase: string;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const ids = items.map(i => i.id);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length || from === to) return;
    const next = [...ids];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id);
    onChange(next);
  };
  if (items.length === 0) return <p className="text-xs text-tertiary">Nothing to order yet.</p>;
  return (
    <ol className="space-y-1" aria-label={label} data-sb-reorder={idBase}>
      {items.map((item, i) => (
        <li
          key={item.id}
          draggable
          onDragStart={e => {
            setDragging(item.id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.id);
          }}
          onDragOver={e => {
            if (dragging && dragging !== item.id) e.preventDefault();
          }}
          onDrop={e => {
            e.preventDefault();
            const from = dragging ? ids.indexOf(dragging) : -1;
            setDragging(null);
            if (from >= 0) move(from, i);
          }}
          onDragEnd={() => setDragging(null)}
          className={`flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2 py-1 ${dragging === item.id ? 'opacity-50' : ''}`}
          data-sb-reorder-item={item.id}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="hidden cursor-grab text-muted lg:inline">
              ⋮⋮
            </span>
            <span className="truncate text-sm text-primary">{item.label}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className={ICON} aria-label={`Move ${item.label} up`} data-sb-reorder-up="">
              <i className="fas fa-arrow-up" aria-hidden="true"></i>
            </button>
            <button type="button" onClick={() => move(i, i + 1)} disabled={i === items.length - 1} className={ICON} aria-label={`Move ${item.label} down`} data-sb-reorder-down="">
              <i className="fas fa-arrow-down" aria-hidden="true"></i>
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}

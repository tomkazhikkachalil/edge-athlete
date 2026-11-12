'use client';

import { Pin, PinOff } from 'lucide-react';

/** The pin control beside a best (the athlete's own view only): pressed = pinned to the top of Training. */
export default function PinToggle({ pinned, label, onToggle, dataKey }: { pinned: boolean; label: string; onToggle: () => void; dataKey: string }) {
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${label} from the top of Training` : `Pin ${label} to the top of Training`}
      title={pinned ? 'Unpin' : 'Pin to the top of Training'}
      onClick={onToggle}
      className={`ea-icon-btn inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${pinned ? 'text-brand-fg' : 'text-muted'}`}
      data-pin-toggle={dataKey}
    >
      {pinned ? <PinOff className="w-4 h-4" aria-hidden="true" /> : <Pin className="w-4 h-4" aria-hidden="true" />}
    </button>
  );
}

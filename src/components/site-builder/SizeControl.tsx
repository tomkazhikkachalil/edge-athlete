'use client';

import { SIZE_LABEL, sizeOptionsFor, sizePresetFor, type SizePreset } from '@/lib/site-builder/sections';
import type { WidgetInstance } from '@/lib/site-builder/layout';

// ── Size, in words (Sep 11 2026) ─────────────────────────────────────────
// One segmented radiogroup for the Sections list and the properties panel:
// small · medium · wide, offered only where the catalog allows it; a single
// option renders nothing (the hero is always wide).

interface Props {
  widget: WidgetInstance;
  title: string;
  onResize: (preset: SizePreset) => void;
}

export default function SizeControl({ widget, title, onResize }: Props) {
  const options = sizeOptionsFor(widget.key);
  if (options.length < 2) return null;
  const current = sizePresetFor(widget.w);
  return (
    <div role="radiogroup" aria-label={`Size of ${title}`} className="inline-flex rounded-md border border-border-strong p-0.5" data-sb-size-control="">
      {options.map(p => {
        const checked = p === current;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => {
              if (!checked) onResize(p);
            }}
            className={`min-h-[36px] rounded px-2.5 text-xs font-medium transition-colors ${checked ? 'bg-brand text-white' : 'text-secondary hover:bg-surface-sunken'}`}
            data-sb-size={p}
          >
            {SIZE_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}

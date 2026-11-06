'use client';

/**
 * Retouch (clone-stamp, E4g): the spot chips with Remove OUTSIDE their
 * scrolling strip (always on screen — Nov 6 2026), Size / Soft edge for the
 * selected spot. Placement happens on the stage overlay (tap to drop, drag
 * circles); everything here routes through onPatch with per-control
 * history keys.
 */

import { MAX_CLONE_STAMPS } from '@/lib/media/engine/clone-math';
import { uiToUnsigned, unsignedToUi } from '@/lib/media/slider-scale';
import type { CloneStamp, ImageRecipe } from '@/lib/media/types';
import EditorSlider from './EditorSlider';

const CHIP = 'px-3 min-h-[36px] rounded-full text-chip whitespace-nowrap shrink-0';

interface RetouchPanelProps {
  recipe: ImageRecipe;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onPatch: (patch: Partial<ImageRecipe>, keys: string) => void;
  engineAvailable: boolean;
}

export default function RetouchPanel({
  recipe,
  selectedIndex,
  onSelectIndex,
  onPatch,
  engineAvailable,
}: RetouchPanelProps) {
  const clones = recipe.clones ?? [];
  const selected: CloneStamp | undefined = clones[selectedIndex];

  const patchClones = (next: CloneStamp[], keys: string) =>
    onPatch({ clones: next.length > 0 ? next : undefined }, keys);

  const patchSelected = (stamp: CloneStamp, keys: string) =>
    patchClones(clones.map((s, i) => (i === selectedIndex ? stamp : s)), keys);

  return (
    <div className="px-4 py-3 space-y-2 w-full max-w-xl mx-auto">
      {!engineAvailable && (
        <p className="text-chip text-amber-300/90">
          Live preview isn&apos;t available on this device — retouches still apply on save.
        </p>
      )}

      {clones.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {clones.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelectIndex(i)}
                aria-pressed={i === selectedIndex}
                className={`${CHIP} ${
                  i === selectedIndex
                    ? 'bg-brand text-white font-semibold'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                Spot {i + 1}
              </button>
            ))}
          </div>
          {selected && (
            <button
              type="button"
              onClick={() => {
                patchClones(clones.filter((_, i) => i !== selectedIndex), 'clone.delete');
                onSelectIndex(Math.max(0, selectedIndex - 1));
              }}
              className={`${CHIP} text-white/70 bg-white/10 hover:bg-white/20 hover:text-white`}
            >
              Remove
            </button>
          )}
        </div>
      )}

      <p className="text-chip text-white/50">
        {clones.length >= MAX_CLONE_STAMPS
          ? `Up to ${MAX_CLONE_STAMPS} spots on a photo.`
          : 'Tap a spot on the photo to hide it. Drag the dashed circle to choose what covers it.'}
      </p>

      {selected && (
        <div className="space-y-1">
          <EditorSlider
            label="Size"
            value={Math.round(((selected.radius - 0.01) / 0.49) * 100)}
            min={0}
            onChange={ui =>
              patchSelected(
                { ...selected, radius: 0.01 + (ui / 100) * 0.49 },
                `clone.${selectedIndex}.radius`
              )
            }
          />
          <EditorSlider
            label="Soft edge"
            value={unsignedToUi(selected.feather)}
            min={0}
            onChange={ui =>
              patchSelected({ ...selected, feather: uiToUnsigned(ui) }, `clone.${selectedIndex}.feather`)
            }
          />
        </div>
      )}
    </div>
  );
}

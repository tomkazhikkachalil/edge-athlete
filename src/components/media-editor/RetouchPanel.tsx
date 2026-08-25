'use client';

/**
 * Clone-stamp panel (E4g): stamp list, Size/Feather for the selected
 * stamp, remove. Placement happens on the stage overlay (tap to drop,
 * drag circles); everything here routes through onPatch with per-control
 * history keys.
 */

import { MAX_CLONE_STAMPS } from '@/lib/media/engine/clone-math';
import { uiToUnsigned, unsignedToUi } from '@/lib/media/slider-scale';
import type { CloneStamp, ImageRecipe } from '@/lib/media/types';
import EditorSlider from './EditorSlider';

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
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {clones.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelectIndex(i)}
            className={`px-3 min-h-[36px] rounded-full text-chip whitespace-nowrap shrink-0 ${
              i === selectedIndex
                ? 'bg-brand text-white font-semibold'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
          >
            Spot {i + 1}
          </button>
        ))}
        {clones.length === 0 && (
          <p className="text-chip text-white/50">
            Tap a blemish or distraction on the photo — a copy circle appears; drag the dashed
            circle to choose where to copy from.
          </p>
        )}
        {clones.length >= MAX_CLONE_STAMPS && (
          <p className="text-chip text-white/50">Limit of {MAX_CLONE_STAMPS} spots reached.</p>
        )}
        {selected && (
          <button
            type="button"
            onClick={() => {
              patchClones(clones.filter((_, i) => i !== selectedIndex), 'clone.delete');
              onSelectIndex(Math.max(0, selectedIndex - 1));
            }}
            className="ml-auto px-3 min-h-[36px] rounded-full text-chip shrink-0 text-white/70 bg-white/10 hover:bg-white/20 hover:text-white"
          >
            Remove
          </button>
        )}
      </div>

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
            label="Feather"
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

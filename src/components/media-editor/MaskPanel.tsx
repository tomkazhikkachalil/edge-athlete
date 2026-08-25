'use client';

/**
 * Local-adjustment masks panel: mask list (add radial/linear up to 4,
 * select, delete), geometry sliders for the selected radial (size,
 * feather, invert), and the local Exposure / Saturation / Warmth sliders.
 * Geometry dragging happens on the stage overlay; everything here goes
 * through onPatch with per-control history keys.
 */

import {
  defaultLinearMask,
  defaultRadialMask,
  MAX_MASKS,
} from '@/lib/media/engine/mask-math';
import { signedToUi, uiToSigned, uiToUnsigned, unsignedToUi } from '@/lib/media/slider-scale';
import type { ImageRecipe, Mask, MaskAdjust } from '@/lib/media/types';
import EditorSlider from './EditorSlider';

interface MaskPanelProps {
  recipe: ImageRecipe;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onPatch: (patch: Partial<ImageRecipe>, keys: string) => void;
  engineAvailable: boolean;
}

export default function MaskPanel({
  recipe,
  selectedIndex,
  onSelectIndex,
  onPatch,
  engineAvailable,
}: MaskPanelProps) {
  const masks = recipe.masks ?? [];
  const selected: Mask | undefined = masks[selectedIndex];

  const patchMasks = (next: Mask[], keys: string) =>
    onPatch({ masks: next.length > 0 ? next : undefined }, keys);

  const addMask = (mask: Mask) => {
    const next = [...masks, mask];
    patchMasks(next, 'mask.add');
    onSelectIndex(next.length - 1);
  };

  const patchSelected = (mask: Mask, keys: string) =>
    patchMasks(masks.map((m, i) => (i === selectedIndex ? mask : m)), keys);

  const patchAdjust = (field: keyof MaskAdjust, ui: number) => {
    if (!selected) return;
    patchSelected(
      { ...selected, adjust: { ...selected.adjust, [field]: uiToSigned(ui) } },
      `mask.${selectedIndex}.${field}`
    );
  };

  return (
    <div className="px-4 py-3 space-y-2 w-full max-w-xl mx-auto">
      {!engineAvailable && (
        <p className="text-chip text-amber-300/90">
          Live preview isn&apos;t available on this device — masks still apply on save.
        </p>
      )}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {masks.map((mask, i) => (
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
            {mask.kind === 'radial' ? 'Radial' : 'Linear'} {i + 1}
          </button>
        ))}
        <button
          type="button"
          onClick={() => addMask(defaultRadialMask())}
          disabled={masks.length >= MAX_MASKS}
          className="px-3 min-h-[36px] rounded-full text-chip whitespace-nowrap shrink-0 bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-40"
        >
          + Radial
        </button>
        <button
          type="button"
          onClick={() => addMask(defaultLinearMask())}
          disabled={masks.length >= MAX_MASKS}
          className="px-3 min-h-[36px] rounded-full text-chip whitespace-nowrap shrink-0 bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-40"
        >
          + Linear
        </button>
        {selected && (
          <button
            type="button"
            onClick={() => {
              patchMasks(masks.filter((_, i) => i !== selectedIndex), 'mask.delete');
              onSelectIndex(Math.max(0, selectedIndex - 1));
            }}
            className="ml-auto px-3 min-h-[36px] rounded-full text-chip shrink-0 text-white/70 bg-white/10 hover:bg-white/20 hover:text-white"
          >
            Remove
          </button>
        )}
      </div>

      {!selected ? (
        <p className="text-chip text-white/50">
          Add a mask, then drag it into place on the photo and shape the light underneath it.
        </p>
      ) : (
        <div className="space-y-1 max-h-[32vh] overflow-y-auto">
          {selected.kind === 'radial' && (
            <>
              <EditorSlider
                label="Size"
                value={unsignedToUi(Math.min(1, selected.rx))}
                min={5}
                onChange={ui => {
                  const size = Math.max(0.05, uiToUnsigned(ui));
                  patchSelected({ ...selected, rx: size, ry: size }, `mask.${selectedIndex}.size`);
                }}
              />
              <EditorSlider
                label="Feather"
                value={unsignedToUi(selected.feather)}
                min={0}
                onChange={ui =>
                  patchSelected(
                    { ...selected, feather: uiToUnsigned(ui) },
                    `mask.${selectedIndex}.feather`
                  )
                }
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  aria-pressed={selected.invert}
                  onClick={() =>
                    patchSelected(
                      { ...selected, invert: !selected.invert },
                      `mask.${selectedIndex}.invert`
                    )
                  }
                  className={`px-3 min-h-[36px] rounded-full text-chip ${
                    selected.invert
                      ? 'bg-white/20 text-white font-semibold'
                      : 'bg-white/10 text-white/70 hover:bg-white/20'
                  }`}
                >
                  Invert
                </button>
              </div>
            </>
          )}
          <EditorSlider
            label="Exposure"
            value={signedToUi(selected.adjust.exposure)}
            onChange={ui => patchAdjust('exposure', ui)}
          />
          <EditorSlider
            label="Saturation"
            value={signedToUi(selected.adjust.saturation)}
            onChange={ui => patchAdjust('saturation', ui)}
          />
          <EditorSlider
            label="Warmth"
            value={signedToUi(selected.adjust.temperature)}
            onChange={ui => patchAdjust('temperature', ui)}
          />
        </div>
      )}
    </div>
  );
}

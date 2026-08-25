'use client';

/**
 * Local-adjustment masks panel: mask list (add radial/linear up to 4,
 * select, delete), geometry sliders for the selected radial (size,
 * feather, invert), and the local Exposure / Saturation / Warmth sliders.
 * Geometry dragging happens on the stage overlay; everything here goes
 * through onPatch with per-control history keys.
 */

import {
  defaultBrushMask,
  defaultLinearMask,
  defaultRadialMask,
  MAX_MASKS,
} from '@/lib/media/engine/mask-math';
import { signedToUi, uiToSigned, uiToUnsigned, unsignedToUi } from '@/lib/media/slider-scale';
import type { ImageRecipe, Mask, MaskAdjust } from '@/lib/media/types';
import EditorSlider from './EditorSlider';

/** Settings for the NEXT painted stroke (strokes carry their own copies). */
export interface BrushSettings {
  radius: number; // 0.01..0.5, fraction of image width
  feather: number; // 0..1
  erase: boolean;
}

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  radius: 0.06,
  feather: 0.5,
  erase: false,
};

const MASK_KIND_LABELS: Record<Mask['kind'], string> = {
  radial: 'Radial',
  linear: 'Linear',
  brush: 'Brush',
  data: 'Subject',
};

interface MaskPanelProps {
  recipe: ImageRecipe;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onPatch: (patch: Partial<ImageRecipe>, keys: string) => void;
  brushSettings: BrushSettings;
  onBrushSettingsChange: (settings: BrushSettings) => void;
  engineAvailable: boolean;
  /** Phase 3: AI subject selection — visible ONLY when a runner is
   *  configured (cost-gated; see docs/AI_RUNNER.md). */
  aiAvailable: boolean;
  aiBusy: boolean;
  onSelectSubject: () => void;
}

export default function MaskPanel({
  recipe,
  selectedIndex,
  onSelectIndex,
  onPatch,
  brushSettings,
  onBrushSettingsChange,
  engineAvailable,
  aiAvailable,
  aiBusy,
  onSelectSubject,
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
            {MASK_KIND_LABELS[mask.kind]} {i + 1}
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
        <button
          type="button"
          onClick={() => addMask(defaultBrushMask())}
          disabled={masks.length >= MAX_MASKS}
          className="px-3 min-h-[36px] rounded-full text-chip whitespace-nowrap shrink-0 bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-40"
        >
          + Brush
        </button>
        {aiAvailable && (
          <button
            type="button"
            onClick={onSelectSubject}
            disabled={aiBusy || masks.length >= MAX_MASKS}
            className="px-3 min-h-[36px] rounded-full text-chip whitespace-nowrap shrink-0 bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-40"
          >
            {aiBusy ? 'Finding subject…' : '✦ Select subject'}
          </button>
        )}
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
          {selected.kind === 'brush' && (
            <>
              <p className="text-chip text-white/50">
                Paint on the photo. Strokes keep the size and feather they were painted with.
              </p>
              <EditorSlider
                label="Brush size"
                value={Math.round(((brushSettings.radius - 0.01) / 0.49) * 100)}
                min={0}
                onChange={ui =>
                  onBrushSettingsChange({
                    ...brushSettings,
                    radius: 0.01 + (ui / 100) * 0.49,
                  })
                }
              />
              <EditorSlider
                label="Brush feather"
                value={unsignedToUi(brushSettings.feather)}
                min={0}
                onChange={ui =>
                  onBrushSettingsChange({ ...brushSettings, feather: uiToUnsigned(ui) })
                }
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  aria-pressed={brushSettings.erase}
                  onClick={() =>
                    onBrushSettingsChange({ ...brushSettings, erase: !brushSettings.erase })
                  }
                  className={`px-3 min-h-[36px] rounded-full text-chip ${
                    brushSettings.erase
                      ? 'bg-white/20 text-white font-semibold'
                      : 'bg-white/10 text-white/70 hover:bg-white/20'
                  }`}
                >
                  Erase
                </button>
              </div>
            </>
          )}
          {selected.kind === 'data' && (
            <>
              <EditorSlider
                label="Edge feather"
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
                  {selected.invert ? 'Background' : 'Subject'} — tap to flip
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
          <EditorSlider
            label="Blur"
            value={unsignedToUi(selected.adjust.blur ?? 0)}
            min={0}
            onChange={ui =>
              patchSelected(
                { ...selected, adjust: { ...selected.adjust, blur: uiToUnsigned(ui) } },
                `mask.${selectedIndex}.blur`
              )
            }
          />
        </div>
      )}
    </div>
  );
}

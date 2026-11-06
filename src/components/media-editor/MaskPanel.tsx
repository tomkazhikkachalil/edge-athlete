'use client';

/**
 * Masks: edit PART of the photo. To the person a mask is a Circle, a
 * Gradient, a painted area (Paint) or the AI-found Subject (Nov 6 2026,
 * plain words — the recipe kinds stay radial / linear / brush / data).
 *
 * Layout rule shared with Retouch and Text: the item chips scroll in their
 * own strip with Remove OUTSIDE it (always on screen), the add buttons on
 * their own row, then the selected item's controls under a one-line hint.
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
  radial: 'Circle',
  linear: 'Gradient',
  brush: 'Paint',
  data: 'Subject',
};

const MASK_HINTS: Record<Mask['kind'], string> = {
  radial: 'Drag the circle over the area to change.',
  linear: 'Drag the two ends: full effect at the filled dot, fading to none at the hollow one.',
  brush: 'Paint on the photo. Each stroke keeps its size and softness.',
  data: '',
};

const CHIP = 'px-3 min-h-[36px] rounded-full text-chip whitespace-nowrap shrink-0';
const CHIP_IDLE = `${CHIP} bg-white/10 text-white/70 hover:bg-white/20`;
const CHIP_ON = `${CHIP} bg-white/20 text-white font-semibold`;

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
  const full = masks.length >= MAX_MASKS;

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

      {masks.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {masks.map((mask, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelectIndex(i)}
                aria-pressed={i === selectedIndex}
                className={i === selectedIndex ? `${CHIP} bg-brand text-white font-semibold` : CHIP_IDLE}
              >
                {MASK_KIND_LABELS[mask.kind]} {i + 1}
              </button>
            ))}
          </div>
          {selected && (
            <button
              type="button"
              onClick={() => {
                patchMasks(masks.filter((_, i) => i !== selectedIndex), 'mask.delete');
                onSelectIndex(Math.max(0, selectedIndex - 1));
              }}
              className={`${CHIP_IDLE} hover:text-white`}
            >
              Remove
            </button>
          )}
        </div>
      )}

      {full ? (
        <p className="text-chip text-white/50">Up to {MAX_MASKS} masks on a photo.</p>
      ) : (
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          <button type="button" onClick={() => addMask(defaultRadialMask())} className={CHIP_IDLE}>
            + Circle
          </button>
          <button type="button" onClick={() => addMask(defaultLinearMask())} className={CHIP_IDLE}>
            + Gradient
          </button>
          <button type="button" onClick={() => addMask(defaultBrushMask())} className={CHIP_IDLE}>
            + Paint
          </button>
          {aiAvailable && (
            <button
              type="button"
              onClick={onSelectSubject}
              disabled={aiBusy}
              className={`${CHIP_IDLE} disabled:opacity-40`}
            >
              {aiBusy ? 'Finding subject…' : '✦ Subject'}
            </button>
          )}
        </div>
      )}

      {!selected ? (
        <p className="text-chip text-white/50">
          Edit part of the photo. Add a circle, a gradient or paint an area, then adjust what&apos;s
          inside it.
        </p>
      ) : (
        <div className="space-y-1 max-h-[32vh] overflow-y-auto">
          {MASK_HINTS[selected.kind] && (
            <p className="text-chip text-white/50">{MASK_HINTS[selected.kind]}</p>
          )}
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
                label="Soft edge"
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
                  title="Change everything outside the circle instead"
                  onClick={() =>
                    patchSelected(
                      { ...selected, invert: !selected.invert },
                      `mask.${selectedIndex}.invert`
                    )
                  }
                  className={selected.invert ? CHIP_ON : CHIP_IDLE}
                >
                  Outside
                </button>
              </div>
            </>
          )}
          {selected.kind === 'brush' && (
            <>
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
                label="Brush soft edge"
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
                  className={brushSettings.erase ? CHIP_ON : CHIP_IDLE}
                >
                  Erase
                </button>
              </div>
            </>
          )}
          {selected.kind === 'data' && (
            <>
              <EditorSlider
                label="Edge soft edge"
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
                  className={selected.invert ? CHIP_ON : CHIP_IDLE}
                >
                  {selected.invert ? 'Background' : 'Subject'} — tap to flip
                </button>
              </div>
            </>
          )}
          <p className="pt-1 text-chip font-semibold uppercase tracking-wide text-white/50">Effect</p>
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

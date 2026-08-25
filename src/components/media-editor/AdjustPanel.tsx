'use client';

/**
 * Grouped adjustment panel (engine round): Light | Color sub-tabs, one
 * thumb-reach group of sliders at a time so the panel stays bounded at
 * 320px. Detail (sharpen/clarity/NR) arrives with the blur passes.
 *
 * Legacy trio: Contrast and Saturation are the SAME recipe fields as v2
 * (adjustments.*) so old recipes keep their meaning; Brightness has no
 * slider anymore — Exposure supersedes it (old recipes still honor it).
 *
 * Every slider passes its own coalescing key so a drag is one undo step
 * per control (and, later, one labeled history entry).
 */

import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { NEUTRAL_COLOR, NEUTRAL_DETAIL, NEUTRAL_LIGHT } from '@/lib/media/filters';
import {
  legacyToUi,
  signedToUi,
  uiToLegacy,
  uiToSigned,
  uiToUnsigned,
  unsignedToUi,
} from '@/lib/media/slider-scale';
import type {
  ColorAdjustments,
  DetailAdjustments,
  ImageRecipe,
  LightAdjustments,
} from '@/lib/media/types';
import EditorSlider from './EditorSlider';

type Group = 'light' | 'color' | 'detail';

interface SliderDef {
  label: string;
  keys: string;
  /** Unsigned sliders (0..100) instead of the default ±100. */
  min?: number;
  get: (recipe: ImageRecipe) => number;
  patch: (recipe: ImageRecipe, ui: number) => Partial<ImageRecipe>;
}

function lightSlider(field: keyof LightAdjustments, label: string): SliderDef {
  return {
    label,
    keys: `light.${field}`,
    get: r => signedToUi(r.light[field]),
    patch: (r, ui) => ({ light: { ...r.light, [field]: uiToSigned(ui) } }),
  };
}

function colorSlider(field: keyof ColorAdjustments, label: string): SliderDef {
  return {
    label,
    keys: `color.${field}`,
    get: r => signedToUi(r.color[field]),
    patch: (r, ui) => ({ color: { ...r.color, [field]: uiToSigned(ui) } }),
  };
}

function detailSlider(
  field: Exclude<keyof DetailAdjustments, 'vignette'>,
  label: string
): SliderDef {
  return {
    label,
    keys: `detail.${field}`,
    min: 0,
    get: r => unsignedToUi(r.detail[field]),
    patch: (r, ui) => ({ detail: { ...r.detail, [field]: uiToUnsigned(ui) } }),
  };
}

function legacySlider(field: 'contrast' | 'saturation', label: string): SliderDef {
  return {
    label,
    keys: `adjustments.${field}`,
    get: r => legacyToUi(r.adjustments[field]),
    patch: (r, ui) => ({ adjustments: { ...r.adjustments, [field]: uiToLegacy(ui) } }),
  };
}

const GROUPS: Array<{ id: Group; label: string; sliders: SliderDef[] }> = [
  {
    id: 'light',
    label: 'Light',
    sliders: [
      lightSlider('exposure', 'Exposure'),
      legacySlider('contrast', 'Contrast'),
      lightSlider('highlights', 'Highlights'),
      lightSlider('shadows', 'Shadows'),
      lightSlider('whites', 'Whites'),
      lightSlider('blacks', 'Blacks'),
    ],
  },
  {
    id: 'color',
    label: 'Color',
    sliders: [
      colorSlider('temperature', 'Temperature'),
      colorSlider('tint', 'Tint'),
      colorSlider('vibrance', 'Vibrance'),
      legacySlider('saturation', 'Saturation'),
    ],
  },
  {
    id: 'detail',
    label: 'Detail',
    sliders: [
      detailSlider('sharpen', 'Sharpen'),
      detailSlider('clarity', 'Clarity'),
      detailSlider('noiseReduction', 'Noise reduction'),
      {
        label: 'Vignette',
        keys: 'detail.vignette',
        get: r => signedToUi(r.detail.vignette),
        patch: (r, ui) => ({ detail: { ...r.detail, vignette: uiToSigned(ui) } }),
      },
    ],
  },
];

interface AdjustPanelProps {
  recipe: ImageRecipe;
  onPatch: (patch: Partial<ImageRecipe>, keys: string) => void;
  /** One-tap auto-enhance (histogram targeting) — lands as ONE undo step. */
  onAutoEnhance: () => void;
  /** When false (no WebGL2), engine-only sliders are disabled with a notice
   *  — they'd show no live preview, though export would still apply them. */
  engineAvailable: boolean;
}

export default function AdjustPanel({ recipe, onPatch, onAutoEnhance, engineAvailable }: AdjustPanelProps) {
  const [group, setGroup] = useState<Group>('light');
  const active = GROUPS.find(g => g.id === group) ?? GROUPS[0];

  const resetGroup = () => {
    if (active.id === 'light') {
      onPatch(
        { light: { ...NEUTRAL_LIGHT }, adjustments: { ...recipe.adjustments, contrast: 1 } },
        'reset.light'
      );
    } else if (active.id === 'color') {
      onPatch(
        { color: { ...NEUTRAL_COLOR }, adjustments: { ...recipe.adjustments, saturation: 1 } },
        'reset.color'
      );
    } else {
      onPatch({ detail: { ...NEUTRAL_DETAIL } }, 'reset.detail');
    }
  };

  return (
    <div className="px-4 py-3 space-y-2 w-full max-w-xl mx-auto">
      <div className="flex items-center gap-2">
        {GROUPS.map(g => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGroup(g.id)}
            className={`px-3 min-h-[36px] rounded-full text-chip transition-colors ${
              active.id === g.id ? 'bg-white/20 text-white font-semibold' : 'text-white/60 hover:text-white'
            }`}
          >
            {g.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onAutoEnhance}
          aria-label="Auto-enhance"
          title="Auto-enhance"
          className="ml-auto w-9 h-9 flex items-center justify-center rounded-full text-white/70 bg-white/10 hover:bg-white/20 hover:text-white"
        >
          <Wand2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={resetGroup}
          className="px-3 min-h-[36px] rounded-full text-chip text-white/70 bg-white/10 hover:bg-white/20 hover:text-white"
        >
          Reset
        </button>
      </div>

      {!engineAvailable && (
        <p className="text-chip text-amber-300/90">
          Live preview for these controls isn&apos;t available on this device — Contrast and
          Saturation still preview, and every adjustment is applied on save.
        </p>
      )}

      <div className="space-y-1 max-h-[38vh] overflow-y-auto">
        {active.sliders.map(def => {
          const legacy = def.keys.startsWith('adjustments.');
          return (
            <div key={def.keys} className={!engineAvailable && !legacy ? 'opacity-40' : undefined}>
              <EditorSlider
                label={def.label}
                value={def.get(recipe)}
                min={def.min}
                onChange={ui => onPatch(def.patch(recipe, ui), def.keys)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

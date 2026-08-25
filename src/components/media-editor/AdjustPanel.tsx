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
import { Pipette, Wand2 } from 'lucide-react';
import { NEUTRAL_COLOR, NEUTRAL_DETAIL, NEUTRAL_LIGHT } from '@/lib/media/filters';
import { HSL_BAND_NAMES, NEUTRAL_BAND } from '@/lib/media/engine/hsl-math';
import { IDENTITY_CURVE } from '@/lib/media/engine/curves-math';
import CurveEditor from './CurveEditor';
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
  HslBandAdjust,
  HslBandName,
  ImageRecipe,
  LightAdjustments,
} from '@/lib/media/types';
import EditorSlider from './EditorSlider';

type Group = 'light' | 'color' | 'detail' | 'mix' | 'curves';

type CurveChannel = 'master' | 'r' | 'g' | 'b';

const CURVE_CHANNELS: Array<{ id: CurveChannel; label: string; color: string }> = [
  { id: 'master', label: 'RGB', color: '#f4f4f5' },
  { id: 'r', label: 'Red', color: '#f87171' },
  { id: 'g', label: 'Green', color: '#4ade80' },
  { id: 'b', label: 'Blue', color: '#60a5fa' },
];

// Chip swatches for the mixer bands (visual identity only — the math's
// band centers live in hsl-math.ts).
const BAND_SWATCHES: Record<HslBandName, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  aqua: '#06b6d4',
  blue: '#3b82f6',
  purple: '#a855f7',
  magenta: '#ec4899',
};

const BAND_LABELS: Record<HslBandName, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  aqua: 'Aqua',
  blue: 'Blue',
  purple: 'Purple',
  magenta: 'Magenta',
};

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
      {
        label: 'Grain',
        keys: 'grain.amount',
        min: 0,
        get: r => unsignedToUi(r.grain?.amount ?? 0),
        patch: (r, ui) => ({
          grain: { amount: uiToUnsigned(ui), size: r.grain?.size ?? 1.5 },
        }),
      },
      {
        label: 'Grain size',
        keys: 'grain.size',
        min: 0,
        // size 1..3 px ↔ 0..100 ui
        get: r => Math.round((((r.grain?.size ?? 1.5) - 1) / 2) * 100),
        patch: (r, ui) => ({
          grain: { amount: r.grain?.amount ?? 0, size: 1 + (ui / 100) * 2 },
        }),
      },
    ],
  },
  // 'mix' and 'curves' render their own UI — sliders don't apply.
  { id: 'mix', label: 'Mix', sliders: [] },
  { id: 'curves', label: 'Curves', sliders: [] },
];

interface AdjustPanelProps {
  recipe: ImageRecipe;
  onPatch: (patch: Partial<ImageRecipe>, keys: string) => void;
  /** One-tap auto-enhance (histogram targeting) — lands as ONE undo step. */
  onAutoEnhance: () => void;
  /** Arms the stage's white-balance eyedropper (Color group). */
  onWhiteBalancePick: () => void;
  /** True while the stage is waiting for the eyedropper click. */
  whiteBalancePicking: boolean;
  /** When false (no WebGL2), engine-only sliders are disabled with a notice
   *  — they'd show no live preview, though export would still apply them. */
  engineAvailable: boolean;
}

export default function AdjustPanel({
  recipe,
  onPatch,
  onAutoEnhance,
  onWhiteBalancePick,
  whiteBalancePicking,
  engineAvailable,
}: AdjustPanelProps) {
  const [group, setGroup] = useState<Group>('light');
  const [band, setBand] = useState<HslBandName>('red');
  const [curveChannel, setCurveChannel] = useState<CurveChannel>('master');
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
    } else if (active.id === 'mix') {
      onPatch({ hsl: undefined }, 'reset.hsl');
    } else if (active.id === 'curves') {
      onPatch({ curves: undefined }, 'reset.curves');
    } else {
      onPatch({ detail: { ...NEUTRAL_DETAIL } }, 'reset.detail');
    }
  };

  const bandAdjust: HslBandAdjust = recipe.hsl?.[band] ?? NEUTRAL_BAND;
  const patchBand = (field: keyof HslBandAdjust, ui: number) =>
    onPatch(
      { hsl: { ...recipe.hsl, [band]: { ...bandAdjust, [field]: uiToSigned(ui) } } },
      `hsl.${band}.${field}`
    );

  return (
    <div className="px-4 py-3 space-y-2 w-full max-w-xl mx-auto">
      <div className="flex items-center gap-2">
        {/* Five groups now — the chip row scrolls at 320px. */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide min-w-0 flex-1">
          {GROUPS.map(g => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroup(g.id)}
              className={`px-3 min-h-[36px] rounded-full text-chip transition-colors shrink-0 whitespace-nowrap ${
                active.id === g.id ? 'bg-white/20 text-white font-semibold' : 'text-white/60 hover:text-white'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onAutoEnhance}
          aria-label="Auto-enhance"
          title="Auto-enhance"
          className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full text-white/70 bg-white/10 hover:bg-white/20 hover:text-white"
        >
          <Wand2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={resetGroup}
          className="px-3 min-h-[36px] flex-shrink-0 rounded-full text-chip text-white/70 bg-white/10 hover:bg-white/20 hover:text-white"
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
        {active.id === 'curves' ? (
          <div className={!engineAvailable ? 'opacity-40' : undefined}>
            <div className="flex items-center gap-2 py-1">
              {CURVE_CHANNELS.map(ch => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => setCurveChannel(ch.id)}
                  aria-pressed={curveChannel === ch.id}
                  className={`px-3 min-h-[36px] rounded-full text-chip transition-colors ${
                    curveChannel === ch.id
                      ? 'bg-white/20 font-semibold'
                      : 'hover:bg-white/10'
                  }`}
                  style={{ color: ch.color }}
                >
                  {ch.label}
                </button>
              ))}
            </div>
            <CurveEditor
              points={recipe.curves?.[curveChannel] ?? IDENTITY_CURVE}
              color={CURVE_CHANNELS.find(ch => ch.id === curveChannel)?.color ?? '#f4f4f5'}
              onChange={pts =>
                onPatch(
                  { curves: { ...recipe.curves, [curveChannel]: pts } },
                  `curves.${curveChannel}`
                )
              }
            />
            <p className="text-chip text-white/40 pt-1">
              Tap the curve to add a point, drag to shape, double-tap a point to remove it.
            </p>
          </div>
        ) : active.id === 'mix' ? (
          <div className={!engineAvailable ? 'opacity-40' : undefined}>
            <div className="flex items-center gap-2 py-1 overflow-x-auto scrollbar-hide">
              {HSL_BAND_NAMES.map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setBand(name)}
                  aria-label={BAND_LABELS[name]}
                  aria-pressed={band === name}
                  title={BAND_LABELS[name]}
                  className={`w-8 h-8 rounded-full flex-shrink-0 transition-transform ${
                    band === name ? 'ring-2 ring-white scale-110' : 'ring-1 ring-white/20'
                  }`}
                  style={{ backgroundColor: BAND_SWATCHES[name] }}
                />
              ))}
            </div>
            <EditorSlider
              label="Hue"
              value={signedToUi(bandAdjust.hue)}
              onChange={ui => patchBand('hue', ui)}
            />
            <EditorSlider
              label="Saturation"
              value={signedToUi(bandAdjust.saturation)}
              onChange={ui => patchBand('saturation', ui)}
            />
            <EditorSlider
              label="Luminance"
              value={signedToUi(bandAdjust.luminance)}
              onChange={ui => patchBand('luminance', ui)}
            />
          </div>
        ) : (
          <>
            {active.id === 'color' && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onWhiteBalancePick}
                  aria-pressed={whiteBalancePicking}
                  aria-label="Pick white balance"
                  title="Tap something that should be neutral gray"
                  className={`px-3 min-h-[36px] rounded-full text-chip flex items-center gap-1.5 ${
                    whiteBalancePicking
                      ? 'bg-brand text-white font-semibold'
                      : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                  }`}
                >
                  <Pipette className="w-3.5 h-3.5" />
                  {whiteBalancePicking ? 'Tap a neutral…' : 'White balance'}
                </button>
              </div>
            )}
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
          </>
        )}
      </div>
    </div>
  );
}

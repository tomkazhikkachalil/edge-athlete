'use client';

/**
 * Photo crop, hands-on (Oct 2026): the person drags the crop box's corners
 * and edges to ANY area (CropCanvas), where the fixed-frame stage only
 * offered the ratio chips. The chips stay as shortcuts — "Free" is the
 * default and leaves the box free; a ratio snaps the box to that shape and
 * keeps it while it is resized. Rotate, flip and straighten live here too.
 *
 * Used by every surface that does not ENFORCE a ratio; the avatar, cover and
 * logo keep CropStage (a fixed frame the picture moves under).
 *
 * Geometry notes, each pinned in src/lib/media/crop-box.ts:
 *  - the box always stays on the picture, so straightening shrinks an
 *    untouched crop to the largest box that hides the wedges (and gives it
 *    back when the slider returns) — a crop the person shaped only shrinks
 *    when it has to;
 *  - a quarter turn carries the box with the picture;
 *  - flip is CSS here and innermost in the export, so the box does not move.
 */

import { useRef, useState } from 'react';
import { FlipHorizontal2, FlipVertical2, RotateCw } from 'lucide-react';
import {
  frameBounds,
  normalizeCrop,
  ratioCrop,
  refitCrop,
  rotateCropQuarter,
  type CropFrame,
  type Size,
} from '@/lib/media/crop-box';
import { parseAspectRatio } from '@/lib/media/crop-math';
import type { AspectRatioId, CropRect, EditorConfig, ImageRecipe } from '@/lib/media/types';
import CropCanvas from './CropCanvas';

export const RATIO_LABELS: Record<AspectRatioId, string> = {
  free: 'Free',
  '1:1': '1:1',
  '4:5': '4:5',
  '9:16': '9:16',
  '16:9': '16:9',
  '3:1': '3:1',
};

interface FreeCropStageProps {
  imageUrl: string;
  recipe: ImageRecipe;
  config: EditorConfig;
  /** Live adjustments+filter preview on the picture. */
  cssFilter: string;
  onPatch: (patch: Partial<ImageRecipe>, keys?: string) => void;
}

export default function FreeCropStage({
  imageUrl,
  recipe,
  config,
  cssFilter,
  onPatch,
}: FreeCropStageProps) {
  const [natural, setNatural] = useState<Size | null>(null);
  // The crop WE last derived from the whole picture (none, or the box that
  // straightening fitted), serialized. While the recipe's crop still equals
  // it, a straighten step re-derives it from the whole picture; a crop the
  // person shaped is only ever shrunk. Compared by value, so undo/redo can
  // never leave it describing a crop that is no longer there.
  const autoCropRef = useRef('null');
  const cropIsAuto = () => JSON.stringify(recipe.crop) === autoCropRef.current;

  const frame: CropFrame | null = natural
    ? { natural, rotate: recipe.rotate, straighten: recipe.straighten }
    : null;
  const aspect = parseAspectRatio(recipe.aspect);

  const storedCrop = (target: CropFrame, crop: CropRect | null): CropRect | null =>
    crop ? normalizeCrop(crop, target) : null;

  const chooseRatio = (id: AspectRatioId) => {
    if (!frame) {
      onPatch({ aspect: id });
      return;
    }
    const ratio = parseAspectRatio(id);
    if (ratio === null) {
      onPatch({ aspect: id, crop: recipe.crop }, 'aspect,crop');
      return;
    }
    const wasAuto = cropIsAuto();
    const crop = storedCrop(frame, ratioCrop(frame, ratio, wasAuto ? null : recipe.crop));
    if (wasAuto) autoCropRef.current = JSON.stringify(crop);
    onPatch({ aspect: id, crop }, 'aspect,crop');
  };

  const straightenTo = (degrees: number) => {
    if (!frame) return;
    const target = { ...frame, straighten: degrees };
    const wasAuto = cropIsAuto();
    const crop = storedCrop(target, refitCrop(wasAuto ? null : recipe.crop, target, aspect, frame));
    if (wasAuto) autoCropRef.current = JSON.stringify(crop);
    onPatch({ straighten: degrees, crop }, 'straighten');
  };

  const rotateQuarter = () => {
    const rotate = ((recipe.rotate + 90) % 360) as ImageRecipe['rotate'];
    if (!frame || !recipe.crop) {
      onPatch({ rotate }, 'rotate');
      return;
    }
    const target = { ...frame, rotate };
    const wasAuto = cropIsAuto();
    const turned = rotateCropQuarter(recipe.crop, frameBounds(frame));
    const crop = storedCrop(target, refitCrop(turned, target, null));
    if (wasAuto) autoCropRef.current = JSON.stringify(crop);
    onPatch({ rotate, crop }, 'rotate');
  };

  const reset = () => {
    if (!frame) return;
    const crop = storedCrop(frame, refitCrop(null, frame, aspect));
    autoCropRef.current = JSON.stringify(crop);
    onPatch({ crop }, 'crop.reset');
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <CropCanvas
        frame={frame}
        crop={recipe.crop}
        aspect={aspect}
        flipH={recipe.flipH}
        flipV={recipe.flipV}
        onCommit={(crop, keys) => onPatch({ crop }, keys)}
      >
        {mediaStyle => (
          // Raw <img>: a blob: object URL the optimizer cannot fetch.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            onLoad={e => {
              const size = {
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              };
              if (size.width === 0 || size.height === 0) return;
              setNatural(size);
              // A surface whose FIRST ratio is a real one (equipment: 1:1)
              // opens already cropped to it — the box on screen must be the
              // box that exports.
              if (recipe.crop === null && aspect !== null) {
                const loaded = { natural: size, rotate: recipe.rotate, straighten: recipe.straighten };
                const crop = storedCrop(loaded, refitCrop(null, loaded, aspect));
                if (crop) {
                  autoCropRef.current = JSON.stringify(crop);
                  onPatch({ crop }, 'aspect,crop');
                }
              }
            }}
            style={{ ...mediaStyle, ...(cssFilter ? { filter: cssFilter } : {}) }}
          />
        )}
      </CropCanvas>

      <div className="flex items-center gap-2 px-4 py-3 overflow-x-auto scrollbar-hide w-full max-w-xl mx-auto">
        {config.aspectRatios.map(id => (
          <button
            key={id}
            type="button"
            onClick={() => chooseRatio(id)}
            aria-pressed={recipe.aspect === id}
            className={`px-3 min-h-[44px] rounded-full text-chip font-medium whitespace-nowrap transition-colors ${
              recipe.aspect === id
                ? 'bg-brand text-white'
                : 'bg-white/10 text-white/80 hover:bg-white/20'
            }`}
          >
            {RATIO_LABELS[id]}
          </button>
        ))}
        {recipe.crop && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center px-3 min-h-[44px] rounded-full text-chip text-white/80 underline hover:text-white whitespace-nowrap"
          >
            Reset
          </button>
        )}
        <button
          type="button"
          onClick={rotateQuarter}
          aria-label="Rotate 90 degrees"
          className="ml-auto w-11 h-11 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 flex-shrink-0"
        >
          <RotateCw className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => onPatch({ flipH: !recipe.flipH }, 'flipH')}
          aria-label="Flip horizontally"
          aria-pressed={recipe.flipH}
          className={`w-11 h-11 flex items-center justify-center rounded-full flex-shrink-0 ${
            recipe.flipH ? 'bg-brand text-white' : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          <FlipHorizontal2 className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => onPatch({ flipV: !recipe.flipV }, 'flipV')}
          aria-label="Flip vertically"
          aria-pressed={recipe.flipV}
          className={`w-11 h-11 flex items-center justify-center rounded-full flex-shrink-0 ${
            recipe.flipV ? 'bg-brand text-white' : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          <FlipVertical2 className="w-5 h-5" />
        </button>
      </div>

      <div className="flex items-center gap-3 px-4 pb-3 w-full max-w-xl mx-auto">
        <span className="text-chip text-white/60 w-16">Straighten</span>
        <input
          type="range"
          min={-45}
          max={45}
          step={0.5}
          value={recipe.straighten}
          onChange={e => straightenTo(Number(e.target.value))}
          className="flex-1 accent-violet-500 min-h-[44px]"
          aria-label="Straighten angle"
        />
        <span className="text-chip text-white/60 w-10 text-right tabular-nums">
          {recipe.straighten.toFixed(1)}°
        </span>
      </div>
    </div>
  );
}

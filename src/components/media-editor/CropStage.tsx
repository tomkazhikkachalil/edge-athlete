'use client';

import { useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { RotateCw } from 'lucide-react';
import { parseAspectRatio, totalRotation } from '@/lib/media/crop-math';
import type { AspectRatioId, CropRect, EditorConfig, ImageRecipe } from '@/lib/media/types';

const RATIO_LABELS: Record<AspectRatioId, string> = {
  free: 'Original',
  '1:1': '1:1',
  '4:5': '4:5',
  '16:9': '16:9',
  '3:1': '3:1',
};

interface CropStageProps {
  imageUrl: string;
  recipe: ImageRecipe;
  config: EditorConfig;
  /** Live adjustments+filter preview on the cropper media. */
  cssFilter: string;
  onPatch: (patch: Partial<ImageRecipe>) => void;
}

/**
 * Crop tool: react-easy-crop stage (pinch/drag, touch-first) + ratio chips,
 * quarter-turn rotate, straighten slider. 'free' behaves as the image's own
 * ratio (react-easy-crop is fixed-aspect by design) — labeled "Original".
 */
export default function CropStage({ imageUrl, recipe, config, cssFilter, onPatch }: CropStageProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [naturalAspect, setNaturalAspect] = useState<number | null>(null);
  // Gate the initial auto-fired onCropComplete: an untouched 'free' crop must
  // keep recipe.crop null so no-op pass-through (original bytes) survives.
  const interactedRef = useRef(false);

  const ratioId = config.enforcedRatio ?? recipe.aspect;
  const aspect = parseAspectRatio(ratioId) ?? naturalAspect ?? 4 / 3;
  const ratioIsReal = config.enforcedRatio !== undefined || recipe.aspect !== 'free';

  const commitCrop = (pixels: CropRect) => {
    if (!interactedRef.current && !ratioIsReal && recipe.rotate === 0 && recipe.straighten === 0) {
      return; // untouched original-ratio frame — not an edit
    }
    onPatch({ crop: pixels });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="relative flex-1 min-h-0">
        <Cropper
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          rotation={totalRotation(recipe.rotate, recipe.straighten)}
          aspect={aspect}
          cropShape={config.circularPreview ? 'round' : 'rect'}
          showGrid={!config.circularPreview}
          initialCroppedAreaPixels={recipe.crop ?? undefined}
          onCropChange={next => {
            interactedRef.current = true;
            setCrop(next);
          }}
          onZoomChange={next => {
            interactedRef.current = true;
            setZoom(next);
          }}
          onCropComplete={(_area, pixels) => commitCrop(pixels)}
          onMediaLoaded={size => setNaturalAspect(size.naturalWidth / size.naturalHeight)}
          style={{ mediaStyle: cssFilter ? { filter: cssFilter } : undefined }}
        />
      </div>

      <div className="flex items-center gap-2 px-4 py-3 overflow-x-auto scrollbar-hide w-full max-w-xl mx-auto">
        {!config.enforcedRatio &&
          config.aspectRatios.map(id => (
            <button
              key={id}
              type="button"
              onClick={() => {
                interactedRef.current = true;
                onPatch({ aspect: id });
              }}
              className={`px-3 min-h-[36px] rounded-full text-chip font-medium whitespace-nowrap transition-colors ${
                recipe.aspect === id
                  ? 'bg-brand text-white'
                  : 'bg-white/10 text-white/80 hover:bg-white/20'
              }`}
            >
              {RATIO_LABELS[id]}
            </button>
          ))}
        <button
          type="button"
          onClick={() => {
            interactedRef.current = true;
            onPatch({ rotate: ((recipe.rotate + 90) % 360) as ImageRecipe['rotate'] });
          }}
          aria-label="Rotate 90 degrees"
          className="ml-auto w-11 h-11 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 flex-shrink-0"
        >
          <RotateCw className="w-5 h-5" />
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
          onChange={e => {
            interactedRef.current = true;
            onPatch({ straighten: Number(e.target.value) });
          }}
          className="flex-1 accent-blue-500 min-h-[44px]"
          aria-label="Straighten angle"
        />
        <span className="text-chip text-white/60 w-10 text-right tabular-nums">
          {recipe.straighten.toFixed(1)}°
        </span>
      </div>
    </div>
  );
}

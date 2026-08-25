'use client';

/**
 * Aspect reframe for video — react-easy-crop's native video mode + the same
 * ratio chips as the image crop stage (no rotate/straighten for video v1).
 * Commits recipe.crop in source display pixels; an untouched 'free' frame
 * keeps crop null so a no-op recipe stays a pass-through.
 */

import { useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { parseAspectRatio } from '@/lib/media/crop-math';
import type { AspectRatioId, CropRect, EditorConfig, VideoRecipe } from '@/lib/media/types';

const RATIO_LABELS: Record<AspectRatioId, string> = {
  free: 'Original',
  '1:1': '1:1',
  '4:5': '4:5',
  '9:16': '9:16',
  '16:9': '16:9',
  '3:1': '3:1',
};

interface VideoCropStageProps {
  videoUrl: string;
  recipe: VideoRecipe;
  config: EditorConfig;
  onPatch: (patch: Partial<VideoRecipe>) => void;
}

export default function VideoCropStage({ videoUrl, recipe, config, onPatch }: VideoCropStageProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [naturalAspect, setNaturalAspect] = useState<number | null>(null);
  // Gate the initial auto-fired onCropComplete (CropStage precedent): an
  // untouched 'free' frame must keep recipe.crop null.
  const interactedRef = useRef(false);

  const aspect = parseAspectRatio(recipe.aspect) ?? naturalAspect ?? 16 / 9;

  const commitCrop = (pixels: CropRect) => {
    if (!interactedRef.current && recipe.aspect === 'free') return;
    onPatch({ crop: pixels });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="relative flex-1 min-h-0">
        <Cropper
          video={videoUrl}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          showGrid
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
        />
      </div>

      <div className="flex items-center gap-2 px-4 py-3 overflow-x-auto scrollbar-hide w-full max-w-xl mx-auto">
        {config.aspectRatios.map(id => (
          <button
            key={id}
            type="button"
            onClick={() => {
              interactedRef.current = true;
              onPatch({ aspect: id });
            }}
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
            onClick={() => onPatch({ crop: null, aspect: 'free' })}
            className="ml-auto inline-flex items-center px-3 min-h-[44px] rounded-full text-chip text-white/80 underline hover:text-white whitespace-nowrap"
          >
            Clear crop
          </button>
        )}
      </div>
    </div>
  );
}

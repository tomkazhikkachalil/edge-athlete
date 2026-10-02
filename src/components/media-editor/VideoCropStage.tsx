'use client';

/**
 * Reframe for video — the same hands-on crop box as photos (CropCanvas): drag
 * the corners and edges to any area, with the ratio chips as shortcuts. No
 * rotate / straighten for video. Commits recipe.crop in source display
 * pixels; the whole frame is stored as null, so an untouched video stays a
 * pass-through.
 */

import { useState } from 'react';
import { normalizeCrop, ratioCrop, type CropFrame, type Size } from '@/lib/media/crop-box';
import { parseAspectRatio } from '@/lib/media/crop-math';
import type { AspectRatioId, EditorConfig, VideoRecipe } from '@/lib/media/types';
import CropCanvas from './CropCanvas';
import { RATIO_LABELS } from './FreeCropStage';

interface VideoCropStageProps {
  videoUrl: string;
  recipe: VideoRecipe;
  config: EditorConfig;
  onPatch: (patch: Partial<VideoRecipe>, keys?: string) => void;
}

export default function VideoCropStage({ videoUrl, recipe, config, onPatch }: VideoCropStageProps) {
  const [natural, setNatural] = useState<Size | null>(null);
  const frame: CropFrame | null = natural ? { natural, rotate: 0, straighten: 0 } : null;
  const aspect = parseAspectRatio(recipe.aspect);

  const chooseRatio = (id: AspectRatioId) => {
    const ratio = parseAspectRatio(id);
    if (!frame || ratio === null) {
      onPatch({ aspect: id, crop: recipe.crop }, 'aspect,crop');
      return;
    }
    onPatch(
      { aspect: id, crop: normalizeCrop(ratioCrop(frame, ratio, recipe.crop), frame) },
      'aspect,crop'
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <CropCanvas
        frame={frame}
        crop={recipe.crop}
        aspect={aspect}
        onCommit={(crop, keys) => onPatch({ crop }, keys)}
      >
        {mediaStyle => (
          <video
            src={videoUrl}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={e => {
              const size = {
                width: e.currentTarget.videoWidth,
                height: e.currentTarget.videoHeight,
              };
              if (size.width > 0 && size.height > 0) setNatural(size);
            }}
            style={mediaStyle}
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
            onClick={() => onPatch({ crop: null, aspect: 'free' }, 'crop.reset')}
            className="ml-auto inline-flex items-center px-3 min-h-[44px] rounded-full text-chip text-white/80 underline hover:text-white whitespace-nowrap"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { FlipHorizontal2, FlipVertical2, RotateCw } from 'lucide-react';
import { isFullFrameCrop, parseAspectRatio, scaleRect, totalRotation } from '@/lib/media/crop-math';
import { MAX_CANVAS_DIM } from '@/lib/media/limits';
import type { AspectRatioId, CropRect, EditorConfig, ImageRecipe } from '@/lib/media/types';

const RATIO_LABELS: Record<AspectRatioId, string> = {
  free: 'Original',
  '1:1': '1:1',
  '4:5': '4:5',
  '9:16': '9:16',
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

  // Flip round: react-easy-crop can't mirror its media (it owns the media
  // transform), so a flipped session crops a DERIVED flipped object URL.
  // Flip is innermost in the export chain, so flipped-image space IS export
  // space — crop coords need no translation, only the k rescale when the
  // derived image had to shrink under the iOS canvas cap.
  // The state carries WHICH flip it was rendered for; render gates on the
  // match, so stale (revoked-URL) entries are never read and no synchronous
  // reset is needed when flips toggle.
  const [flipped, setFlipped] = useState<{
    url: string;
    scale: number;
    forH: boolean;
    forV: boolean;
  } | null>(null);
  const isFlipped = recipe.flipH || recipe.flipV;
  const flippedActive =
    isFlipped && flipped && flipped.forH === recipe.flipH && flipped.forV === recipe.flipV
      ? flipped
      : null;
  useEffect(() => {
    if (!recipe.flipH && !recipe.flipV) return;
    let cancelled = false;
    let mintedUrl: string | null = null;
    (async () => {
      try {
        const img = new Image();
        img.src = imageUrl;
        await img.decode(); // EXIF-oriented, same space as the export decode
        const k = Math.min(1, MAX_CANVAS_DIM / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.translate(recipe.flipH ? canvas.width : 0, recipe.flipV ? canvas.height : 0);
        ctx.scale(recipe.flipH ? -1 : 1, recipe.flipV ? -1 : 1);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve =>
          canvas.toBlob(resolve, 'image/jpeg', 0.92)
        );
        canvas.width = 0;
        canvas.height = 0;
        if (!blob || cancelled) return;
        mintedUrl = URL.createObjectURL(blob);
        setFlipped({ url: mintedUrl, scale: k, forH: recipe.flipH, forV: recipe.flipV });
      } catch {
        // Preview stays unflipped; export still applies the flip.
      }
    })();
    return () => {
      cancelled = true;
      if (mintedUrl) URL.revokeObjectURL(mintedUrl);
    };
  }, [imageUrl, recipe.flipH, recipe.flipV]);
  const flipScale = flippedActive?.scale ?? 1;

  const ratioId = config.enforcedRatio ?? recipe.aspect;
  const aspect = parseAspectRatio(ratioId) ?? naturalAspect ?? 4 / 3;
  const ratioIsReal = config.enforcedRatio !== undefined || recipe.aspect !== 'free';
  // Natural size of the DISPLAYED media (the flipped derivative when
  // flipped) — same space as croppedAreaPixels, for the full-frame check.
  const naturalSizeRef = useRef<{ width: number; height: number } | null>(null);

  const commitCrop = (pixels: CropRect) => {
    // Full-frame crops of an unrotated free-ratio frame are not edits —
    // react-easy-crop auto-emits one on every mount/media-load, and
    // committing it dirtied untouched sessions and polluted history with
    // no-op "Crop" entries. Zooming back OUT to full frame clears a real
    // crop instead of storing a redundant one.
    const naturalSize = naturalSizeRef.current;
    if (
      naturalSize &&
      !ratioIsReal &&
      recipe.rotate === 0 &&
      recipe.straighten === 0 &&
      isFullFrameCrop(pixels, naturalSize)
    ) {
      if (recipe.crop !== null) onPatch({ crop: null });
      return;
    }
    if (
      !interactedRef.current &&
      !ratioIsReal &&
      recipe.rotate === 0 &&
      recipe.straighten === 0 &&
      !isFlipped
    ) {
      return; // untouched original-ratio frame — not an edit
    }
    onPatch({ crop: flipScale === 1 ? pixels : scaleRect(pixels, 1 / flipScale) });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="relative flex-1 min-h-0">
        <Cropper
          image={flippedActive ? flippedActive.url : imageUrl}
          crop={crop}
          zoom={zoom}
          rotation={totalRotation(recipe.rotate, recipe.straighten)}
          aspect={aspect}
          cropShape={config.circularPreview ? 'round' : 'rect'}
          showGrid={!config.circularPreview}
          initialCroppedAreaPixels={
            recipe.crop ? (flipScale === 1 ? recipe.crop : scaleRect(recipe.crop, flipScale)) : undefined
          }
          onCropChange={next => {
            interactedRef.current = true;
            setCrop(next);
          }}
          onZoomChange={next => {
            interactedRef.current = true;
            setZoom(next);
          }}
          onCropComplete={(_area, pixels) => commitCrop(pixels)}
          onMediaLoaded={size => {
            naturalSizeRef.current = { width: size.naturalWidth, height: size.naturalHeight };
            setNaturalAspect(size.naturalWidth / size.naturalHeight);
          }}
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
              className={`px-3 min-h-[44px] rounded-full text-chip font-medium whitespace-nowrap transition-colors ${
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
        <button
          type="button"
          onClick={() => {
            interactedRef.current = true;
            onPatch({ flipH: !recipe.flipH });
          }}
          aria-label="Flip horizontally"
          className={`w-11 h-11 flex items-center justify-center rounded-full flex-shrink-0 ${
            recipe.flipH ? 'bg-brand text-white' : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          <FlipHorizontal2 className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            interactedRef.current = true;
            onPatch({ flipV: !recipe.flipV });
          }}
          aria-label="Flip vertically"
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
          onChange={e => {
            interactedRef.current = true;
            onPatch({ straighten: Number(e.target.value) });
          }}
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

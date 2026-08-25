'use client';

/**
 * Keystone correction — two sliders over the live engine stage. The warp
 * applies to the FRAMED image (after crop), so leaning verticals get
 * straightened and the exposed edges render black; cropping afterwards is
 * the expected finish (same trade Lightroom shows before its auto-crop).
 */

import { NEUTRAL_PERSPECTIVE } from '@/lib/media/engine/perspective-math';
import { signedToUi, uiToSigned } from '@/lib/media/slider-scale';
import type { ImageRecipe } from '@/lib/media/types';
import EditorSlider from './EditorSlider';

interface PerspectivePanelProps {
  recipe: ImageRecipe;
  onPatch: (patch: Partial<ImageRecipe>, keys: string) => void;
  engineAvailable: boolean;
}

export default function PerspectivePanel({ recipe, onPatch, engineAvailable }: PerspectivePanelProps) {
  const perspective = recipe.perspective ?? NEUTRAL_PERSPECTIVE;
  return (
    <div className="px-4 py-3 space-y-1 w-full max-w-xl mx-auto">
      {!engineAvailable && (
        <p className="text-chip text-amber-300/90">
          Live preview isn&apos;t available on this device — the correction is still applied on
          save.
        </p>
      )}
      <EditorSlider
        label="Vertical"
        value={signedToUi(perspective.vertical)}
        onChange={ui =>
          onPatch(
            { perspective: { ...perspective, vertical: uiToSigned(ui) } },
            'perspective.vertical'
          )
        }
      />
      <EditorSlider
        label="Horizontal"
        value={signedToUi(perspective.horizontal)}
        onChange={ui =>
          onPatch(
            { perspective: { ...perspective, horizontal: uiToSigned(ui) } },
            'perspective.horizontal'
          )
        }
      />
      <p className="text-chip text-white/40">
        Straightens leaning lines. Exposed edges turn black — crop afterwards to taste.
      </p>
    </div>
  );
}

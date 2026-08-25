'use client';

/**
 * Live WebGL preview for the adjust/filter tabs. The source texture is
 * uploaded ONCE per (file, geometry) — every slider move is a uniforms-only
 * redraw coalesced to one requestAnimationFrame, which is what makes the
 * sliders feel instant regardless of image size.
 *
 * Shows the recipe's real geometry (crop/rotate/flip) — an upgrade over the
 * old <img> preview, which always showed the uncropped frame.
 *
 * Fallback ladder: no WebGL2, context loss, or a decode failure drops to
 * the legacy <img> + CSS filter (trio only) — export stays fully correct
 * via the reference pixel loop either way.
 *
 * GL lifecycle is EFFECT-owned with symmetric cleanup (same StrictMode
 * doctrine as useEditorSession's object URLs — doubly important here since
 * browsers cap ~16 live WebGL contexts).
 */

import { useEffect, useRef, useState } from 'react';
import { cssFilterString } from '@/lib/media/filters';
import { decodeImage } from '@/lib/media/decode';
import { PREVIEW_MAX_DIM } from '@/lib/media/limits';
import { releaseCanvas, renderGeometry } from '@/lib/media/render';
import { createEngine, type Engine } from '@/lib/media/engine/engine';
import { recipeToEngineParams, type EngineParams } from '@/lib/media/engine/params';
import type { ImageRecipe } from '@/lib/media/types';

interface EnginePreviewProps {
  file: File;
  recipe: ImageRecipe;
  /** Object URL of the source file, for the no-WebGL <img> fallback. */
  fallbackUrl: string;
  /** Hold-to-compare: true renders the untouched source. */
  showOriginal?: boolean;
}

export default function EnginePreview({ file, recipe, fallbackUrl, showOriginal }: EnginePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const rafRef = useRef(0);
  const params = recipeToEngineParams(recipe);
  const paramsRef = useRef<EngineParams>(params);
  const showOriginalRef = useRef(!!showOriginal);
  const recipeRef = useRef(recipe);
  const [fallback, setFallback] = useState(false);
  const [ready, setReady] = useState(false);

  // Geometry identity — texture re-upload only when this changes.
  const geometryKey = JSON.stringify([
    recipe.crop,
    recipe.rotate,
    recipe.straighten,
    recipe.flipH,
    recipe.flipV,
  ]);

  const scheduleDraw = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      engineRef.current?.draw(paramsRef.current, { showOriginal: showOriginalRef.current });
    });
  };

  // Declared BEFORE the geometry effect so refs are current when it runs.
  useEffect(() => {
    recipeRef.current = recipe;
    paramsRef.current = params;
    showOriginalRef.current = !!showOriginal;
    scheduleDraw();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const engine = createEngine(
      canvas,
      () => {
        if (!cancelled) setFallback(true);
      },
      // StrictMode remounts reuse this canvas node — the context must
      // survive destroy or the second mount inherits a dead context.
      { keepContextOnDestroy: true }
    );
    if (!engine) {
      // Engine creation needs the mounted canvas — no-WebGL2 is only
      // discoverable here.
      setFallback(true);
      return;
    }
    engineRef.current = engine;
    (async () => {
      try {
        const decoded = await decodeImage(file);
        if (cancelled) {
          decoded.close();
          return;
        }
        const stage = renderGeometry(decoded, recipeRef.current, PREVIEW_MAX_DIM);
        decoded.close();
        engine.setSource(stage, stage.width, stage.height);
        releaseCanvas(stage);
        if (!cancelled) {
          engine.draw(paramsRef.current, { showOriginal: showOriginalRef.current });
          setReady(true);
        }
      } catch (err) {
        console.warn('Engine preview decode failed, using image fallback:', err);
        if (!cancelled) setFallback(true);
      }
    })();
    return () => {
      cancelled = true;
      engineRef.current = null;
      engine.destroy();
    };
    // geometryKey covers every recipe field this effect reads (via recipeRef).
  }, [file, geometryKey, fallback]);

  // Cancel MUST also zero the ref: a canceled frame never runs the callback
  // that resets it, and StrictMode's remount would then see the stale id and
  // skip every future draw (scheduleDraw's coalescing guard).
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    },
    []
  );

  if (fallback) {
    const filter = cssFilterString(params.adjustments);
    return (
      // Raw <img>: blob: object URL the optimizer cannot fetch; the live
      // style={{filter}} IS the (reduced) preview on no-WebGL devices.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={fallbackUrl}
        alt="Preview"
        style={filter && !showOriginal ? { filter } : undefined}
        className="max-w-full max-h-full object-contain"
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-label="Preview"
      className={`max-w-full max-h-full object-contain ${ready ? '' : 'invisible'}`}
    />
  );
}

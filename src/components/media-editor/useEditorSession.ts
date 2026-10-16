'use client';

/**
 * Editor-internal state: the working asset list (grows when a video is
 * split), one recipe per asset (rehydrated from `asset.recipe` on re-edit),
 * and the preview object URLs.
 *
 * Preview URLs are EFFECT-owned, never render-owned: each mount mints its
 * own map and the cleanup revokes exactly that map. A render-time useMemo
 * here breaks under React StrictMode (dev): its simulated mount→unmount→
 * remount runs the cleanup (revoking the URLs) while the memo keeps the
 * same map — every view mounted after that points at dead blob: URLs.
 */

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { HEIF_SNIFF_BYTES, isHeifCandidate } from '@/lib/media/heic-brand';
import { defaultImageRecipe, defaultVideoRecipe } from '@/lib/media/recipes';
import { emptyHistory, jumpTo, push, undo, redo, type History } from '@/lib/media/history';
import type { EditRecipe, ImageRecipe, MediaAsset } from '@/lib/media/types';

function seedRecipe(asset: MediaAsset, defaultAspect: ImageRecipe['aspect']): EditRecipe {
  return (
    asset.recipe ??
    (asset.kind === 'image' ? defaultImageRecipe(defaultAspect) : defaultVideoRecipe())
  );
}

export function useEditorSession(
  initialAssets: MediaAsset[],
  defaultAspect: ImageRecipe['aspect']
) {
  const [assets, setAssets] = useState<MediaAsset[]>(initialAssets);
  const [recipes, setRecipes] = useState<Record<string, EditRecipe>>(() => {
    const initial: Record<string, EditRecipe> = {};
    for (const asset of initialAssets) initial[asset.id] = seedRecipe(asset, defaultAspect);
    return initial;
  });

  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(() => new Map());
  // A video's cover chosen as a PHOTO (video posters PR 4): session state —
  // the File never enters the recipe (which persists); the recipe only
  // remembers that the cover was a photo (`poster: { kind: 'photo' }`).
  const [covers, setCovers] = useState<Record<string, File | null>>({});

  // MUST stay effect-owned — do not "optimise" this into a useMemo. Render-
  // owned object URLs were revoked by StrictMode's mount→unmount→remount
  // while the memo kept the dead map, blanking images on tab switch (DEVLOG,
  // July 26). Each mount mints its own URLs and its own cleanup revokes them.
  // A LAYOUT effect (Oct 15 2026, photo → editor speed): the URL lands in
  // the same commit, before the first paint, so the stage never paints a
  // frame empty and the picture's decode starts one frame sooner.
  useLayoutEffect(() => {
    const map = new Map(assets.map(asset => [asset.id, URL.createObjectURL(asset.file)]));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviewUrls(map);
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
    };
  }, [assets]);

  // A HEIC the browser cannot paint (Samsung's "high efficiency" photos in
  // Chrome on Android — Safari decodes them itself) used to leave the crop
  // stage blank: the stage is a plain <img>, and the WebAssembly decoder only
  // ran at export. Now the session converts it to a JPEG up front, ONLY when
  // the native decode fails, and swaps the asset's file under the same id
  // (recipes are keyed by id; the URLs re-mint with the assets). Oct 15 2026.
  const [preparing, setPreparing] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    for (const asset of initialAssets) {
      if (asset.kind !== 'image') continue;
      void (async () => {
        const head = new Uint8Array(await asset.file.slice(0, HEIF_SNIFF_BYTES).arrayBuffer());
        if (!isHeifCandidate(asset.file.type, head)) return;
        try {
          (await createImageBitmap(asset.file)).close();
          return; // this browser paints HEIC itself
        } catch {
          // fall through to the WebAssembly decoder
        }
        if (cancelled) return;
        setPreparing(prev => new Set(prev).add(asset.id));
        try {
          const { decodeHeicToJpeg } = await import('@/lib/media/heic-decode');
          const jpeg = await decodeHeicToJpeg(asset.file);
          if (!cancelled) setAssets(prev => prev.map(a => (a.id === asset.id ? { ...a, file: jpeg } : a)));
        } catch (err) {
          console.warn('[editor] HEIC could not be converted for the stage:', err);
        } finally {
          if (!cancelled) setPreparing(prev => { const next = new Set(prev); next.delete(asset.id); return next; });
        }
      })();
    }
    return () => { cancelled = true; };
    // Once per session: the assets the editor opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per-asset undo/redo over whole-recipe snapshots. The coalescing key is
  // the patch's key set, so a slider drag (many same-key patches) is ONE
  // undo step back to the pre-drag recipe. Recipe-level only — asset ops
  // (split) are not undoable yet.
  const [histories, setHistories] = useState<Record<string, History<EditRecipe>>>({});

  // `keys` overrides the coalescing signature — sliders pass a per-control
  // key ('light.exposure') because their patches share a top-level field
  // ('light'), and the default would wrongly coalesce different sliders in
  // the same group into one undo step.
  const patchRecipe = (id: string, patch: Partial<EditRecipe>, keys?: string) => {
    setRecipes(prev => {
      const current = prev[id];
      return { ...prev, [id]: { ...current, ...patch } as EditRecipe };
    });
    const signature = keys ?? Object.keys(patch).sort().join(',');
    setHistories(prev => ({
      ...prev,
      [id]: push(prev[id] ?? emptyHistory<EditRecipe>(), recipes[id], signature),
    }));
  };

  const undoRecipe = (id: string) => {
    const result = undo(histories[id] ?? emptyHistory<EditRecipe>(), recipes[id]);
    if (!result) return;
    setHistories(prev => ({ ...prev, [id]: result.history }));
    setRecipes(prev => ({ ...prev, [id]: result.value }));
  };

  const redoRecipe = (id: string) => {
    const result = redo(histories[id] ?? emptyHistory<EditRecipe>(), recipes[id]);
    if (!result) return;
    setHistories(prev => ({ ...prev, [id]: result.history }));
    setRecipes(prev => ({ ...prev, [id]: result.value }));
  };

  const canUndo = (id: string) => (histories[id]?.past.length ?? 0) > 0;
  const canRedo = (id: string) => (histories[id]?.future.length ?? 0) > 0;

  /** History rail: restore any timeline index (pure jumpTo underneath). */
  const jumpToRecipe = (id: string, index: number) => {
    const result = jumpTo(histories[id] ?? emptyHistory<EditRecipe>(), recipes[id], index);
    if (!result) return;
    setHistories(prev => ({ ...prev, [id]: result.history }));
    setRecipes(prev => ({ ...prev, [id]: result.value }));
  };

  const historyFor = (id: string): History<EditRecipe> =>
    histories[id] ?? emptyHistory<EditRecipe>();

  /** Split support: insert a new asset right after its sibling, with its recipe. */
  const addAsset = (asset: MediaAsset, afterId?: string) => {
    setRecipes(prev => ({ ...prev, [asset.id]: seedRecipe(asset, defaultAspect) }));
    setAssets(prev => {
      const index = afterId ? prev.findIndex(a => a.id === afterId) : -1;
      if (index === -1) return [...prev, asset];
      return [...prev.slice(0, index + 1), asset, ...prev.slice(index + 1)];
    });
  };

  const setCover = useCallback((id: string, file: File | null) => {
    setCovers(prev => ({ ...prev, [id]: file }));
    setRecipes(prev => {
      const current = prev[id];
      if (!current || current.kind !== 'video') return prev;
      const { poster: _poster, ...rest } = current; // eslint-disable-line @typescript-eslint/no-unused-vars
      return { ...prev, [id]: file ? { ...current, poster: { kind: 'photo' } } : (rest as typeof current) };
    });
  }, []);

  return {
    assets,
    /** Assets being converted for the stage (a HEIC the browser cannot paint). */
    preparing,
    recipes,
    patchRecipe,
    addAsset,
    previewUrls,
    covers,
    setCover,
    undoRecipe,
    redoRecipe,
    canUndo,
    canRedo,
    jumpToRecipe,
    historyFor,
  };
}

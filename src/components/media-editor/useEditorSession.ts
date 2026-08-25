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

import { useEffect, useState } from 'react';
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

  // MUST stay effect-owned — do not "optimise" this into a useMemo. Render-
  // owned object URLs were revoked by StrictMode's mount→unmount→remount
  // while the memo kept the dead map, blanking images on tab switch (DEVLOG,
  // July 26). Each mount mints its own URLs and its own cleanup revokes them;
  // the one-render empty gap is why the crop stage renders nothing until a
  // URL exists.
  useEffect(() => {
    const map = new Map(assets.map(asset => [asset.id, URL.createObjectURL(asset.file)]));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviewUrls(map);
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
    };
  }, [assets]);

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

  return {
    assets,
    recipes,
    patchRecipe,
    addAsset,
    previewUrls,
    undoRecipe,
    redoRecipe,
    canUndo,
    canRedo,
    jumpToRecipe,
    historyFor,
  };
}

'use client';

/**
 * Editor-internal state: one recipe per asset (rehydrated from
 * `asset.recipe` on re-edit) and the preview object URLs, revoked on
 * unmount. Recipes are in-memory only — see src/lib/media/recipes.ts.
 */

import { useEffect, useState } from 'react';
import { defaultImageRecipe, defaultVideoRecipe } from '@/lib/media/recipes';
import type { EditRecipe, ImageRecipe, MediaAsset } from '@/lib/media/types';

export function useEditorSession(assets: MediaAsset[], defaultAspect: ImageRecipe['aspect']) {
  const [recipes, setRecipes] = useState<Record<string, EditRecipe>>(() => {
    const initial: Record<string, EditRecipe> = {};
    for (const asset of assets) {
      initial[asset.id] =
        asset.recipe ??
        (asset.kind === 'image' ? defaultImageRecipe(defaultAspect) : defaultVideoRecipe());
    }
    return initial;
  });

  // Preview URLs are EFFECT-owned, never render-owned: each mount mints its
  // own map and the cleanup revokes exactly that map. A render-time useMemo
  // here breaks under React StrictMode (dev): its simulated mount→unmount→
  // remount runs the cleanup (revoking the URLs) while the memo keeps the
  // same map — every view mounted after that points at dead blob: URLs
  // (the "image disappears when switching tabs on localhost" bug).
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    const map = new Map(assets.map(asset => [asset.id, URL.createObjectURL(asset.file)]));
    setPreviewUrls(map);
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
    };
  }, [assets]);

  const patchRecipe = (id: string, patch: Partial<EditRecipe>) => {
    setRecipes(prev => ({ ...prev, [id]: { ...prev[id], ...patch } as EditRecipe }));
  };

  return { recipes, patchRecipe, previewUrls };
}

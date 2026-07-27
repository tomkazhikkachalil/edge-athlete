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

  /** Split support: insert a new asset right after its sibling, with its recipe. */
  const addAsset = (asset: MediaAsset, afterId?: string) => {
    setRecipes(prev => ({ ...prev, [asset.id]: seedRecipe(asset, defaultAspect) }));
    setAssets(prev => {
      const index = afterId ? prev.findIndex(a => a.id === afterId) : -1;
      if (index === -1) return [...prev, asset];
      return [...prev.slice(0, index + 1), asset, ...prev.slice(index + 1)];
    });
  };

  return { assets, recipes, patchRecipe, addAsset, previewUrls };
}

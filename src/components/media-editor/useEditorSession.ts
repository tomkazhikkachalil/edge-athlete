'use client';

/**
 * Editor-internal state: one recipe per asset (rehydrated from
 * `asset.recipe` on re-edit) and the preview object URLs, revoked on
 * unmount. Recipes are in-memory only — see src/lib/media/recipes.ts.
 */

import { useEffect, useMemo, useState } from 'react';
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

  const previewUrls = useMemo(
    () => new Map(assets.map(asset => [asset.id, URL.createObjectURL(asset.file)])),
    [assets]
  );

  useEffect(() => {
    return () => {
      for (const url of previewUrls.values()) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);

  const patchRecipe = (id: string, patch: Partial<EditRecipe>) => {
    setRecipes(prev => ({ ...prev, [id]: { ...prev[id], ...patch } as EditRecipe }));
  };

  return { recipes, patchRecipe, previewUrls };
}

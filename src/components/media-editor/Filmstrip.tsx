'use client';

import { isNoopRecipe } from '@/lib/media/recipes';
import type { EditRecipe, MediaAsset } from '@/lib/media/types';

interface FilmstripProps {
  assets: MediaAsset[];
  previewUrls: Map<string, string>;
  recipes: Record<string, EditRecipe>;
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * Multi-asset rail. Selection only — add/remove/reorder stay on the owning
 * surface (the composer grid already does both); duplicating them here would
 * fork that logic.
 */
export default function Filmstrip({ assets, previewUrls, recipes, activeId, onSelect }: FilmstripProps) {
  return (
    <div className="flex gap-2 px-4 py-2 overflow-x-auto scrollbar-hide border-t border-white/10">
      {assets.map(asset => {
        const url = previewUrls.get(asset.id);
        const edited = recipes[asset.id] ? !isNoopRecipe(recipes[asset.id]) : false;
        const active = asset.id === activeId;
        return (
          <button
            key={asset.id}
            type="button"
            onClick={() => onSelect(asset.id)}
            aria-label={`Edit ${asset.file.name}`}
            className={`relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 ${
              active ? 'ring-2 ring-violet-500' : 'ring-1 ring-white/20'
            }`}
          >
            {asset.kind === 'video' ? (
              <video src={url} className="w-full h-full object-cover" preload="metadata" muted />
            ) : (
              // Raw <img>: effect-owned blob: object URL. The optimizer
              // fetches server-side and cannot read a client-only URL —
              // next/image force-sets unoptimized for these anyway.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="w-full h-full object-cover" />
            )}
            {edited && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-violet-500" aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  );
}

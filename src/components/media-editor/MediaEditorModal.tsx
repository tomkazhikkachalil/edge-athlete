'use client';

/**
 * The shared pre-upload media editor. Full-screen dark shell, tool tabs,
 * filmstrip for multi-asset sessions, sequential export on Done.
 *
 * Contract: NEVER uploads. onDone hands back rendered blobs + recipes; the
 * surface keeps its own upload timing. See src/lib/media/types.ts.
 *
 * z-[65]: above CreatePostModal (z-50) and its z-[60] sub-modals
 * (TagPeopleModal etc.), below Toast (z-[70]).
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useToast } from '@/components/Toast';
import { cssFilterString, composeAdjustments } from '@/lib/media/filters';
import { exportAsset, passThrough } from '@/lib/media/export';
import { isServerAllowedType } from '@/lib/media/validation';
import { isVideoEditingSupported } from '@/lib/media/video';
import type { TrimRange } from '@/lib/media/video-math';
import type { EditedMedia, EditorConfig, ImageRecipe, MediaAsset, VideoRecipe } from '@/lib/media/types';
import CropStage from './CropStage';
import AdjustPanel from './AdjustPanel';
import FilterStrip from './FilterStrip';
import Filmstrip from './Filmstrip';
import VideoStage from './VideoStage';
import { useEditorSession } from './useEditorSession';

type Tool = 'crop' | 'adjust' | 'filter' | 'trim' | 'poster';

const IMAGE_TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'crop', label: 'Crop' },
  { id: 'adjust', label: 'Adjust' },
  { id: 'filter', label: 'Filters' },
];
const VIDEO_TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'trim', label: 'Trim' },
  { id: 'poster', label: 'Cover' },
];

export interface MediaEditorModalProps {
  assets: MediaAsset[];
  config: EditorConfig;
  onDone: (results: EditedMedia[]) => void;
  onCancel: () => void;
}

export default function MediaEditorModal({ assets: initialAssets, config, onDone, onCancel }: MediaEditorModalProps) {
  useBodyScrollLock(true);
  const { showError } = useToast();
  const defaultAspect = config.enforcedRatio ?? config.aspectRatios[0] ?? 'free';
  const { assets, recipes, patchRecipe, addAsset, previewUrls } = useEditorSession(
    initialAssets,
    defaultAspect
  );
  const [activeId, setActiveId] = useState(initialAssets[0]?.id ?? '');
  const [tool, setTool] = useState<Tool>(initialAssets[0]?.kind === 'video' ? 'trim' : 'crop');
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);

  const active = assets.find(a => a.id === activeId) ?? assets[0];
  if (!active) return null;
  const activeRecipe = recipes[active.id];
  const activeUrl = previewUrls.get(active.id) ?? '';
  const isGif = active.file.type === 'image/gif';
  const isVideo = active.kind === 'video';
  const imageRecipe = activeRecipe?.kind === 'image' ? activeRecipe : null;
  const videoRecipe = activeRecipe?.kind === 'video' ? activeRecipe : null;
  const canTrim = isVideoEditingSupported();
  const liveFilter = imageRecipe
    ? cssFilterString(composeAdjustments(imageRecipe.adjustments, imageRecipe.filterId))
    : '';
  const tools = isVideo ? VIDEO_TOOLS : IMAGE_TOOLS;
  const activeTool: Tool = tools.some(t => t.id === tool) ? tool : tools[0].id;

  const handleSplit = (first: TrimRange, second: TrimRange) => {
    patchRecipe(active.id, { trim: first } as Partial<VideoRecipe>);
    addAsset(
      {
        id: `${active.id}-b`,
        file: active.file,
        kind: 'video',
        recipe: { kind: 'video', trim: second, posterTime: second.start },
      },
      active.id
    );
  };

  const handleDone = async () => {
    if (exporting) return;
    setExporting({ done: 0, total: assets.length });
    const results: EditedMedia[] = [];
    // Sequential on purpose — parallel decodes/encodes kill mobile tabs
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      setExporting({ done: i, total: assets.length });
      try {
        results.push(await exportAsset(asset, recipes[asset.id], config.output));
      } catch (err) {
        console.error('Media export failed:', asset.file.name, err);
        if (isServerAllowedType(asset.file.type)) {
          results.push(passThrough(asset, recipes[asset.id]));
        } else {
          showError('Could not process file', `${asset.file.name} was skipped`);
        }
      }
    }
    onDone(results);
  };

  return (
    <div className="fixed inset-0 z-[65] bg-black flex flex-col safe-top safe-bottom">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 flex-shrink-0">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel editing"
          className="w-11 h-11 flex items-center justify-center rounded-full text-white hover:bg-white/10"
        >
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-label font-semibold text-white">Edit media</h2>
        <button
          type="button"
          onClick={handleDone}
          disabled={!!exporting}
          className="px-4 min-h-[44px] rounded-full bg-brand text-white text-label font-semibold hover:bg-brand-hover disabled:opacity-50"
        >
          Done
        </button>
      </div>

      {/* Stage + tools. activeUrl is '' for one render while the effect mints
          object URLs (StrictMode-safe lifecycle) — mounting react-easy-crop
          with an empty image makes its position math NaN and loops
          componentDidUpdate into "Maximum update depth exceeded". Never
          render media elements until the URL exists. */}
      {!activeUrl ? (
        <div className="flex-1 min-h-0" aria-hidden="true" />
      ) : isVideo && videoRecipe ? (
        <VideoStage
          key={active.id}
          videoUrl={activeUrl}
          recipe={videoRecipe}
          tool={activeTool === 'poster' ? 'poster' : 'trim'}
          canTrim={canTrim}
          canSplit={canTrim && assets.length < config.maxAssets}
          onPatch={patch => patchRecipe(active.id, patch)}
          onSplit={handleSplit}
        />
      ) : !isGif && imageRecipe ? (
        <>
          {activeTool === 'crop' ? (
            <CropStage
              key={active.id}
              imageUrl={activeUrl}
              recipe={imageRecipe}
              config={config}
              cssFilter={liveFilter}
              onPatch={patch => patchRecipe(active.id, patch)}
            />
          ) : (
            <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeUrl}
                alt="Preview"
                style={liveFilter ? { filter: liveFilter } : undefined}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}

          {activeTool === 'adjust' && (
            <AdjustPanel
              adjustments={imageRecipe.adjustments}
              onChange={adjustments => patchRecipe(active.id, { adjustments })}
            />
          )}
          {activeTool === 'filter' && (
            <FilterStrip
              imageUrl={activeUrl}
              activeFilterId={imageRecipe.filterId}
              onSelect={filterId => patchRecipe(active.id, { filterId } as Partial<ImageRecipe>)}
            />
          )}
        </>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={activeUrl} alt="Preview" className="max-w-full max-h-[60vh] object-contain rounded-lg" />
          <p className="text-label text-white/70 text-center">
            GIFs upload as-is so the animation is preserved.
          </p>
        </div>
      )}

      {/* Tool tabs (GIFs have no tools) */}
      {activeUrl && !isGif && (
        <div className="flex justify-center gap-2 px-4 py-2 flex-shrink-0">
          {tools.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTool(t.id)}
              className={`px-4 min-h-[44px] rounded-full text-label transition-colors ${
                activeTool === t.id ? 'bg-white/20 text-white font-semibold' : 'text-white/60 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Filmstrip */}
      {config.maxAssets > 1 && assets.length > 1 && (
        <Filmstrip
          assets={assets}
          previewUrls={previewUrls}
          recipes={recipes}
          activeId={active.id}
          onSelect={id => {
            setActiveId(id);
            const next = assets.find(a => a.id === id);
            setTool(next?.kind === 'video' ? 'trim' : 'crop');
          }}
        />
      )}

      {/* Export overlay */}
      {exporting && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-3">
          <div className="w-48 h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand rounded-full transition-all"
              style={{ width: `${(exporting.done / Math.max(1, exporting.total)) * 100}%` }}
            />
          </div>
          <p className="text-label text-white/80">
            Saving {Math.min(exporting.done + 1, exporting.total)} of {exporting.total}…
          </p>
        </div>
      )}
    </div>
  );
}

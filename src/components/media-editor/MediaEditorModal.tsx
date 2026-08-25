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

import { useEffect, useRef, useState } from 'react';
import { X, Undo2, Redo2, Eye, History } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { isTypingTarget, matchesRedoShortcut, matchesUndoShortcut } from '@/lib/keyboard';
import ConfirmModal from '@/components/ConfirmModal';
import { COPY } from '@/lib/copy';
import { useToast } from '@/components/Toast';
import { cssFilterString, composeAdjustments } from '@/lib/media/filters';
import { exportAsset, passThrough } from '@/lib/media/export';
import { isServerAllowedType } from '@/lib/media/validation';
import { isVideoEditingSupported } from '@/lib/media/video';
import { isEngineSupported } from '@/lib/media/engine/engine';
import { autoEnhance } from '@/lib/media/engine/auto-enhance';
import { sampleFileHistogram } from '@/lib/media/engine/sample';
import type { EditedMedia, EditorConfig, ImageRecipe, MediaAsset } from '@/lib/media/types';
import CropStage from './CropStage';
import AdjustPanel from './AdjustPanel';
import EnginePreview from './EnginePreview';
import HistoryRail from './HistoryRail';
import FilterStrip from './FilterStrip';
import Filmstrip from './Filmstrip';
import VideoStage from './VideoStage';
import VideoCropStage from './VideoCropStage';
import { useEditorSession } from './useEditorSession';

type Tool = 'crop' | 'adjust' | 'filter' | 'clips' | 'poster';

const IMAGE_TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'crop', label: 'Crop' },
  { id: 'adjust', label: 'Adjust' },
  { id: 'filter', label: 'Filters' },
];
const VIDEO_TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'clips', label: 'Clips' },
  { id: 'crop', label: 'Crop' },
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
  const {
    assets,
    recipes,
    patchRecipe,
    previewUrls,
    undoRecipe,
    redoRecipe,
    canUndo,
    canRedo,
    jumpToRecipe,
    historyFor,
  } = useEditorSession(initialAssets, defaultAspect);
  const isDesktop = useIsDesktop();
  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  const [activeId, setActiveId] = useState(initialAssets[0]?.id ?? '');
  const [tool, setTool] = useState<Tool>(initialAssets[0]?.kind === 'video' ? 'clips' : 'crop');
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  // Hold-to-compare: while pressed, the stage renders the untouched source.
  const [comparing, setComparing] = useState(false);

  // Crop/filter/trim recipes are deliberately non-persistable, so a confirm
  // on cancel is the only protection against losing the edits.
  const initialRecipesRef = useRef(JSON.stringify(recipes));
  const isDirty = () =>
    assets.length !== initialAssets.length || JSON.stringify(recipes) !== initialRecipesRef.current;

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, onCancel);

  // Editor keyboard map (desktop round): ⌘Z/⌘⇧Z undo/redo, Escape backs out
  // one layer (confirm → sheet → editor), \ held = before/after, [ ] cycle
  // tools. Registered on window for the modal's lifetime only; re-bound per
  // render so closures are always current. Declared BEFORE the early return
  // (rules of hooks), so everything derived is recomputed inside handlers.
  useEffect(() => {
    const activeAsset = assets.find(a => a.id === activeId) ?? assets[0];
    const onKeyDown = (e: KeyboardEvent) => {
      if (exporting) return;
      if (e.key === 'Escape') {
        if (confirmOpen) cancelDiscard();
        else if (historySheetOpen) setHistorySheetOpen(false);
        else requestClose();
        return;
      }
      // Range sliders are inputs but not text entry — undo/redo must keep
      // working with a slider focused (the most common post-drag state).
      const targetEl = e.target as HTMLInputElement | null;
      const isRange = targetEl?.tagName === 'INPUT' && targetEl.type === 'range';
      if (isTypingTarget(e.target) && !isRange) return;
      if (!activeAsset) return;
      if (matchesUndoShortcut(e)) {
        e.preventDefault();
        undoRecipe(activeAsset.id);
        return;
      }
      if (matchesRedoShortcut(e)) {
        e.preventDefault();
        redoRecipe(activeAsset.id);
        return;
      }
      const editable = activeAsset.file.type !== 'image/gif';
      if (e.key === '\\' && editable) {
        setComparing(true);
        return;
      }
      if ((e.key === '[' || e.key === ']') && editable && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const toolList = activeAsset.kind === 'video' ? VIDEO_TOOLS : IMAGE_TOOLS;
        const currentTool = toolList.some(t => t.id === tool) ? tool : toolList[0].id;
        const index = toolList.findIndex(t => t.id === currentTool);
        const step = e.key === ']' ? 1 : -1;
        setTool(toolList[(index + step + toolList.length) % toolList.length].id);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === '\\') setComparing(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

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

  // Histogram-targeted auto: exposure/whites/blacks + mild contrast, applied
  // as ONE undo step ('auto' coalescing key). Sampled from the SOURCE file —
  // the same pixels the engine transforms.
  const handleAutoEnhance = async (id: string, file: File, recipe: ImageRecipe) => {
    const histogram = await sampleFileHistogram(file);
    if (!histogram) return;
    const auto = autoEnhance(histogram);
    patchRecipe(
      id,
      {
        light: { ...recipe.light, ...auto.light },
        adjustments: { ...recipe.adjustments, contrast: auto.contrast },
      },
      'auto'
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

  // Panels + tool tabs render ONCE and move between layouts via the JS
  // gate (chat-dock precedent) — CSS-gated duplicates would double slider
  // DOM and double-fire focus.
  const panels =
    activeUrl && !isGif && imageRecipe ? (
      <>
        {activeTool === 'adjust' && (
          <AdjustPanel
            recipe={imageRecipe}
            onPatch={(patch, keys) => patchRecipe(active.id, patch, keys)}
            onAutoEnhance={() => handleAutoEnhance(active.id, active.file, imageRecipe)}
            engineAvailable={isEngineSupported()}
          />
        )}
        {activeTool === 'filter' && (
          <FilterStrip
            imageUrl={activeUrl}
            activeFilterId={imageRecipe.filterId}
            filterStrength={imageRecipe.filterStrength}
            onSelect={filterId =>
              // Selecting a preset always starts at full intensity —
              // predictable, and the slider appears right below to tune.
              patchRecipe(active.id, { filterId, filterStrength: 1 } as Partial<ImageRecipe>, 'filterId')
            }
            onStrengthChange={strength =>
              patchRecipe(active.id, { filterStrength: strength } as Partial<ImageRecipe>, 'filterStrength')
            }
          />
        )}
      </>
    ) : null;

  // Tool tabs (GIFs have no tools). Scrolls, not clips: the video path
  // renders four tabs (~321px) in a 288px shell at 320px — same recipe as
  // FilterStrip. sm:justify-center restores the centered look where
  // everything fits.
  const toolTabs =
    activeUrl && !isGif ? (
      <div className="flex sm:justify-center gap-2 px-4 py-2 flex-shrink-0 overflow-x-auto scrollbar-hide">
        {tools.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTool(t.id)}
            className={`px-4 min-h-[44px] rounded-full text-label transition-colors shrink-0 whitespace-nowrap ${
              activeTool === t.id ? 'bg-white/20 text-white font-semibold' : 'text-white/60 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    ) : null;

  const historyRail = (
    <HistoryRail history={historyFor(active.id)} onJump={index => jumpToRecipe(active.id, index)} />
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit media"
      className="fixed inset-0 z-[65] bg-black flex flex-col safe-top safe-bottom"
    >
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        overlayZClass="z-[75]"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 flex-shrink-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={requestClose}
            aria-label="Cancel editing"
            className="w-11 h-11 flex items-center justify-center rounded-full text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
          {/* Undo/redo appear once the active asset has history — recipe
              snapshots only, one step per control drag (see lib/media/history). */}
          {(canUndo(active.id) || canRedo(active.id)) && (
            <>
              <button
                type="button"
                onClick={() => undoRecipe(active.id)}
                disabled={!canUndo(active.id)}
                aria-label="Undo"
                className="w-11 h-11 flex items-center justify-center rounded-full text-white hover:bg-white/10 disabled:opacity-40"
              >
                <Undo2 className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => redoRecipe(active.id)}
                disabled={!canRedo(active.id)}
                aria-label="Redo"
                className="w-11 h-11 flex items-center justify-center rounded-full text-white hover:bg-white/10 disabled:opacity-40"
              >
                <Redo2 className="w-5 h-5" />
              </button>
              {/* Mobile: history lives in a bottom sheet; desktop shows the
                  rail in the right column instead. */}
              {!isDesktop && (
                <button
                  type="button"
                  onClick={() => setHistorySheetOpen(true)}
                  aria-label="Edit history"
                  className="w-11 h-11 flex items-center justify-center rounded-full text-white hover:bg-white/10"
                >
                  <History className="w-5 h-5" />
                </button>
              )}
            </>
          )}
        </div>
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

      {/* Stage + tools, split at lg: stage column left, panel/history column
          right (one engine, two layouts). activeUrl is '' for one render
          while the effect mints object URLs (StrictMode-safe lifecycle) —
          mounting react-easy-crop with an empty image makes its position
          math NaN and loops componentDidUpdate into "Maximum update depth
          exceeded". Never render media elements until the URL exists. */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <div className="flex-1 min-h-0 flex flex-col">
      {!activeUrl ? (
        <div className="flex-1 min-h-0" aria-hidden="true" />
      ) : isVideo && videoRecipe ? (
        activeTool === 'crop' ? (
          <VideoCropStage
            key={`${active.id}-crop`}
            videoUrl={activeUrl}
            recipe={videoRecipe}
            config={config}
            onPatch={patch => patchRecipe(active.id, patch)}
          />
        ) : (
          <VideoStage
            key={active.id}
            videoUrl={activeUrl}
            file={active.file}
            recipe={videoRecipe}
            tool={activeTool === 'poster' ? 'poster' : 'clips'}
            canEdit={canTrim}
            onPatch={patch => patchRecipe(active.id, patch)}
          />
        )
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
              {/* WebGL preview of the FULL recipe (geometry + engine color);
                  falls back internally to <img> + CSS trio on no-WebGL. */}
              <EnginePreview
                file={active.file}
                recipe={imageRecipe}
                fallbackUrl={activeUrl}
                showOriginal={comparing}
              />
              {/* Press-and-hold before/after — released anywhere restores
                  the edit (pointer capture keeps Up firing off-button). */}
              <button
                type="button"
                aria-label="Hold to compare with original"
                title="Hold to compare with original"
                onPointerDown={e => {
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // Synthetic/untrusted events have no capturable pointer.
                  }
                  setComparing(true);
                }}
                onPointerUp={() => setComparing(false)}
                onPointerCancel={() => setComparing(false)}
                onContextMenu={e => e.preventDefault()}
                className={`absolute bottom-3 right-3 w-11 h-11 flex items-center justify-center rounded-full ${
                  comparing ? 'bg-white/30 text-white' : 'bg-black/40 text-white/80 hover:text-white'
                }`}
              >
                <Eye className="w-5 h-5" />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-6">
          {/* Raw <img>: both reasons apply — a blob: object URL the optimizer
              cannot fetch, holding an animated GIF it would not shrink. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={activeUrl} alt="Preview" className="max-w-full max-h-[60vh] object-contain rounded-lg" />
          <p className="text-label text-white/70 text-center">
            GIFs upload as-is so the animation is preserved.
          </p>
        </div>
      )}

          {/* Mobile flow: panel + tabs stack under the stage. */}
          {!isDesktop && panels}
          {!isDesktop && toolTabs}
        </div>

        {/* Desktop right column: tools, active panel, always-visible
            history rail. Precise sliders, large stage, no thumb-reach
            constraints — the second of the mandate's two layouts. */}
        {isDesktop && activeUrl && !isGif && (
          <div className="w-80 flex-shrink-0 border-l border-white/10 flex flex-col min-h-0">
            {toolTabs}
            <div className="flex-shrink-0 overflow-y-auto max-h-[55%]">{panels}</div>
            <div className="flex-1 min-h-0 border-t border-white/10 flex flex-col">
              <p className="px-4 pt-3 pb-1 text-chip font-semibold uppercase tracking-wide text-white/50">
                History
              </p>
              <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">{historyRail}</div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile history bottom sheet. */}
      {!isDesktop && historySheetOpen && (
        <div className="fixed inset-0 z-[68]" onClick={() => setHistorySheetOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            role="dialog"
            aria-label="Edit history"
            className="absolute bottom-0 inset-x-0 max-h-[60vh] overflow-y-auto rounded-t-2xl bg-neutral-900 p-3 safe-bottom"
            onClick={e => e.stopPropagation()}
          >
            <p className="px-3 pb-2 text-label font-semibold text-white">History</p>
            {historyRail}
          </div>
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
            setTool(next?.kind === 'video' ? 'clips' : 'crop');
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

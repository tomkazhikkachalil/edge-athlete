'use client';

/**
 * Media diagnostic page — /app/diag/media (Sep 3 2026, round 9 of the phone
 * camera incident). Eight fix rounds were hypotheses tested on a device no
 * one here can run (iPhone 12 Pro Max, iOS 15, WebKit under Safari AND
 * Chrome); the reports contradicted each other across a phone restart. This
 * page replaces the guessing with a measurement: it runs the SAME steps the
 * composer runs — pick/capture → validate → decode → editor engine → export
 * bake → (opt-in) upload — one at a time, timed, every failure caught, and
 * prints them as a plain log the user can screenshot or copy.
 *
 * Deliberately self-contained and inside the iOS 15 floor: no new APIs
 * unguarded, heavy modules imported lazily at the step that needs them so the
 * page the camera opens FROM stays light. The log lives in sessionStorage so
 * a page that iOS reloads while the camera is up still shows what ran before
 * (a per-boot id marks the reload). Reached by URL only; not linked anywhere.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import BrandBar from '@/components/BrandBar';
import CaptureInputs from '@/components/media/CaptureInputs';
import { validateFiles } from '@/lib/media/validation';
import { MAX_CANVAS_DIM, PREVIEW_MAX_DIM } from '@/lib/media/limits';

const LOG_KEY = 'ea:diag-media:v1';
const BOOT_ID = Math.random().toString(36).slice(2, 8);
const MAX_LINES = 400;

interface StoredLog {
  bootId: string;
  lines: string[];
}

function readStored(): StoredLog | null {
  try {
    const raw = sessionStorage.getItem(LOG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLog>;
    if (!parsed || typeof parsed.bootId !== 'string' || !Array.isArray(parsed.lines)) return null;
    return { bootId: parsed.bootId, lines: parsed.lines.filter(l => typeof l === 'string') };
  } catch {
    return null;
  }
}

function writeStored(lines: string[]): void {
  try {
    sessionStorage.setItem(LOG_KEY, JSON.stringify({ bootId: BOOT_ID, lines: lines.slice(-MAX_LINES) }));
  } catch {
    /* storage disabled — the on-screen log still works */
  }
}

const stamp = (): string => {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};
const ms = (t0: number): string => `${Math.round(performance.now() - t0)}ms`;
const kb = (n: number): string => `${Math.round(n / 1024)}KB`;
const errText = (e: unknown): string =>
  e instanceof Error ? `${e.name}: ${e.message}` : typeof e === 'string' ? e : JSON.stringify(e);

/** Resolve after `limit` ms with `fallback` if `p` has not settled — a hung API must show as a line, not a stall. */
function withTimeout<T>(p: Promise<T>, limit: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), limit);
    p.then(v => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(fallback); });
  });
}

export default function MediaDiagPage() {
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  const [lines, setLines] = useState<string[]>([]);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const tapAtRef = useRef<number | null>(null);
  const linesRef = useRef<string[]>([]);

  const append = useCallback((text: string) => {
    const line = `${stamp()} ${text}`;
    linesRef.current = [...linesRef.current, line].slice(-MAX_LINES);
    writeStored(linesRef.current);
    setLines(linesRef.current);
  }, []);

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  // Boot: recover a previous log (a reload mid-camera is the round-2 killer),
  // hook global errors, then probe the environment. All async so no state is
  // set synchronously inside the effect.
  useEffect(() => {
    const onError = (ev: ErrorEvent) => append(`[window.onerror] ${ev.message} @${ev.filename}:${ev.lineno}`);
    const onRejection = (ev: PromiseRejectionEvent) => append(`[unhandledrejection] ${errText(ev.reason)}`);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    void (async () => {
      const stored = readStored();
      if (stored && stored.lines.length > 0) {
        linesRef.current = stored.lines;
        setLines(stored.lines);
        if (stored.bootId !== BOOT_ID) append(`[reload] page (re)loaded — the log above is from before the reload`);
      } else {
        append(`[boot] ${BOOT_ID} — media diagnostic`);
      }
      append(`[env] ${navigator.userAgent}`);
      append(`[env] viewport ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x · cores ${navigator.hardwareConcurrency ?? '?'}`);
      append(`[env] createImageBitmap: ${typeof createImageBitmap}`);
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2');
        append(gl ? `[env] webgl2 ok · MAX_TEXTURE_SIZE ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}` : `[env] webgl2 UNAVAILABLE`);
        const lose = gl?.getExtension('WEBGL_lose_context');
        lose?.loseContext();
      } catch (e) {
        append(`[env] webgl2 probe threw: ${errText(e)}`);
      }
      try {
        const { isEngineSupported } = await import('@/lib/media/engine/engine');
        append(`[env] editor engine supported: ${isEngineSupported()}`);
      } catch (e) {
        append(`[env] engine module failed to load: ${errText(e)}`);
      }
      try {
        if (typeof indexedDB === 'undefined') append('[env] indexedDB: undefined');
        else {
          const t0 = performance.now();
          const ok = await withTimeout(
            new Promise<string>((resolve, reject) => {
              const req = indexedDB.open('ea-diag-probe', 1);
              req.onsuccess = () => { req.result.close(); resolve('ok'); };
              req.onerror = () => reject(req.error ?? new Error('open failed'));
              req.onblocked = () => reject(new Error('blocked'));
            }).catch(e => `error ${errText(e)}`),
            3000,
            'TIMEOUT (3s — the Safari 14/15 first-load hang)'
          );
          append(`[env] indexedDB open: ${ok} ${ms(t0)}`);
        }
      } catch (e) {
        append(`[env] indexedDB probe threw: ${errText(e)}`);
      }
      try {
        if (navigator.storage && typeof navigator.storage.estimate === 'function') {
          const est = await withTimeout(navigator.storage.estimate(), 3000, null);
          if (est) append(`[env] storage usage ${kb(est.usage ?? 0)} / quota ${kb(est.quota ?? 0)}`);
        }
      } catch { /* optional */ }
      append('[ready] pick from the library or use the camera below');
    })();

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [append]);

  const runImageSteps = useCallback(async (file: File) => {
    // 1. createImageBitmap — the editor's preferred decoder.
    if (typeof createImageBitmap === 'function') {
      const t0 = performance.now();
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        append(`[createImageBitmap] ${bmp.width}×${bmp.height} ${ms(t0)}`);
        bmp.close();
      } catch (e) {
        append(`[createImageBitmap] THREW ${ms(t0)}: ${errText(e)}`);
      }
    } else {
      append('[createImageBitmap] not a function on this browser');
    }
    // 2. <img>.decode — the fallback decoder.
    {
      const t0 = performance.now();
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        append(`[img.decode] ${img.naturalWidth}×${img.naturalHeight} ${ms(t0)}`);
      } catch (e) {
        append(`[img.decode] THREW ${ms(t0)}: ${errText(e)}`);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    // 3. The editor's open path: decodeImage → renderGeometry → engine.setSource/draw.
    {
      const t0 = performance.now();
      let canvas: HTMLCanvasElement | null = null;
      try {
        const [{ decodeImage }, { renderGeometry, releaseCanvas }, { createEngine }, { recipeToEngineParams }, { defaultImageRecipe }] =
          await Promise.all([
            import('@/lib/media/decode'),
            import('@/lib/media/render'),
            import('@/lib/media/engine/engine'),
            import('@/lib/media/engine/params'),
            import('@/lib/media/recipes'),
          ]);
        const decoded = await decodeImage(file);
        append(`[editor] decodeImage ${decoded.width}×${decoded.height} ${ms(t0)}`);
        const recipe = defaultImageRecipe();
        const stage = renderGeometry(decoded, recipe, PREVIEW_MAX_DIM);
        decoded.close();
        append(`[editor] preview stage ${stage.width}×${stage.height} ${ms(t0)}`);
        canvas = document.createElement('canvas');
        canvas.width = stage.width;
        canvas.height = stage.height;
        const engine = createEngine(canvas, () => append('[editor] engine CONTEXT LOST'));
        if (!engine) {
          append(`[editor] engine unavailable (no WebGL2 for this canvas) ${ms(t0)}`);
        } else {
          engine.setSource(stage, stage.width, stage.height);
          engine.draw(recipeToEngineParams(recipe));
          append(`[editor] engine setSource+draw ok ${ms(t0)}`);
          engine.destroy();
        }
        releaseCanvas(stage);
      } catch (e) {
        append(`[editor] FAILED ${ms(t0)}: ${errText(e)}`);
      } finally {
        if (canvas) { canvas.width = 0; canvas.height = 0; }
      }
    }
    // 4. The export / upload bake at full size.
    {
      const t0 = performance.now();
      try {
        const [{ renderImage }, { defaultImageRecipe }] = await Promise.all([
          import('@/lib/media/render'),
          import('@/lib/media/recipes'),
        ]);
        const blob = await renderImage(file, defaultImageRecipe(), { maxDimension: MAX_CANVAS_DIM, mime: 'image/jpeg', quality: 0.92 });
        append(`[renderImage] ${blob.type || 'no type'} ${kb(blob.size)} ${ms(t0)}`);
      } catch (e) {
        append(`[renderImage] FAILED ${ms(t0)}: ${errText(e)}`);
      }
    }
  }, [append]);

  const runVideoSteps = useCallback(async (file: File) => {
    const t0 = performance.now();
    const url = URL.createObjectURL(file);
    try {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      const meta = await withTimeout(
        new Promise<string>((resolve, reject) => {
          video.onloadedmetadata = () => resolve(`${video.videoWidth}×${video.videoHeight} · ${video.duration.toFixed(1)}s`);
          video.onerror = () => reject(new Error(`code ${video.error?.code ?? '?'} ${video.error?.message ?? ''}`));
          video.src = url;
        }).catch(e => `THREW ${errText(e)}`),
        15000,
        'TIMEOUT (15s, no loadedmetadata)'
      );
      append(`[video] metadata ${meta} ${ms(t0)}`);
      video.removeAttribute('src');
      video.load();
    } finally {
      URL.revokeObjectURL(url);
    }
    try {
      const { isVideoEditingSupported } = await import('@/lib/media/video');
      append(`[video] editing (WebCodecs) supported: ${isVideoEditingSupported()}`);
    } catch (e) {
      append(`[video] module failed to load: ${errText(e)}`);
    }
  }, [append]);

  const handleFiles = useCallback(async (files: FileList, source: string) => {
    const tapped = tapAtRef.current;
    tapAtRef.current = null;
    append(`[change] ${source}: ${files.length} file(s)${tapped !== null ? ` · ${ms(tapped)} after the tap` : ''}`);
    const list = Array.from(files);
    for (const f of list) append(`[file] ${f.name} · ${f.type || 'no type'} · ${kb(f.size)} · modified ${new Date(f.lastModified).toISOString()}`);
    const { accepted, rejected } = validateFiles(list, { maxBytes: 50 * 1024 * 1024, allowVideo: true, maxCount: 10 });
    for (const r of rejected) append(`[validate] REJECTED ${r.file.name}: ${r.message}`);
    append(`[validate] accepted ${accepted.length}`);
    const first = accepted[0];
    if (!first) return;
    setLastFile(first);
    setBusy('running');
    try {
      if (first.type.startsWith('video/')) await runVideoSteps(first);
      else await runImageSteps(first);
      append('[done] steps complete — tap Upload to test the server round trip');
    } finally {
      setBusy(null);
    }
  }, [append, runImageSteps, runVideoSteps]);

  const handleUpload = useCallback(async () => {
    if (!lastFile) return;
    setBusy('uploading');
    const t0 = performance.now();
    try {
      const { uploadPostMedia } = await import('@/lib/media/upload');
      const result = await uploadPostMedia(lastFile);
      append(`[upload] ok ${result.type} ${ms(t0)} → ${result.url}`);
    } catch (e) {
      append(`[upload] FAILED ${ms(t0)}: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }, [append, lastFile]);

  const copyLog = useCallback(async () => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(linesRef.current.join('\n'));
        append('[copy] log copied to the clipboard');
      } else append('[copy] clipboard unavailable — screenshot instead');
    } catch (e) {
      append(`[copy] failed: ${errText(e)}`);
    }
  }, [append]);

  const clearLog = useCallback(() => {
    linesRef.current = [];
    writeStored([]);
    setLines([]);
    append(`[boot] ${BOOT_ID} — log cleared`);
  }, [append]);

  if (loading || !initialAuthCheckComplete || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-soft">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar />
      <main className="flex-grow p-4 max-w-2xl w-full mx-auto">
        <h1 className="text-2xl font-bold text-primary">Media diagnostic</h1>
        <p className="mt-2 text-sm text-secondary">
          Runs the same steps the post composer runs — pick, validate, decode, editor, export — and logs
          each one. Nothing is posted. The Upload test stores one file that the storage sweep removes
          within 48 hours.
        </p>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="ea-cta min-h-[52px] rounded-lg text-white font-semibold flex items-center justify-center cursor-pointer">
            Upload (library)
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              data-testid="diag-library-input"
              onClick={e => {
                tapAtRef.current = performance.now();
                (e.target as HTMLInputElement).value = '';
              }}
              onChange={e => e.target.files && e.target.files.length > 0 && void handleFiles(e.target.files, 'library')}
            />
          </label>
          <CaptureInputs onFiles={files => void handleFiles(files, 'camera')} allowVideo>
            {({ openPhoto, openVideo }) => (
              <>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => { tapAtRef.current = performance.now(); append('[tap] Take photo'); openPhoto(); }}
                  className="min-h-[52px] rounded-lg border border-border-strong text-primary font-semibold hover:bg-surface disabled:opacity-50"
                >
                  Take photo
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => { tapAtRef.current = performance.now(); append('[tap] Record video'); openVideo?.(); }}
                  className="min-h-[52px] rounded-lg border border-border-strong text-primary font-semibold hover:bg-surface disabled:opacity-50"
                >
                  Record video
                </button>
              </>
            )}
          </CaptureInputs>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!lastFile || busy !== null}
            onClick={() => void handleUpload()}
            className="min-h-[44px] px-4 rounded-full bg-brand text-white text-sm font-semibold hover:bg-brand-hover disabled:opacity-50"
          >
            Upload last file to the server
          </button>
          <button type="button" onClick={() => void copyLog()} className="min-h-[44px] px-4 rounded-full border border-border-strong text-sm font-semibold text-primary">
            Copy log
          </button>
          <button type="button" onClick={clearLog} className="min-h-[44px] px-4 rounded-full border border-border-strong text-sm font-semibold text-primary">
            Clear log
          </button>
          {busy && <span className="self-center text-sm text-secondary">{busy}…</span>}
        </div>

        <pre
          role="log"
          aria-live="polite"
          data-testid="diag-log"
          className="mt-4 rounded-lg bg-surface border border-border-strong p-3 text-xs font-mono text-primary whitespace-pre-wrap break-words max-h-[60vh] overflow-y-auto"
        >
          {lines.join('\n')}
        </pre>
      </main>
    </div>
  );
}

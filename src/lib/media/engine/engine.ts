/**
 * The WebGL2 color engine — browser-only, thin. Uploads a source texture
 * once, then every draw() is uniforms + one fullscreen-triangle pass, which
 * is what makes 60fps slider preview possible (the old path re-rendered
 * nothing live; export re-rendered everything once).
 *
 * Lifecycle contract: preview engines live for a component mount and MUST
 * be destroy()ed in the effect cleanup (browsers cap ~16 live GL contexts;
 * StrictMode double-mount would leak one per mount otherwise). Export
 * engines are created, used, and destroyed within a single export.
 */

import { compileProgram, createSourceTexture, getWebGL2Context } from './gl';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders';
import { NEUTRAL_ENGINE_PARAMS, type EngineParams } from './params';

export interface Engine {
  /** Upload (or replace) the source texture and size the canvas to match.
   *  Call once per asset/geometry change — never during slider drags. */
  setSource(source: TexImageSource, width: number, height: number): void;
  /** Draw with params; showOriginal renders the untouched source instead. */
  draw(params: EngineParams, opts?: { showOriginal?: boolean }): void;
  isLost(): boolean;
  destroy(): void;
}

export interface CreateEngineOptions {
  /** Keep the WebGL context alive on destroy (delete resources only).
   *  REQUIRED for React-mounted canvases: StrictMode remounts reuse the
   *  same canvas node, and a context killed via WEBGL_lose_context stays
   *  lost for the next mount's getContext call. Leave false for one-shot
   *  scratch canvases (export), where immediate release is the point. */
  keepContextOnDestroy?: boolean;
}

/** null = WebGL2 unavailable → caller uses the CSS/reference fallback. */
export function createEngine(
  canvas: HTMLCanvasElement,
  onContextLost?: () => void,
  options?: CreateEngineOptions
): Engine | null {
  const gl = getWebGL2Context(canvas);
  if (!gl || gl.isContextLost()) return null;
  const program = compileProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
  const texture = program ? createSourceTexture(gl) : null;
  if (!program || !texture) return null;

  const loc = {
    src: gl.getUniformLocation(program, 'u_src'),
    resolution: gl.getUniformLocation(program, 'u_resolution'),
    bcs: gl.getUniformLocation(program, 'u_bcs'),
    exposure: gl.getUniformLocation(program, 'u_exposure'),
    wb: gl.getUniformLocation(program, 'u_wb'),
    tone: gl.getUniformLocation(program, 'u_tone'),
    vibrance: gl.getUniformLocation(program, 'u_vibrance'),
    vignette: gl.getUniformLocation(program, 'u_vignette'),
  };

  let lost = false;
  let destroyed = false;
  const handleLost = (event: Event) => {
    event.preventDefault(); // required, or the context never restores
    lost = true;
    onContextLost?.();
  };
  canvas.addEventListener('webglcontextlost', handleLost);

  const setSource = (source: TexImageSource, width: number, height: number) => {
    if (lost || destroyed) return;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // uv comes from gl_FragCoord (origin bottom-left) — flip the upload so
    // source row 0 (top) lands at v=1 and the draw is upright.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  };

  const draw = (params: EngineParams, opts?: { showOriginal?: boolean }) => {
    if (lost || destroyed) return;
    const p = opts?.showOriginal ? NEUTRAL_ENGINE_PARAMS : params;
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(loc.src, 0);
    gl.uniform2f(loc.resolution, canvas.width, canvas.height);
    gl.uniform3f(loc.bcs, p.adjustments.brightness, p.adjustments.contrast, p.adjustments.saturation);
    gl.uniform1f(loc.exposure, p.light.exposure);
    gl.uniform2f(loc.wb, p.color.temperature, p.color.tint);
    gl.uniform4f(loc.tone, p.light.highlights, p.light.shadows, p.light.whites, p.light.blacks);
    gl.uniform1f(loc.vibrance, p.color.vibrance);
    gl.uniform1f(loc.vignette, p.detail.vignette);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    canvas.removeEventListener('webglcontextlost', handleLost);
    if (!lost) {
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      // Explicit teardown frees the context slot immediately instead of
      // waiting for GC — matters under the ~16-context browser cap.
      if (!options?.keepContextOnDestroy) {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    }
  };

  return { setSource, draw, isLost: () => lost, destroy };
}

let engineSupport: boolean | null = null;

/** One-time capability probe (creates and immediately destroys a context).
 *  Says nothing about later context loss — components handle that live. */
export function isEngineSupported(): boolean {
  if (engineSupport !== null) return engineSupport;
  if (typeof document === 'undefined') return false; // SSR render pass
  const canvas = document.createElement('canvas');
  const engine = createEngine(canvas);
  engineSupport = engine !== null;
  engine?.destroy();
  canvas.width = 0;
  canvas.height = 0;
  return engineSupport;
}

/**
 * One-shot: run the engine over a 2D canvas IN PLACE (export path). Returns
 * false when WebGL2 is unavailable or the context died mid-draw — caller
 * falls back to the reference pixel loop.
 */
export function renderEngineOnCanvas(target: HTMLCanvasElement, params: EngineParams): boolean {
  const scratch = document.createElement('canvas');
  const engine = createEngine(scratch);
  if (!engine) return false;
  try {
    engine.setSource(target, target.width, target.height);
    engine.draw(params);
    if (engine.isLost()) return false;
    const ctx = target.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(scratch, 0, 0);
    return true;
  } finally {
    engine.destroy();
    scratch.width = 0;
    scratch.height = 0;
  }
}

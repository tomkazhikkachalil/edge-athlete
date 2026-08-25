/**
 * The WebGL2 color engine — browser-only, thin. Uploads a source texture
 * once, then every draw() is uniforms + one fullscreen-triangle pass, which
 * is what makes 60fps slider preview possible (the old path re-rendered
 * nothing live; export re-rendered everything once).
 *
 * Detail round: when sharpen/clarity/NR are active the composite samples
 * two gaussian blurs (σ=1 full-res, σ=2 half-res). Blur programs and FBO
 * textures are LAZY — a Light/Color drag never allocates or runs them —
 * and blurs depend only on the SOURCE, so they compute once per setSource
 * and every subsequent drag is still uniform-only.
 *
 * Lifecycle contract: preview engines live for a component mount and MUST
 * be destroy()ed in the effect cleanup (browsers cap ~16 live GL contexts;
 * StrictMode double-mount would leak one per mount otherwise). Export
 * engines are created, used, and destroyed within a single export.
 */

import { compileProgram, createSourceTexture, getWebGL2Context } from './gl';
import {
  BLUR_LARGE_FRAGMENT,
  BLUR_SMALL_FRAGMENT,
  COPY_FRAGMENT,
  FRAGMENT_SHADER,
  VERTEX_SHADER,
} from './shaders';
import { NEUTRAL_ENGINE_PARAMS, planPasses, type EngineParams } from './params';

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

interface BlurTarget {
  tex: WebGLTexture;
  width: number;
  height: number;
}

/** null = WebGL2 unavailable → caller uses the CSS/reference fallback. */
export function createEngine(
  canvas: HTMLCanvasElement,
  onContextLost?: () => void,
  options?: CreateEngineOptions
): Engine | null {
  const gl = getWebGL2Context(canvas);
  if (!gl || gl.isContextLost()) return null;
  const composite = compileProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
  const texture = composite ? createSourceTexture(gl) : null;
  if (!composite || !texture) return null;

  const loc = {
    src: gl.getUniformLocation(composite, 'u_src'),
    blurSmall: gl.getUniformLocation(composite, 'u_blurSmall'),
    blurLarge: gl.getUniformLocation(composite, 'u_blurLarge'),
    resolution: gl.getUniformLocation(composite, 'u_resolution'),
    bcs: gl.getUniformLocation(composite, 'u_bcs'),
    exposure: gl.getUniformLocation(composite, 'u_exposure'),
    wb: gl.getUniformLocation(composite, 'u_wb'),
    tone: gl.getUniformLocation(composite, 'u_tone'),
    vibrance: gl.getUniformLocation(composite, 'u_vibrance'),
    vignette: gl.getUniformLocation(composite, 'u_vignette'),
    detail: gl.getUniformLocation(composite, 'u_detail'),
  };

  let lost = false;
  let destroyed = false;
  let srcWidth = 0;
  let srcHeight = 0;

  // Blur machinery — everything below is lazily created on first need.
  let fbo: WebGLFramebuffer | null = null;
  let copyProgram: WebGLProgram | null | undefined;
  let blurSmallProgram: WebGLProgram | null | undefined;
  let blurLargeProgram: WebGLProgram | null | undefined;
  let fullA: BlurTarget | null = null;
  let fullB: BlurTarget | null = null;
  let halfA: BlurTarget | null = null;
  let halfB: BlurTarget | null = null;
  let blurSmallReady = false;
  let blurLargeReady = false;

  const handleLost = (event: Event) => {
    event.preventDefault(); // required, or the context never restores
    lost = true;
    onContextLost?.();
  };
  canvas.addEventListener('webglcontextlost', handleLost);

  const makeTarget = (width: number, height: number): BlurTarget | null => {
    const tex = createSourceTexture(gl);
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return { tex, width, height };
  };

  const dropTargets = () => {
    for (const t of [fullA, fullB, halfA, halfB]) if (t) gl.deleteTexture(t.tex);
    fullA = fullB = halfA = halfB = null;
    blurSmallReady = false;
    blurLargeReady = false;
  };

  /** One fullscreen pass: srcTex → target FBO with `program`. */
  const runPass = (
    program: WebGLProgram,
    srcTex: WebGLTexture,
    target: BlurTarget,
    direction?: [number, number]
  ) => {
    if (!fbo) fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.tex, 0);
    gl.viewport(0, 0, target.width, target.height);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(gl.getUniformLocation(program, 'u_src'), 0);
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), target.width, target.height);
    if (direction) {
      gl.uniform2f(gl.getUniformLocation(program, 'u_direction'), direction[0], direction[1]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /** σ=1 full-res, ping-pong src → fullA → fullB. */
  const computeBlurSmall = (): boolean => {
    blurSmallProgram ??= compileProgram(gl, VERTEX_SHADER, BLUR_SMALL_FRAGMENT);
    if (!blurSmallProgram) return false;
    fullA ??= makeTarget(srcWidth, srcHeight);
    fullB ??= makeTarget(srcWidth, srcHeight);
    if (!fullA || !fullB) return false;
    runPass(blurSmallProgram, texture, fullA, [1, 0]);
    runPass(blurSmallProgram, fullA.tex, fullB, [0, 1]);
    blurSmallReady = true;
    return true;
  };

  /** Half-res downsample (hardware linear), then σ=2 ping-pong; the final
   *  blur lands in halfA and upsamples in the composite's LINEAR fetch. */
  const computeBlurLarge = (): boolean => {
    copyProgram ??= compileProgram(gl, VERTEX_SHADER, COPY_FRAGMENT);
    blurLargeProgram ??= compileProgram(gl, VERTEX_SHADER, BLUR_LARGE_FRAGMENT);
    if (!copyProgram || !blurLargeProgram) return false;
    const hw = Math.max(1, Math.round(srcWidth / 2));
    const hh = Math.max(1, Math.round(srcHeight / 2));
    halfA ??= makeTarget(hw, hh);
    halfB ??= makeTarget(hw, hh);
    if (!halfA || !halfB) return false;
    runPass(copyProgram, texture, halfA);
    runPass(blurLargeProgram, halfA.tex, halfB, [1, 0]);
    runPass(blurLargeProgram, halfB.tex, halfA, [0, 1]);
    blurLargeReady = true;
    return true;
  };

  const setSource = (source: TexImageSource, width: number, height: number) => {
    if (lost || destroyed) return;
    canvas.width = width;
    canvas.height = height;
    if (width !== srcWidth || height !== srcHeight) dropTargets();
    srcWidth = width;
    srcHeight = height;
    blurSmallReady = false;
    blurLargeReady = false;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // uv comes from gl_FragCoord (origin bottom-left) — flip the upload so
    // source row 0 (top) lands at v=1 and the draw is upright. Blur FBO
    // passes inherit this orientation consistently (no flip on render-to-
    // texture), so the composite samples all three textures in one space.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  };

  const draw = (params: EngineParams, opts?: { showOriginal?: boolean }) => {
    if (lost || destroyed) return;
    const p = opts?.showOriginal ? NEUTRAL_ENGINE_PARAMS : params;
    const plan = planPasses(p);
    // Blur availability degrades gracefully: a failed compile/alloc just
    // leaves the sampler on src — detail sliders no-op instead of breaking.
    const haveSmall = plan.blurSmall && (blurSmallReady || computeBlurSmall());
    const haveLarge = plan.blurLarge && (blurLargeReady || computeBlurLarge());

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, srcWidth, srcHeight);
    gl.useProgram(composite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, haveSmall && fullB ? fullB.tex : texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, haveLarge && halfA ? halfA.tex : texture);
    gl.uniform1i(loc.src, 0);
    gl.uniform1i(loc.blurSmall, 1);
    gl.uniform1i(loc.blurLarge, 2);
    gl.uniform2f(loc.resolution, srcWidth, srcHeight);
    gl.uniform3f(loc.bcs, p.adjustments.brightness, p.adjustments.contrast, p.adjustments.saturation);
    gl.uniform1f(loc.exposure, p.light.exposure);
    gl.uniform2f(loc.wb, p.color.temperature, p.color.tint);
    gl.uniform4f(loc.tone, p.light.highlights, p.light.shadows, p.light.whites, p.light.blacks);
    gl.uniform1f(loc.vibrance, p.color.vibrance);
    gl.uniform1f(loc.vignette, p.detail.vignette);
    gl.uniform3f(
      loc.detail,
      haveSmall ? p.detail.sharpen : 0,
      haveLarge ? p.detail.clarity : 0,
      haveLarge ? p.detail.noiseReduction : 0
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    canvas.removeEventListener('webglcontextlost', handleLost);
    if (!lost) {
      dropTargets();
      if (fbo) gl.deleteFramebuffer(fbo);
      for (const program of [copyProgram, blurSmallProgram, blurLargeProgram]) {
        if (program) gl.deleteProgram(program);
      }
      gl.deleteTexture(texture);
      gl.deleteProgram(composite);
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

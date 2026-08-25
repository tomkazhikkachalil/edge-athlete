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
  BLUR_BG_FRAGMENT,
  BLUR_LARGE_FRAGMENT,
  BLUR_SMALL_FRAGMENT,
  CLONE_FRAGMENT,
  COPY_FRAGMENT,
  FRAGMENT_SHADER,
  VERTEX_SHADER,
  WARP_FRAGMENT,
} from './shaders';
import { NEUTRAL_ENGINE_PARAMS, planPasses, type EngineParams } from './params';
import { isNeutralPerspective } from './perspective-math';
import { bakeHslLut, HSL_LUT_SIZE, isNeutralHsl } from './hsl-math';
import { bakeCurveLut, CURVE_LUT_SIZE, isNeutralCurves } from './curves-math';
import { MAX_MASKS, wantsBackgroundBlur } from './mask-math';
import { extendRaster, rasterizeBrushMask } from './mask-raster';
import { isNeutralClones, MAX_CLONE_STAMPS } from './clone-math';
import type { BrushStroke, CloneStamp } from '../types';

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
    hslLut: gl.getUniformLocation(composite, 'u_hslLut'),
    hslEnabled: gl.getUniformLocation(composite, 'u_hslEnabled'),
    curveLut: gl.getUniformLocation(composite, 'u_curveLut'),
    curveEnabled: gl.getUniformLocation(composite, 'u_curveEnabled'),
    maskCount: gl.getUniformLocation(composite, 'u_maskCount'),
    maskGeom: gl.getUniformLocation(composite, 'u_maskGeom'),
    maskKind: gl.getUniformLocation(composite, 'u_maskKind'),
    maskAdjust: gl.getUniformLocation(composite, 'u_maskAdjust'),
    grain: gl.getUniformLocation(composite, 'u_grain'),
    blurBg: gl.getUniformLocation(composite, 'u_blurBg'),
    bgBlurEnabled: gl.getUniformLocation(composite, 'u_bgBlurEnabled'),
    brushMasks: [0, 1, 2, 3].map(i => gl.getUniformLocation(composite, `u_brushMask${i}`)),
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
  let blurBgProgram: WebGLProgram | null | undefined;
  let warpProgram: WebGLProgram | null | undefined;
  let cloneProgram: WebGLProgram | null | undefined;
  let fullA: BlurTarget | null = null;
  let fullB: BlurTarget | null = null;
  let halfA: BlurTarget | null = null;
  let halfB: BlurTarget | null = null;
  let quarterA: BlurTarget | null = null;
  let quarterB: BlurTarget | null = null;
  let warpTarget: BlurTarget | null = null;
  let cloneTarget: BlurTarget | null = null;
  /** Stamps the clone texture was rendered for. */
  let cloneFor: string | null = null;
  let blurSmallReady = false;
  let blurLargeReady = false;
  let blurBgReady = false;
  /** Perspective the warp texture (and any blurs) were computed for. */
  let warpFor: string | null = null;
  // Mixer LUT (unit 3): source-independent, re-baked only when the mixer
  // values change (256×4 bytes — trivial even per drag frame).
  let hslLutTex: WebGLTexture | null = null;
  let hslFor: string | null = null;
  // Curve LUT (unit 4): same pattern as the mixer LUT.
  let curveLutTex: WebGLTexture | null = null;
  let curveFor: string | null = null;
  // Brush-mask coverage textures (units 6..9, E4f): per-slot cache holding
  // the strokes it was rasterized from, so live painting extends the
  // raster incrementally instead of recomputing per pointer move.
  interface BrushSlot {
    key: string;
    strokes: BrushStroke[];
    buffer: Float32Array;
    tex: WebGLTexture;
    width: number;
    height: number;
  }
  const brushSlots: Array<BrushSlot | null> = [null, null, null, null];

  const ensureBrushTexture = (slot: number, strokes: BrushStroke[]): WebGLTexture | null => {
    const bw = Math.max(1, Math.round(srcWidth / 2));
    const bh = Math.max(1, Math.round(srcHeight / 2));
    const key = `${bw}x${bh}:${JSON.stringify(strokes)}`;
    const cached = brushSlots[slot];
    if (cached && cached.key === key) return cached.tex;
    let buffer: Float32Array;
    if (
      cached &&
      cached.width === bw &&
      cached.height === bh &&
      extendRaster(cached.buffer, cached.strokes, strokes, bw, bh)
    ) {
      buffer = cached.buffer; // stamped in place
    } else {
      buffer = rasterizeBrushMask(strokes, bw, bh);
    }
    const tex = cached?.tex ?? createSourceTexture(gl);
    if (!tex) return null;
    const bytes = new Uint8Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) bytes[i] = Math.round(Math.min(1, buffer[i]) * 255);
    gl.activeTexture(gl.TEXTURE6 + slot);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // Single-channel rows aren't 4-byte aligned at arbitrary widths.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, bw, bh, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    brushSlots[slot] = { key, strokes, buffer, tex, width: bw, height: bh };
    return tex;
  };

  /** Bake+upload a 256×1 LUT when its key changed. Returns the texture or
   *  null when allocation failed (caller degrades to disabled). */
  const ensureLut = (
    existing: WebGLTexture | null,
    unit: number,
    size: number,
    key: string,
    lastKey: string | null,
    bake: () => Uint8ClampedArray
  ): WebGLTexture | null => {
    const tex = existing ?? createSourceTexture(gl);
    if (!tex) return null;
    if (lastKey !== key || existing === null) {
      const lut = bake();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        size,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(lut.buffer, lut.byteOffset, lut.length)
      );
    }
    return tex;
  };

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
    for (const t of [fullA, fullB, halfA, halfB, quarterA, quarterB, warpTarget, cloneTarget]) {
      if (t) gl.deleteTexture(t.tex);
    }
    fullA = fullB = halfA = halfB = quarterA = quarterB = warpTarget = cloneTarget = null;
    blurSmallReady = false;
    blurLargeReady = false;
    blurBgReady = false;
    warpFor = null;
    cloneFor = null;
  };

  /** One fullscreen pass: srcTex → target FBO with `program`. */
  const runPass = (
    program: WebGLProgram,
    srcTex: WebGLTexture,
    target: BlurTarget,
    direction?: [number, number],
    setExtraUniforms?: (prog: WebGLProgram) => void
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
    setExtraUniforms?.(program);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /** Clone-stamp pass: heals the source BEFORE the warp (clone coords live
   *  on the framed image). A stamp change invalidates warp + blurs. */
  const computeClone = (stamps: CloneStamp[]): boolean => {
    const key = JSON.stringify(stamps);
    if (cloneFor === key && cloneTarget) return true;
    cloneProgram ??= compileProgram(gl, VERTEX_SHADER, CLONE_FRAGMENT);
    if (!cloneProgram) return false;
    cloneTarget ??= makeTarget(srcWidth, srcHeight);
    if (!cloneTarget) return false;
    runPass(cloneProgram, texture, cloneTarget, undefined, prog => {
      const count = Math.min(stamps.length, MAX_CLONE_STAMPS);
      const geom = new Float32Array(MAX_CLONE_STAMPS * 4);
      const params = new Float32Array(MAX_CLONE_STAMPS * 2);
      for (let i = 0; i < count; i++) {
        const s = stamps[i];
        geom.set([s.srcX, 1 - s.srcY, s.dstX, 1 - s.dstY], i * 4);
        params.set([s.radius, s.feather], i * 2);
      }
      gl.uniform1i(gl.getUniformLocation(prog, 'u_stampCount'), count);
      gl.uniform4fv(gl.getUniformLocation(prog, 'u_stampGeom'), geom);
      gl.uniform2fv(gl.getUniformLocation(prog, 'u_stampParams'), params);
    });
    cloneFor = key;
    warpFor = null; // downstream passes consumed the old input
    blurSmallReady = false;
    blurLargeReady = false;
    blurBgReady = false;
    return true;
  };

  /** Keystone pass: input texture → warpTarget. The warp output is what
   *  blurs and the composite consume, so a perspective change invalidates
   *  blurs. */
  const computeWarp = (p: EngineParams, inputTex: WebGLTexture): boolean => {
    const key = `${p.perspective.vertical},${p.perspective.horizontal}`;
    if (warpFor === key && warpTarget) return true;
    warpProgram ??= compileProgram(gl, VERTEX_SHADER, WARP_FRAGMENT);
    if (!warpProgram) return false;
    warpTarget ??= makeTarget(srcWidth, srcHeight);
    if (!warpTarget) return false;
    runPass(warpProgram, inputTex, warpTarget, undefined, prog => {
      gl.uniform2f(
        gl.getUniformLocation(prog, 'u_persp'),
        p.perspective.vertical,
        p.perspective.horizontal
      );
    });
    warpFor = key;
    blurSmallReady = false;
    blurLargeReady = false;
    blurBgReady = false;
    return true;
  };

  /** σ=1 full-res, ping-pong input → fullA → fullB. */
  const computeBlurSmall = (inputTex: WebGLTexture): boolean => {
    blurSmallProgram ??= compileProgram(gl, VERTEX_SHADER, BLUR_SMALL_FRAGMENT);
    if (!blurSmallProgram) return false;
    fullA ??= makeTarget(srcWidth, srcHeight);
    fullB ??= makeTarget(srcWidth, srcHeight);
    if (!fullA || !fullB) return false;
    runPass(blurSmallProgram, inputTex, fullA, [1, 0]);
    runPass(blurSmallProgram, fullA.tex, fullB, [0, 1]);
    blurSmallReady = true;
    return true;
  };

  /** Half-res downsample (hardware linear), then σ=2 ping-pong; the final
   *  blur lands in halfA and upsamples in the composite's LINEAR fetch. */
  const computeBlurLarge = (inputTex: WebGLTexture): boolean => {
    copyProgram ??= compileProgram(gl, VERTEX_SHADER, COPY_FRAGMENT);
    blurLargeProgram ??= compileProgram(gl, VERTEX_SHADER, BLUR_LARGE_FRAGMENT);
    if (!copyProgram || !blurLargeProgram) return false;
    const hw = Math.max(1, Math.round(srcWidth / 2));
    const hh = Math.max(1, Math.round(srcHeight / 2));
    halfA ??= makeTarget(hw, hh);
    halfB ??= makeTarget(hw, hh);
    if (!halfA || !halfB) return false;
    runPass(copyProgram, inputTex, halfA);
    runPass(blurLargeProgram, halfA.tex, halfB, [1, 0]);
    runPass(blurLargeProgram, halfB.tex, halfA, [0, 1]);
    blurLargeReady = true;
    return true;
  };

  /** Quarter-res defocus (mask background blur): downsample twice via the
   *  copy pass, σ=4 ping-pong; final blur lands in quarterA. */
  const computeBlurBg = (inputTex: WebGLTexture): boolean => {
    copyProgram ??= compileProgram(gl, VERTEX_SHADER, COPY_FRAGMENT);
    blurBgProgram ??= compileProgram(gl, VERTEX_SHADER, BLUR_BG_FRAGMENT);
    if (!copyProgram || !blurBgProgram) return false;
    const qw = Math.max(1, Math.round(srcWidth / 4));
    const qh = Math.max(1, Math.round(srcHeight / 4));
    quarterA ??= makeTarget(qw, qh);
    quarterB ??= makeTarget(qw, qh);
    if (!quarterA || !quarterB) return false;
    runPass(copyProgram, inputTex, quarterA);
    runPass(blurBgProgram, quarterA.tex, quarterB, [1, 0]);
    runPass(blurBgProgram, quarterB.tex, quarterA, [0, 1]);
    blurBgReady = true;
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
    blurBgReady = false;
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
    // Pre-passes in order: clone (heal the framed image) → perspective
    // warp. Each caches by its inputs and invalidates everything
    // downstream on change; turning either off restores the raw chain
    // and equally invalidates.
    let inputTex = texture;
    if (!isNeutralClones(p.clones)) {
      if (computeClone(p.clones) && cloneTarget) inputTex = cloneTarget.tex;
    } else if (cloneFor !== null) {
      cloneFor = null;
      warpFor = null;
      blurSmallReady = false;
      blurLargeReady = false;
      blurBgReady = false;
    }
    if (!isNeutralPerspective(p.perspective)) {
      if (computeWarp(p, inputTex) && warpTarget) inputTex = warpTarget.tex;
    } else if (warpFor !== null) {
      warpFor = null;
      blurSmallReady = false;
      blurLargeReady = false;
      blurBgReady = false;
    }
    // Blur availability degrades gracefully: a failed compile/alloc just
    // leaves the sampler on src — detail sliders no-op instead of breaking.
    const haveSmall = plan.blurSmall && (blurSmallReady || computeBlurSmall(inputTex));
    const haveLarge = plan.blurLarge && (blurLargeReady || computeBlurLarge(inputTex));
    const haveBg =
      wantsBackgroundBlur(p.masks) && (blurBgReady || computeBlurBg(inputTex));

    // LUT stages: bake + upload only when their values changed.
    const wantHsl = !isNeutralHsl(p.hsl);
    if (wantHsl) {
      const key = JSON.stringify(p.hsl);
      hslLutTex = ensureLut(hslLutTex, 3, HSL_LUT_SIZE, key, hslFor, () => bakeHslLut(p.hsl));
      if (hslLutTex) hslFor = key;
    }
    const hslActive = wantHsl && hslLutTex !== null;
    const wantCurves = !isNeutralCurves(p.curves);
    if (wantCurves) {
      const key = JSON.stringify(p.curves);
      curveLutTex = ensureLut(curveLutTex, 4, CURVE_LUT_SIZE, key, curveFor, () =>
        bakeCurveLut(p.curves)
      );
      if (curveLutTex) curveFor = key;
    }
    const curvesActive = wantCurves && curveLutTex !== null;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, srcWidth, srcHeight);
    gl.useProgram(composite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, haveSmall && fullB ? fullB.tex : inputTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, haveLarge && halfA ? halfA.tex : inputTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, hslActive && hslLutTex ? hslLutTex : inputTex);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, curvesActive && curveLutTex ? curveLutTex : inputTex);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, haveBg && quarterA ? quarterA.tex : inputTex);
    gl.uniform1i(loc.src, 0);
    gl.uniform1i(loc.blurSmall, 1);
    gl.uniform1i(loc.blurLarge, 2);
    gl.uniform1i(loc.hslLut, 3);
    gl.uniform1f(loc.hslEnabled, hslActive ? 1 : 0);
    gl.uniform1i(loc.curveLut, 4);
    gl.uniform1f(loc.curveEnabled, curvesActive ? 1 : 0);
    gl.uniform2f(loc.grain, p.grain.amount, p.grain.size);
    gl.uniform1i(loc.blurBg, 5);
    gl.uniform1f(loc.bgBlurEnabled, haveBg ? 1 : 0);
    // Local masks: analytic uniforms, y flipped into the shader's y-up uv.
    // u_maskKind.x = kind (0 radial / 1 linear / 2 brush), .w = blur (E4e).
    const maskCount = Math.min(p.masks.length, MAX_MASKS);
    gl.uniform1i(loc.maskCount, maskCount);
    if (maskCount > 0) {
      const geom = new Float32Array(MAX_MASKS * 4);
      const kind = new Float32Array(MAX_MASKS * 4);
      const adjust = new Float32Array(MAX_MASKS * 3);
      for (let i = 0; i < maskCount; i++) {
        const m = p.masks[i];
        const blur = m.adjust.blur ?? 0;
        if (m.kind === 'radial') {
          geom.set([m.cx, 1 - m.cy, m.rx, m.ry], i * 4);
          kind.set([0, m.feather, m.invert ? 1 : 0, blur], i * 4);
        } else if (m.kind === 'linear') {
          geom.set([m.x0, 1 - m.y0, m.x1, 1 - m.y1], i * 4);
          kind.set([1, 0, 0, blur], i * 4);
        } else {
          // Brush: coverage texture on unit 6+i. A failed raster/alloc
          // degrades to a zero-weight mask (kind stays radial-0 with a
          // zero adjust row) rather than sampling garbage.
          const tex = ensureBrushTexture(i, m.strokes);
          if (tex) {
            kind.set([2, 0, 0, blur], i * 4);
          } else {
            kind.set([0, 0, 0, 0], i * 4);
            geom.set([0, 0, 1e-4, 1e-4], i * 4);
            adjust.set([0, 0, 0], i * 3);
            continue;
          }
        }
        adjust.set([m.adjust.exposure, m.adjust.saturation, m.adjust.temperature], i * 3);
      }
      gl.uniform4fv(loc.maskGeom, geom);
      gl.uniform4fv(loc.maskKind, kind);
      gl.uniform3fv(loc.maskAdjust, adjust);
    }
    // Brush samplers must always point at valid units.
    for (let i = 0; i < MAX_MASKS; i++) {
      gl.activeTexture(gl.TEXTURE6 + i);
      gl.bindTexture(gl.TEXTURE_2D, brushSlots[i]?.tex ?? texture);
      gl.uniform1i(loc.brushMasks[i], 6 + i);
    }
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
      for (const program of [
        copyProgram,
        blurSmallProgram,
        blurLargeProgram,
        blurBgProgram,
        warpProgram,
        cloneProgram,
      ]) {
        if (program) gl.deleteProgram(program);
      }
      if (hslLutTex) gl.deleteTexture(hslLutTex);
      if (curveLutTex) gl.deleteTexture(curveLutTex);
      for (const slot of brushSlots) if (slot) gl.deleteTexture(slot.tex);
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

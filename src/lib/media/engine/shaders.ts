/**
 * GLSL ES 3.00 sources for the color engine. Pure strings — node tests
 * assert every color-math.ts constant appears verbatim, so the GPU pipeline
 * can never drift from the tested reference implementation.
 *
 * The fragment pipeline is STRAIGHT-LINE (no per-stage branching): every
 * neutral stage is an exact or 8-bit-invisible identity, and uniform
 * branches would buy nothing on hardware that executes both sides anyway.
 * Order must match color-math.transformPixel:
 *   legacy trio → exposure → white balance → tone → vibrance → vignette
 */

import {
  BLUR_BG_SIGMA,
  BLUR_BG_TAPS,
  BLUR_LARGE_SIGMA,
  BLUR_LARGE_TAPS,
  BLUR_SMALL_SIGMA,
  BLUR_SMALL_TAPS,
  CLARITY_SCALE,
  EXPOSURE_EV_RANGE,
  gaussianKernel,
  LUMA_B,
  LUMA_G,
  LUMA_R,
  NR_EDGE_HI,
  NR_EDGE_LO,
  SAT_B,
  SAT_G,
  SAT_R,
  SHARPEN_SCALE,
  TONE_POINT_SCALE,
  TONE_SCALE,
  VIBRANCE_SCALE,
  VIGNETTE_INNER,
  VIGNETTE_SCALE,
  WB_TEMP_SCALE,
  WB_TINT_SCALE,
} from './color-math';
import { PERSPECTIVE_SCALE } from './perspective-math';
import {
  HSL_GRAY_GUARD,
  HSL_HUE_RANGE_DEG,
  HSL_LUM_RANGE,
  HSL_LUT_SIZE,
  HSL_SAT_RANGE,
} from './hsl-math';
import { CURVE_LUT_SIZE } from './curves-math';
import { MASK_EV_RANGE, MAX_MASKS } from './mask-math';
import { GRAIN_BASE_WEIGHT, GRAIN_MID_WEIGHT, GRAIN_SCALE } from './grain-math';
import { MAX_CLONE_STAMPS } from './clone-math';

/** Number → GLSL float literal ("2" would be an int and fail to compile). */
function glf(n: number): string {
  const s = String(n);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
}

/** Fullscreen triangle from gl_VertexID — no vertex buffers at all. */
export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 pos = vec2(
    gl_VertexID == 1 ? 3.0 : -1.0,
    gl_VertexID == 2 ? 3.0 : -1.0
  );
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

/** Plain resample (the half-res downsample pass — LINEAR filtering does
 *  the 2×2 averaging in hardware). */
export const COPY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_resolution;
out vec4 outColor;
void main() {
  outColor = vec4(texture(u_src, gl_FragCoord.xy / u_resolution).rgb, 1.0);
}
`;

/** Separable gaussian with the kernel BAKED as constants (test-pinnable,
 *  no uniform arrays). u_direction is (1,0) or (0,1). */
function makeBlurFragment(sigma: number, taps: number): string {
  const weights = gaussianKernel(sigma, taps);
  const lines = [`  vec3 acc = texture(u_src, uv).rgb * ${glf(weights[0])};`];
  for (let i = 1; i < weights.length; i++) {
    lines.push(
      `  acc += (texture(u_src, uv + texel * ${glf(i)}).rgb + texture(u_src, uv - texel * ${glf(i)}).rgb) * ${glf(weights[i])};`
    );
  }
  return `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_resolution;
uniform vec2 u_direction;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 texel = u_direction / u_resolution;
${lines.join('\n')}
  outColor = vec4(acc, 1.0);
}
`;
}

export const BLUR_SMALL_FRAGMENT = makeBlurFragment(BLUR_SMALL_SIGMA, BLUR_SMALL_TAPS);
export const BLUR_LARGE_FRAGMENT = makeBlurFragment(BLUR_LARGE_SIGMA, BLUR_LARGE_TAPS);
export const BLUR_BG_FRAGMENT = makeBlurFragment(BLUR_BG_SIGMA, BLUR_BG_TAPS);

/** Clone-stamp pass (E4g) — the GPU twin of clone-math.applyCloneStamps.
 *  All stamps sample the ORIGINAL source in one draw; feathered mix at
 *  each destination circle. Geometry uniforms are y-up. */
export const CLONE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_resolution;
uniform int u_stampCount;
uniform vec4 u_stampGeom[${MAX_CLONE_STAMPS}];   // srcX, srcY, dstX, dstY
uniform vec2 u_stampParams[${MAX_CLONE_STAMPS}]; // radius (width fraction), feather
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 rgb = texture(u_src, uv).rgb;
  float aspect = u_resolution.y / u_resolution.x;
  for (int i = 0; i < ${MAX_CLONE_STAMPS}; i++) {
    if (i >= u_stampCount) break;
    vec2 d = (uv - u_stampGeom[i].zw) * vec2(1.0, aspect);
    float dist = length(d) / max(u_stampParams[i].x, 1e-4);
    if (dist >= 1.0) continue;
    float w = 1.0 - smoothstep(max(0.0, 1.0 - u_stampParams[i].y), 1.0, dist);
    vec2 offset = u_stampGeom[i].xy - u_stampGeom[i].zw;
    vec3 healed = texture(u_src, clamp(uv + offset, 0.0, 1.0)).rgb;
    rgb = mix(rgb, healed, w);
  }
  outColor = vec4(rgb, 1.0);
}
`;

/** Keystone warp (inverse mapping, centered Y-up coords) — the GPU twin of
 *  perspective-math.ts. Outside samples render opaque black. */
export const WARP_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_resolution;
uniform vec2 u_persp; // vertical, horizontal (0 = none)
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 c = uv - 0.5; // gl_FragCoord is already Y-up
  float w = 1.0 + ${glf(PERSPECTIVE_SCALE)} * (u_persp.x * c.y + u_persp.y * c.x);
  vec2 s = c * w;
  if (abs(s.x) > 0.5 || abs(s.y) > 0.5) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  outColor = vec4(texture(u_src, s + 0.5).rgb, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_src;
uniform sampler2D u_blurSmall; // σ=${glf(BLUR_SMALL_SIGMA)} full-res (bound to u_src when sharpen is 0)
uniform sampler2D u_blurLarge; // σ=${glf(BLUR_LARGE_SIGMA)} half-res (bound to u_src when clarity/NR are 0)
uniform vec2 u_resolution;
uniform vec3 u_bcs;      // brightness, contrast, saturation (1 = neutral)
uniform float u_exposure;
uniform vec2 u_wb;       // temperature, tint (0 = neutral)
uniform vec4 u_tone;     // highlights, shadows, whites, blacks (0 = neutral)
uniform float u_vibrance;
uniform float u_vignette;
uniform vec3 u_detail;   // sharpen, clarity, noiseReduction (0 = off)
uniform sampler2D u_hslLut;  // 256×1 mixer LUT (signed-encoded, see hsl-math)
uniform float u_hslEnabled;  // 0/1 — see the mixer block for why it branches
uniform sampler2D u_curveLut;  // 256×1 tone-curve LUT (see curves-math)
uniform float u_curveEnabled;  // 0/1 — same closed-domain reasoning as HSL
// Local masks (analytic — no textures; geometry pre-flipped to y-up):
uniform int u_maskCount;
uniform vec4 u_maskGeom[${MAX_MASKS}];   // radial: cx,cy,rx,ry | linear: x0,y0,x1,y1
uniform vec4 u_maskKind[${MAX_MASKS}];   // kind (0 radial / 1 linear), feather, invert, unused
uniform vec3 u_maskAdjust[${MAX_MASKS}]; // exposure, saturation, temperature
uniform vec2 u_grain; // amount (0 = off), cell size in device px
uniform sampler2D u_blurBg; // σ=${glf(BLUR_BG_SIGMA)} quarter-res defocus (mask blur)
uniform float u_bgBlurEnabled; // 0/1 — set only when the bg blur pass ran
// Brush-mask coverage textures (E4f) — sampler arrays can't be indexed
// dynamically in ES 3.0, hence four fixed slots (units 6..9).
uniform sampler2D u_brushMask0;
uniform sampler2D u_brushMask1;
uniform sampler2D u_brushMask2;
uniform sampler2D u_brushMask3;

out vec4 outColor;

const vec3 LUMA = vec3(${glf(LUMA_R)}, ${glf(LUMA_G)}, ${glf(LUMA_B)});

/** Mask weight (mask-math.maskWeight's GPU twin) — shared by the blur-mix
 *  (top of pipeline) and the local-light stage. Kind codes: 0 radial,
 *  1 linear, 2 brush (coverage texture; buffers are top-left row order,
 *  so the y flips once here). */
float maskW(int i, vec2 uv) {
  float w;
  if (u_maskKind[i].x > 1.5) {
    vec2 buv = vec2(uv.x, 1.0 - uv.y);
    return i == 0 ? texture(u_brushMask0, buv).r
         : i == 1 ? texture(u_brushMask1, buv).r
         : i == 2 ? texture(u_brushMask2, buv).r
         : texture(u_brushMask3, buv).r;
  }
  if (u_maskKind[i].x < 0.5) {
    vec2 d = (uv - u_maskGeom[i].xy) / max(u_maskGeom[i].zw, vec2(1e-4));
    float inner = max(0.0, 1.0 - u_maskKind[i].y);
    w = 1.0 - smoothstep(inner, 1.0, length(d));
    if (u_maskKind[i].z > 0.5) w = 1.0 - w;
  } else {
    vec2 grad = u_maskGeom[i].zw - u_maskGeom[i].xy;
    float len2 = dot(grad, grad);
    float t = len2 < 1e-8 ? 1.0 : dot(uv - u_maskGeom[i].xy, grad) / len2;
    w = 1.0 - smoothstep(0.0, 1.0, t);
  }
  return w;
}

vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  if (d < 1e-6) return vec3(0.0, 0.0, l);
  float s = d / (1.0 - abs(2.0 * l - 1.0) + 1e-6);
  float h = mx == c.r ? mod((c.g - c.b) / d + 6.0, 6.0)
          : mx == c.g ? (c.b - c.r) / d + 2.0
          : (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}

vec3 hsl2rgb(vec3 hsl) {
  float c = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y;
  float hp = fract(hsl.x) * 6.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgb = hp < 1.0 ? vec3(c, x, 0.0)
           : hp < 2.0 ? vec3(x, c, 0.0)
           : hp < 3.0 ? vec3(0.0, c, x)
           : hp < 4.0 ? vec3(0.0, x, c)
           : hp < 5.0 ? vec3(x, 0.0, c)
           : vec3(c, 0.0, x);
  return rgb + (hsl.z - 0.5 * c);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 rgb = texture(u_src, uv).rgb;

  // Mask blur (background defocus) mixes on the INPUT — before detail and
  // every color stage — so blurred regions take all adjustments uniformly.
  if (u_bgBlurEnabled > 0.5 && u_maskCount > 0) {
    float wBlur = 0.0;
    for (int i = 0; i < ${MAX_MASKS}; i++) {
      if (i >= u_maskCount) break;
      wBlur += maskW(i, uv) * u_maskKind[i].w;
    }
    wBlur = clamp(wBlur, 0.0, 1.0);
    if (wBlur > 0.0) rgb = mix(rgb, texture(u_blurBg, uv).rgb, wBlur);
  }

  // Detail pass FIRST (color math runs on the detail-processed pixel):
  // edge-masked NR toward the large blur → clarity (local-contrast ratio
  // vs large blur) → sharpen (unsharp vs small blur). With zero uniforms
  // every step is an exact identity, samplers bound to src or not.
  vec3 blurL = texture(u_blurLarge, uv).rgb;
  vec3 blurS = texture(u_blurSmall, uv).rgb;
  float lumaLarge = dot(blurL, LUMA);
  float edge = abs(dot(rgb, LUMA) - lumaLarge);
  float nrMask = 1.0 - smoothstep(${glf(NR_EDGE_LO)}, ${glf(NR_EDGE_HI)}, edge);
  rgb = mix(rgb, blurL, u_detail.z * nrMask);
  rgb *= 1.0 + u_detail.y * ${glf(CLARITY_SCALE)} * (dot(rgb, LUMA) - lumaLarge);
  rgb += u_detail.x * ${glf(SHARPEN_SCALE)} * (rgb - blurS);

  // Legacy trio (CSS Filter Effects math — byte parity with applyAdjustments)
  rgb = (rgb * u_bcs.x - 0.5) * u_bcs.y + 0.5;
  float s = u_bcs.z;
  vec3 satR = vec3(${glf(SAT_R)} + 0.787 * s, ${glf(SAT_G)} * (1.0 - s), ${glf(SAT_B)} * (1.0 - s));
  vec3 satG = vec3(${glf(SAT_R)} * (1.0 - s), ${glf(SAT_G)} + 0.285 * s, ${glf(SAT_B)} * (1.0 - s));
  vec3 satB = vec3(${glf(SAT_R)} * (1.0 - s), ${glf(SAT_G)} * (1.0 - s), ${glf(SAT_B)} + 0.928 * s);
  rgb = vec3(dot(rgb, satR), dot(rgb, satG), dot(rgb, satB));

  // Exposure (±${glf(EXPOSURE_EV_RANGE)} EV full scale)
  rgb *= exp2(u_exposure * ${glf(EXPOSURE_EV_RANGE)});

  // White balance (multiplicative; temperature + = warm, tint + = magenta)
  rgb.r *= 1.0 + u_wb.x * ${glf(WB_TEMP_SCALE)};
  rgb.g *= 1.0 - u_wb.y * ${glf(WB_TINT_SCALE)};
  rgb.b *= 1.0 - u_wb.x * ${glf(WB_TEMP_SCALE)};

  // Tone: highlights/shadows ratio-applied (masks vanish at endpoints),
  // whites/blacks additive achromatic (they move the endpoints by design).
  float L = clamp(dot(rgb, LUMA), 0.0, 1.0);
  float dHS = u_tone.x * ${glf(TONE_SCALE)} * smoothstep(0.5, 1.0, L) * (1.0 - L)
            + u_tone.y * ${glf(TONE_SCALE)} * (1.0 - smoothstep(0.0, 0.5, L)) * L * (1.0 - L) * 2.0;
  float dWB = u_tone.z * ${glf(TONE_POINT_SCALE)} * smoothstep(0.65, 1.0, L)
            + u_tone.w * ${glf(TONE_POINT_SCALE)} * (1.0 - smoothstep(0.0, 0.35, L));
  rgb = rgb * (1.0 + dHS / max(L, 1e-4)) + dWB;

  // Vibrance: saturation weighted toward the least-saturated pixels
  float sat = clamp(max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b)), 0.0, 1.0);
  float amount = 1.0 + u_vibrance * ${glf(VIBRANCE_SCALE)} * (1.0 - sat);
  float Lv = dot(rgb, LUMA);
  rgb = vec3(Lv) + (rgb - vec3(Lv)) * amount;

  // Local masks (Phase 2): weighted delta SUMS applied once — N masks are
  // one small loop, not N passes; drags stay uniform-only. Order matches
  // mask-math.applyMaskDeltas: exposure → temperature → saturation.
  if (u_maskCount > 0) {
    float mEv = 0.0;
    float mSat = 0.0;
    float mTemp = 0.0;
    for (int i = 0; i < ${MAX_MASKS}; i++) {
      if (i >= u_maskCount) break;
      float w = maskW(i, uv);
      mEv += w * u_maskAdjust[i].x;
      mSat += w * u_maskAdjust[i].y;
      mTemp += w * u_maskAdjust[i].z;
    }
    rgb *= exp2(mEv * ${glf(MASK_EV_RANGE)});
    rgb.r *= 1.0 + mTemp * ${glf(WB_TEMP_SCALE)};
    rgb.b *= 1.0 - mTemp * ${glf(WB_TEMP_SCALE)};
    float Lmask = dot(rgb, LUMA);
    rgb = vec3(Lmask) + (rgb - vec3(Lmask)) * max(0.0, 1.0 + mSat);
  }

  // Color mixer (HSL, Phase 2): LUT by hue → shift/scale, gray-guarded.
  // Uniform-branched — NOT straight-line like the rest — because the
  // identity path would force a mid-pipeline clamp (HSL is a closed
  // domain), and that would change existing renders of overshooting
  // pixels. The CPU reference skips the stage under the same condition.
  if (u_hslEnabled > 0.5) {
    vec3 base = clamp(rgb, 0.0, 1.0);
    vec3 hsl = rgb2hsl(base);
    float guard = smoothstep(0.0, ${glf(HSL_GRAY_GUARD)}, hsl.y);
    vec4 lut = texture(u_hslLut, vec2((hsl.x * ${glf(HSL_LUT_SIZE - 1)} + 0.5) / ${glf(HSL_LUT_SIZE)}, 0.5));
    // Symmetric-zero decode: byte 128 → exactly 0 (matches hsl-math).
    float hueShift = ((lut.r * 255.0 - 128.0) / 127.5) * ${glf(HSL_HUE_RANGE_DEG)} / 360.0;
    float satMul = 1.0 + ((lut.g * 255.0 - 128.0) / 127.5) * ${glf(HSL_SAT_RANGE)};
    float lumMul = 1.0 + ((lut.b * 255.0 - 128.0) / 127.5) * ${glf(HSL_LUM_RANGE)};
    vec3 mixed = hsl2rgb(vec3(hsl.x + hueShift, clamp(hsl.y * satMul, 0.0, 1.0), clamp(hsl.z * lumMul, 0.0, 1.0)));
    rgb = base + (mixed - base) * guard;
  }

  // Tone curves (Phase 2): per-channel LUT (master pre-composed at bake).
  // Branched for the same closed-domain reason as the mixer above.
  if (u_curveEnabled > 0.5) {
    vec3 cin = clamp(rgb, 0.0, 1.0);
    rgb = vec3(
      texture(u_curveLut, vec2((cin.r * ${glf(CURVE_LUT_SIZE - 1)} + 0.5) / ${glf(CURVE_LUT_SIZE)}, 0.5)).r,
      texture(u_curveLut, vec2((cin.g * ${glf(CURVE_LUT_SIZE - 1)} + 0.5) / ${glf(CURVE_LUT_SIZE)}, 0.5)).g,
      texture(u_curveLut, vec2((cin.b * ${glf(CURVE_LUT_SIZE - 1)} + 0.5) / ${glf(CURVE_LUT_SIZE)}, 0.5)).b
    );
  }

  // Vignette: aspect-corrected radial falloff; + darkens, − lightens
  float ay = u_resolution.y / u_resolution.x;
  vec2 p = (uv - 0.5) * vec2(1.0, ay);
  float d = length(p) / (0.5 * length(vec2(1.0, ay)));
  float f = smoothstep(${glf(VIGNETTE_INNER)}, 1.0, d);
  if (u_vignette >= 0.0) {
    rgb *= 1.0 - u_vignette * ${glf(VIGNETTE_SCALE)} * f;
  } else {
    rgb = mix(rgb, vec3(1.0), -u_vignette * ${glf(VIGNETTE_SCALE)} * f);
  }

  // Film grain: white noise per cell, midtone-weighted, LAST look stage
  // (over the vignette, like real stock). Stochastic — the CPU twin uses
  // its own hash; the parity contract is statistical, not per-pixel.
  if (u_grain.x > 0.0) {
    vec2 cell = floor(gl_FragCoord.xy / max(u_grain.y, 1.0));
    float gn = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    float Lg = dot(clamp(rgb, 0.0, 1.0), LUMA);
    rgb += gn * u_grain.x * ${glf(GRAIN_SCALE)} * (${glf(GRAIN_BASE_WEIGHT)} + ${glf(GRAIN_MID_WEIGHT)} * 4.0 * Lg * (1.0 - Lg));
  }

  // Ordered-ish dither: ±0.5/255 of position hash kills the banding that
  // smooth tone/vignette gradients produce on an 8-bit output.
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  outColor = vec4(clamp(rgb, 0.0, 1.0) + dither / 255.0, 1.0);
}
`;

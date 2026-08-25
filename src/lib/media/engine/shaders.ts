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

out vec4 outColor;

const vec3 LUMA = vec3(${glf(LUMA_R)}, ${glf(LUMA_G)}, ${glf(LUMA_B)});

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 rgb = texture(u_src, uv).rgb;

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

  // Ordered-ish dither: ±0.5/255 of position hash kills the banding that
  // smooth tone/vignette gradients produce on an 8-bit output.
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  outColor = vec4(clamp(rgb, 0.0, 1.0) + dither / 255.0, 1.0);
}
`;

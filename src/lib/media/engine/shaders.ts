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
  EXPOSURE_EV_RANGE,
  LUMA_B,
  LUMA_G,
  LUMA_R,
  SAT_B,
  SAT_G,
  SAT_R,
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

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_src;
uniform vec2 u_resolution;
uniform vec3 u_bcs;      // brightness, contrast, saturation (1 = neutral)
uniform float u_exposure;
uniform vec2 u_wb;       // temperature, tint (0 = neutral)
uniform vec4 u_tone;     // highlights, shadows, whites, blacks (0 = neutral)
uniform float u_vibrance;
uniform float u_vignette;

out vec4 outColor;

const vec3 LUMA = vec3(${glf(LUMA_R)}, ${glf(LUMA_G)}, ${glf(LUMA_B)});

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 rgb = texture(u_src, uv).rgb;

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

  outColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

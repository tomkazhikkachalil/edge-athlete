/**
 * UI ↔ parameter mapping for editor sliders — pure, node-tested.
 *
 * Every slider presents −100..100 with 0 = neutral (the Lightroom idiom),
 * regardless of the parameter's native range:
 *   - signed params (engine round: exposure, temperature, …) are −1..1
 *   - legacy trio params (contrast, saturation) are 0..2 with 1 neutral
 *   - unsigned params (sharpen, …) are 0..1 shown as 0..100
 * UI space is integers; param = exact linear map of the integer, so a
 * ui → param → ui round-trip is lossless.
 */

export function signedToUi(value: number): number {
  return Math.round(value * 100);
}

export function uiToSigned(ui: number): number {
  return ui / 100;
}

export function legacyToUi(value: number): number {
  return Math.round((value - 1) * 100);
}

export function uiToLegacy(ui: number): number {
  return 1 + ui / 100;
}

export function unsignedToUi(value: number): number {
  return Math.round(value * 100);
}

export function uiToUnsigned(ui: number): number {
  return ui / 100;
}

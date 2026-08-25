/**
 * Human labels for history-rail entries — pure, node-tested. Keys are the
 * coalescing signatures patchRecipe records (per-control for sliders,
 * sorted-field-list for object patches), so this map is the single place
 * that turns them into UI words.
 */

const LABELS: Record<string, string> = {
  // Geometry (CropStage patch key sets)
  crop: 'Crop',
  'aspect,crop': 'Crop ratio',
  aspect: 'Crop ratio',
  rotate: 'Rotate',
  straighten: 'Straighten',
  // Light
  'light.exposure': 'Exposure',
  'light.highlights': 'Highlights',
  'light.shadows': 'Shadows',
  'light.whites': 'Whites',
  'light.blacks': 'Blacks',
  'adjustments.contrast': 'Contrast',
  // Color
  'color.temperature': 'Temperature',
  'color.tint': 'Tint',
  'color.vibrance': 'Vibrance',
  'adjustments.saturation': 'Saturation',
  // Detail
  'detail.sharpen': 'Sharpen',
  'detail.clarity': 'Clarity',
  'detail.noiseReduction': 'Noise reduction',
  'detail.vignette': 'Vignette',
  // Filters + one-taps
  filterId: 'Filter',
  filterStrength: 'Filter intensity',
  auto: 'Auto enhance',
  'reset.light': 'Reset light',
  'reset.color': 'Reset color',
  'reset.detail': 'Reset detail',
  // Legacy full-object patch (pre-per-control rounds)
  adjustments: 'Adjustments',
  // Video
  clips: 'Clips',
  posterTime: 'Cover frame',
};

/** null = the oldest retained state. Unknown keys degrade to 'Edit'. */
export function labelForKeys(keys: string | null): string {
  if (keys === null) return 'Original';
  return LABELS[keys] ?? 'Edit';
}

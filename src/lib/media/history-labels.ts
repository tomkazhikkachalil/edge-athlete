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
  // Perspective
  'perspective.vertical': 'Perspective',
  'perspective.horizontal': 'Perspective',
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
  // Per-band mixer keys ('hsl.aqua.saturation') are open-ended — prefix rule.
  if (keys.startsWith('hsl.')) return 'Color mix';
  if (keys === 'reset.hsl') return 'Reset color mix';
  if (keys.startsWith('curves.')) return 'Curves';
  if (keys === 'reset.curves') return 'Reset curves';
  if (keys === 'wb.eyedropper') return 'White balance';
  if (keys.startsWith('grain.')) return 'Grain';
  if (keys === 'mask.add') return 'Add mask';
  if (keys === 'mask.delete') return 'Remove mask';
  if (keys.startsWith('mask.')) return 'Mask';
  if (keys === 'clone.add') return 'Add retouch';
  if (keys === 'clone.delete') return 'Remove retouch';
  if (keys.startsWith('clone.')) return 'Retouch';
  return LABELS[keys] ?? 'Edit';
}

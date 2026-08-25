/**
 * Media editor — public contract.
 *
 * The editor is a pure transform step: it takes original Files, returns
 * rendered Blobs plus the EditRecipe that produced them. It NEVER uploads —
 * each surface keeps its own upload timing (deferred-to-submit vs
 * immediate-on-select) and feeds `EditedMedia.file` wherever it previously
 * fed the picked File.
 */

export type MediaKind = 'image' | 'video';

export type AspectRatioId = 'free' | '1:1' | '4:5' | '9:16' | '16:9' | '3:1';

/** All values 1 = neutral. Range 0–2, mirroring CSS filter semantics. */
export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
}

/** Engine round: all values 0 = neutral, range −1..1. Light = tonal range. */
export interface LightAdjustments {
  exposure: number; // ±2 EV at full scale
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
}

/** 0 = neutral, −1..1. temperature + = warm, tint + = magenta (LR convention). */
export interface ColorAdjustments {
  temperature: number;
  tint: number;
  vibrance: number;
}

/** sharpen/clarity/noiseReduction 0..1 (0 = off); vignette −1..1 (+ darkens). */
export interface DetailAdjustments {
  sharpen: number;
  clarity: number;
  noiseReduction: number;
  vignette: number;
}

/** Keystone correction, −1..1 per axis, 0 = none. Optional on the recipe
 *  (absent = none) — added within v3, additive like videoClip.speed. */
export interface PerspectiveCorrection {
  vertical: number;
  horizontal: number;
}

/** The eight color-mixer bands (Phase 2 E4a — the Lightroom set). */
export type HslBandName =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'aqua'
  | 'blue'
  | 'purple'
  | 'magenta';

/** Per-band mixer sliders, −1..1, 0 = neutral. */
export interface HslBandAdjust {
  hue: number;
  saturation: number;
  luminance: number;
}

/** Full mixer state — every band present (the engine's normalized form). */
export type HslMix = Record<HslBandName, HslBandAdjust>;

/** One tone-curve control point, both axes 0..1 (input → output). */
export interface CurvePoint {
  x: number;
  y: number;
}

/** Tone curves (Phase 2 E4b): master applied first, then per-channel.
 *  Absent channel = identity. Points sorted by x, 2..8 per channel. */
export interface CurveSet {
  master?: CurvePoint[];
  r?: CurvePoint[];
  g?: CurvePoint[];
  b?: CurvePoint[];
}

/** Local adjustment carried by a mask, −1..1, 0 = neutral. */
export interface MaskAdjust {
  exposure: number; // ±1 EV locally
  saturation: number;
  temperature: number;
  /** Background blur strength 0..1 (optional — E4e, additive in v3). */
  blur?: number;
}

/** Film grain (Phase 2 E4d): amount 0..1 (0 = off), cell size 1..3 px. */
export interface GrainSettings {
  amount: number;
  size: number;
}

/** Bundled overlay faces (E4h) — family names owned by globals.css. */
export type OverlayFontId = 'inter' | 'lora' | 'caveat';

/**
 * Text / emoji-sticker overlay (Phase 2 E4h). (x, y) is the CENTER,
 * normalized top-left space on the framed image; size is the text height
 * as a fraction of image WIDTH; rotation in degrees.
 */
export type Overlay =
  | {
      kind: 'text';
      content: string; // 1..120 chars
      x: number;
      y: number;
      size: number; // 0.02..0.3
      fontId: OverlayFontId;
      color: string; // '#rrggbb'
      rotation: number; // −45..45
      pill?: boolean; // rounded translucent backdrop
    }
  | {
      kind: 'emoji';
      emoji: string; // 1..16 chars (ZWJ sequences)
      x: number;
      y: number;
      size: number;
      rotation: number;
    };

/** Clone stamp (Phase 2 E4g): copy a feathered circle from (src) over
 *  (dst). Normalized to the FRAMED image, origin top-left; radius is a
 *  fraction of image WIDTH. Max 8. */
export interface CloneStamp {
  srcX: number;
  srcY: number;
  dstX: number;
  dstY: number;
  radius: number; // 0.01..0.5
  feather: number; // 0..1
}

/** One painted stroke (E4f): decimated pointer path, brush radius as a
 *  fraction of image WIDTH (discs are circular in image space), feather
 *  0..1, erase subtracts instead of painting. */
export interface BrushStroke {
  points: Array<{ x: number; y: number }>; // 1..256, normalized top-left
  radius: number; // 0.01..0.5
  feather: number; // 0..1
  erase?: boolean;
}

/**
 * Local-adjustment masks (Phase 2 E4c/E4f). Geometry normalized to the
 * FRAMED image, ORIGIN TOP-LEFT. Radial = ellipse (full effect inside,
 * feathered to the edge, invertible); linear = gradient from (x0,y0)
 * (full) to (x1,y1) (none); brush = painted strokes rasterized to a
 * coverage buffer. Max 4 (shader uniform arrays / sampler slots).
 */
export type Mask =
  | {
      kind: 'radial';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      feather: number; // 0..1
      invert: boolean;
      adjust: MaskAdjust;
    }
  | {
      kind: 'linear';
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      adjust: MaskAdjust;
    }
  | {
      kind: 'brush';
      strokes: BrushStroke[]; // 0..32
      adjust: MaskAdjust;
    }
  | {
      /** Raster mask ingested from a data source (Phase 3: AI subject
       *  segmentation) — RLE-encoded binary coverage at model resolution
       *  (≤512²), feathered on decode. Invert flips subject↔background. */
      kind: 'data';
      width: number;
      height: number;
      rle: string;
      feather: number; // 0..1
      invert: boolean;
      adjust: MaskAdjust;
    };

/**
 * Crop rectangle in source pixels, in the ROTATED bounding-box coordinate
 * space (react-easy-crop's croppedAreaPixels convention — rotation is applied
 * first, then the crop is read against the rotated image's bounding box).
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Recipe v3 (engine round). The legacy `adjustments` trio stays verbatim so
 * existing v2 recipes render byte-identically (contrast/saturation remain the
 * UI's Contrast/Saturation; brightness is honored for old recipes but has no
 * slider in the new UI — exposure supersedes it). Everything new is
 * zero/false-neutral, so v2 → v3 upgrade is a spread plus neutrals.
 */
export interface ImageRecipe {
  kind: 'image';
  crop: CropRect | null; // null = uncropped
  rotate: 0 | 90 | 180 | 270; // quarter-turn button
  straighten: number; // degrees, -45..45 (slider), added to rotate
  /** Mirror, applied to the SOURCE before rotation (innermost in the
   *  transform chain) — crop coords live in the flipped image's rotated
   *  bbox, so all existing crop math is unchanged. */
  flipH: boolean;
  flipV: boolean;
  adjustments: Adjustments;
  light: LightAdjustments;
  color: ColorAdjustments;
  detail: DetailAdjustments;
  filterId: string | null; // preset applied on top of adjustments
  /** 0..1 intensity of the preset (1 = full). Irrelevant when filterId null. */
  filterStrength: number;
  aspect: AspectRatioId;
  /** Keystone correction, applied to the FRAMED image (after crop) so crop
   *  coordinates stay valid; out-of-source edges render black. */
  perspective?: PerspectiveCorrection;
  /** Color mixer (Phase 2): sparse — absent bands are neutral. */
  hsl?: Partial<Record<HslBandName, HslBandAdjust>>;
  /** Tone curves (Phase 2): absent = identity. */
  curves?: CurveSet;
  /** Local-adjustment masks (Phase 2): absent/empty = none. Max 4. */
  masks?: Mask[];
  /** Film grain (Phase 2): absent or amount 0 = none. */
  grain?: GrainSettings;
  /** Clone stamps (Phase 2 healing v1): absent/empty = none. Max 8. */
  clones?: CloneStamp[];
  /** Text + emoji sticker overlays (Phase 2 E4h): absent/empty = none.
   *  Max 8. Drawn LAST (over grain/vignette) by 2D canvas, never by the
   *  engine — glyph raster is a canvas job. */
  overlays?: Overlay[];
}

/** One segment of the output timeline — a [in, out) slice of the SOURCE. */
export interface VideoClip {
  in: number; // source seconds
  out: number; // source seconds, > in
  volume: number; // 0–1; 0 = muted
  /** Playback speed (slo-mo round): 0.25 | 0.5 | 1 | 2; absent = 1. A
   *  slowed/sped clip's TIMELINE length is (out − in) / speed, and its
   *  audio is muted on export (pitch-preserving stretch is a follow-up). */
  speed?: number;
}

/**
 * Recipe v2 (multi-clip round). `clips` is the OUTPUT timeline in order —
 * every clip slices the same source file; [] means "whole file, untouched"
 * (so an unedited video stays a pass-through). `crop` is the aspect reframe
 * in source display pixels. `posterTime` is TIMELINE-space seconds (with []
 * clips, timeline == source).
 */
export interface VideoRecipe {
  kind: 'video';
  clips: VideoClip[];
  crop: CropRect | null;
  aspect: AspectRatioId;
  posterTime: number;
}

export type EditRecipe = ImageRecipe | VideoRecipe;

/** Input to the editor. `recipe` rehydrates prior edits when re-opening. */
export interface MediaAsset {
  id: string; // stable per composer session
  file: File; // ORIGINAL source file
  kind: MediaKind;
  recipe?: EditRecipe;
}

/** Output of the editor, one per asset (video split appends a '-b' id). */
export interface EditedMedia {
  id: string;
  blob: Blob;
  file: File; // blob wrapped with derived name + correct extension
  previewUrl: string; // objectURL of blob — the CALLER owns revocation
  kind: MediaKind;
  posterBlob?: Blob; // video only
  sourceFile: File; // original, for re-editing
  recipe: EditRecipe;
  edited: boolean; // false = pass-through (GIF, no-op, unsupported video)
  /** Output metadata, best-effort (probe failures leave them unset) —
   *  persisted to post_media.width/height/duration. */
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface OutputConfig {
  maxDimension: number; // longest-edge cap, e.g. 2048 posts / 512 avatar
  mime: 'image/jpeg' | 'image/webp';
  quality: number; // 0–1
}

export interface EditorConfig {
  aspectRatios: AspectRatioId[]; // offered ratios; first = default
  enforcedRatio?: Exclude<AspectRatioId, 'free'>; // locks the ratio UI (avatar 1:1)
  circularPreview?: boolean; // round crop mask (avatar)
  allowVideo: boolean;
  maxAssets: number; // 1 = single-asset mode, no filmstrip
  output: OutputConfig;
}

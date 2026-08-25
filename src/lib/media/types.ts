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

export type AspectRatioId = 'free' | '1:1' | '4:5' | '16:9' | '3:1';

/** All values 1 = neutral. Range 0–2, mirroring CSS filter semantics. */
export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
}

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

export interface ImageRecipe {
  kind: 'image';
  crop: CropRect | null; // null = uncropped
  rotate: 0 | 90 | 180 | 270; // quarter-turn button
  straighten: number; // degrees, -45..45 (slider), added to rotate
  adjustments: Adjustments;
  filterId: string | null; // preset applied on top of adjustments
  aspect: AspectRatioId;
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

/**
 * Pure geometry for the hands-on crop box (Oct 2026): a rectangle the person
 * sizes with their fingers — corners, edges, a drag inside to move it, two
 * fingers to scale it — instead of a fixed frame with ratio chips. No DOM;
 * node-tested. The stage (`CropCanvas`) only translates pointers into these
 * calls, so the box on screen and the export can never disagree.
 *
 * SPACE: everything here is in FRAME pixels — the rotated bounding box of the
 * source (`CropRect`'s convention, see types.ts). The picture itself is the
 * natural-size rectangle rotated about the frame's centre; at a quarter turn
 * the two coincide, with a straighten angle the frame has four empty wedges.
 * A box is VALID when all four of its corners are on the picture, so a crop
 * never exports a black wedge.
 */

import { clampCrop, isFullFrameCrop, rotatedSize, totalRotation } from './crop-math';
import type { CropRect } from './types';

export interface Size {
  width: number;
  height: number;
}

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export const CROP_CORNERS: readonly CropHandle[] = ['nw', 'ne', 'sw', 'se'];
export const CROP_EDGES: readonly CropHandle[] = ['n', 's', 'e', 'w'];

/** The source and how it is turned. Video has no rotation: both are 0. */
export interface CropFrame {
  /** Natural size in display pixels (EXIF applied). */
  natural: Size;
  /** Quarter turns, degrees. */
  rotate: number;
  /** Straighten angle, degrees. */
  straighten: number;
}

export interface CropContext {
  frame: CropFrame;
  /** Locked width / height, or null for a free box. */
  aspect: number | null;
  /** The smallest side the box may shrink to, in frame pixels. */
  minSize: number;
}

const DEG_TO_RAD = Math.PI / 180;
/** Sub-pixel slack for the on-the-picture test (rounding, float rotation). */
const INSIDE_EPSILON = 0.75;
const BISECT_STEPS = 24;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

export function frameBounds(frame: CropFrame): Size {
  return rotatedSize(
    frame.natural.width,
    frame.natural.height,
    totalRotation(frame.rotate, frame.straighten)
  );
}

/** Quarter turns only — the picture fills the frame exactly. */
export function isAxisAligned(frame: CropFrame): boolean {
  const remainder = Math.abs(totalRotation(frame.rotate, frame.straighten)) % 90;
  return remainder < 1e-6 || 90 - remainder < 1e-6;
}

/** Width / height of the picture as it sits on screen (quarter turns swap it). */
export function displayedAspect(frame: CropFrame): number {
  const { width, height } = frame.natural;
  const quarter = Math.round(frame.rotate / 90);
  return quarter % 2 === 0 ? width / height : height / width;
}

function pointOnPicture(x: number, y: number, frame: CropFrame, bounds: Size): boolean {
  const radians = -totalRotation(frame.rotate, frame.straighten) * DEG_TO_RAD;
  const dx = x - bounds.width / 2;
  const dy = y - bounds.height / 2;
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
  return (
    Math.abs(localX) <= frame.natural.width / 2 + INSIDE_EPSILON &&
    Math.abs(localY) <= frame.natural.height / 2 + INSIDE_EPSILON
  );
}

/** Are all four corners of `rect` on the (possibly tilted) picture? */
export function insidePicture(rect: CropRect, frame: CropFrame): boolean {
  const bounds = frameBounds(frame);
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return (
    pointOnPicture(rect.x, rect.y, frame, bounds) &&
    pointOnPicture(right, rect.y, frame, bounds) &&
    pointOnPicture(rect.x, bottom, frame, bounds) &&
    pointOnPicture(right, bottom, frame, bounds)
  );
}

function lerpRect(from: CropRect, to: CropRect, t: number): CropRect {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    width: from.width + (to.width - from.width) * t,
    height: from.height + (to.height - from.height) * t,
  };
}

/**
 * The furthest point from `from` (valid) towards `to` that is still valid.
 * The valid set is convex in (x, y, width, height) — each corner is affine in
 * those four and the picture is a convex polygon — so a bisection on the
 * straight line between them finds the boundary.
 */
function furthestValid(from: CropRect, to: CropRect, frame: CropFrame): CropRect {
  let low = 0;
  let high = 1;
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = (low + high) / 2;
    if (insidePicture(lerpRect(from, to, mid), frame)) low = mid;
    else high = mid;
  }
  return lerpRect(from, to, low);
}

const travel = (a: CropRect, b: CropRect) =>
  Math.abs(a.x - b.x) +
  Math.abs(a.y - b.y) +
  Math.abs(a.width - b.width) +
  Math.abs(a.height - b.height);

/**
 * Hold a proposed box on the picture. `last` is the box before this move (the
 * previous frame of the gesture). A free box may slide along the picture's
 * edge: when the straight move is blocked, the horizontal and the vertical
 * half of it are tried on their own and the one that gets further wins.
 */
function settle(last: CropRect, proposal: CropRect, frame: CropFrame, slide: boolean): CropRect {
  if (isAxisAligned(frame) || insidePicture(proposal, frame)) return proposal;
  if (!insidePicture(last, frame)) return shrinkToFit(proposal, frame);
  let best = furthestValid(last, proposal, frame);
  if (!slide) return best;
  const halves: CropRect[] = [
    { x: proposal.x, width: proposal.width, y: last.y, height: last.height },
    { x: last.x, width: last.width, y: proposal.y, height: proposal.height },
  ];
  for (const half of halves) {
    const candidate = insidePicture(half, frame) ? half : furthestValid(last, half, frame);
    if (travel(last, candidate) > travel(last, best)) best = candidate;
  }
  return best;
}

/** The smallest box of a locked ratio whose short side is `minSize`. */
function lockedMinimum(bounds: Size, minSize: number, aspect: number): Size {
  let width = aspect >= 1 ? minSize * aspect : minSize;
  let height = width / aspect;
  const over = Math.max(width / bounds.width, height / bounds.height, 1);
  width /= over;
  height /= over;
  return { width, height };
}

function aspectMatches(rect: CropRect, aspect: number): boolean {
  return Math.abs(rect.width / rect.height - aspect) / aspect < 0.01;
}

/** The largest box of `aspect` centred inside `rect`. */
function snapToAspect(rect: CropRect, aspect: number): CropRect {
  const width = Math.min(rect.width, rect.height * aspect);
  const height = width / aspect;
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
}

function proposeMove(start: CropRect, dx: number, dy: number, bounds: Size): CropRect {
  return {
    ...start,
    x: clamp(start.x + dx, 0, Math.max(0, bounds.width - start.width)),
    y: clamp(start.y + dy, 0, Math.max(0, bounds.height - start.height)),
  };
}

function proposeFree(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  bounds: Size,
  minSize: number
): CropRect {
  const minWidth = Math.min(minSize, bounds.width);
  const minHeight = Math.min(minSize, bounds.height);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - minWidth);
  if (handle.includes('e')) right = clamp(right + dx, left + minWidth, bounds.width);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minHeight);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minHeight, bounds.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A locked box scales as a whole. A corner keeps the opposite corner still
 * and follows whichever axis the finger moved further (relative to the box);
 * an edge keeps the opposite edge still and stays centred on the other axis.
 */
function proposeLocked(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  bounds: Size,
  aspect: number,
  minSize: number
): CropRect {
  const base = aspectMatches(start, aspect) ? start : snapToAspect(start, aspect);
  const left = base.x;
  const top = base.y;
  const right = base.x + base.width;
  const bottom = base.y + base.height;
  const centreX = left + base.width / 2;
  const centreY = top + base.height / 2;
  const east = handle.includes('e');
  const west = handle.includes('w');
  const north = handle.includes('n');
  const south = handle.includes('s');
  const horizontal = east || west;
  const vertical = north || south;

  const scaleX = horizontal ? (base.width + (east ? dx : -dx)) / base.width : null;
  const scaleY = vertical ? (base.height + (south ? dy : -dy)) / base.height : null;
  let scale = 1;
  if (scaleX !== null && scaleY !== null) {
    scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
  } else if (scaleX !== null) {
    scale = scaleX;
  } else if (scaleY !== null) {
    scale = scaleY;
  }

  const roomX = horizontal
    ? east
      ? bounds.width - left
      : right
    : 2 * Math.min(centreX, bounds.width - centreX);
  const roomY = vertical
    ? south
      ? bounds.height - top
      : bottom
    : 2 * Math.min(centreY, bounds.height - centreY);
  const maxScale = Math.min(roomX / base.width, roomY / base.height);
  const minScale = Math.min(lockedMinimum(bounds, minSize, aspect).width / base.width, maxScale);
  scale = clamp(scale, minScale, maxScale);

  const width = base.width * scale;
  const height = base.height * scale;
  return {
    x: horizontal ? (east ? left : right - width) : centreX - width / 2,
    y: vertical ? (south ? top : bottom - height) : centreY - height / 2,
    width,
    height,
  };
}

/**
 * One frame of a one-finger gesture. `start` is the box when the finger went
 * down and (dx, dy) its total travel since, in frame pixels — so the box never
 * drifts from the finger; `last` is the previous frame's result.
 */
export function dragCrop(
  start: CropRect,
  handle: CropHandle | 'move',
  dx: number,
  dy: number,
  last: CropRect,
  context: CropContext
): CropRect {
  const bounds = frameBounds(context.frame);
  if (handle === 'move') {
    return settle(last, proposeMove(start, dx, dy, bounds), context.frame, true);
  }
  if (context.aspect !== null) {
    const proposal = proposeLocked(start, handle, dx, dy, bounds, context.aspect, context.minSize);
    return settle(last, proposal, context.frame, false);
  }
  const proposal = proposeFree(start, handle, dx, dy, bounds, context.minSize);
  return settle(last, proposal, context.frame, true);
}

/**
 * Two fingers: scale the box about its own centre by `factor` (the fingers'
 * distance now over their distance at the start), keeping its shape.
 */
export function scaleCrop(
  start: CropRect,
  factor: number,
  last: CropRect,
  context: CropContext
): CropRect {
  const bounds = frameBounds(context.frame);
  const base =
    context.aspect !== null && !aspectMatches(start, context.aspect)
      ? snapToAspect(start, context.aspect)
      : start;
  const centreX = base.x + base.width / 2;
  const centreY = base.y + base.height / 2;
  const maxScale = Math.min(
    (2 * Math.min(centreX, bounds.width - centreX)) / base.width,
    (2 * Math.min(centreY, bounds.height - centreY)) / base.height
  );
  const minimum = lockedMinimum(bounds, context.minSize, base.width / base.height);
  const minScale = Math.min(minimum.width / base.width, maxScale);
  const scale = clamp(Number.isFinite(factor) ? factor : 1, minScale, maxScale);
  const width = base.width * scale;
  const height = base.height * scale;
  const proposal = { x: centreX - width / 2, y: centreY - height / 2, width, height };
  return settle(last, proposal, context.frame, false);
}

/**
 * Shrink `rect` about its own centre until it sits on the picture. A box
 * whose centre is off the picture is first moved to the frame's centre.
 */
export function shrinkToFit(rect: CropRect, frame: CropFrame): CropRect {
  if (insidePicture(rect, frame)) return rect;
  const bounds = frameBounds(frame);
  let centreX = rect.x + rect.width / 2;
  let centreY = rect.y + rect.height / 2;
  if (!pointOnPicture(centreX, centreY, frame, bounds)) {
    centreX = bounds.width / 2;
    centreY = bounds.height / 2;
  }
  const point: CropRect = { x: centreX, y: centreY, width: 0, height: 0 };
  const full: CropRect = {
    x: centreX - rect.width / 2,
    y: centreY - rect.height / 2,
    width: rect.width,
    height: rect.height,
  };
  return furthestValid(point, full, frame);
}

/**
 * The largest box of `aspect` on the picture, centred — then moved as close
 * to `around`'s centre as the picture allows, so a ratio chosen after a crop
 * stays on what the person had framed.
 */
export function ratioCrop(frame: CropFrame, aspect: number, around?: CropRect | null): CropRect {
  const bounds = frameBounds(frame);
  const width = Math.min(bounds.width, bounds.height * aspect);
  const height = width / aspect;
  const centred = shrinkToFit(
    { x: (bounds.width - width) / 2, y: (bounds.height - height) / 2, width, height },
    frame
  );
  if (!around) return centred;
  const moved = proposeMove(
    centred,
    around.x + around.width / 2 - (centred.x + centred.width / 2),
    around.y + around.height / 2 - (centred.y + centred.height / 2),
    bounds
  );
  return settle(centred, moved, frame, true);
}

/**
 * The box after the picture turned (a straighten drag, or a load with a
 * locked ratio). null = the whole frame, which only exists at a quarter turn
 * with no lock; a tilted picture with no crop yet gets the largest box of its
 * own shape, so the wedges never reach the export.
 *
 * `from` is the frame the crop was measured in. The picture turns about the
 * frame's CENTRE and the frame grows and shrinks round it, so a box keeps its
 * place on the picture by keeping its offset from the centre — not from the
 * top-left corner, which moves.
 */
export function refitCrop(
  crop: CropRect | null,
  frame: CropFrame,
  aspect: number | null,
  from?: CropFrame
): CropRect | null {
  if (crop === null) {
    if (aspect !== null) return ratioCrop(frame, aspect);
    if (isAxisAligned(frame)) return null;
    return ratioCrop(frame, displayedAspect(frame));
  }
  const bounds = frameBounds(frame);
  let placed = crop;
  if (from) {
    const before = frameBounds(from);
    placed = {
      ...crop,
      x: crop.x + (bounds.width - before.width) / 2,
      y: crop.y + (bounds.height - before.height) / 2,
    };
  }
  return shrinkToFit(clampCrop(placed, bounds), frame);
}

/**
 * A box carried through one clockwise quarter turn: `before` is the frame it
 * was measured in; the result lives in the turned frame (height × width).
 */
export function rotateCropQuarter(rect: CropRect, before: Size): CropRect {
  return {
    x: before.height - (rect.y + rect.height),
    y: rect.x,
    width: rect.height,
    height: rect.width,
  };
}

/**
 * What the recipe stores: whole pixels inside the frame. Rounded to the
 * NEAREST pixel, so a box that was only moved keeps its size — unless that
 * would put a corner back on a tilted picture's wedge, in which case it is
 * rounded INWARD. null = the whole, unturned frame — not an edit, so an
 * untouched photo stays a pass-through.
 */
export function normalizeCrop(rect: CropRect, frame: CropFrame): CropRect | null {
  const bounds = frameBounds(frame);
  const maxWidth = Math.max(1, Math.round(bounds.width));
  const maxHeight = Math.max(1, Math.round(bounds.height));

  const nearestX = clamp(Math.round(rect.x), 0, maxWidth - 1);
  const nearestY = clamp(Math.round(rect.y), 0, maxHeight - 1);
  let out: CropRect = {
    x: nearestX,
    y: nearestY,
    width: clamp(Math.round(rect.width), 1, maxWidth - nearestX),
    height: clamp(Math.round(rect.height), 1, maxHeight - nearestY),
  };
  if (!isAxisAligned(frame) && !insidePicture(out, frame)) {
    const slack = 1e-3;
    const x = clamp(Math.ceil(rect.x - slack), 0, maxWidth - 1);
    const y = clamp(Math.ceil(rect.y - slack), 0, maxHeight - 1);
    const right = clamp(Math.floor(rect.x + rect.width + slack), x + 1, maxWidth);
    const bottom = clamp(Math.floor(rect.y + rect.height + slack), y + 1, maxHeight);
    out = { x, y, width: right - x, height: bottom - y };
  }
  if (isAxisAligned(frame) && isFullFrameCrop(out, { width: maxWidth, height: maxHeight })) {
    return null;
  }
  return out;
}

/** The whole frame as a box — what a null crop looks like on the stage. */
export function fullCrop(frame: CropFrame): CropRect {
  const bounds = frameBounds(frame);
  return { x: 0, y: 0, width: bounds.width, height: bounds.height };
}

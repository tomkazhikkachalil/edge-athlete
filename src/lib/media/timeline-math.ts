/**
 * Pure math for the multi-clip video timeline (recipe v2). No DOM — fully
 * unit-tested. Clips are ordered OUTPUT segments over one source file;
 * [] means "whole file" and callers materialize before doing clip math.
 */

import { MIN_CLIP_SECONDS } from './video-math';
import type { VideoClip } from './types';

/** [] → the single whole-file clip (needs the source duration). */
export function materializeClips(clips: VideoClip[], duration: number): VideoClip[] {
  if (clips.length > 0) return clips;
  return [{ in: 0, out: Math.max(duration, MIN_CLIP_SECONDS), volume: 1 }];
}

/** A clip's speed with the absent-means-1 default (slo-mo round). */
export function clipSpeed(clip: VideoClip): number {
  return clip.speed && clip.speed > 0 ? clip.speed : 1;
}

/** A clip's length ON THE TIMELINE — source length stretched by speed. */
export function clipTimelineLength(clip: VideoClip): number {
  return Math.max(0, clip.out - clip.in) / clipSpeed(clip);
}

export function timelineDuration(clips: VideoClip[]): number {
  return clips.reduce((sum, c) => sum + clipTimelineLength(c), 0);
}

/** Timeline start of each clip, in order. */
export function sourceOffsets(clips: VideoClip[]): number[] {
  const offsets: number[] = [];
  let t = 0;
  for (const clip of clips) {
    offsets.push(t);
    t += clipTimelineLength(clip);
  }
  return offsets;
}

/** Map a timeline instant to {clipIndex, sourceTime}; null when outside. */
export function timelineToSource(
  t: number,
  clips: VideoClip[]
): { clipIndex: number; sourceTime: number } | null {
  if (t < 0) return null;
  let offset = 0;
  for (let i = 0; i < clips.length; i++) {
    const len = clipTimelineLength(clips[i]);
    if (t < offset + len) {
      return { clipIndex: i, sourceTime: clips[i].in + (t - offset) * clipSpeed(clips[i]) };
    }
    offset += len;
  }
  // The exact end maps to the last clip's final instant (poster at the end).
  if (clips.length > 0 && t === offset) {
    return { clipIndex: clips.length - 1, sourceTime: clips[clips.length - 1].out };
  }
  return null;
}

/**
 * Map a SOURCE instant to the timeline. When several clips cover it (overlap
 * after handle edits), the first covering clip wins; when none does, the
 * NEAREST covered instant is returned — the poster scrubber runs over the
 * full source strip and must always land inside the output.
 */
export function timelineFromSource(sourceT: number, clips: VideoClip[]): number {
  const offsets = sourceOffsets(clips);
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (sourceT >= clip.in && sourceT <= clip.out) {
      return offsets[i] + (sourceT - clip.in) / clipSpeed(clip);
    }
    const nearest = sourceT < clip.in ? clip.in : clip.out;
    const distance = Math.abs(sourceT - nearest);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = offsets[i] + (nearest - clip.in) / clipSpeed(clip);
    }
  }
  return best ?? 0;
}

export function reorderClip(clips: VideoClip[], from: number, to: number): VideoClip[] {
  if (from < 0 || from >= clips.length || to < 0 || to >= clips.length || from === to) {
    return clips;
  }
  const next = [...clips];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Remove clip i; null refuses deleting the last remaining clip. */
export function deleteClip(clips: VideoClip[], index: number): VideoClip[] | null {
  if (clips.length <= 1 || index < 0 || index >= clips.length) return null;
  return clips.filter((_, i) => i !== index);
}

/** Split the clip under timeline instant `t`; null when a half would fall
 *  under the minimum length (or t is outside the timeline). */
export function splitClipAt(clips: VideoClip[], t: number): VideoClip[] | null {
  const hit = timelineToSource(t, clips);
  if (!hit) return null;
  const clip = clips[hit.clipIndex];
  if (
    hit.sourceTime < clip.in + MIN_CLIP_SECONDS ||
    hit.sourceTime > clip.out - MIN_CLIP_SECONDS
  ) {
    return null;
  }
  const next = [...clips];
  next.splice(
    hit.clipIndex,
    1,
    { ...clip, out: hit.sourceTime },
    { ...clip, in: hit.sourceTime }
  );
  return next;
}

/** Move one edge of clip i in SOURCE time, respecting bounds + min length. */
export function setClipEdge(
  clips: VideoClip[],
  index: number,
  edge: 'in' | 'out',
  sourceTime: number,
  duration: number
): VideoClip[] {
  const clip = clips[index];
  if (!clip) return clips;
  const next = [...clips];
  if (edge === 'in') {
    const value = Math.min(Math.max(sourceTime, 0), clip.out - MIN_CLIP_SECONDS);
    next[index] = { ...clip, in: value };
  } else {
    const value = Math.max(Math.min(sourceTime, duration), clip.in + MIN_CLIP_SECONDS);
    next[index] = { ...clip, out: value };
  }
  return next;
}

export function setClipVolume(clips: VideoClip[], index: number, volume: number): VideoClip[] {
  const clip = clips[index];
  if (!clip) return clips;
  const next = [...clips];
  next[index] = { ...clip, volume: Math.min(Math.max(volume, 0), 1) };
  return next;
}

export const CLIP_SPEEDS = [0.5, 1, 2] as const;

export function setClipSpeed(clips: VideoClip[], index: number, speed: number): VideoClip[] {
  const clip = clips[index];
  if (!clip || speed <= 0) return clips;
  const next = [...clips];
  next[index] = { ...clip, speed };
  return next;
}

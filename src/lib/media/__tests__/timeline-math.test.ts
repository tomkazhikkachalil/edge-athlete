import { describe, it, expect } from 'vitest';
import {
  materializeClips,
  timelineDuration,
  sourceOffsets,
  timelineToSource,
  timelineFromSource,
  reorderClip,
  deleteClip,
  splitClipAt,
  setClipEdge,
  setClipVolume,
} from '../timeline-math';
import { MIN_CLIP_SECONDS } from '../video-math';
import type { VideoClip } from '../types';

const clip = (inT: number, out: number, volume = 1): VideoClip => ({ in: inT, out, volume });

describe('materializeClips / timelineDuration / sourceOffsets', () => {
  it('materializes [] into the whole-file clip', () => {
    expect(materializeClips([], 12)).toEqual([{ in: 0, out: 12, volume: 1 }]);
    const real = [clip(1, 3)];
    expect(materializeClips(real, 12)).toBe(real);
  });

  it('sums durations and computes timeline starts', () => {
    const clips = [clip(2, 5), clip(0, 2), clip(8, 10)];
    expect(timelineDuration(clips)).toBe(7);
    expect(sourceOffsets(clips)).toEqual([0, 3, 5]);
  });
});

describe('timelineToSource / timelineFromSource', () => {
  const clips = [clip(2, 5), clip(8, 10)]; // timeline: 0-3 → src 2-5, 3-5 → src 8-10

  it('maps timeline instants into the right clip', () => {
    expect(timelineToSource(0, clips)).toEqual({ clipIndex: 0, sourceTime: 2 });
    expect(timelineToSource(2.5, clips)).toEqual({ clipIndex: 0, sourceTime: 4.5 });
    expect(timelineToSource(3, clips)).toEqual({ clipIndex: 1, sourceTime: 8 });
    expect(timelineToSource(5, clips)).toEqual({ clipIndex: 1, sourceTime: 10 }); // exact end
    expect(timelineToSource(5.1, clips)).toBeNull();
    expect(timelineToSource(-1, clips)).toBeNull();
  });

  it('maps source instants back, snapping uncovered moments to the nearest clip', () => {
    expect(timelineFromSource(4, clips)).toBe(2); // inside clip 0
    expect(timelineFromSource(9, clips)).toBe(4); // inside clip 1
    expect(timelineFromSource(6, clips)).toBe(3); // gap → nearest edge (clip0.out=5 dist1, clip1.in=8 dist2)
    expect(timelineFromSource(0, clips)).toBe(0); // before everything → clip0.in
  });

  it('first covering clip wins on overlap', () => {
    const overlapping = [clip(0, 6), clip(4, 8)];
    expect(timelineFromSource(5, overlapping)).toBe(5); // clip 0's mapping
  });
});

describe('reorderClip / deleteClip', () => {
  const clips = [clip(0, 1), clip(1, 2), clip(2, 3)];

  it('moves a clip and returns the same array for no-ops', () => {
    expect(reorderClip(clips, 0, 2).map(c => c.in)).toEqual([1, 2, 0]);
    expect(reorderClip(clips, 1, 1)).toBe(clips);
    expect(reorderClip(clips, 5, 0)).toBe(clips);
  });

  it('deletes, refusing the last clip', () => {
    expect(deleteClip(clips, 1)!.map(c => c.in)).toEqual([0, 2]);
    expect(deleteClip([clip(0, 1)], 0)).toBeNull();
    expect(deleteClip(clips, 9)).toBeNull();
  });
});

describe('splitClipAt', () => {
  const clips = [clip(2, 8)];

  it('splits at a timeline instant into two source-contiguous clips', () => {
    const next = splitClipAt(clips, 3)!; // timeline 3 → source 5
    expect(next).toEqual([clip(2, 5), clip(5, 8)]);
  });

  it('refuses halves shorter than the minimum and out-of-range instants', () => {
    expect(splitClipAt(clips, MIN_CLIP_SECONDS / 2)).toBeNull();
    expect(splitClipAt(clips, 6 - MIN_CLIP_SECONDS / 2)).toBeNull();
    expect(splitClipAt(clips, 99)).toBeNull();
  });
});

describe('setClipEdge / setClipVolume', () => {
  it('clamps edges to bounds and minimum length', () => {
    const clips = [clip(2, 8)];
    expect(setClipEdge(clips, 0, 'in', -5, 10)[0].in).toBe(0);
    expect(setClipEdge(clips, 0, 'in', 7.9, 10)[0].in).toBe(8 - MIN_CLIP_SECONDS);
    expect(setClipEdge(clips, 0, 'out', 99, 10)[0].out).toBe(10);
    expect(setClipEdge(clips, 0, 'out', 2.1, 10)[0].out).toBe(2 + MIN_CLIP_SECONDS);
    expect(setClipEdge(clips, 5, 'in', 1, 10)).toBe(clips);
  });

  it('clamps volume to 0–1', () => {
    const clips = [clip(0, 2)];
    expect(setClipVolume(clips, 0, 1.5)[0].volume).toBe(1);
    expect(setClipVolume(clips, 0, -1)[0].volume).toBe(0);
    expect(setClipVolume(clips, 0, 0.4)[0].volume).toBe(0.4);
  });
});

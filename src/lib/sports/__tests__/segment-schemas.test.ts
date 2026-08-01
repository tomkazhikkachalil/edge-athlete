import { describe, it, expect } from 'vitest';
import {
  SPORT_SEGMENT_SCHEMAS,
  segmentSchemaFor,
  segmentLabel,
  isValidSegment,
  segmentOptions,
} from '../segment-schemas';
import type { SportKey } from '../SportRegistry';

describe('SPORT_SEGMENT_SCHEMAS', () => {
  it('declares golf as holes 1-18 with a hard ceiling', () => {
    const golf = segmentSchemaFor('golf')!;
    expect(golf.kind).toBe('hole');
    expect(golf.label).toBe('Hole');
    expect([golf.min, golf.max]).toEqual([1, 18]);
    expect(golf.variable).toBeFalsy();
  });

  it('marks sports that legitimately run past their max as variable', () => {
    // Extra innings and overtime are ordinary play, not corrupt input.
    expect(segmentSchemaFor('baseball')!.variable).toBe(true);
    expect(segmentSchemaFor('basketball')!.variable).toBe(true);
    expect(segmentSchemaFor('ice_hockey')!.variable).toBe(true);
    // A tennis match cannot exceed 5 sets.
    expect(segmentSchemaFor('tennis')!.variable).toBeFalsy();
  });

  it('keys every schema by the sport it declares', () => {
    for (const [key, schema] of Object.entries(SPORT_SEGMENT_SCHEMAS)) {
      expect(schema!.sport_key).toBe(key);
    }
  });

  it('has a sane range on every schema', () => {
    for (const schema of Object.values(SPORT_SEGMENT_SCHEMAS)) {
      expect(schema!.min).toBeGreaterThan(0);
      expect(schema!.max).toBeGreaterThanOrEqual(schema!.min);
      expect(schema!.label.length).toBeGreaterThan(0);
      expect(schema!.labelPlural.length).toBeGreaterThan(0);
    }
  });

  it('returns null for a sport with no segments rather than throwing', () => {
    expect(segmentSchemaFor('swimming' as SportKey)).toBeNull();
    expect(segmentSchemaFor('training' as SportKey)).toBeNull();
    expect(segmentSchemaFor(null)).toBeNull();
    expect(segmentSchemaFor(undefined)).toBeNull();
  });
});

describe('segmentLabel', () => {
  it('uses each sport&apos;s own word — the same layout, only the label changes', () => {
    expect(segmentLabel('golf', 3)).toBe('Hole 3');
    expect(segmentLabel('baseball', 7)).toBe('Inning 7');
    expect(segmentLabel('basketball', 4)).toBe('Quarter 4');
    expect(segmentLabel('ice_hockey', 2)).toBe('Period 2');
    expect(segmentLabel('tennis', 1)).toBe('Set 1');
    expect(segmentLabel('track_field', 12)).toBe('Lap 12');
  });

  it('labels event-level media, and never calls it "Segment 0"', () => {
    expect(segmentLabel('golf', null)).toBe('Round');
    expect(segmentLabel('golf', undefined)).toBe('Round');
    expect(segmentLabel('swimming' as SportKey, null)).toBe('Overall');
  });

  it('degrades to a generic label for an unknown sport instead of crashing', () => {
    expect(segmentLabel('swimming' as SportKey, 2)).toBe('Segment 2');
    expect(segmentLabel(null, 2)).toBe('Segment 2');
  });
});

describe('isValidSegment', () => {
  it('accepts the ordinary range and rejects outside it', () => {
    expect(isValidSegment('golf', 1)).toBe(true);
    expect(isValidSegment('golf', 18)).toBe(true);
    expect(isValidSegment('golf', 0)).toBe(false);
    expect(isValidSegment('golf', 19)).toBe(false);
    expect(isValidSegment('golf', -3)).toBe(false);
  });

  it('lets variable sports run past their max', () => {
    // THE POINT of `variable`: rejecting the 11th inning would be a bug, not a
    // safeguard. This is what the old `hole_number BETWEEN 1 AND 18` could not
    // express without a migration per sport.
    expect(isValidSegment('baseball', 11)).toBe(true);
    expect(isValidSegment('basketball', 6)).toBe(true);
    expect(isValidSegment('baseball', 0)).toBe(false);
  });

  it('rejects non-integers', () => {
    expect(isValidSegment('golf', 3.5)).toBe(false);
    expect(isValidSegment('golf', NaN)).toBe(false);
    expect(isValidSegment('golf', Infinity)).toBe(false);
  });

  it('accepts any positive integer for a sport we have no schema for', () => {
    // No grounds to reject one; an over-strict default would block a sport
    // before anyone had a chance to describe it.
    expect(isValidSegment('swimming' as SportKey, 3)).toBe(true);
    expect(isValidSegment('swimming' as SportKey, 0)).toBe(false);
  });
});

describe('segmentOptions', () => {
  it('lists the ordinary segments for a picker', () => {
    expect(segmentOptions('golf')).toHaveLength(18);
    expect(segmentOptions('golf')[0]).toBe(1);
    expect(segmentOptions('golf').at(-1)).toBe(18);
    expect(segmentOptions('basketball')).toEqual([1, 2, 3, 4]);
  });

  it('returns [] for a sport with no schema so callers can fall back', () => {
    expect(segmentOptions('swimming' as SportKey)).toEqual([]);
    expect(segmentOptions(null)).toEqual([]);
  });

  it('only lists values the validator accepts', () => {
    for (const key of Object.keys(SPORT_SEGMENT_SCHEMAS) as SportKey[]) {
      for (const n of segmentOptions(key)) {
        expect(isValidSegment(key, n), `${key} ${n}`).toBe(true);
      }
    }
  });
});

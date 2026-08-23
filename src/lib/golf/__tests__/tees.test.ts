import { describe, it, expect } from 'vitest';
import { courseTeeOptions, teeLabel, tidyCourseName, FALLBACK_TEES } from '../tees';

describe('courseTeeOptions', () => {
  it('lists the course\'s real tees hardest-first by rating', () => {
    const opts = courseTeeOptions({
      courseRating: { silver: 66, taupe: 75.8, black: 73.6, gold: 69.3 },
      slopeRating: { silver: 100, taupe: 140, black: 130, gold: 120 },
      holes: [],
    });
    expect(opts).toEqual(['taupe', 'black', 'gold', 'silver']);
  });

  it('includes yardage-only keys after rated ones', () => {
    const opts = courseTeeOptions({
      courseRating: { blue: 71 },
      slopeRating: { blue: 120 },
      holes: [{ number: 1, par: 4, yardage: { blue: 380, web: 378 }, handicap: 1 }],
    });
    expect(opts).toEqual(['blue', 'web']);
  });

  it('falls back to the classic five for custom/thin courses', () => {
    expect(courseTeeOptions(null)).toEqual([...FALLBACK_TEES]);
    expect(courseTeeOptions({ courseRating: {}, slopeRating: {}, holes: [] })).toEqual([...FALLBACK_TEES]);
  });
});

describe('teeLabel', () => {
  it('title-cases including parenthesized suffixes', () => {
    expect(teeLabel('championship')).toBe('Championship');
    expect(teeLabel('blue (f)')).toBe('Blue (F)');
  });
});

describe('tidyCourseName', () => {
  it('reshapes numbered sub-courses and nine-combos', () => {
    expect(tidyCourseName('1 At Ponkapoag Golf Club')).toBe('Ponkapoag Golf Club (Course 1)');
    expect(tidyCourseName('10 19 At University Park Country Club')).toBe('University Park Country Club (Nines 10 & 19)');
    expect(tidyCourseName('3/30 At Lowden Golf Club')).toBe('Lowden Golf Club (Nines 3 & 30)');
  });

  it('passes normal names through untouched', () => {
    expect(tidyCourseName('Pebble Beach Golf Links')).toBe('Pebble Beach Golf Links');
    expect(tidyCourseName('1757 Golf Club')).toBe('1757 Golf Club');
  });
});

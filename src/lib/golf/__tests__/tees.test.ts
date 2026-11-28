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

// The tee table (the mechanical dialect, Nov 23 2026).
describe('the tee table — sides, labels, dots, and when the rating is typed', () => {
  it('the women\'s side is the " (f)" keys', async () => {
    const { splitTeeSides, isWomensTee } = await import('../tees');
    expect(splitTeeSides(['black', 'blue', 'white', 'blue (f)', 'red (f)'])).toEqual({
      men: ['black', 'blue', 'white'],
      women: ['blue (f)', 'red (f)'],
    });
    expect(isWomensTee('Blue (F)')).toBe(true);
    expect(isWomensTee('forward')).toBe(false);
  });
  it('a row drops the "(F)" — the switch says the side', async () => {
    const { teeRowLabel } = await import('../tees');
    expect(teeRowLabel('blue (f)')).toBe('Blue');
    expect(teeRowLabel('championship')).toBe('Championship');
  });
  it('a colour name gets its dot; a name that is not a colour gets none', async () => {
    const { teeDotColour } = await import('../tees');
    expect(teeDotColour('black')).toBe('#0B0B0D');
    expect(teeDotColour('gold')).toBe('#D4A72C');
    expect(teeDotColour('blue (f)')).toBe('#3B82F6');
    expect(teeDotColour('White')).toBe('#EDEDED');
    expect(teeDotColour('red')).toBe('#E5484D');
    expect(teeDotColour('blue/white')).toBe('#3B82F6');
    expect(teeDotColour('championship')).toBeNull();
    expect(teeDotColour('map')).toBeNull();
  });
  it('rating and slope are typed only where the card cannot answer', async () => {
    const { ratingEntryNeeded } = await import('../tees');
    const full = { courseRating: { blue: 72.9, white: 71.2 }, slopeRating: { blue: 134, white: 128 } };
    expect(ratingEntryNeeded(null, '')).toBe(true); // a typed course
    expect(ratingEntryNeeded(null, 'white')).toBe(true);
    expect(ratingEntryNeeded(full, 'white')).toBe(false);
    expect(ratingEntryNeeded(full, '')).toBe(false); // no tee yet: the table asks, not the fields
    expect(ratingEntryNeeded(full, 'red')).toBe(true); // a tee the card has no numbers for
    expect(ratingEntryNeeded({ courseRating: { blue: 72.9 }, slopeRating: {} }, 'blue')).toBe(true);
    expect(ratingEntryNeeded({ courseRating: {}, slopeRating: {} }, '')).toBe(true); // a map-only row
  });
});

describe('roundTeeKeys — every round lists the men\'s boxes (Tom, Nov 27 2026: indoor first, then every round)', () => {
  it('drops the women\'s boxes, keeping the tee-sheet order', async () => {
    const { roundTeeKeys } = await import('../tees');
    expect(roundTeeKeys(['black', 'blue', 'white', 'blue (f)', 'red (f)'])).toEqual(['black', 'blue', 'white']);
    expect(roundTeeKeys(['blue', 'white'])).toEqual(['blue', 'white']);
  });
  it('a course with only women\'s boxes shows those: a tee can always be picked', async () => {
    const { roundTeeKeys } = await import('../tees');
    expect(roundTeeKeys(['red (f)', 'gold (f)'])).toEqual(['red (f)', 'gold (f)']);
    expect(roundTeeKeys([])).toEqual([]);
  });
});

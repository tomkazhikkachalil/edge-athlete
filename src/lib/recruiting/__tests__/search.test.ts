import { describe, expect, it } from 'vitest';
import { containsPattern, hasPerformanceFilters, parseRecruitingSearchParams, rungsAtOrAbove, VERIFIED_FLOOR } from '../search';

const get = (o: Record<string, string>) => (k: string) => o[k] ?? null;

describe('parseRecruitingSearchParams', () => {
  it('reads the needle, the sport and a grad-year window; junk is no filter; a reversed window swaps', () => {
    expect(parseRecruitingSearchParams(get({ q: '  Jordan ', sport: 'golf', gradFrom: '2027', gradTo: '2025' })))
      .toEqual({ q: 'Jordan', sport: 'golf', gradFrom: 2025, gradTo: 2027, since: null, minProvenance: null, minHeadline: null });
    expect(parseRecruitingSearchParams(get({ gradFrom: 'abc', gradTo: '1900' })))
      .toEqual({ q: '', sport: null, gradFrom: null, gradTo: null, since: null, minProvenance: null, minHeadline: null });
    expect(parseRecruitingSearchParams(get({ q: 'x'.repeat(200) })).q).toHaveLength(80);
  });
});

describe('containsPattern', () => {
  it('escapes the wildcards and strips the filter separators', () => {
    expect(containsPattern('Jordan')).toBe('%Jordan%');
    expect(containsPattern('50%_x')).toBe('%50\\%\\_x%');
    expect(containsPattern('a,b.(c)')).toBe('%a b  c%');
  });
});

describe('the performance filters (data foundation F6)', () => {
  it('parses a real day, a stored rung and a finite headline; junk is no filter', () => {
    const p = parseRecruitingSearchParams(get({ sport: 'golf', since: '2026-09-01', minProvenance: 'club_recorded', minHeadline: '78' }));
    expect(p).toMatchObject({ since: '2026-09-01', minProvenance: 'club_recorded', minHeadline: 78 });
    expect(hasPerformanceFilters(p)).toBe(true);
    const junk = parseRecruitingSearchParams(get({ since: '2026-02-30', minProvenance: 'verified', minHeadline: 'lots' }));
    expect(junk).toMatchObject({ since: null, minProvenance: null, minHeadline: null });
    expect(hasPerformanceFilters(junk)).toBe(false);
    expect(parseRecruitingSearchParams(get({ since: '13/09/2026' })).since).toBeNull();
    expect(parseRecruitingSearchParams(get({ minHeadline: '-3.5' })).minHeadline).toBe(-3.5);
  });
  it('rungsAtOrAbove follows the ONE ladder: imported sits above self_reported; the verified floor is club_recorded', () => {
    expect(rungsAtOrAbove('sanctioned')).toEqual(['sanctioned']);
    expect(rungsAtOrAbove('club_recorded')).toEqual(['sanctioned', 'league_verified', 'club_recorded']);
    expect(rungsAtOrAbove('imported')).toEqual(['sanctioned', 'league_verified', 'club_recorded', 'imported']);
    expect(rungsAtOrAbove('self_reported')).toEqual(['sanctioned', 'league_verified', 'club_recorded', 'self_reported', 'imported']);
    expect(VERIFIED_FLOOR).toBe('club_recorded');
  });
});

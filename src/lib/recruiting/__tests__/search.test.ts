import { describe, expect, it } from 'vitest';
import { containsPattern, parseRecruitingSearchParams } from '../search';

const get = (o: Record<string, string>) => (k: string) => o[k] ?? null;

describe('parseRecruitingSearchParams', () => {
  it('reads the needle, the sport and a grad-year window; junk is no filter; a reversed window swaps', () => {
    expect(parseRecruitingSearchParams(get({ q: '  Jordan ', sport: 'golf', gradFrom: '2027', gradTo: '2025' })))
      .toEqual({ q: 'Jordan', sport: 'golf', gradFrom: 2025, gradTo: 2027 });
    expect(parseRecruitingSearchParams(get({ gradFrom: 'abc', gradTo: '1900' })))
      .toEqual({ q: '', sport: null, gradFrom: null, gradTo: null });
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

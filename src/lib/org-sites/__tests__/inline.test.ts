import { describe, expect, it } from 'vitest';
import { inlineToPlain, parseInline } from '../inline';

describe('parseInline (N1)', () => {
  it('plain text is one text node', () => {
    expect(parseInline('Doors at six.')).toEqual([{ t: 'text', v: 'Doors at six.' }]);
  });
  it('bold and https links become typed pieces', () => {
    expect(parseInline('Game **tonight** — [tickets](https://example.com/t) here')).toEqual([
      { t: 'text', v: 'Game ' },
      { t: 'bold', v: 'tonight' },
      { t: 'text', v: ' — ' },
      { t: 'link', label: 'tickets', href: 'https://example.com/t' },
      { t: 'text', v: ' here' },
    ]);
  });
  it('a non-https link and markup-looking text stay literal', () => {
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ t: 'text', v: '[x](javascript:alert(1))' }]);
    expect(parseInline('[x](http://example.com)')).toEqual([{ t: 'text', v: '[x](http://example.com)' }]);
    expect(parseInline('<b>hi</b>')).toEqual([{ t: 'text', v: '<b>hi</b>' }]);
  });
  it('an unclosed ** stays literal; an empty one is not bold', () => {
    expect(parseInline('**open')).toEqual([{ t: 'text', v: '**open' }]);
    expect(parseInline('a **** b')).toEqual([{ t: 'text', v: 'a **** b' }]);
  });
  it('inlineToPlain keeps only the words', () => {
    expect(inlineToPlain('Game **tonight** — [tickets](https://example.com/t)')).toBe('Game tonight — tickets');
  });
});

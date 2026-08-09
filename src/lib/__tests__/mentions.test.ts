import { describe, it, expect } from 'vitest';
import {
  parseMentionTokens,
  extractHandles,
  findActiveMentionToken,
  spliceMention,
} from '../mentions';

describe('parseMentionTokens', () => {
  it('splits text around a mention', () => {
    expect(parseMentionTokens('hey @tom.k nice round')).toEqual([
      { type: 'text', value: 'hey ' },
      { type: 'mention', value: '@tom.k', handle: 'tom.k' },
      { type: 'text', value: ' nice round' },
    ]);
  });

  it('handles mention at start and end', () => {
    const segs = parseMentionTokens('@abc hi @xyz');
    expect(segs[0]).toEqual({ type: 'mention', value: '@abc', handle: 'abc' });
    expect(segs[segs.length - 1]).toEqual({ type: 'mention', value: '@xyz', handle: 'xyz' });
  });

  it('does NOT tokenize emails', () => {
    expect(parseMentionTokens('mail me at tom@example.com')).toEqual([
      { type: 'text', value: 'mail me at tom@example.com' },
    ]);
  });

  it('ignores a bare @ and sub-2-char bodies', () => {
    expect(parseMentionTokens('a @ b @x c')).toEqual([{ type: 'text', value: 'a @ b @x c' }]);
  });

  it('stops the token at a trailing dot (handles end alphanumeric)', () => {
    expect(parseMentionTokens('thanks @tom.')).toEqual([
      { type: 'text', value: 'thanks ' },
      { type: 'mention', value: '@tom', handle: 'tom' },
      { type: 'text', value: '.' },
    ]);
  });

  it('lowercases the handle but preserves the raw slice', () => {
    const segs = parseMentionTokens('yo @TomK');
    expect(segs[1]).toEqual({ type: 'mention', value: '@TomK', handle: 'tomk' });
  });

  it('multi-line text (comments are pre-wrap now)', () => {
    const segs = parseMentionTokens('line one\n@abc line two');
    expect(segs.find((s) => s.type === 'mention')?.handle).toBe('abc');
  });
});

describe('extractHandles', () => {
  it('dedupes case-insensitively', () => {
    expect(extractHandles('@abc and @ABC and @def')).toEqual(['abc', 'def']);
  });

  it('empty for plain text', () => {
    expect(extractHandles('no mentions here')).toEqual([]);
  });
});

describe('findActiveMentionToken', () => {
  it('triggers right after typing @', () => {
    expect(findActiveMentionToken('hey @', 5)).toEqual({ start: 4, query: '' });
  });

  it('carries the partial query', () => {
    expect(findActiveMentionToken('hey @tom', 8)).toEqual({ start: 4, query: 'tom' });
  });

  it('null for mid-word @ (emails)', () => {
    expect(findActiveMentionToken('tom@exa', 7)).toBeNull();
  });

  it('null once the token is terminated by whitespace', () => {
    expect(findActiveMentionToken('hey @tom said', 13)).toBeNull();
  });

  it('null when the caret is before the @', () => {
    expect(findActiveMentionToken('hey @tom', 2)).toBeNull();
  });

  it('caret mid-token uses only the part before the caret', () => {
    expect(findActiveMentionToken('hey @tomk', 7)).toEqual({ start: 4, query: 'to' });
  });

  it('null for an overlong query', () => {
    expect(findActiveMentionToken('@' + 'a'.repeat(25), 26)).toBeNull();
  });

  it('lowercases the query', () => {
    expect(findActiveMentionToken('@ToM', 4)).toEqual({ start: 0, query: 'tom' });
  });
});

describe('spliceMention', () => {
  it('replaces the active token and places the caret after a space', () => {
    const r = spliceMention('hey @to rest', 4, 7, 'tom.k');
    expect(r.text).toBe('hey @tom.k  rest');
    expect(r.caret).toBe(4 + '@tom.k '.length);
  });

  it('works at the end of text', () => {
    const r = spliceMention('hey @t', 4, 6, 'tom');
    expect(r.text).toBe('hey @tom ');
    expect(r.caret).toBe(9);
  });
});

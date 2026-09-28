import { describe, expect, it } from 'vitest';
import { NEWS_BELL_MAX, newsBellMessage } from '../news-bell';

describe('newsBellMessage (A1)', () => {
  it('the summary first', () => {
    expect(newsBellMessage({ summary: '  Doors at six.  ', body: [{ type: 'paragraph', text: 'x' }] }, 'Comets')).toBe('Doors at six.');
  });
  it('else the first paragraph’s words — markup stripped', () => {
    expect(newsBellMessage({ body: [{ type: 'heading', text: 'H' }, { type: 'paragraph', text: 'Game **tonight** — [tickets](https://example.com)' }] }, 'Comets')).toBe('Game tonight — tickets');
  });
  it('else a plain line; long text is capped', () => {
    expect(newsBellMessage({ body: [] }, 'Comets')).toBe('A new post from Comets.');
    expect(newsBellMessage({ summary: 'x'.repeat(900) }, 'Comets')).toHaveLength(NEWS_BELL_MAX);
  });
});

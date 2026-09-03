import { describe, expect, it } from 'vitest';
import { firstImage, firstParagraph } from '../public-data';

// N1 (program 10): a news post's cover is derived from its first image
// block — nothing stored. These pin the derivation's edges.

describe('firstImage', () => {
  it('returns the first image block with its trimmed alt and measured dims', () => {
    const body = [
      { type: 'paragraph', text: 'Hello' },
      { type: 'image', path: 'org-media/site-1/a.png', alt: '  The first tee ', width: 1200, height: 675 },
      { type: 'image', path: 'org-media/site-1/b.png', alt: 'second' },
    ];
    expect(firstImage(body)).toEqual({ path: 'org-media/site-1/a.png', alt: 'The first tee', width: 1200, height: 675 });
  });

  it('omits dims that are missing or malformed and tolerates a missing alt', () => {
    expect(firstImage([{ type: 'image', path: 'org-media/s/x.jpg', width: '900', height: -1 }])).toEqual({
      path: 'org-media/s/x.jpg',
      alt: '',
    });
  });

  it('ignores non-image blocks, foreign paths and non-array bodies', () => {
    expect(firstImage([{ type: 'paragraph', text: 'no image' }])).toBeNull();
    expect(firstImage([{ type: 'image', path: 'https://evil.example/x.png', alt: 'x' }])).toBeNull();
    expect(firstImage([null, 'text', 7, { type: 'image' }])).toBeNull();
    expect(firstImage(null)).toBeNull();
    expect(firstImage('[]')).toBeNull();
  });
});

describe('firstParagraph', () => {
  it('skips blank paragraphs and truncates long ones', () => {
    expect(firstParagraph([{ type: 'paragraph', text: '   ' }, { type: 'paragraph', text: 'Second' }])).toBe('Second');
    expect(firstParagraph([{ type: 'paragraph', text: 'x'.repeat(200) }])).toBe(`${'x'.repeat(157)}…`);
    expect(firstParagraph([{ type: 'image', path: 'org-media/s/a.png', alt: 'a' }])).toBeNull();
  });
});

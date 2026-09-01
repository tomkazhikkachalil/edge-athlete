import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RESERVED_ROOT_SLUGS, firstPathSegment } from '../reserved';

// The load-bearing assertion of phase 6 R1: every routable root segment
// must be in RESERVED_ROOT_SLUGS, or the middleware's vanity fast path
// would strip session refresh from a real app route. A new directory
// under src/app/(app) (or a new root-level entry) fails here until it is
// added to reserved.ts — that is the point, not an inconvenience.

const APP_DIR = join(process.cwd(), 'src', 'app');

function routableSegments(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    // Route groups, private folders and dynamic segments don't claim a
    // literal first path segment.
    .filter(n => !n.startsWith('(') && !n.startsWith('_') && !n.startsWith('['));
}

describe('RESERVED_ROOT_SLUGS', () => {
  it('covers every (app) root segment', () => {
    const missing = routableSegments(join(APP_DIR, '(app)')).filter(
      s => !RESERVED_ROOT_SLUGS.has(s)
    );
    expect(missing, `add these to RESERVED_ROOT_SLUGS (and the reserved_handles seed): ${missing.join(', ')}`).toEqual([]);
  });

  it('covers every root-level segment outside the groups', () => {
    const missing = routableSegments(APP_DIR)
      .filter(s => !RESERVED_ROOT_SLUGS.has(s))
      // (public)'s own children are the org tree, reached via /org — its
      // root [slug] is the vanity segment itself.
      .filter(s => s !== 'api' || !RESERVED_ROOT_SLUGS.has('api'));
    expect(missing, `add these to RESERVED_ROOT_SLUGS: ${missing.join(', ')}`).toEqual([]);
  });

  it('covers the crawler/metadata root files', () => {
    for (const f of ['robots.txt', 'sitemap.xml', 'favicon.ico', 'manifest.webmanifest']) {
      expect(RESERVED_ROOT_SLUGS.has(f), f).toBe(true);
    }
  });
});

describe('firstPathSegment', () => {
  it('extracts and lowercases the first segment', () => {
    expect(firstPathSegment('/')).toBe('');
    expect(firstPathSegment('/Feed')).toBe('feed');
    expect(firstPathSegment('/kanata-knights/standings')).toBe('kanata-knights');
    expect(firstPathSegment('/org/x')).toBe('org');
  });
});

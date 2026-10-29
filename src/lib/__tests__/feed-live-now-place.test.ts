import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The leftovers program PR 5 (Oct 28 2026, Tom: "move it below the cards"):
// the Live Now strip mounts when its poll answers and reserves no space, so
// above the Get Started card it shifted the card by its height whenever a
// round was live (the Oct 26 maintenance finding). It renders BELOW the three
// cards now, above the scope tabs; only the posts under it can move.
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('the Live Now strip sits below the cards', () => {
  const page = read('src/app/(app)/feed/page.tsx');
  it('order: composer → Get Started → Install → Push → Live Now → the scope tabs', () => {
    const at = (needle: string) => { const i = page.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    const getStarted = at('<GetStartedCard ');
    const install = at('<InstallCard />');
    const push = at('<PushCard />');
    const strip = at('<LiveNowStrip />');
    const tabs = at('aria-label="Feed scope"');
    expect(getStarted).toBeLessThan(install);
    expect(install).toBeLessThan(push);
    expect(push).toBeLessThan(strip);
    expect(strip).toBeLessThan(tabs);
    expect(page.match(/<LiveNowStrip \/>/g)?.length).toBe(1);
  });
  it('the strip root is marked so the layout-shift spec can tell its shift from the card\'s', () => {
    expect(read('src/components/LiveNowStrip.tsx')).toMatch(/<div className="mb-4" data-live-now>/);
    expect(read('e2e/get-started-mobile.spec.ts')).toMatch(/closest\?\.\('\[data-live-now\]'\)/);
  });
});

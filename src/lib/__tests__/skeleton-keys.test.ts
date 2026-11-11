import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// A pulsing skeleton and what replaces it never share a DOM node (performance-budgets.md, rule 16 — Nov 11 2026).
// The feed's whole layout-shift score (0.441, "poor") was ONE element: the Suggested Connections card returned a
// skeleton `<div><div className="animate-pulse">…` and then a list `<div><div className="flex …">…` from the same
// position, React turned the pulsing wrapper into the header row, and Chrome scored that animated element's change as
// a shift at the top of the screen — from a card thousands of pixels below the fold. Keyed apart, the score is 0.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('skeletons are keyed apart from what replaces them', () => {
  it('the Suggested Connections card', () => {
    const src = read('src/components/ConnectionSuggestions.tsx');
    expect(src).toMatch(/<div key="loading" className=\{`bg-surface rounded-lg[^>]*data-feed-suggestions="loading">/);
    expect(src).toMatch(/<div key="ready" className=\{`bg-surface rounded-lg[^>]*data-feed-suggestions="ready">/);
  });
  it('the course summary card', () => {
    const src = read('src/components/golf/CourseSummaryCard.tsx');
    expect(src).toContain('<div key="loading" className="mb-3 h-[72px] animate-pulse');
    expect(src).toContain('<div key="ready" className="mb-3 grid');
  });
  it('the feed perf spec holds the score: a budget, a cold open and a return visit, the moved elements named in the failure', () => {
    const spec = read('e2e/perf-feed.spec.ts');
    expect(spec).toContain('const FEED_CLS_BUDGET = 0.05;');
    expect(spec).toContain("observe({ type: 'layout-shift', buffered: true })");
    expect(spec).toContain('expect(sample.cls.cold,');
    expect(spec).toContain('expect(sample.cls.reopen,');
  });
});

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The official scorecard as two nines (Oct 30 2026, Tom's desktop report):
// an 18-hole sheet in one row cut off at desktop widths; the card is two
// blocks — front with Out, back with In and Total — and a nine is one block.
// Pinned from the source: the component has no hooks and renders on the server.
const src = fs.readFileSync(path.join(process.cwd(), 'src/components/golf/CourseScorecardTable.tsx'), 'utf8');

describe('CourseScorecardTable — two nines, stacked', () => {
  it('an eighteen is a front block with Out and a back block with In and Tot; a nine is one block with Total', () => {
    expect(src).toMatch(/\{ key: 'front', holes: front, sumLabel: 'Out', withTotal: false \}/);
    expect(src).toMatch(/\{ key: 'back', holes: back, sumLabel: 'In', withTotal: true \}/);
    expect(src).toMatch(/\[\{ key: 'all', holes, sumLabel: 'Total', withTotal: false \}\]/);
    expect(src).toMatch(/b\.withTotal && <th scope="col" className=\{headCell\}>Tot<\/th>/);
  });
  it('every block is its own scrolling table with the Par / HCP rows marked and the HCP row on light purple', () => {
    expect(src).toContain('data-course-scorecard-block={b.key}');
    expect(src).toContain("data-course-scorecard-row={tone === 'tee' ? undefined : tone}");
    expect(src).toMatch(/tone === 'hcp' \? 'bg-brand-soft' : ''/);
    expect(src.startsWith("'use client'")).toBe(false);
  });
});

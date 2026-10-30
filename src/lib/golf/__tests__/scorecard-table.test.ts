import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The official scorecard on ONE row that fits (Oct 30 2026, Tom's follow-up):
// Hole · 1–9 · Out · 10–18 · In · Tot in compact cells, Out / In / Tot boxed
// and bold. Pinned from the source: no hooks, renders on the server.
const src = fs.readFileSync(path.join(process.cwd(), 'src/components/golf/CourseScorecardTable.tsx'), 'utf8');

describe('CourseScorecardTable — one row, the sums emphasised', () => {
  it('one table: the front nine, Out, the back nine, In, Tot; a nine ends in Total', () => {
    expect(src).toMatch(/sumTh\(eighteen \? 'out' : 'total', eighteen \? 'Out' : 'Total'\)/);
    expect(src).toMatch(/sumTh\('in', 'In'\)/);
    expect(src).toMatch(/sumTh\('total', 'Tot'\)/);
    expect(src).not.toMatch(/data-course-scorecard-block/);
    expect(src).toContain('data-course-scorecard-table=""');
  });
  it('the sum columns are boxed and bold, marked for the e2e; the hole cells are compact', () => {
    expect(src).toMatch(/const sumCell = 'border-l-2 border-r-2 border-border-strong font-bold/);
    expect(src).toContain('data-course-scorecard-sum={kind}');
    expect(src).toMatch(/const headCell = 'px-1 py-1\.5/);
    expect(src).toMatch(/const cell = 'px-1 py-1\.5/);
  });
  it('Par / HCP rows keep their borders and the HCP purple; the tee suffix hides below sm; no client directive', () => {
    expect(src).toContain("data-course-scorecard-row={tone === 'tee' ? undefined : tone}");
    expect(src).toMatch(/tone === 'hcp' \? 'bg-brand-soft' : ''/);
    expect(src).toMatch(/hidden font-normal text-muted sm:inline/);
    expect(src.startsWith("'use client'")).toBe(false);
  });
});

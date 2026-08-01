import { describe, it, expect } from 'vitest';
import { pillGeometry, activeNavIndex, type ItemBox } from '../nav-pill';

const box = (left: number, width: number): ItemBox => ({ left, width });

describe('pillGeometry', () => {
  const boxes = [box(0, 60), box(70, 80), box(160, 50)];

  it('lands exactly on the active item', () => {
    expect(pillGeometry(boxes, 1)).toEqual({ x: 70, width: 80, visible: true });
    expect(pillGeometry(boxes, 0)).toEqual({ x: 0, width: 60, visible: true });
    expect(pillGeometry(boxes, 2)).toEqual({ x: 160, width: 50, visible: true });
  });

  it('HIDES rather than parking a sliver at the left edge when nothing is active', () => {
    // -1 is a real, common case: /settings and the guardian pages are not in
    // the nav. A zero-width pill at x=0 would read as a stray dot.
    expect(pillGeometry(boxes, -1).visible).toBe(false);
  });

  it('hides for an index outside the list', () => {
    expect(pillGeometry(boxes, 3).visible).toBe(false);
    expect(pillGeometry([], 0).visible).toBe(false);
  });

  it('hides when the ref has not attached yet', () => {
    // Refs are null on the very first render; measuring gives nothing. Showing
    // a zero-width pill here is exactly the first-paint flash to avoid.
    expect(pillGeometry([null, box(70, 80)], 0).visible).toBe(false);
    expect(pillGeometry([undefined], 0).visible).toBe(false);
    expect(pillGeometry([box(0, 0)], 0).visible).toBe(false);
  });

  it('never returns a visible pill without a positive width', () => {
    for (const bs of [[box(10, 0)], [null], [box(10, -5)]]) {
      const g = pillGeometry(bs, 0);
      if (g.visible) expect(g.width).toBeGreaterThan(0);
      else expect(g.visible).toBe(false);
    }
  });
});

describe('activeNavIndex', () => {
  const exact = (path: string, pathname: string) => pathname === path;
  const prefix = (path: string, pathname: string) =>
    pathname === path || pathname.startsWith(`${path}/`);

  it('finds the matching item', () => {
    expect(activeNavIndex(['/feed', '/explore', '/live'], '/explore', exact)).toBe(1);
  });

  it('returns -1 when no item matches', () => {
    expect(activeNavIndex(['/feed', '/explore'], '/settings', exact)).toBe(-1);
  });

  it('returns -1 for a missing pathname rather than guessing', () => {
    expect(activeNavIndex(['/feed'], null, exact)).toBe(-1);
    expect(activeNavIndex(['/feed'], undefined, exact)).toBe(-1);
    expect(activeNavIndex(['/feed'], '', exact)).toBe(-1);
  });

  it('LONGEST match wins, regardless of array order', () => {
    // The trap this guards: a broad entry listed first would otherwise swallow
    // a more specific one, so /app/followers would light up an /app item.
    expect(activeNavIndex(['/app', '/app/followers'], '/app/followers', prefix)).toBe(1);
    expect(activeNavIndex(['/app/followers', '/app'], '/app/followers', prefix)).toBe(0);
  });

  it('matches a nested route under a prefix item', () => {
    // /live/[groupPostId] must light up Live — it did not before, because the
    // old check was exact-equality only.
    expect(activeNavIndex(['/feed', '/live'], '/live/abc-123', prefix)).toBe(1);
  });

  it('does not match a sibling that merely shares a prefix string', () => {
    // /livestream must not light up /live.
    expect(activeNavIndex(['/live'], '/livestream', prefix)).toBe(-1);
  });
});

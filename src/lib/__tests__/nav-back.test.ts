import { describe, it, expect, vi } from 'vitest';
import { backOr, hasBackHistory } from '../nav-back';

describe('hasBackHistory', () => {
  it('treats a lone entry (a cold open) as nowhere to go back to', () => {
    expect(hasBackHistory(0)).toBe(false);
    expect(hasBackHistory(1)).toBe(false);
    expect(hasBackHistory(2)).toBe(true);
  });
});

describe('backOr', () => {
  it('goes to the fallback when there is no window history (node has none)', () => {
    const router = { back: vi.fn(), push: vi.fn() };
    backOr(router, '/feed');
    expect(router.back).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/feed');
  });
});

import { describe, it, expect } from 'vitest';
import {
  dockReducer,
  initialDockState,
  isDockSuppressedPath,
  windowCapForWidth,
  parseDockState,
  serializeDockState,
  MAX_OPEN_WINDOWS,
  type DockState,
} from '../dock-state';

const state = (overrides: Partial<DockState> = {}): DockState => ({
  ...initialDockState,
  ...overrides,
});

describe('windowCapForWidth', () => {
  it('scales with viewport width, clamped 1..3', () => {
    expect(windowCapForWidth(1024)).toBe(1);
    expect(windowCapForWidth(1100)).toBe(2);
    expect(windowCapForWidth(1440)).toBe(3);
    expect(windowCapForWidth(3000)).toBe(MAX_OPEN_WINDOWS);
    expect(windowCapForWidth(600)).toBe(1); // never zero
  });
});

describe('dockReducer', () => {
  it('opens windows, deduping and un-minimizing', () => {
    let s = dockReducer(state(), { type: 'OPEN_WINDOW', id: 'a' });
    s = dockReducer(s, { type: 'OPEN_WINDOW', id: 'a' });
    expect(s.open).toEqual(['a']);
    s = dockReducer(state({ minimized: ['b'] }), { type: 'OPEN_WINDOW', id: 'b' });
    expect(s.open).toEqual(['b']);
    expect(s.minimized).toEqual([]);
  });

  it('minimizes the OLDEST window when the cap is exceeded', () => {
    let s = state({ cap: 2 });
    s = dockReducer(s, { type: 'OPEN_WINDOW', id: 'a' });
    s = dockReducer(s, { type: 'OPEN_WINDOW', id: 'b' });
    s = dockReducer(s, { type: 'OPEN_WINDOW', id: 'c' });
    expect(s.open).toEqual(['b', 'c']);
    expect(s.minimized).toEqual(['a']);
  });

  it('SET_CAP shrink minimizes overflow; growth does not restore', () => {
    let s = state({ open: ['a', 'b', 'c'], cap: 3 });
    s = dockReducer(s, { type: 'SET_CAP', cap: 1 });
    expect(s.open).toEqual(['c']);
    expect(s.minimized).toEqual(['a', 'b']);
    s = dockReducer(s, { type: 'SET_CAP', cap: 3 });
    expect(s.open).toEqual(['c']); // restore is explicit, not automatic
  });

  it('minimize/restore round-trip preserves membership', () => {
    let s = state({ open: ['a', 'b'] });
    s = dockReducer(s, { type: 'MINIMIZE', id: 'a' });
    expect(s.open).toEqual(['b']);
    expect(s.minimized).toEqual(['a']);
    s = dockReducer(s, { type: 'RESTORE', id: 'a' });
    expect(s.open).toEqual(['b', 'a']);
    expect(s.minimized).toEqual([]);
  });

  it('close removes from both lists', () => {
    let s = state({ open: ['a'], minimized: ['b'] });
    s = dockReducer(s, { type: 'CLOSE_WINDOW', id: 'a' });
    s = dockReducer(s, { type: 'CLOSE_WINDOW', id: 'b' });
    expect(s.open).toEqual([]);
    expect(s.minimized).toEqual([]);
  });

  it('HYDRATE dedupes open∩minimized (open wins) and applies the cap', () => {
    const s = dockReducer(state({ cap: 2 }), {
      type: 'HYDRATE',
      state: { panelOpen: true, open: ['a', 'b', 'c', 'a'], minimized: ['b', 'd'] },
    });
    expect(s.panelOpen).toBe(true);
    expect(s.open).toEqual(['b', 'c']);
    expect(s.minimized.sort()).toEqual(['a', 'd']);
  });

  it('PRUNE drops ids not in the conversation list', () => {
    const s = dockReducer(state({ open: ['a', 'gone'], minimized: ['b', 'gone2'] }), {
      type: 'PRUNE',
      validIds: ['a', 'b'],
    });
    expect(s.open).toEqual(['a']);
    expect(s.minimized).toEqual(['b']);
  });
});

describe('CLEAR_WINDOWS', () => {
  it('tears down the whole workspace', () => {
    const s = dockReducer(
      state({ panelOpen: true, open: ['a', 'b'], minimized: ['c'] }),
      { type: 'CLEAR_WINDOWS' }
    );
    expect(s.panelOpen).toBe(false);
    expect(s.open).toEqual([]);
    expect(s.minimized).toEqual([]);
  });

  it('is a no-op-shaped result when nothing is open', () => {
    const s = dockReducer(state(), { type: 'CLEAR_WINDOWS' });
    expect(s).toEqual(state());
  });
});

describe('persistence round-trip', () => {
  it('serialize → parse preserves layout', () => {
    const s = state({ panelOpen: true, open: ['a'], minimized: ['b'] });
    expect(parseDockState(serializeDockState(s))).toEqual({
      panelOpen: true,
      open: ['a'],
      minimized: ['b'],
    });
  });

  it('rejects garbage and wrong versions', () => {
    expect(parseDockState(null)).toBeNull();
    expect(parseDockState('not json')).toBeNull();
    expect(parseDockState(JSON.stringify({ v: 2, open: [] }))).toBeNull();
    expect(parseDockState(JSON.stringify({ v: 1, open: [1, 'a'], minimized: null, panelOpen: 'x' })))
      .toEqual({ panelOpen: false, open: ['a'], minimized: [] });
  });
});

describe('isDockSuppressedPath', () => {
  it('shows the dock on browsing surfaces', () => {
    for (const p of [
      '/feed', '/explore', '/live', '/athlete', '/athlete/abc', '/athlete/saved',
      '/u/someone', '/calendar', '/dashboard', '/dashboard/guardians',
      '/app/notifications', '/app/followers', '/app/sport/golf/rounds',
      '/privacy', '/terms',
    ]) {
      expect(isDockSuppressedPath(p), p).toBe(false);
    }
  });

  it('hides on the full messages page and every focused workflow', () => {
    for (const p of [
      '/messages', '/messages/abc',
      '/app/guardian/add-athlete', '/app/guardian/consent/xyz', '/app/guardian/approvals',
      '/app/transfer/xyz', '/app/workout/new', '/app/workout/abc',
      '/onboarding', '/auth/complete-profile', '/activate/token', '/invite/token',
      '/reset-password', '/forgot-password', '/contact', '/settings',
    ]) {
      expect(isDockSuppressedPath(p), p).toBe(true);
    }
  });

  it('matches "/" exactly — prefix-matching it would hide the dock everywhere', () => {
    expect(isDockSuppressedPath('/')).toBe(true);
    expect(isDockSuppressedPath('/feed')).toBe(false);
  });

  it('requires a full segment boundary, so sibling routes are unaffected', () => {
    expect(isDockSuppressedPath('/contacts')).toBe(false);
    expect(isDockSuppressedPath('/invites')).toBe(false);
    expect(isDockSuppressedPath('/app/guardianship')).toBe(false);
    expect(isDockSuppressedPath('/settings-help')).toBe(false);
  });

  it('stays out of the way when the route is unknown', () => {
    expect(isDockSuppressedPath(null)).toBe(true);
    expect(isDockSuppressedPath(undefined)).toBe(true);
    expect(isDockSuppressedPath('')).toBe(true);
  });
});

describe('opening a conversation leaves the panel alone', () => {
  it('OPEN_WINDOW does not close the panel', () => {
    // The pill used to collapse the moment you picked a name, so opening a
    // second conversation meant re-opening the panel every time. The collapse
    // lived in the component, not here — this pins the reducer half so a
    // future refactor cannot quietly reintroduce it.
    const open = { ...initialDockState, panelOpen: true };
    expect(dockReducer(open, { type: 'OPEN_WINDOW', id: 'a' }).panelOpen).toBe(true);
  });

  it('keeps the panel open across several selections', () => {
    let s = { ...initialDockState, panelOpen: true };
    for (const id of ['a', 'b', 'c']) {
      s = dockReducer(s, { type: 'OPEN_WINDOW', id });
      expect(s.panelOpen).toBe(true);
    }
  });

  it('still lets the panel be closed deliberately', () => {
    // Removing the automatic collapse must not disable the minimize control.
    const s = dockReducer({ ...initialDockState, panelOpen: true }, { type: 'CLOSE_PANEL' });
    expect(s.panelOpen).toBe(false);
  });
});

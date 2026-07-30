import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import {
  CHAT_DOCK_HIDDEN_KEY,
  CHAT_DOCK_VISIBILITY_EVENT,
  isChatDockHidden,
  setChatDockHidden,
  subscribeChatDockVisibility,
} from '../chat-dock-visibility';

// Node environment (no jsdom dep): a minimal in-memory localStorage plus an
// event-listener registry is all this module touches.
const store = new Map<string, string>();
const listeners = new Map<string, Set<(e: unknown) => void>>();

const windowStub = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  addEventListener: (type: string, fn: (e: unknown) => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: (e: unknown) => void) => {
    listeners.get(type)?.delete(fn);
  },
  dispatchEvent: (event: { type: string }) => {
    listeners.get(event.type)?.forEach(fn => fn(event));
    return true;
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = windowStub;
// CustomEvent isn't defined in the node env — a minimal stand-in is enough.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).CustomEvent = class {
  type: string;
  detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
};

afterAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).CustomEvent;
});

beforeEach(() => {
  store.clear();
  listeners.clear();
});

describe('chat dock visibility', () => {
  it('defaults to visible', () => {
    expect(isChatDockHidden()).toBe(false);
  });

  it('round-trips hiding and restoring', () => {
    setChatDockHidden(true);
    expect(store.get(CHAT_DOCK_HIDDEN_KEY)).toBe('1');
    expect(isChatDockHidden()).toBe(true);

    setChatDockHidden(false);
    expect(store.has(CHAT_DOCK_HIDDEN_KEY)).toBe(false);
    expect(isChatDockHidden()).toBe(false);
  });

  it('only treats exactly "1" as hidden', () => {
    for (const value of ['0', 'true', 'yes', '', 'garbage']) {
      store.set(CHAT_DOCK_HIDDEN_KEY, value);
      expect(isChatDockHidden(), value).toBe(false);
    }
  });

  it('notifies subscribers in this tab, with the new value', () => {
    const seen: boolean[] = [];
    const stop = subscribeChatDockVisibility(hidden => seen.push(hidden));
    setChatDockHidden(true);
    setChatDockHidden(false);
    expect(seen).toEqual([true, false]);
    stop();
  });

  it('stops notifying after cleanup', () => {
    const cb = vi.fn();
    const stop = subscribeChatDockVisibility(cb);
    stop();
    setChatDockHidden(true);
    expect(cb).not.toHaveBeenCalled();
  });

  it('reacts to the visibility event dispatched by another component', () => {
    const seen: boolean[] = [];
    const stop = subscribeChatDockVisibility(hidden => seen.push(hidden));
    store.set(CHAT_DOCK_HIDDEN_KEY, '1');
    // No detail: the subscriber must fall back to reading storage.
    windowStub.dispatchEvent({ type: CHAT_DOCK_VISIBILITY_EVENT } as never);
    expect(seen).toEqual([true]);
    stop();
  });

  it('reacts to a storage change from another tab', () => {
    const seen: boolean[] = [];
    const stop = subscribeChatDockVisibility(hidden => seen.push(hidden));
    store.set(CHAT_DOCK_HIDDEN_KEY, '1');
    windowStub.dispatchEvent({ type: 'storage', key: CHAT_DOCK_HIDDEN_KEY } as never);
    expect(seen).toEqual([true]);
    stop();
  });

  it('ignores storage changes for unrelated keys', () => {
    const cb = vi.fn();
    const stop = subscribeChatDockVisibility(cb);
    windowStub.dispatchEvent({ type: 'storage', key: 'ea:something-else' } as never);
    expect(cb).not.toHaveBeenCalled();
    stop();
  });

  it('survives storage throwing (private mode)', () => {
    const original = windowStub.localStorage.getItem;
    windowStub.localStorage.getItem = () => {
      throw new Error('denied');
    };
    expect(isChatDockHidden()).toBe(false);
    windowStub.localStorage.getItem = original;

    const setter = windowStub.localStorage.setItem;
    windowStub.localStorage.setItem = () => {
      throw new Error('quota');
    };
    // Must not throw, and must still notify this session.
    const seen: boolean[] = [];
    const stop = subscribeChatDockVisibility(h => seen.push(h));
    expect(() => setChatDockHidden(true)).not.toThrow();
    expect(seen).toEqual([true]);
    stop();
    windowStub.localStorage.setItem = setter;
  });
});

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import {
  CHAT_DOCK_OPEN_EVENT,
  requestDockConversation,
  subscribeDockConversationRequests,
} from '../chat-dock-open';

// Node environment (no jsdom dep): an event-listener registry is all this
// module touches — no localStorage (open requests are transient intents,
// not preferences).
const listeners = new Map<string, Set<(e: unknown) => void>>();

const windowStub = {
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
  listeners.clear();
});

describe('chat dock open requests', () => {
  it('delivers the conversation id to subscribers', () => {
    const seen: string[] = [];
    const stop = subscribeDockConversationRequests(id => seen.push(id));
    requestDockConversation('conv-1');
    expect(seen).toEqual(['conv-1']);
    stop();
  });

  it('delivers multiple requests in order', () => {
    const seen: string[] = [];
    const stop = subscribeDockConversationRequests(id => seen.push(id));
    requestDockConversation('a');
    requestDockConversation('b');
    requestDockConversation('a');
    expect(seen).toEqual(['a', 'b', 'a']);
    stop();
  });

  it('stops delivering after cleanup', () => {
    const cb = vi.fn();
    const stop = subscribeDockConversationRequests(cb);
    stop();
    requestDockConversation('conv-1');
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores events without a usable string detail', () => {
    const cb = vi.fn();
    const stop = subscribeDockConversationRequests(cb);
    windowStub.dispatchEvent({ type: CHAT_DOCK_OPEN_EVENT } as never);
    windowStub.dispatchEvent({ type: CHAT_DOCK_OPEN_EVENT, detail: '' } as never);
    windowStub.dispatchEvent({ type: CHAT_DOCK_OPEN_EVENT, detail: 42 } as never);
    expect(cb).not.toHaveBeenCalled();
    stop();
  });

  it('does not throw when CustomEvent is unavailable', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = (globalThis as any).CustomEvent;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).CustomEvent;
    expect(() => requestDockConversation('conv-1')).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).CustomEvent = original;
  });
});

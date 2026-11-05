import { describe, it, expect } from 'vitest';
import {
  EMPTY_PULSE,
  PULSE_REFRESH_MS,
  PULSE_STALE_MS,
  SIGNAL_DEBOUNCE_MS,
  SIGNAL_JITTER_MS,
  adjustUnread,
  planPulseFetch,
  readPulsePayload,
  signalDelayMs,
} from '../pulse/pulse-rules';

// The pulse (the cost program PR B, Oct 29 2026): the header's two numbers
// in one fetch, and the rules that bound how often that fetch happens.

const T = 1_000_000;

describe('planPulseFetch', () => {
  it('never fetches hidden or offline — the resume catch-up covers the return', () => {
    for (const reason of ['mount', 'timer', 'resume', 'signal', 'demand'] as const) {
      expect(planPulseFetch({ reason, lastFetchedAt: 0, now: T, visible: false, online: true })).toBe('skip');
      expect(planPulseFetch({ reason, lastFetchedAt: 0, now: T, visible: true, online: false })).toBe('skip');
    }
  });
  it('a mount or a return reuses a fresh answer and refetches a stale one', () => {
    expect(planPulseFetch({ reason: 'mount', lastFetchedAt: T - PULSE_STALE_MS + 1, now: T, visible: true, online: true })).toBe('skip');
    expect(planPulseFetch({ reason: 'mount', lastFetchedAt: T - PULSE_STALE_MS - 1, now: T, visible: true, online: true })).toBe('fetch');
    expect(planPulseFetch({ reason: 'resume', lastFetchedAt: T - 5_000, now: T, visible: true, online: true })).toBe('skip');
    expect(planPulseFetch({ reason: 'resume', lastFetchedAt: 0, now: T, visible: true, online: true })).toBe('fetch');
  });
  it('the timer, a signal and a demand always fetch while visible', () => {
    for (const reason of ['timer', 'signal', 'demand'] as const) {
      expect(planPulseFetch({ reason, lastFetchedAt: T, now: T, visible: true, online: true })).toBe('fetch');
    }
  });
  it('the safety-net cadence is the old Live dot cadence (one minute) until the signals land', () => {
    expect(PULSE_REFRESH_MS).toBe(60_000);
    expect(PULSE_STALE_MS).toBe(30_000);
  });
});

describe('signalDelayMs', () => {
  it('waits the debounce plus a share of the jitter window, and never outside it', () => {
    expect(signalDelayMs(0)).toBe(SIGNAL_DEBOUNCE_MS);
    expect(signalDelayMs(0.5)).toBe(SIGNAL_DEBOUNCE_MS + SIGNAL_JITTER_MS / 2);
    expect(signalDelayMs(0.999_999)).toBeLessThan(SIGNAL_DEBOUNCE_MS + SIGNAL_JITTER_MS);
    expect(signalDelayMs(1)).toBeLessThan(SIGNAL_DEBOUNCE_MS + SIGNAL_JITTER_MS);
    expect(signalDelayMs(-3)).toBe(SIGNAL_DEBOUNCE_MS);
    expect(signalDelayMs(Number.NaN)).toBe(SIGNAL_DEBOUNCE_MS);
  });
});

describe('readPulsePayload', () => {
  it('reads the wire shape and stamps the time', () => {
    expect(readPulsePayload({ liveNow: { golf: 1, events: 2, total: 3 }, unread: { messages: 4 } }, EMPTY_PULSE, T)).toEqual({ liveNow: 3, unreadMessages: 4, fetchedAt: T });
  });
  it('a malformed payload keeps the previous numbers (and still stamps the fetch)', () => {
    const prev = { liveNow: 2, unreadMessages: 5, fetchedAt: 1 };
    expect(readPulsePayload(null, prev, T)).toEqual({ ...prev, fetchedAt: T });
    expect(readPulsePayload({ liveNow: { total: -1 }, unread: { messages: 'x' } }, prev, T)).toEqual({ ...prev, fetchedAt: T });
  });
});

describe('adjustUnread', () => {
  it('corrects locally, never below zero, and is a no-op for zero or garbage', () => {
    const s = { liveNow: 0, unreadMessages: 2, fetchedAt: T };
    expect(adjustUnread(s, -1).unreadMessages).toBe(1);
    expect(adjustUnread(s, -5).unreadMessages).toBe(0);
    expect(adjustUnread(s, 0)).toBe(s);
    expect(adjustUnread(s, Number.NaN)).toBe(s);
    expect(adjustUnread(s, 2.9).unreadMessages).toBe(4);
  });
});

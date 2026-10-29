'use client';

import { coordKey, type Weather } from './weather';

// ── The browser's side of the weather (Oct 29 2026) ─────────────────────────
// One function: the conditions at a cell, from OUR route (/api/weather —
// the browser never meets the provider; the CSP says so). A sessionStorage
// memo per 2-decimal cell (10 min for an answer, 2 min for a miss) keeps a
// re-opened composer or a second screen from re-asking. Called from a TAP
// handler or a hook — never on page load by itself. Null means "nothing
// came": on screen weather is never an error.

const MEMO_PREFIX = 'ea.weather.';
const POSITIVE_MS = 10 * 60_000;
const NEGATIVE_MS = 2 * 60_000;

function readMemo(key: string): { weather: Weather | null } | null {
  try {
    const raw = sessionStorage.getItem(MEMO_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; weather?: Weather | null };
    if (typeof parsed.at !== 'number') return null;
    const ttl = parsed.weather ? POSITIVE_MS : NEGATIVE_MS;
    if (Date.now() - parsed.at > ttl) return null;
    return { weather: parsed.weather ?? null };
  } catch {
    return null;
  }
}

function writeMemo(key: string, weather: Weather | null): void {
  try {
    sessionStorage.setItem(MEMO_PREFIX + key, JSON.stringify({ at: Date.now(), weather }));
  } catch {
    // private mode / blocked storage: the answer lives for this call only
  }
}

/** The conditions at a place, or null when nothing came (any status, any failure). */
export async function loadWeather(coords: { lat: number; lng: number }): Promise<Weather | null> {
  const key = coordKey(coords.lat, coords.lng);
  const memo = readMemo(key);
  if (memo) return memo.weather;
  const [lat, lng] = key.split(',');
  let weather: Weather | null = null;
  try {
    const res = await fetch(`/api/weather?lat=${lat}&lng=${lng}`);
    if (res.ok) {
      const body = (await res.json()) as { weather?: Weather };
      weather = body.weather ?? null;
    }
  } catch {
    weather = null;
  }
  writeMemo(key, weather);
  return weather;
}

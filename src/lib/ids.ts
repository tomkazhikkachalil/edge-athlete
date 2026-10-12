// ── One id minter for the browser and the server (Oct 12 2026) ──────────────
// A v4 UUID for a recording, a photo tile, a segment, an exercise in the
// workout editor. `crypto.randomUUID` is Safari 15.4+ and the app's floor is
// iOS 15.0 (the browser-floor gate refuses a bare call), so it is
// feature-detected with `getRandomValues` (Safari 15.0) as the fallback; Node
// has both. Zero imports. The recorder's `newId` (recording.ts) re-exports it.

export function newId(): string {
  const c = typeof crypto !== 'undefined' ? (crypto as Crypto & { randomUUID?: () => string }) : null;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

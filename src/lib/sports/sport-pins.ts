// ── Pinning sports: the ONE write rule (Oct 14 2026) ─────────────────────────
// Pure, zero imports. The pins are an ordered list of sport keys; every
// change answers the WHOLE packed list (1..n, no gaps), which the one writer
// (pins-server.ts) stores. A pin beyond the cap is refused by name.

export const MAX_PINNED_SPORTS = 4;

export type PinChange =
  | { kind: 'pin'; key: string; position?: number }
  | { kind: 'unpin'; key: string }
  | { kind: 'move'; key: string; position: number };

export type PinResult = { pins: string[]; refused?: 'pin_cap' | 'not_pinned' };

export function applyPinChange(current: string[], change: PinChange, max = MAX_PINNED_SPORTS): PinResult {
  const pins = current.filter((k, i, arr) => arr.indexOf(k) === i);
  const without = pins.filter(k => k !== change.key);
  const clamp = (pos: number | undefined, len: number) => Math.min(Math.max(1, pos ?? len + 1), len + 1) - 1;
  switch (change.kind) {
    case 'unpin':
      return { pins: without };
    case 'pin': {
      if (!pins.includes(change.key) && pins.length >= max) return { pins, refused: 'pin_cap' };
      const at = clamp(change.position, without.length);
      return { pins: [...without.slice(0, at), change.key, ...without.slice(at)] };
    }
    case 'move': {
      if (!pins.includes(change.key)) return { pins, refused: 'not_pinned' };
      const at = clamp(change.position, without.length);
      return { pins: [...without.slice(0, at), change.key, ...without.slice(at)] };
    }
  }
}

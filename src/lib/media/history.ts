// Undo/redo history for editor recipes — pure and node-testable. Snapshots
// are whole recipes (small plain objects), pushed BEFORE a patch applies.
//
// Coalescing: a slider drag fires a patch per pointer move; pushing each one
// would flood the stack and make undo step back pixel by pixel. Consecutive
// pushes with the SAME `keys` signature (e.g. 'adjustments') collapse into
// one step — the stack keeps the pre-drag snapshot, so one undo reverts the
// whole drag. Undo/redo clear the signature, so the next patch always
// pushes a fresh step.

export interface History<T> {
  past: T[];
  future: T[];
  /** Signature of the last pushed patch (coalescing key); null = no coalescing. */
  lastKeys: string | null;
}

export const HISTORY_CAP = 30;

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [], lastKeys: null };
}

/** Record `entry` (the value BEFORE the change). Clears the redo stack. */
export function push<T>(
  history: History<T>,
  entry: T,
  keys: string | null = null,
  cap: number = HISTORY_CAP
): History<T> {
  if (keys !== null && keys === history.lastKeys && history.past.length > 0) {
    // Same control still moving — keep the pre-drag snapshot already stacked.
    return history.future.length > 0 ? { ...history, future: [] } : history;
  }
  const past = [...history.past, entry];
  if (past.length > cap) past.splice(0, past.length - cap);
  return { past, future: [], lastKeys: keys };
}

export function undo<T>(
  history: History<T>,
  present: T
): { history: History<T>; value: T } | null {
  if (history.past.length === 0) return null;
  const value = history.past[history.past.length - 1];
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, present],
      lastKeys: null,
    },
    value,
  };
}

export function redo<T>(
  history: History<T>,
  present: T
): { history: History<T>; value: T } | null {
  if (history.future.length === 0) return null;
  const value = history.future[history.future.length - 1];
  return {
    history: {
      past: [...history.past, present],
      future: history.future.slice(0, -1),
      lastKeys: null,
    },
    value,
  };
}

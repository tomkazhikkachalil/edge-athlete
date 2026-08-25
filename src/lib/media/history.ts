// Undo/redo history for editor recipes — pure and node-testable. Snapshots
// are whole recipes (small plain objects), pushed BEFORE a patch applies.
//
// Coalescing: a slider drag fires a patch per pointer move; pushing each one
// would flood the stack and make undo step back pixel by pixel. Consecutive
// pushes with the SAME `keys` signature (e.g. 'light.exposure') collapse
// into one step — the stack keeps the pre-drag snapshot, so one undo reverts
// the whole drag. Undo/redo clear the signature, so the next patch always
// pushes a fresh step.
//
// Entries carry the signature of the change that FOLLOWED them (an entry is
// the state BEFORE its `keys` change) — that's what lets the history rail
// label each state by the operation that produced it and jump to any point.

export interface HistoryEntry<T> {
  value: T;
  /** Signature of the change applied AFTER this snapshot (null = unknown —
   *  pre-labeling pushes, or a cleared coalescing boundary). */
  keys: string | null;
}

export interface History<T> {
  past: Array<HistoryEntry<T>>;
  future: Array<HistoryEntry<T>>;
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
  const past = [...history.past, { value: entry, keys }];
  if (past.length > cap) past.splice(0, past.length - cap);
  return { past, future: [], lastKeys: keys };
}

export function undo<T>(
  history: History<T>,
  present: T
): { history: History<T>; value: T } | null {
  if (history.past.length === 0) return null;
  const entry = history.past[history.past.length - 1];
  return {
    history: {
      past: history.past.slice(0, -1),
      // The present state was produced by the popped entry's change — carry
      // that signature so redo (and the rail) keep the right label.
      future: [...history.future, { value: present, keys: entry.keys }],
      lastKeys: null,
    },
    value: entry.value,
  };
}

export function redo<T>(
  history: History<T>,
  present: T
): { history: History<T>; value: T } | null {
  if (history.future.length === 0) return null;
  const entry = history.future[history.future.length - 1];
  return {
    history: {
      // Symmetric: the redone state's signature labels the change again.
      past: [...history.past, { value: present, keys: entry.keys }],
      future: history.future.slice(0, -1),
      lastKeys: null,
    },
    value: entry.value,
  };
}

/** One row of the visible history rail. Position `index` counts from the
 *  oldest retained state; `keys` is the change that PRODUCED this state
 *  (null for the oldest — shown as "Original"). */
export interface TimelineRow {
  index: number;
  keys: string | null;
  isPresent: boolean;
}

/** The full timeline, oldest first. Present sits at index past.length. */
export function historyTimeline<T>(history: History<T>): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const presentIndex = history.past.length;
  // State i (< presentIndex) is past[i].value; the change that produced it
  // is recorded on the PREVIOUS entry (an entry is the state before its
  // own keys-change), so row i takes past[i−1].keys.
  for (let i = 0; i < history.past.length; i++) {
    rows.push({ index: i, keys: i === 0 ? null : history.past[i - 1].keys, isPresent: false });
  }
  const lastPast = history.past[history.past.length - 1];
  rows.push({
    index: presentIndex,
    keys: presentIndex === 0 ? null : (lastPast?.keys ?? null),
    isPresent: true,
  });
  // Redo states, nearest first: future's top is the next redo.
  for (let k = 0; k < history.future.length; k++) {
    const entry = history.future[history.future.length - 1 - k];
    rows.push({ index: presentIndex + 1 + k, keys: entry.keys, isPresent: false });
  }
  return rows;
}

/** Jump the present to any timeline index (repeated pure undo/redo). Null
 *  when the index is out of range or already the present. */
export function jumpTo<T>(
  history: History<T>,
  present: T,
  index: number
): { history: History<T>; value: T } | null {
  const presentIndex = history.past.length;
  const maxIndex = history.past.length + history.future.length;
  if (index < 0 || index > maxIndex || index === presentIndex) return null;
  let state = { history, value: present };
  while (state.history.past.length > index) {
    const next = undo(state.history, state.value);
    if (!next) return null;
    state = next;
  }
  while (state.history.past.length < index) {
    const next = redo(state.history, state.value);
    if (!next) return null;
    state = next;
  }
  return state;
}

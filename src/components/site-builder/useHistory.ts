'use client';

import { useCallback, useReducer } from 'react';

/**
 * Undo / redo as a SNAPSHOT stack — Site Builder P3-B. A layout is a few
 * dozen small objects, so snapshots are trivially correct and trivially
 * testable; inverse commands are not worth their bugs here. One gesture =
 * one commit (the canvas commits on drag/resize STOP, never per frame).
 * after a conflict, or a size correction that is not the user's act.
 *
 * Phase 6 — COALESCING: a commit may carry a key; when it matches the key
 * of the commit before it, the present is replaced instead of pushed, so
 * typing a paragraph is ONE undo step (and the canvas still updates per
 * keystroke). Any un-keyed commit, undo or redo closes the run.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** The coalesce key of the last commit, if it had one. */
  lastKey: string | null;
}
export type HistoryAction<T> =
  | { type: 'commit'; next: T; coalesce?: string }
  | { type: 'undo' }
  | { type: 'redo' };


const CAP = 100;

export function initialHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null };
}

export function historyReducer<T>(state: History<T>, action: HistoryAction<T>): History<T> {
  switch (action.type) {
    case 'commit': {
      if (action.next === state.present) return state;
      if (action.coalesce && action.coalesce === state.lastKey) {
        return { ...state, present: action.next, future: [] };
      }
      return { past: [...state.past.slice(-(CAP - 1)), state.present], present: action.next, future: [], lastKey: action.coalesce ?? null };
    }
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return state;
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future], lastKey: null };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (next === undefined) return state;
      return { past: [...state.past, state.present], present: next, future: rest, lastKey: null };
    }
    default:
      return state;
  }
}

export function useHistory<T>(initial: T) {
  const [state, dispatch] = useReducer(historyReducer<T>, initial, initialHistory);
  const commit = useCallback((next: T, coalesce?: string) => dispatch({ type: 'commit', next, coalesce }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  return { present: state.present, canUndo: state.past.length > 0, canRedo: state.future.length > 0, commit, undo, redo };
}

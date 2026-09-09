'use client';

import { useCallback, useReducer } from 'react';

/**
 * Undo / redo as a SNAPSHOT stack — Site Builder P3-B. A layout is a few
 * dozen small objects, so snapshots are trivially correct and trivially
 * testable; inverse commands are not worth their bugs here. One gesture =
 * one commit (the canvas commits on drag/resize STOP, never per frame).
 * `replace` swaps the present without touching history — a server reload
 * after a conflict, or a size correction that is not the user's act.
 */
interface History<T> {
  past: T[];
  present: T;
  future: T[];
}
type Action<T> = { type: 'commit'; next: T } | { type: 'undo' } | { type: 'redo' } | { type: 'replace'; next: T };

const CAP = 100;

function reducer<T>(state: History<T>, action: Action<T>): History<T> {
  switch (action.type) {
    case 'commit':
      if (action.next === state.present) return state;
      return { past: [...state.past.slice(-(CAP - 1)), state.present], present: action.next, future: [] };
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return state;
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (next === undefined) return state;
      return { past: [...state.past, state.present], present: next, future: rest };
    }
    case 'replace':
      return { ...state, present: action.next };
    default:
      return state;
  }
}

export function useHistory<T>(initial: T) {
  const [state, dispatch] = useReducer(reducer<T>, { past: [], present: initial, future: [] });
  const commit = useCallback((next: T) => dispatch({ type: 'commit', next }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const replace = useCallback((next: T) => dispatch({ type: 'replace', next }), []);
  return { present: state.present, canUndo: state.past.length > 0, canRedo: state.future.length > 0, commit, undo, redo, replace };
}

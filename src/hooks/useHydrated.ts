'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False on the server and during hydration, true once React owns the page.
 * A button that writes something (Start a workout) is DISABLED until then:
 * a tap that lands before hydration is otherwise swallowed in silence — on
 * production, where the first paint comes well before the handlers (Oct 20
 * 2026, the prod probe's `throughPicker` tapped Start into nothing).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

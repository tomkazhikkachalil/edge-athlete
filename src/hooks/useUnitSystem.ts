'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { readUnitPreference, writeUnitPreference } from '@/lib/activities/format';
import { deviceUnitOf, resolveUnitSystem, sanitizeUnitSystem, type UnitSystem } from '@/lib/activities/unit-prefs';
import { createSerialQueue } from '@/lib/serial-queue';

/**
 * The unit system — metric or imperial for everything measured — as ONE
 * live value (293, Oct 29 2026). The truth arrives on
 * `useAuth().profile.unit_system` (the ACCOUNT's own row, adopted by
 * UnitSystemApplier on every profile load: the account wins over the device
 * and is mirrored into the device cache, `ea.activities.unit`). A change —
 * Settings → Account's row, the golf Conditions step's °F / °C toggle —
 * applies at once on this device and persists through
 * PATCH /api/settings/units, one save at a time (serial-queue.ts). Signed
 * out, the device's cache stands.
 *
 * Readers that only need a snapshot at mount keep `readUnitPreference()`
 * (the round card, the round page, Training): the cache IS the account's
 * value once the profile has loaded.
 */
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/** The device cache is the one store; the hook reads it live. */
const getSnapshot = (): UnitSystem => resolveUnitSystem(null, readUnitPreference());
/** The server has no device: metric, the app's stored unit (useSyncExternalStore's hydration pass). */
const getServerSnapshot = (): UnitSystem => 'metric';

const enqueueSave = createSerialQueue();

/** Apply a system on this device and tell every subscriber. */
function applyLocally(sys: UnitSystem): void {
  writeUnitPreference(deviceUnitOf(sys));
  emit();
}

/** The account's stored value (any shape) seeds the device — server truth
 *  first — but only when the SERVER value changes (the favourites' rule):
 *  `useAuth().profile` is not re-read after a save, so a re-render of the
 *  same stale row must not flip a fresher device choice back. */
let lastAdopted: UnitSystem | null | undefined;
export function adoptAccountUnitSystem(raw: unknown): void {
  const sys = sanitizeUnitSystem(raw);
  if (sys === lastAdopted) return;
  lastAdopted = sys;
  if (!sys || sys === getSnapshot()) return;
  applyLocally(sys);
}

export function persistUnitSystem(sys: UnitSystem): Promise<boolean> {
  // What the account will hold once this lands — a later re-adopt of the
  // same value is a no-op.
  lastAdopted = sys;
  return enqueueSave(async () => {
    try {
      const res = await fetch('/api/settings/units', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ system: sys }),
      });
      return res.ok;
    } catch {
      return false;
    }
  });
}

export interface UseUnitSystemResult {
  sys: UnitSystem;
  /** Choose a system: the device at once, the account in the background.
   *  Resolves true when the account took it; false means the device alone
   *  holds it for now (the caller may say so). */
  setSys: (sys: UnitSystem) => Promise<boolean>;
}

export function useUnitSystem(): UseUnitSystemResult {
  const sys = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setSys = useCallback((next: UnitSystem) => {
    applyLocally(next);
    return persistUnitSystem(next);
  }, []);
  return { sys, setSys };
}

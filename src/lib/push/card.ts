/**
 * When the feed's "Turn on notifications" card shows (Tom, Oct 2 2026 —
 * "option 1"): it stays until the person chooses. "Turn on" ends it (the
 * device is on); "Not now" puts it away for a week, then it asks again. A
 * device whose notifications are blocked is never asked — only the phone's
 * settings can undo that. Pure, so the week is unit-tested.
 *
 * Oct 4 2026 — the card asks ONCE per device per account. "On" used to be
 * read from the live PushSubscription alone, so a device that lost its
 * subscription (a sign-out turns it off by design; iOS may drop it; the
 * worker's URL changed) was asked again though the person had said yes.
 * Now the CHOICE is remembered on the device (`PUSH_DEVICE_CHOICE_KEY`,
 * keyed by account): either answer hides the card for good — Settings →
 * Notifications stays the door — and a device that chose ON is repaired
 * silently at boot (src/lib/push/client.ts syncPush).
 */

import type { PushSupport } from './client';

export const PUSH_CARD_SNOOZE_KEY = 'ea:push-card:snoozed-until:v1';
export const PUSH_CARD_SNOOZE_DAYS = 7;

/** The stored "Not now" — an ISO instant, or null when never snoozed (or
 *  the value is unreadable, which asks again rather than never). */
export function parseSnooze(raw: string | null): number | null {
  if (!raw) return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : null;
}

export function isSnoozed(snoozedUntil: number | null, now: number): boolean {
  return snoozedUntil !== null && now < snoozedUntil;
}

export function snoozeUntil(now: number): string {
  return new Date(now + PUSH_CARD_SNOOZE_DAYS * 86_400_000).toISOString();
}

// ── The device's choice, per account ────────────────────────────────────────

export const PUSH_DEVICE_CHOICE_KEY = 'ea:push:device-choice:v1';

export type DeviceChoice = 'on' | 'off';

export interface StoredDeviceChoice {
  userId: string;
  choice: DeviceChoice;
  /** ISO instant of the choice. */
  at: string;
}

/** The stored choice, or null when none / unreadable (which asks again
 *  rather than never — the same rule as the snooze). */
export function parseDeviceChoice(raw: string | null): StoredDeviceChoice | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDeviceChoice> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.userId !== 'string' || !parsed.userId) return null;
    if (parsed.choice !== 'on' && parsed.choice !== 'off') return null;
    return { userId: parsed.userId, choice: parsed.choice, at: typeof parsed.at === 'string' ? parsed.at : '' };
  } catch {
    return null;
  }
}

/** This account's choice on this device; another account's choice is not
 *  theirs (a shared phone asks each person once). */
export function deviceChoiceFor(stored: StoredDeviceChoice | null, userId: string | null): DeviceChoice | null {
  if (!stored || !userId || stored.userId !== userId) return null;
  return stored.choice;
}

export function serializeDeviceChoice(userId: string, choice: DeviceChoice, now: number): string {
  const stored: StoredDeviceChoice = { userId, choice, at: new Date(now).toISOString() };
  return JSON.stringify(stored);
}

// ── The one show / hide rule ────────────────────────────────────────────────

export interface CardSignals {
  /** Signed in. */
  signedIn: boolean;
  /** The app opened from the home-screen icon — the only place the card lives. */
  installed: boolean;
  /** Waiting behind the Get Started card's dismissal (never slides into its slot). */
  waiting: boolean;
  snoozed: boolean;
  /** This device's recorded choice for this account. */
  choice: DeviceChoice | null;
  /** The browser has been read and the deployment's config is known. */
  ready: boolean;
  /** The deployment holds the keys. */
  offered: boolean;
  /** This device is subscribed right now. */
  on: boolean;
  support: PushSupport;
}

/** True when the feed shows the card. */
export function cardDecision(s: CardSignals): boolean {
  if (!s.signedIn || !s.installed || s.waiting || s.snoozed) return false;
  // They chose, either way — the card never asks twice; Settings is the door.
  if (s.choice !== null) return false;
  if (!s.ready || !s.offered || s.on) return false;
  // 'granted' without a subscription is a device that allowed notifications
  // but is not turned on here: the tap then subscribes without a prompt.
  return s.support === 'available' || s.support === 'granted';
}

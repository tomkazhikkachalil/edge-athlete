/**
 * The live half of "Download the app": the browser's install signals, held
 * in ONE module-level store that React reads through useSyncExternalStore
 * (`InstallAppProvider`). platform.ts decides; this only listens.
 *
 * Wired when the module first loads on a client, not when a component
 * subscribes: `beforeinstallprompt` fires ONCE, early, on whatever page
 * loaded first, and an event missed is an install button that never appears.
 * Every API is feature-checked — the floor is iOS 15, where none of the
 * install APIs exist at all.
 */
import { installMode, isHandheld, type InstallMode } from './platform';

/** Chromium's install prompt. Not in lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<unknown>;
}

/** Set when the browser reports the install; cleared when it offers one again
 *  (an uninstall). Lets a BROWSER TAB on the same device stop inviting. */
const INSTALLED_KEY = 'ea:app-installed:v1';

let promptEvent: BeforeInstallPromptEvent | null = null;
let knownInstalled = false;
let wired = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function remember(installed: boolean): void {
  knownInstalled = installed;
  try {
    if (installed) window.localStorage.setItem(INSTALLED_KEY, '1');
    else window.localStorage.removeItem(INSTALLED_KEY);
  } catch {
    // Storage unavailable — the answer holds for this visit only.
  }
}

function standaloneQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null;
}

function isStandalone(): boolean {
  if (standaloneQuery()?.matches) return true;
  // iOS's own flag (it predates display-mode there).
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function wire(): void {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  try {
    knownInstalled = window.localStorage.getItem(INSTALLED_KEY) === '1';
  } catch {
    knownInstalled = false;
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep the browser's own mini-bar away: the app's button is the door.
    e.preventDefault();
    promptEvent = e as BeforeInstallPromptEvent;
    // The browser only offers an install to a device that does not have one.
    if (knownInstalled) remember(false);
    emit();
  });
  window.addEventListener('appinstalled', () => {
    promptEvent = null;
    remember(true);
    emit();
  });
  const mq = standaloneQuery();
  if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', emit);
}

wire();

export interface InstallSnapshot {
  mode: InstallMode;
  /** Installed on this device, though this window is a browser tab. */
  knownInstalled: boolean;
  handheld: boolean;
}

export function subscribe(listener: () => void): () => void {
  wire();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A primitive, so useSyncExternalStore can compare it: `mode|known|handheld`. */
export function getSnapshot(): string {
  const signals = {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    standalone: isStandalone(),
    hasPrompt: promptEvent !== null,
  };
  return `${installMode(signals)}|${knownInstalled ? 1 : 0}|${isHandheld(signals) ? 1 : 0}`;
}

export function parseSnapshot(snapshot: string | null): InstallSnapshot | null {
  if (!snapshot) return null;
  const [mode, known, handheld] = snapshot.split('|');
  return { mode: mode as InstallMode, knownInstalled: known === '1', handheld: handheld === '1' };
}

/**
 * Show the browser's install dialog. A prompt is single-use: it is spent
 * whatever the person answers (the browser sends a new one when it is ready
 * to offer again). False = there was no prompt to show.
 */
export async function showInstallPrompt(): Promise<boolean> {
  const ev = promptEvent;
  if (!ev) return false;
  promptEvent = null;
  emit();
  try {
    await ev.prompt();
  } catch {
    return false;
  }
  return true;
}

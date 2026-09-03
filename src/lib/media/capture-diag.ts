/**
 * Capture diagnostic (browser-only; the parser is pure and unit-tested).
 *
 * Tom's iPhone (Sep 3 2026): "Take photo" from the feed composer → native
 * camera → Keep → the page comes back reloaded and the photo is gone. The
 * IndexedDB stash (capture-stash.ts) stayed empty, so the change event never
 * fired — whatever killed the session happened while the camera was up. Two
 * explanations remain and nothing in the code can tell them apart:
 *   A. iOS discarded the WebContent process (memory) and reloaded the page;
 *   B. the page stayed loaded but our own state flipped (a refocus auth event
 *      → the feed's `loading || !user` gate) and unmounted the composer, and
 *      with it the <input capture> that owned the pending file.
 *
 * So: ARM at the tap that opens the camera (sessionStorage — survives a reload
 * of the same tab, dies with it), DISARM when a file arrives, count the feed
 * gate's flips, and on the next composer open read the outcome:
 *   - `reloaded`  — the per-JS-boot id changed ⇒ a real document reload (A);
 *   - `gateFlips` — the composer was unmounted inside the same boot (B);
 *   - `navType`   — the Navigation Timing type ('reload' | 'navigate' | …).
 * A record with neither anomaly is a plain camera cancel and is cleared
 * silently. Fail-open throughout: storage errors mean "no diagnostic".
 */

const KEY = 'ea:capture-diag:v1';

/** Long enough to cover the reload and the reopen; short enough that an old
 *  cancel followed by an unrelated pull-to-refresh rarely reads as a loss. */
export const CAPTURE_DIAG_TTL_MS = 5 * 60 * 1000;

/** Minted once per JS boot. A client-side remount keeps it; a reload changes it. */
const BOOT_ID = Math.random().toString(36).slice(2, 10);

interface DiagRecord {
  v: 1;
  armedAt: number;
  surface: string;
  bootId: string;
  gateFlips: number;
}

export interface CaptureOutcome {
  surface: string;
  elapsedMs: number;
  reloaded: boolean;
  navType: string;
  gateFlips: number;
}

export function parseCaptureOutcome(
  raw: string | null,
  currentBootId: string,
  navType: string,
  now: number = Date.now()
): CaptureOutcome | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DiagRecord> | null;
    if (!parsed || parsed.v !== 1) return null;
    if (typeof parsed.armedAt !== 'number' || !Number.isFinite(parsed.armedAt)) return null;
    const elapsedMs = now - parsed.armedAt;
    if (elapsedMs < 0 || elapsedMs > CAPTURE_DIAG_TTL_MS) return null;
    return {
      surface: typeof parsed.surface === 'string' ? parsed.surface : 'unknown',
      elapsedMs,
      reloaded: parsed.bootId !== currentBootId,
      navType,
      gateFlips:
        typeof parsed.gateFlips === 'number' && Number.isFinite(parsed.gateFlips)
          ? Math.max(0, Math.floor(parsed.gateFlips))
          : 0,
    };
  } catch {
    return null;
  }
}

/** True when the outcome is worth telling the user about (not a plain cancel). */
export function isAnomalousOutcome(outcome: CaptureOutcome): boolean {
  return outcome.reloaded || outcome.gateFlips > 0;
}

function readRaw(): string | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeRecord(record: DiagRecord): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable — no diagnostic, never a broken capture.
  }
}

function navigationType(): string {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return entry?.type ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Call at the tap that opens the native camera, before anything else. */
export function armCapture(surface: string): void {
  writeRecord({ v: 1, armedAt: Date.now(), surface, bootId: BOOT_ID, gateFlips: 0 });
}

/** Call when a file arrives (the normal path) or the surface is deliberately left. */
export function disarmCapture(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** The feed's `loading || !user` branch re-engaged after having been open. */
export function recordCaptureGateFlip(): void {
  const raw = readRaw();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as DiagRecord;
    if (parsed?.v !== 1) return;
    writeRecord({ ...parsed, gateFlips: (parsed.gateFlips ?? 0) + 1 });
  } catch {
    // ignore
  }
}

export function readCaptureOutcome(now: number = Date.now()): CaptureOutcome | null {
  return parseCaptureOutcome(readRaw(), BOOT_ID, navigationType(), now);
}

/** One line for the notice — the measurement, in plain text. */
export function describeCaptureOutcome(outcome: CaptureOutcome): string {
  const seconds = (outcome.elapsedMs / 1000).toFixed(1);
  return `${outcome.navType} · boot ${outcome.reloaded ? 'changed' : 'same'} · gate flips ${outcome.gateFlips} · ${seconds}s · ${outcome.surface}`;
}

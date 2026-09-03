import { describe, it, expect } from 'vitest';
import {
  CAPTURE_DIAG_TTL_MS,
  describeCaptureOutcome,
  isAnomalousOutcome,
  parseCaptureOutcome,
} from '../capture-diag';

const now = 1_800_000_000_000;
const record = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, armedAt: now - 12_400, surface: 'composer', bootId: 'boot-a', gateFlips: 0, ...over });

describe('parseCaptureOutcome', () => {
  it('reads a same-boot record as not reloaded', () => {
    const out = parseCaptureOutcome(record(), 'boot-a', 'navigate', now);
    expect(out).toEqual({ surface: 'composer', elapsedMs: 12_400, reloaded: false, navType: 'navigate', gateFlips: 0 });
    expect(isAnomalousOutcome(out!)).toBe(false); // a plain camera cancel
  });

  it('a different boot id means the document reloaded', () => {
    const out = parseCaptureOutcome(record(), 'boot-b', 'reload', now);
    expect(out?.reloaded).toBe(true);
    expect(isAnomalousOutcome(out!)).toBe(true);
    expect(describeCaptureOutcome(out!)).toBe('reload · boot changed · gate flips 0 · 12.4s · composer');
  });

  it('gate flips inside the same boot are anomalous too', () => {
    const out = parseCaptureOutcome(record({ gateFlips: 2 }), 'boot-a', 'navigate', now);
    expect(out?.gateFlips).toBe(2);
    expect(isAnomalousOutcome(out!)).toBe(true);
  });

  it('expires after the TTL and rejects the future', () => {
    expect(parseCaptureOutcome(record({ armedAt: now - CAPTURE_DIAG_TTL_MS - 1 }), 'x', 'reload', now)).toBeNull();
    expect(parseCaptureOutcome(record({ armedAt: now + 1 }), 'x', 'reload', now)).toBeNull();
    expect(parseCaptureOutcome(record({ armedAt: now - CAPTURE_DIAG_TTL_MS }), 'x', 'reload', now)).not.toBeNull();
  });

  it('returns null for missing, malformed, or wrong-version records', () => {
    expect(parseCaptureOutcome(null, 'x', 'reload', now)).toBeNull();
    expect(parseCaptureOutcome('{not json', 'x', 'reload', now)).toBeNull();
    expect(parseCaptureOutcome(record({ v: 2 }), 'x', 'reload', now)).toBeNull();
    expect(parseCaptureOutcome(record({ armedAt: 'yesterday' }), 'x', 'reload', now)).toBeNull();
  });

  it('tolerates a bad gateFlips value and a missing surface', () => {
    const out = parseCaptureOutcome(record({ gateFlips: 'lots', surface: undefined }), 'x', 'reload', now);
    expect(out?.gateFlips).toBe(0);
    expect(out?.surface).toBe('unknown');
  });
});

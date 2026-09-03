import { describe, it, expect } from 'vitest';
import * as acorn from 'acorn';
import { FLOOR_POLYFILLS_SCRIPT } from '../floor-polyfills';
import { HEAD_POLYFILLED_GLOBALS } from '../../../scripts/browser-floor-rules.mjs';

/**
 * The head polyfill script runs before any chunk on every (app) page, on the
 * oldest engine the floor admits. Three things must hold: it is plain ES5 (a
 * parse error in a blocking head script kills the page — the failure class
 * this arc exists to prevent); it installs every global the floor gate
 * exempts on the strength of it; and it leaves an engine that already has the
 * API alone.
 */

function runScript(windowStub: Record<string, unknown>, existing: unknown) {
  // The script tests the BARE global, so shadow it via a parameter: `undefined`
  // simulates iOS 15.0–15.3, a function simulates every engine at or above 15.4.
  new Function('window', 'structuredClone', FLOOR_POLYFILLS_SCRIPT)(windowStub, existing);
}

describe('FLOOR_POLYFILLS_SCRIPT', () => {
  it('is ES5 — parses with ecmaVersion 5 as a classic script', () => {
    expect(() => acorn.parse(FLOOR_POLYFILLS_SCRIPT, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
  });

  it('installs every global the gate exempts as head-polyfilled', () => {
    const windowStub: Record<string, unknown> = {};
    runScript(windowStub, undefined);
    for (const name of HEAD_POLYFILLED_GLOBALS) {
      expect(typeof windowStub[name], name).toBe('function');
    }
  });

  it('does not touch an engine that already has structuredClone', () => {
    const windowStub: Record<string, unknown> = {};
    runScript(windowStub, () => 'native');
    expect(windowStub).toEqual({});
  });

  it('the structuredClone stand-in deep-copies plain data and passes undefined through', () => {
    const windowStub: Record<string, unknown> = {};
    runScript(windowStub, undefined);
    const clone = windowStub.structuredClone as <T>(v: T) => T;
    const src = { tree: ['a', { segment: 'b', params: { id: '1' } }], n: 2, ok: true, nil: null };
    const out = clone(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
    expect(out.tree).not.toBe(src.tree);
    expect(clone(undefined)).toBeUndefined();
    expect(clone('s')).toBe('s');
  });

  it('never throws, even without a window', () => {
    expect(() => new Function('window', 'structuredClone', FLOOR_POLYFILLS_SCRIPT)(undefined, undefined)).not.toThrow();
  });
});

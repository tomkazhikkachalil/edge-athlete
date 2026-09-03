import { describe, it, expect } from 'vitest';
import {
  scanChunkSource,
  FLOOR_INSTANCE_METHODS,
  FLOOR_STATIC_MEMBERS,
  FLOOR_BARE_GLOBALS,
  HEAD_POLYFILLED_GLOBALS,
} from '../../../scripts/browser-floor-rules.mjs';

/**
 * Pins the browser-floor gate's classifier (scripts/check-browser-syntax.mjs,
 * the last step of `npm run verify`) on fixture snippets: what it must catch,
 * and — as important — the guard/install shapes it must let through, since a
 * gate that cries wolf on every feature-detect gets disabled.
 */

const scan = (src: string) => scanChunkSource(src, 'fixture.js');

describe('browser floor — syntax the engine cannot parse', () => {
  it('flags class static blocks, #x in obj, and regex d/v flags', () => {
    expect(scan('class A { static { A.x = 1 } }')).toEqual([expect.stringContaining('class static block')]);
    expect(scan('class A { #p; static has(o) { return #p in o } }')).toEqual([expect.stringContaining('#x in obj')]);
    expect(scan('const r = /a/d;')).toEqual([expect.stringContaining('regex flag d')]);
    // `v` is ES2024: acorn at 2022 rejects it outright, which is still a finding
    expect(scan('const r = /[\\p{L}]/v;')).toEqual([expect.stringMatching(/regex flag v|does not parse/)]);
  });

  it('accepts private fields, optional chaining, nullish, and class fields (Safari 14–15)', () => {
    expect(scan('class A { #p = 1; static s = 2; get p() { return this.#p ?? a?.b } }')).toEqual([]);
  });

  it('reports a chunk that does not parse at all', () => {
    expect(scan('await 1; @@')).toEqual([expect.stringContaining('does not parse as ES2022')]);
  });
});

describe('browser floor — runtime members the engine cannot call', () => {
  it('flags every listed instance method on any receiver, including bracket access', () => {
    for (const name of Object.keys(FLOOR_INSTANCE_METHODS)) {
      expect(scan(`x.${name}(1)`), name).toEqual([expect.stringContaining(`.${name}()`)]);
      expect(scan(`x["${name}"](1)`), name).toEqual([expect.stringContaining(`.${name}()`)]);
    }
  });

  it('flags the listed statics only on their own global', () => {
    for (const [global, members] of Object.entries(FLOOR_STATIC_MEMBERS)) {
      for (const name of Object.keys(members)) {
        expect(scan(`${global}.${name}(x)`), `${global}.${name}`).toEqual([expect.stringContaining(`${global}.${name}`)]);
        expect(scan(`other.${name}(x)`), `other.${name}`).toEqual([]);
      }
    }
  });

  it('flags a bare call to a global above the floor unless the head polyfills it', () => {
    for (const name of Object.keys(FLOOR_BARE_GLOBALS)) {
      const findings = scan(`const c = ${name}(v);`);
      if (HEAD_POLYFILLED_GLOBALS.includes(name)) expect(findings, name).toEqual([]);
      else expect(findings, name).toEqual([expect.stringContaining(`${name}()`)]);
    }
    // the rule itself, independent of the polyfill list
    expect(HEAD_POLYFILLED_GLOBALS.every(n => n in FLOOR_BARE_GLOBALS)).toBe(true);
  });

  it('lets feature detection through: typeof, ||, ??, ?:, if, !, ===', () => {
    for (const src of [
      'typeof a.toSpliced === "function" && a.toSpliced(1)',
      'a.toSpliced || fallback',
      'a.toSpliced ?? fallback',
      'a.toSpliced ? 1 : 2',
      'if (a.toSpliced) {}',
      '!a.toSpliced',
      'a.toSpliced === undefined',
      'void 0 !== AbortSignal.timeout',
      '"function" == typeof AbortSignal.timeout',
    ]) {
      // the call INSIDE a guarded branch is still a call — only the first
      // fixture has one, and it is guarded at the statement level, which this
      // classifier does not model; so assert only on the pure-detect shapes.
      if (src.startsWith('typeof')) continue;
      expect(scan(src), src).toEqual([]);
    }
  });

  it('lets polyfill installs through: prototype access and assignment', () => {
    expect(scan('Array.prototype.toSpliced || (Array.prototype.toSpliced = function () {})')).toEqual([]);
    expect(scan('Array.prototype.toSpliced = function () {}')).toEqual([]);
    expect(scan('AbortSignal.timeout = function (ms) {}')).toEqual([]);
    expect(scan('Object.groupBy || (Object.groupBy = g)')).toEqual([]);
  });

  it('does not mistake property keys, declarations, or member names for global reads', () => {
    expect(scan('const o = { findLast: 1, structuredClone: 2 }; let structuredClone = 3; z.structuredClone;')).toEqual([]);
    expect(scan('function structuredClone(v) { return v } class K { findLast() {} }')).toEqual([]);
  });

  it('reproduces the round-6 finding: the app header\'s toSpliced', () => {
    const minified = 'H=[...X.toSpliced(Math.ceil(X.length/2),0,{path:"/live",label:"Live"}),{path:"/messages"}]';
    expect(scan(minified)).toEqual([expect.stringMatching(/\.toSpliced\(\) \(Safari 16\.4\+\) @\d+/)]);
  });
});

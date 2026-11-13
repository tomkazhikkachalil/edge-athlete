import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORCE_INCLUDED, hardDeps, missingDeps } from '../../../scripts/check-traced-deps.mjs';

/**
 * The traced-dependency gate (Nov 12 2026). An `outputFileTracingIncludes`
 * glob brings a package's files, never its dependencies: sharp shipped
 * without `detect-libc` and four production functions died at import for
 * five days while every local gate stayed green. Found by the maintenance
 * probe on production (`/org/<site>/card.png` → 500).
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('missingDeps', () => {
  const sharp = ['node_modules/sharp/dist/index.mjs', 'node_modules/sharp/node_modules/semver/index.js', 'node_modules/@img/colour/index.js'];
  it('a route that does not carry the package has nothing to miss', () => {
    expect(missingDeps(['node_modules/react/index.js'], 'sharp', ['detect-libc'])).toEqual([]);
  });
  it('a dependency is present nested under the package or hoisted — else it is named', () => {
    expect(missingDeps(sharp, 'sharp', ['semver', '@img/colour'])).toEqual([]);
    expect(missingDeps(sharp, 'sharp', ['semver', '@img/colour', 'detect-libc'])).toEqual(['detect-libc']);
    expect(missingDeps([...sharp, 'node_modules/detect-libc/lib/detect-libc.js'], 'sharp', ['detect-libc'])).toEqual([]);
  });
  it('a package that merely starts with the same letters is not the dependency', () => {
    expect(missingDeps([...sharp, 'node_modules/detect-libc-extra/index.js'], 'sharp', ['detect-libc'])).toEqual(['detect-libc']);
  });
});

describe('the wiring', () => {
  it('sharp is the force-included package, and what it declares today is what the config names', () => {
    expect(FORCE_INCLUDED).toEqual(['sharp']);
    const deps = hardDeps('sharp');
    expect(deps).toContain('detect-libc');
    const config = read('next.config.ts');
    expect(config).toContain("const SHARP_FILES = ['./node_modules/sharp/**', './node_modules/@img/**', './node_modules/detect-libc/**'];");
    // Every function that gets sharp gets the same list — no route names the globs by hand.
    expect(config.match(/\.\.\.SHARP_FILES\]/g)).toHaveLength(4);
    expect(config.match(/'\.\/node_modules\/sharp\/\*\*'/g)).toHaveLength(2); // the list itself, and the diet's exclude
    // A dependency sharp declares that is not under sharp/ or @img/ must be named: today that is detect-libc alone.
    for (const d of deps) {
      const nested = (() => { try { read(`node_modules/sharp/node_modules/${d}/package.json`); return true; } catch { return false; } })();
      expect(nested || d.startsWith('@img/') || config.includes(`'./node_modules/${d}/**'`), `sharp's dependency ${d} is not carried`).toBe(true);
    }
  });
  it('the gate runs in verify, after the build', () => {
    const pkg = read('package.json');
    expect(pkg).toContain('&& node scripts/check-traced-deps.mjs"');
    expect(pkg).toMatch(/"verify": "[^"]*npm run build && npm run check:weight/);
  });
});

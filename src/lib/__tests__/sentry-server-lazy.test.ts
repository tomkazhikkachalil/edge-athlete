import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * The boot diet (performance program PR 1c, Nov 2026): the Sentry server SDK
 * — ~420 ms of module evaluation on this Mac, most of a second on Vercel's
 * CPU — is loaded on the first error, never at boot. These pin that no
 * server module imports '@sentry/nextjs' statically except the lazy module,
 * that the instrumentation hook imports nothing at boot, and that the two
 * eager config files are gone.
 */

const ROOT = process.cwd();
const LAZY = 'src/lib/observability/sentry-server.ts';
/** The browser side is a different budget (Phase 3b); these may import the SDK directly. */
const CLIENT_ALLOWED = new Set(['src/instrumentation-client.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}
const isClient = (src: string) => /^\s*['"]use client['"]/m.test(src.slice(0, 300));

describe('sentry on the server is lazy', () => {
  const files = walk(join(ROOT, 'src'));

  it('no server module imports @sentry/nextjs statically except sentry-server.ts', () => {
    const offenders = files
      .map((f) => [f.slice(ROOT.length + 1), readFileSync(f, 'utf8')] as const)
      .filter(([rel, src]) => rel !== LAZY && !CLIENT_ALLOWED.has(rel) && !isClient(src))
      .filter(([, src]) => /from ['"]@sentry\/nextjs['"]/.test(src.replace(/import type [^;]+;/g, '')))
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });

  it('the lazy module imports the SDK only as a type at the top and dynamically inside', () => {
    const src = readFileSync(join(ROOT, LAZY), 'utf8');
    expect(src).toMatch(/^import type \* as SentryTypes from '@sentry\/nextjs';/m);
    expect(src).toMatch(/import\('@sentry\/nextjs'\)/);
    expect(src.match(/^import (?!type)[^;]*@sentry\/nextjs/gm)).toBeNull();
  });

  it('the instrumentation hook loads nothing at boot and still wires onRequestError', () => {
    const src = readFileSync(join(ROOT, 'src/instrumentation.ts'), 'utf8');
    const imports = src.split('\n').filter((l) => /^\s*(import|export) .*from |import\(/.test(l));
    for (const line of imports) expect(line).not.toMatch(/@sentry\/nextjs|sentry\.(server|edge)\.config/);
    expect(src).toMatch(/export const onRequestError = captureRequestError/);
    expect(existsSync(join(ROOT, 'sentry.server.config.ts'))).toBe(false);
    expect(existsSync(join(ROOT, 'sentry.edge.config.ts'))).toBe(false);
  });

  it('every server caller uses the three lazy calls only', () => {
    const lazyCallers = files.filter((f) => /from '@\/lib\/observability\/sentry-server'/.test(readFileSync(f, 'utf8')));
    expect(lazyCallers.length).toBeGreaterThan(15);
    for (const f of lazyCallers) {
      const used = new Set([...readFileSync(f, 'utf8').matchAll(/Sentry\.([a-zA-Z]+)/g)].map((m) => m[1]));
      for (const name of used) expect(['captureException', 'captureMessage', 'addBreadcrumb'], `${f} uses Sentry.${name}`).toContain(name);
    }
  });
});

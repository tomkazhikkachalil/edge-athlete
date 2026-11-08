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
/** The browser side's lazy module (Phase 3b): the only client file that may name the SDK, as a type and a dynamic import. */
const LAZY_BROWSER = 'src/lib/observability/sentry-browser.ts';
const CLIENT_ALLOWED = new Set<string>([]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('sentry on the server is lazy', () => {
  const files = walk(join(ROOT, 'src'));

  it('no module — server or browser — imports @sentry/nextjs statically except the two lazy ones', () => {
    const offenders = files
      .map((f) => [f.slice(ROOT.length + 1), readFileSync(f, 'utf8')] as const)
      .filter(([rel]) => rel !== LAZY && rel !== LAZY_BROWSER && !CLIENT_ALLOWED.has(rel))
      .filter(([, src]) => /from ['"]@sentry\/nextjs['"]/.test(src.replace(/import type [^;]+;/g, '')))
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });

  it('both lazy modules import the SDK only as a type at the top and dynamically inside', () => {
    for (const file of [LAZY, LAZY_BROWSER]) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src, file).toMatch(/^import type \* as SentryTypes from '@sentry\/nextjs';/m);
      expect(src, file).toMatch(/import\('@sentry\/nextjs'\)/);
      expect(src.match(/^import (?!type)[^;]*@sentry\/nextjs/gm), file).toBeNull();
    }
  });
  it('the browser instrumentation installs the buffering handlers and nothing else; the buffer drains into the SDK first', () => {
    const client = readFileSync(join(ROOT, 'src/instrumentation-client.ts'), 'utf8');
    expect(client).not.toMatch(/@sentry\/nextjs|resolveSentryConfig/);
    expect(client).toContain('installBrowserErrorHandlers();');
    const browser = readFileSync(join(ROOT, LAZY_BROWSER), 'utf8');
    expect(browser).toContain("window.addEventListener('error'");
    expect(browser).toContain("window.addEventListener('unhandledrejection'");
    expect(browser).toMatch(/for \(const b of buffer\.splice\(0\)\)/);
    expect(browser).toContain('integrations: browserBeaconIntegrations,');
    expect(browser).toContain('sendClientReports: false,');
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

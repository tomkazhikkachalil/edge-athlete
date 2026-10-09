import { describe, it, expect } from 'vitest';
import { buildCsp, CSP_REPORT_PATH } from '../csp';

describe('buildCsp', () => {
  const nonce = 'dGVzdC1ub25jZQ==';
  const prod = buildCsp(nonce);
  const dev = buildCsp(nonce, { dev: true });

  it('carries the nonce + strict-dynamic in script-src', () => {
    expect(prod).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    // CSP2 fallbacks present (ignored by nonce-aware browsers)
    expect(prod).toContain("'unsafe-inline' https:");
  });

  it('prod has NO unsafe-eval; dev adds it (Turbopack HMR)', () => {
    // The exact token: 'wasm-unsafe-eval' (below) contains the substring.
    expect(prod).not.toContain("'unsafe-eval'");
    expect(dev).toContain("'unsafe-eval'");
  });

  it("admits WebAssembly compilation only ('wasm-unsafe-eval') — the HEIC decoder in Chrome on Android (Oct 9 2026)", () => {
    const script = prod.split('; ').find(d => d.startsWith('script-src'))!;
    expect(script.split(' ')).toContain("'wasm-unsafe-eval'");
    expect(script.split(' ')).not.toContain("'unsafe-eval'");
  });

  it('connect-src includes Supabase, realtime, and BOTH Sentry ingest forms', () => {
    for (const host of [
      'blob:',
      'https://*.supabase.co',
      'wss://*.supabase.co',
      'https://*.ingest.sentry.io',
      'https://*.ingest.us.sentry.io',
    ]) {
      expect(prod).toContain(host);
    }
    expect(prod).not.toContain('ws://localhost');
    expect(dev).toContain('ws://localhost:*');
  });

  it('keeps the load-bearing media/img sources (blob: for the editor, https: tiles)', () => {
    expect(prod).toContain('img-src \'self\' data: blob: https:');
    expect(prod).toContain('media-src \'self\' blob: https:');
  });

  it('declares both reporting mechanisms at the sink path', () => {
    expect(prod).toContain(`report-uri ${CSP_REPORT_PATH}`);
    expect(prod).toContain('report-to csp');
  });

  it('keeps the frame/base/form lockdowns', () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("form-action 'self'");
  });

  it("admits the same-origin service worker only (248) — 'strict-dynamic' would ignore script-src's 'self'", () => {
    expect(prod.split('; ')).toContain("worker-src 'self'");
  });
});

describe('the static CSP (V3)', () => {
  it('script-src is self + inline only — no https: wildcard, no eval in production', async () => {
    const { buildStaticCsp } = await import('../csp');
    const script = buildStaticCsp().split('; ').find(d => d.startsWith('script-src'))!;
    expect(script).toBe("script-src 'self' 'unsafe-inline'");
    expect(buildStaticCsp({ dev: true }).split('; ').find(d => d.startsWith('script-src'))).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    // The island's feed is same-origin: connect-src keeps 'self'.
    expect(buildStaticCsp().split('; ').find(d => d.startsWith('connect-src'))).toContain("'self'");
    // Public sites register no worker.
    expect(buildStaticCsp()).not.toContain('worker-src');
  });
});

describe('the public theme script is admitted by HASH under the nonce policy (Oct 1 2026)', () => {
  it('the hash source is the sha256 of the script text, base64', async () => {
    const { createHash } = await import('node:crypto');
    const { inlineScriptHashSource } = await import('../csp');
    const { PUBLIC_THEME_SCRIPT } = await import('../theme-script');
    const expected = `'sha256-${createHash('sha256').update(PUBLIC_THEME_SCRIPT, 'utf8').digest('base64')}'`;
    expect(await inlineScriptHashSource(PUBLIC_THEME_SCRIPT)).toBe(expected);
  });

  it('a hash rides script-src beside the nonce; without one the policy is byte-identical to before', async () => {
    const { buildCsp } = await import('../csp');
    const plain = buildCsp('n0nce').split('; ').find(d => d.startsWith('script-src'))!;
    expect(plain).toBe("script-src 'self' 'nonce-n0nce' 'strict-dynamic' 'wasm-unsafe-eval' 'unsafe-inline' https:");
    const hashed = buildCsp('n0nce', { scriptHashes: ["'sha256-abc='"] }).split('; ').find(d => d.startsWith('script-src'))!;
    expect(hashed).toBe("script-src 'self' 'nonce-n0nce' 'sha256-abc=' 'strict-dynamic' 'wasm-unsafe-eval' 'unsafe-inline' https:");
  });
});

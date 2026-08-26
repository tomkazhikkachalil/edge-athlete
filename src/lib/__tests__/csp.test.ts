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
    expect(prod).not.toContain('unsafe-eval');
    expect(dev).toContain("'unsafe-eval'");
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
});

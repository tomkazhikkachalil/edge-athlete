import { describe, it, expect } from 'vitest';
import { cspViolations } from '../csp-report';

describe('cspViolations', () => {
  it('reads the legacy report-uri shape', () => {
    const raw = JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'https://evil.example/x.js', 'document-uri': 'https://edgeathlete.ca/feed' } });
    expect(cspViolations(raw)).toEqual([{ directive: 'script-src', blocked: 'https://evil.example/x.js', page: 'https://edgeathlete.ca/feed', sample: '' }]);
  });

  it('reads EVERY csp-violation in a Reporting API batch and skips the other types', () => {
    const raw = JSON.stringify([
      { type: 'deprecation', body: { id: 'X', message: 'old API' } },
      { type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://cdn.x/y.png', documentURL: 'https://edgeathlete.ca/u/a' } },
      { type: 'intervention', body: { id: 'Y' } },
      { type: 'csp-violation', body: { effectiveDirective: 'connect-src', blockedURL: 'wss://z', documentURL: 'https://edgeathlete.ca/live/1', sample: '' } },
    ]);
    expect(cspViolations(raw).map(v => v.directive)).toEqual(['img-src', 'connect-src']);
  });

  it('logs nothing for a batch with no violation, a body without a directive, or garbage', () => {
    expect(cspViolations(JSON.stringify([{ type: 'deprecation', body: {} }]))).toEqual([]);
    expect(cspViolations(JSON.stringify({ 'csp-report': {} }))).toEqual([]);
    expect(cspViolations('not json')).toEqual([]);
  });

  it('caps a flood at five per post', () => {
    const one = { type: 'csp-violation', body: { effectiveDirective: 'img-src' } };
    expect(cspViolations(JSON.stringify(Array(20).fill(one)))).toHaveLength(5);
  });
});

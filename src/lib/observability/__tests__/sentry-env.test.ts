import { describe, it, expect } from 'vitest';
import { resolveAppEnvironment, resolveSentryConfig } from '../sentry-env';

describe('resolveAppEnvironment', () => {
  it('maps each recognized vercelEnv to itself', () => {
    expect(resolveAppEnvironment({ vercelEnv: 'production' })).toBe('production');
    expect(resolveAppEnvironment({ vercelEnv: 'preview' })).toBe('preview');
    expect(resolveAppEnvironment({ vercelEnv: 'development' })).toBe('development');
  });

  it('lets explicitEnv win over vercelEnv', () => {
    expect(
      resolveAppEnvironment({ explicitEnv: 'preview', vercelEnv: 'production' })
    ).toBe('preview');
  });

  it('ignores unrecognized values instead of passing them through', () => {
    // A typo must never mint a rogue Sentry environment.
    expect(resolveAppEnvironment({ vercelEnv: 'staging', nodeEnv: 'development' })).toBe(
      'development'
    );
    expect(resolveAppEnvironment({ explicitEnv: 'prod', vercelEnv: 'preview' })).toBe(
      'preview'
    );
    expect(resolveAppEnvironment({ vercelEnv: '', nodeEnv: 'production' })).toBe(
      'production'
    );
  });

  it('falls back to nodeEnv, treating anything non-production as development', () => {
    expect(resolveAppEnvironment({ nodeEnv: 'production' })).toBe('production');
    expect(resolveAppEnvironment({ nodeEnv: 'development' })).toBe('development');
    expect(resolveAppEnvironment({ nodeEnv: 'test' })).toBe('development');
    expect(resolveAppEnvironment({})).toBe('development');
  });

  it('REGRESSION: a missing vercelEnv under NODE_ENV=production resolves to production', () => {
    // This is the browser-in-preview case. Vercel preview builds run with
    // NODE_ENV=production, so if NEXT_PUBLIC_VERCEL_ENV is absent from the
    // client bundle, every preview browser event tags as 'production' —
    // exactly the bug this module exists to fix. The behavior below is
    // correct for the server; it is why the client MUST be given
    // NEXT_PUBLIC_VERCEL_ENV. See instrumentation-client.ts.
    expect(resolveAppEnvironment({ vercelEnv: undefined, nodeEnv: 'production' })).toBe(
      'production'
    );
  });
});

describe('resolveSentryConfig', () => {
  it('samples traces in deployed environments but never locally', () => {
    expect(resolveSentryConfig({ vercelEnv: 'production' }).tracesSampleRate).toBe(0.1);
    expect(resolveSentryConfig({ vercelEnv: 'preview' }).tracesSampleRate).toBe(0.1);
    // Local dev spawns a transaction per HMR navigation — pure noise.
    expect(resolveSentryConfig({ vercelEnv: 'development' }).tracesSampleRate).toBe(0);
  });

  it('stays inert without a DSN', () => {
    expect(resolveSentryConfig({}).enabled).toBe(false);
    expect(resolveSentryConfig({ dsn: '' }).enabled).toBe(false);
    expect(resolveSentryConfig({ dsn: 'https://k@o1.ingest.sentry.io/2' }).enabled).toBe(
      true
    );
  });

  it('passes the DSN through untouched', () => {
    const dsn = 'https://abc@o123.ingest.us.sentry.io/456';
    expect(resolveSentryConfig({ dsn }).dsn).toBe(dsn);
    expect(resolveSentryConfig({}).dsn).toBeUndefined();
  });

  it('never enables PII', () => {
    expect(resolveSentryConfig({ vercelEnv: 'production' }).sendDefaultPii).toBe(false);
    expect(resolveSentryConfig({ vercelEnv: 'development' }).sendDefaultPii).toBe(false);
  });

  it('keeps dev enabled so Sentry stays verifiable locally', () => {
    // Deliberate: tagged, not silently disabled.
    const config = resolveSentryConfig({
      dsn: 'https://k@o1.ingest.sentry.io/2',
      nodeEnv: 'development',
    });
    expect(config.enabled).toBe(true);
    expect(config.environment).toBe('development');
  });
});

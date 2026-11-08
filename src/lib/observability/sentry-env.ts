/**
 * Resolves the Sentry environment + sampling for a given runtime. Pure —
 * unit-tested, and deliberately does NOT import @sentry/nextjs so vitest can
 * load it in the node environment with no setup and the browser bundle pays
 * nothing for it.
 *
 * LOAD-BEARING: this module takes env VALUES as arguments and never reads
 * `process.env` itself. Next's DefinePlugin substitutes literal
 * `process.env.X` member expressions AT THE CALL SITE; a module reading them
 * internally would inline nothing in the client build and mis-tag every
 * browser event. That is also why one shared module is safe across all three
 * runtimes (node / edge / browser) — it holds only a decision table.
 *
 * Why this exists: all three Sentry inits used to gate solely on DSN
 * presence, with no `environment`. Once a DSN exists in .env.local, local dev
 * ships errors into the same Sentry project as production, indistinguishable
 * from real incidents.
 */

export type AppEnvironment = 'production' | 'preview' | 'development';

const APP_ENVIRONMENTS: readonly string[] = ['production', 'preview', 'development'];

export interface SentryEnvInput {
  /** NEXT_PUBLIC_SENTRY_DSN */
  dsn?: string;
  /** NEXT_PUBLIC_SENTRY_ENVIRONMENT — explicit override, wins over everything. */
  explicitEnv?: string;
  /** VERCEL_ENV on the server; NEXT_PUBLIC_VERCEL_ENV in the browser. */
  vercelEnv?: string;
  /** NODE_ENV — last resort. */
  nodeEnv?: string;
}

export interface ResolvedSentryConfig {
  dsn: string | undefined;
  enabled: boolean;
  environment: AppEnvironment;
  tracesSampleRate: number;
  sendDefaultPii: false;
}

/**
 * explicitEnv → vercelEnv → nodeEnv. Unrecognized strings FALL THROUGH rather
 * than being passed to Sentry, so a typo can never mint a rogue environment.
 *
 * Note NODE_ENV is 'production' for Vercel preview builds too — that is why
 * vercelEnv must be supplied on both server and client, and why the browser
 * needs the NEXT_PUBLIC_-prefixed copy.
 */
export function resolveAppEnvironment(input: SentryEnvInput): AppEnvironment {
  const { explicitEnv, vercelEnv, nodeEnv } = input;

  if (explicitEnv && APP_ENVIRONMENTS.includes(explicitEnv)) {
    return explicitEnv as AppEnvironment;
  }
  if (vercelEnv && APP_ENVIRONMENTS.includes(vercelEnv)) {
    return vercelEnv as AppEnvironment;
  }
  return nodeEnv === 'production' ? 'production' : 'development';
}

/**
 * No performance traces, anywhere (performance program Phase 2d, Nov 2026).
 * Deployed environments sampled 10 % for a year and nobody read a trace; on
 * the server the SDK now loads on the first error, so it cannot trace, and
 * in the browser each sampled page load cost beacons through /api/relay on
 * the open path (3 of the 23 API calls a cold /feed made). Errors themselves
 * are always sent, in every environment. Turning traces back on is one
 * number here and `browserBeaconIntegrations` below.
 */
function tracesSampleRateFor(environment: AppEnvironment): number {
  void environment;
  return 0;
}

/** The default browser integrations that send on their own without an
 *  error — the session (release-health) envelope on every page load and the
 *  tracing transaction — are left out; everything that captures an error
 *  stays. Pure: a list of names in, the kept list out. */
export const BEACON_INTEGRATIONS: ReadonlySet<string> = new Set(['BrowserSession', 'BrowserTracing']);
export function browserBeaconIntegrations<T extends { name: string }>(defaults: readonly T[]): T[] {
  return defaults.filter((i) => !BEACON_INTEGRATIONS.has(i.name));
}

export function resolveSentryConfig(input: SentryEnvInput): ResolvedSentryConfig {
  const environment = resolveAppEnvironment(input);

  return {
    dsn: input.dsn,
    // Unchanged from before: no DSN means Sentry is inert.
    enabled: !!input.dsn,
    environment,
    tracesSampleRate: tracesSampleRateFor(environment),
    // Athlete data is personal — never attach request bodies/cookies/IPs.
    sendDefaultPii: false,
  };
}

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
 * Traces are sampled in the deployed environments only. Local dev generates a
 * transaction per HMR navigation — pure noise, and it burns the free-tier
 * quota. Errors themselves are always sent, in every environment.
 */
function tracesSampleRateFor(environment: AppEnvironment): number {
  return environment === 'development' ? 0 : 0.1;
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

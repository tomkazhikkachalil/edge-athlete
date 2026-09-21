import * as Sentry from '@sentry/nextjs';

/**
 * The ONE place an API route's failure is recorded (Round 1 PR 4, Sep 2026).
 *
 * Before this, ~96 % of API failures reached only Vercel's function logs:
 * every route caught its error and answered a JSON 500 with `console.error`,
 * and Sentry's `onRequestError` sees UNCAUGHT errors only. This helper is
 * a drop-in for `console.error(...)` — the same call shape — that also sends
 * the first Error (or a synthesized one from the first string) to Sentry,
 * tagged `area: 'api'`. Sentry dedupes by stack; a route that starts 500ing
 * on every request is one event with a count, not a flood.
 *
 * What it deliberately does NOT do: swallow, rethrow, or change the response.
 */
export function reportRouteError(...args: unknown[]): void {
  console.error(...args);
  try {
    const error = args.find(a => a instanceof Error) as Error | undefined;
    const label = args.find(a => typeof a === 'string') as string | undefined;
    const rest = args.filter(a => !(a instanceof Error) && a !== label);
    const extra: Record<string, unknown> = {};
    if (rest.length > 0) extra.details = rest.map(safe);
    if (error) {
      Sentry.captureException(error, { tags: { area: 'api' }, extra: { ...extra, label } });
    } else {
      Sentry.captureMessage(label ?? 'route error', { level: 'error', tags: { area: 'api' }, extra });
    }
  } catch {
    // Observability must never become the error.
  }
}

/** Supabase errors are plain objects — keep them readable in Sentry's extra. */
function safe(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

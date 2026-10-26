/**
 * The database-trip trace (post-audit refinements, item 5 PR 0 — Oct 26 2026).
 *
 * Off unless `EA_TRACE_DB=1` is set on the SERVER process: then every
 * Supabase request the two server clients make (`getSupabaseAdmin`,
 * `getServerClient` → `getServerAuth` / `requireAuth`) is counted and
 * logged as one line — `[db-trace] <method> <path>` — so a serial run of the
 * hot routes (scripts/db-trace-inventory.mjs) can count the trips a request
 * makes. The counter is process-wide, not request-scoped: the inventory sends
 * ONE request at a time. In production the env is unset and this module
 * returns `undefined`, so `createClient` keeps its default fetch; nothing is
 * wrapped, nothing is logged.
 */

const ON = process.env.EA_TRACE_DB === '1';

let trips = 0;

/** The fetch to hand `createClient({ global: { fetch } })`, or undefined when the trace is off. */
export const tracedFetch: typeof fetch | undefined = ON
  ? async (input, init) => {
      trips += 1;
      try {
        const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
        console.error(`[db-trace] ${method} ${u.pathname}${u.search ? '?' + u.search.slice(1, 80) : ''}`);
      } catch {
        console.error('[db-trace] ? (unparsed url)');
      }
      return fetch(input, init);
    }
  : undefined;

/** How many Supabase requests this process has made since it started (0 when the trace is off). */
export function dbTripsSoFar(): number {
  return trips;
}

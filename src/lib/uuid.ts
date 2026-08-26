// ── UUID shape validation ───────────────────────────────────────────────────
// The ONE canonical UUID check. Zero imports on purpose: importable from
// client components, Edge middleware, and API routes without pulling anything
// into a bundle. Route handlers use isUuid() at the top of the handler and
// 400 on failure — a raw non-UUID reaching PostgREST throws 22P02, which
// surfaces as a 500 (and, before the Aug 2026 hardening round, leaked the
// Postgres error body).
//
// History: this regex lived in src/lib/golf/course-catalog.ts (UUID_RE) and
// was re-declared locally in 7 other files; course-catalog now re-exports
// from here, so its existing importers are unaffected.

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

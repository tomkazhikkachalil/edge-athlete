// ── The training week (pure, zero imports) ──────────────────────────────────
// Weeks start MONDAY 00:00 local (ISO-8601 and the near-universal
// training-app convention). Its own module so the session maths
// (src/lib/vitals/session-math.ts) and the workout dashboard can both use it
// without importing each other.

export function startOfWeek(d: Date): Date {
  const result = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = result.getDay(); // 0 = Sunday
  const back = day === 0 ? 6 : day - 1;
  result.setDate(result.getDate() - back);
  return result;
}

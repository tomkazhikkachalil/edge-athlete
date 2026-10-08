// The ONE way a spec's `finally` cleans up (sweep prep, Oct 2026).
//
// Four "QA GPS Links" catalog rows were found on PRODUCTION: the flag spec's
// `finally` ran `ctx.close()` FIRST, a timed-out test had already torn the
// browser down, that call threw, and the database deletes after it never
// ran. The rule: the DATABASE steps run first, every step in its own
// try/catch (one failure never skips the next), the browser / API disposal
// last. A failed step is logged loudly, never thrown — the teardown's
// backstop (global-teardown.ts) and the staging sweep catch what is left.

export async function cleanup(label: string, steps: Array<() => Promise<unknown> | unknown>): Promise<void> {
  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      console.error(`[e2e] cleanup step failed (${label}):`, err instanceof Error ? err.message : err);
    }
  }
}

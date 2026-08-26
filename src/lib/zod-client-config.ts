'use client';

// ── Zod: jitless in the browser (CSP follow-up, Aug 2026) ───────────────────
// Zod 4 feature-detects JIT compilation with `Function("")` inside try/catch.
// Under the enforced CSP that probe is BLOCKED — harmless (Zod falls back to
// its interpreted path, which is exactly what jitless selects), but it fired
// a script-src violation on every page whose bundle parses a schema,
// spamming /api/csp-report with noise. Declaring jitless up front skips the
// probe entirely: identical behavior, zero violations.
//
// Browser-only on purpose: the server has no CSP on execution and keeps
// Zod's compiled fast path. Imported for its side effect from AuthProvider
// (src/lib/auth.tsx), which is in every client bundle and evaluates before
// any schema parse runs.
import { z } from 'zod';

if (typeof window !== 'undefined') {
  z.config({ jitless: true });
}

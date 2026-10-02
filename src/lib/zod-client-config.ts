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
//
// WITHOUT importing zod (speed round, Oct 2026): `import { z } from 'zod'`
// here put the whole library (~287 KB) into EVERY page's bundle, though most
// pages never parse a schema in the browser. Zod keeps its global settings on
// `globalThis.__zod_globalConfig` and creates that object only if it is
// absent (zod/v4/core/core.js), so writing the flag there first is the same
// `z.config({ jitless: true })` — and if zod happened to load earlier, the
// write lands on its live object. Pinned against the installed zod by
// src/lib/__tests__/zod-client-config.test.ts.

type ZodGlobal = { __zod_globalConfig?: Record<string, unknown> };

export function applyZodJitless(target: ZodGlobal = globalThis as ZodGlobal): void {
  const current = target.__zod_globalConfig ?? (target.__zod_globalConfig = {});
  current.jitless = true;
}

if (typeof window !== 'undefined') {
  applyZodJitless();
}

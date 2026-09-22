/**
 * Which Supabase project a LOCAL script talks to (Round 2, Sep 21 2026 —
 * two environments exist now).
 *
 *   .env.local  — STAGING (EdgeAthlete-BackUp): `npm run dev`, the e2e
 *                 suite, check:schema by default. Disposable.
 *   .env.prod   — PRODUCTION: only what must read prod — the rebuild
 *                 baseline (prod's schema IS the baseline), the prod probe,
 *                 `check:schema:prod`, `migrate:mark` after a prod run.
 *
 * `TARGET_ENV=prod` selects `.env.prod`; anything else (or unset) selects
 * `.env.local`. Keys already in the environment win (CI sets them). Both
 * files are gitignored (`.env.*`).
 */
import { readFileSync } from 'fs';

export const TARGET_ENV = process.env.TARGET_ENV === 'prod' ? 'prod' : 'local';
export const ENV_FILE = TARGET_ENV === 'prod' ? '.env.prod' : '.env.local';

/** Loads ENV_FILE's keys into process.env where unset. Returns the file it read (or null). */
export function loadEnvFile(keys = null) {
  let text;
  try {
    text = readFileSync(ENV_FILE, 'utf8');
  } catch {
    return null;
  }
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    if (keys && !keys.includes(m[1])) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return ENV_FILE;
}

/** The project ref in a Supabase URL, for the "is this prod?" refusals. */
export function supabaseRef(url) {
  return /https?:\/\/([a-z0-9]+)\.supabase\.(co|in)/.exec(url ?? '')?.[1] ?? null;
}

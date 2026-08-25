/**
 * AI runner resolution (Phase 3 scaffold). FAIL-CLOSED: no configured
 * endpoint → null → every AI affordance in the editor stays invisible.
 * NEXT_PUBLIC_AI_RUNNER_URL is inlined at BUILD time (the usual
 * NEXT_PUBLIC_* trap — setting it in Vercel requires a redeploy), and
 * setting it is a deliberate act with cost implications documented in
 * docs/AI_RUNNER.md — never set it without reading that file.
 */

import { createRemoteRunner } from './remote-runner';
import type { AiRunner } from './types';

let cached: AiRunner | null | undefined;

export function getAiRunner(): AiRunner | null {
  if (cached !== undefined) return cached;
  const endpoint = process.env.NEXT_PUBLIC_AI_RUNNER_URL;
  cached = endpoint && /^https?:\/\//.test(endpoint) ? createRemoteRunner(endpoint) : null;
  return cached;
}

export function isAiAvailable(): boolean {
  return getAiRunner() !== null;
}

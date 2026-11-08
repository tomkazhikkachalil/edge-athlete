import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WARM_PATHS } from '../../../scripts/warm.mjs';

/**
 * The post-deploy warm step (scripts/warm.mjs, .github/workflows/warm.yml —
 * performance program, Nov 2026): one unauthenticated pass over the open path
 * right after a production deploy, so the first real open finds warm
 * functions. These pin that the pass covers what a feed open fires and that
 * the workflow runs it on the production deployment only.
 */
describe('the warm step', () => {
  it('covers the document and every API call a feed open makes', () => {
    for (const p of ['/', '/api/health', '/api/me/pulse', '/api/notifications', '/api/messages', '/api/posts', '/api/drafts', '/api/golf/live-now', '/api/sport-events/live-now', '/api/videos/live-now', '/api/suggestions', '/api/workout-routines', '/api/guardian/athletes']) {
      expect(WARM_PATHS.some((w: string) => w === p || w.startsWith(p + '?')), p).toBe(true);
    }
    // Reads only: a warm pass must never write.
    expect(WARM_PATHS.every((w: string) => !/\/(delete|create|send|upload)/.test(w))).toBe(true);
  });

  it('runs on the Production deployment_status success only, against edgeathlete.ca, expecting the deployed sha', () => {
    const yml = readFileSync(join(process.cwd(), '.github/workflows/warm.yml'), 'utf8');
    expect(yml).toMatch(/on:\s*\n\s*deployment_status:/);
    expect(yml).toContain("github.event.deployment_status.state == 'success'");
    expect(yml).toContain("github.event.deployment.environment == 'Production'");
    expect(yml).toContain('--base https://edgeathlete.ca');
    expect(yml).toContain('--expect "${{ github.event.deployment.sha }}"');
    expect(yml).not.toMatch(/secrets\./);
  });
});

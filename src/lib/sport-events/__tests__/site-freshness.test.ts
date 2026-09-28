import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// G5 (sports-team website program, Sep 28 2026): a game's STATUS changes
// purge the org sites that show it; its live SCORE never does — the ISR copy
// is a snapshot and the live card (V) is the scoreboard. A purge per score
// tap would re-render a whole site on every goal.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('site freshness on sport-event games', () => {
  it('both transition doors purge through withSiteFreshness, and the internal sugar calls the cores (one purge per act)', () => {
    const src = read('src/lib/sport-events/lifecycle-server.ts');
    expect(src).toMatch(/export async function applyTransition\([^)]*\)[^{]*\{\s*return withSiteFreshness\(admin, req\.eventId, await applyTransitionCore\(admin, req\)\);/);
    expect(src).toMatch(/export async function applyRoundTransition\([^)]*\)[^{]*\{\s*return withSiteFreshness\(admin, req\.eventId, await applyRoundTransitionCore\(admin, req\)\);/);
    // Inside the event-level core, the round sugar never re-enters the wrapped door.
    const core = src.slice(src.indexOf('async function applyTransitionCore'), src.indexOf('export async function applyRoundTransition'));
    expect(core).not.toMatch(/[^e]applyRoundTransition\(/);
    expect(src).toContain("if (outcome.ok) await revalidateOrgSitesForSportEvent(admin, eventId);");
  });

  it('the score routes never purge a site', () => {
    for (const p of ['src/app/api/sport-events/[id]/rounds/[rid]/score/route.ts']) {
      expect(read(p), p).not.toMatch(/revalidate/i);
    }
  });
});

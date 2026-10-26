import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The load tools never touch production (Tom, Oct 25 2026: no production load
// test). Three doors, all shut: the production Supabase ref, the production
// hostnames, and — found Oct 26 — the git-branch alias of the production
// branch (`edge-athlete-git-main-…vercel.app`), which is the production
// deployment under another name. The ramp also proves the target is on the
// staging project before it sends a single load request: a staging session
// must authenticate there.
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
const TOOLS = ['scripts/load-ramp.mjs', 'scripts/realtime-channel-count.mjs', 'scripts/realtime-fanout-probe.mjs', 'scripts/seed-volume.mjs'];

describe('load tools refuse production', () => {
  for (const t of TOOLS) {
    it(`${t} refuses the production project ref`, () => {
      expect(read(t)).toMatch(/htwhmdoiszhhmwuflgci/);
    });
  }
  for (const t of ['scripts/load-ramp.mjs', 'scripts/realtime-channel-count.mjs']) {
    it(`${t} refuses the production hosts and the production branch's alias`, () => {
      const src = read(t);
      expect(src).toMatch(/edgeathlete\\.ca\$\|\^edge-athlete\\.vercel\\.app\$/);
      expect(src).toMatch(/-git-\(main\|master\)-/);
    });
  }
  it('the ramp proves the target is on the staging project before loading it', () => {
    const src = read('scripts/load-ramp.mjs');
    expect(src).toMatch(/\/api\/notifications\/unread-count/);
    expect(src).toMatch(/a staging session does not authenticate/);
  });
});

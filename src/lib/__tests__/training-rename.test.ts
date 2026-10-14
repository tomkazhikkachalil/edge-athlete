import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Profile quick fixes, PR 2 (Oct 14 2026): Vitals is "Training" (the
// workouts + activities section) and Edit Profile's Vitals is "Body
// Metrics". Tom's acceptance check — "a search of the app finds no remaining
// use of the word Vitals" — as a test. What SURVIVES, by rule, is what a
// rename must never touch: the database (athlete_vitals, vitals_privacy),
// the API paths (/api/vitals*, /api/settings/vitals-privacy), the payload
// fields the clients read (counts.vitals, data.vitals, data.vitalsPrivacy,
// data.currentVitals, the media endpoint's `vitals:` key), the stored
// type 'vitals_entry', the media token and the two URL aliases (?tab=vitals,
// the 'vitals' literal) that keep every old link working.
const ROOT = join(__dirname, '..', '..', '..');
const ALLOWED: RegExp[] = [
  /athlete_vitals/, /vitals_privacy/, /\/api\/vitals/, /api\/vitals/, /settings\/vitals-privacy/,
  /vitals_entr(y|ies)(_id)?/, /edge_vitals/, /VITALS_TAB_ALIAS/,
  /'vitals'/, /"vitals"/, /\?tab=vitals/, /tab=vitals/, /\{ vital: data \}/, /names it vitals \(a payload field/,
  /\bvitals: (0|number;|data\.vitals|bodyMetrics|\[\]|filterTrainingRows)/,
  /counts\.vitals/, /data\.vitals/, /data\.vitalsPrivacy/, /data\.currentVitals/,
  /called Vitals until Oct 14 2026/,
];
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!['node_modules', '.next', '.git'].includes(name)) walk(p, out); }
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe('the word Vitals is gone from the app (the rename, Oct 14 2026)', () => {
  it('every surviving occurrence in src/ and e2e/ is a database, API, payload or alias form', () => {
    const offenders: string[] = [];
    for (const dir of ['src', 'e2e']) {
      for (const f of walk(join(ROOT, dir))) {
        if (f.endsWith('training-rename.test.ts')) continue;
        const lines = readFileSync(f, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (!/vital/i.test(line)) return;
          // strip every allowed form, then look for what is left
          let rest = line;
          for (const re of ALLOWED) rest = rest.replace(new RegExp(re.source, 'g'), '');
          if (/vital/i.test(rest)) offenders.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

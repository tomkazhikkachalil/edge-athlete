import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Departed accounts (238): `publicDisplayName` answers a departed tombstone's
 * FULL name only when the reader selected `departed_at`. Supabase rows are
 * untyped here, so the compiler cannot see a select string — this sweep can.
 * Every select that feeds the name rule (it carries the rule's three inputs
 * `visibility`, `email` and `supervision_state`) must also carry
 * `departed_at`; a reader that forgets would show "First L." — fails closed,
 * never a leak, but not Tom's rule.
 */
const SRC = path.join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every single-quoted or backtick string literal in a file. */
function literals(text: string): string[] {
  return [...text.matchAll(/'([^'\n]*)'|`([^`]*)`/g)].map(m => m[1] ?? m[2] ?? '');
}

describe('every reader of the public name rule selects departed_at', () => {
  it('a select carrying visibility + email + supervision_state also carries departed_at', () => {
    const misses: string[] = [];
    for (const file of walk(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const lit of literals(text)) {
        const cols = new Set(lit.split(/[\s,()]+/).filter(Boolean));
        if (cols.has('visibility') && cols.has('email') && cols.has('supervision_state') && !cols.has('departed_at')) {
          misses.push(`${path.relative(process.cwd(), file)}: ${lit.slice(0, 90)}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it('the sweep finds the readers it is meant to guard (not vacuous)', () => {
    let hits = 0;
    for (const file of walk(SRC)) {
      for (const lit of literals(fs.readFileSync(file, 'utf8'))) {
        if (/supervision_state, departed_at/.test(lit)) hits++;
      }
    }
    expect(hits).toBeGreaterThan(20);
  });
});

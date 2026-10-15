import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Feedback policy (Tom, Oct 14 2026): a visible result is its own
// confirmation. The toast surface offers exactly an ERROR (the card, an
// alert) and a NOTICE (quiet, one line, a status, gone in a few seconds —
// for a result the user cannot see from here) plus Undo. `showSuccess`,
// `showInfo` and `showWarning` are gone, so a green banner cannot creep back.

const SRC = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('the feedback policy', () => {
  const files = walk(SRC).filter(f => !f.endsWith('toast-policy.test.ts'));

  it('no component fires a success, info or warning toast', () => {
    const offenders = files.filter(f => /\bshow(Success|Info|Warning)\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.slice(SRC.length + 1))).toEqual([]);
  });

  it('the toast surface offers exactly error, notice and undo', () => {
    const src = readFileSync(join(SRC, 'components', 'Toast.tsx'), 'utf8');
    expect(src).toMatch(/type: 'error' \| 'notice'/);
    for (const fn of ['showError', 'showNotice', 'showUndo']) expect(src).toContain(`const ${fn} = useCallback(`);
    for (const fn of ['showSuccess', 'showInfo', 'showWarning']) expect(src).not.toContain(`const ${fn} = `);
  });

  it('a notice is quiet: a status, one line, gone within four seconds', () => {
    const src = readFileSync(join(SRC, 'components', 'Toast.tsx'), 'utf8');
    const notice = Number(src.match(/export const NOTICE_MS = (\d+);/)?.[1]);
    expect(notice).toBeGreaterThan(0);
    expect(notice).toBeLessThanOrEqual(4000);
    expect(src).toContain('role="status"');
    expect(src).toContain('rounded-full');
  });
});

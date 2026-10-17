import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Every spec runs under every browser profile (every-browser round, Oct 16
// 2026): the `brave-android` project's Shields come in through
// e2e/helpers/test.ts, so a spec that imports '@playwright/test' directly
// would run as plain Chromium there and prove nothing about Brave.
describe('e2e specs import the shared test', () => {
  it('no spec imports @playwright/test directly', () => {
    const dir = path.resolve(__dirname, '../../../e2e');
    const offenders = readdirSync(dir)
      .filter(f => f.endsWith('.spec.ts') && !f.startsWith('zz-'))
      .filter(f => /from '@playwright\/test'/.test(readFileSync(path.join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

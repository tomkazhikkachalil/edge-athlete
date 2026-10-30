import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { deviceUnitOf, resolveUnitSystem, sanitizeUnitSystem, UNIT_SYSTEMS, unitSystemOfTemp } from '../unit-prefs';

// The unit system on the account (293): the column is unknown to the app,
// the account wins over the device, the device key is the cache.
describe('unit-prefs — the account unit system', () => {
  it('sanitizeUnitSystem accepts the two words and nothing else', () => {
    expect(sanitizeUnitSystem('metric')).toBe('metric');
    expect(sanitizeUnitSystem('imperial')).toBe('imperial');
    for (const junk of [null, undefined, '', 'Metric', 'km', 'mi', 1, {}, []]) expect(sanitizeUnitSystem(junk)).toBeNull();
    expect(UNIT_SYSTEMS).toEqual(['metric', 'imperial']);
  });
  it('resolveUnitSystem: the account wins when it has a choice, else the device, metric by default', () => {
    expect(resolveUnitSystem('imperial', 'km')).toBe('imperial');
    expect(resolveUnitSystem('metric', 'mi')).toBe('metric');
    expect(resolveUnitSystem(null, 'mi')).toBe('imperial');
    expect(resolveUnitSystem(undefined, 'km')).toBe('metric');
    expect(resolveUnitSystem('junk', 'mi')).toBe('imperial');
  });
  it('deviceUnitOf and unitSystemOfTemp are the two spellings of one choice', () => {
    expect(deviceUnitOf('metric')).toBe('km');
    expect(deviceUnitOf('imperial')).toBe('mi');
    expect(unitSystemOfTemp('°F')).toBe('imperial');
    expect(unitSystemOfTemp('°C')).toBe('metric');
  });
});

// The column's contract, pinned from the source: owner-only on read, NULLed
// on departure, the one writer behind the one route, the route's bucket.
describe('unit_system — the column\'s contract', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), 'src', p), 'utf8');
  it('is owner-only, stripped on departure, and typed unknown', () => {
    expect(read('app/api/profile/route.ts')).toMatch(/OWNER_ONLY_FIELDS = \[[^\]]*'unit_system'/);
    expect(read('lib/account-departure.ts')).toMatch(/'unit_system'/);
    expect(read('lib/supabase.ts')).toMatch(/unit_system\?: unknown/);
  });
  it('has ONE writer behind PATCH /api/settings/units on the account\'s own row, with its bucket', () => {
    const route = read('app/api/settings/units/route.ts');
    expect(route).toMatch(/requireAuth\(request\)/);
    expect(route).toMatch(/enforceRateLimit\(request, 'units'/);
    expect(route).toMatch(/writeUnitSystem\(/);
    expect(route).toMatch(/private, no-store/);
    expect(read('lib/activities/unit-prefs-server.ts')).toMatch(/\.update\(\{ unit_system: sys \}\)\s*\.eq\('id', profileId\)/);
    expect(read('lib/rate-limit-core.ts')).toMatch(/\n\s*units: \{ max: 120, windowSeconds: 3600, keyBy: 'user' \}/);
  });
  it('the account seeds the device on every profile load, keyed off the OWN profile', () => {
    const applier = read('components/UnitSystemApplier.tsx');
    expect(applier).toMatch(/adoptAccountUnitSystem\(profile\.unit_system\)/);
    expect(applier).toMatch(/const \{ profile \} = useAuth\(\)/);
    expect(read('app/(app)/layout.tsx')).toMatch(/<UnitSystemApplier \/>/);
  });
});

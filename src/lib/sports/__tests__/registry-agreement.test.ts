import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS } from '@/lib/features';
import { SPORT_REGISTRY, type SportKey } from '../SportRegistry';
import { getSportAdapter } from '../AdapterRegistry';
import { STAT_SCHEMAS } from '../stat-schemas';
import { COMBAT_SPORT_KEYS } from '../bout';

// Oct 16 2026 (the combat sports): adding a sport is data in five places —
// the registry, FEATURE_SPORTS, an adapter, a stat schema and (for a combat
// sport) the bout's methods. They must agree, or a sport shows in one door
// and is missing from the next.
describe('the sport tables agree', () => {
  it('every enabled registry sport is a feature sport with an adapter, and back', () => {
    const enabled = (Object.keys(SPORT_REGISTRY) as SportKey[]).filter(k => SPORT_REGISTRY[k].enabled).sort();
    expect([...FEATURE_FLAGS.FEATURE_SPORTS].sort()).toEqual(enabled);
    for (const k of enabled) expect(() => getSportAdapter(k), k).not.toThrow();
  });

  it('every non-golf feature sport has a stat schema; every combat sport is one', () => {
    for (const k of FEATURE_FLAGS.FEATURE_SPORTS) if (k !== 'golf') expect(STAT_SCHEMAS[k as SportKey], k).toBeTruthy();
    for (const k of COMBAT_SPORT_KEYS) {
      expect(FEATURE_FLAGS.FEATURE_SPORTS).toContain(k);
      expect(STAT_SCHEMAS[k]!.profileTiles[0].compute).toEqual({ kind: 'record' });
    }
  });
});

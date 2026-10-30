import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HANDICAPS_MAX_IDS, handicapSuffix, parseHandicapIds } from '../handicaps';

// The players' handicaps on the round's last step (Oct 29 2026): the id
// list's parsing and cap, the line's one spelling, the route's contract.
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('parseHandicapIds', () => {
  it('keeps distinct UUIDs in order, lower-cased, and drops junk', () => {
    expect(parseHandicapIds(`${A}, ${B.toUpperCase()} ,${A},nope,`)).toEqual([A, B]);
    expect(parseHandicapIds('')).toEqual([]);
    expect(parseHandicapIds(null)).toEqual([]);
  });
  it('caps the list at eight', () => {
    const many = Array.from({ length: 12 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`).join(',');
    expect(parseHandicapIds(many)).toHaveLength(HANDICAPS_MAX_IDS);
  });
});

describe('handicapSuffix — EventPlayers\' spelling', () => {
  it('" · index 12.4", and nothing when unknown', () => {
    expect(handicapSuffix('12.4')).toBe(' · index 12.4');
    expect(handicapSuffix('+1.5')).toBe(' · index +1.5');
    expect(handicapSuffix(null)).toBe('');
    expect(handicapSuffix('')).toBe('');
  });
});

describe('GET /api/golf/handicaps — the contract, from the source', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/golf/handicaps/route.ts'), 'utf8');
  it('is signed-in only, gates every other id through canViewProfile, computes with the profile card\'s function, and never caches', () => {
    expect(route).toMatch(/requireAuth\(request\)/);
    expect(route).toMatch(/canViewProfile\(id, user\.id\)/);
    expect(route).toMatch(/fetchHandicapComputation\(id, admin\)/);
    expect(route).toMatch(/formatHandicapIndex\(index\)/);
    expect(route).toMatch(/private, no-store/);
    expect(route).toMatch(/if \(error instanceof Response\) return error;/);
  });
});

import { describe, expect, it } from 'vitest';
import { encounterOf, foldHeadToHead, recordLine, type VersusRow } from '../versus';

const G = (n: number) => `group_post:e0000000-0000-4000-8000-00000000000${n}`;
const R = (n: number) => `sport_event_round:f0000000-0000-4000-8000-00000000000${n}`;
const C = (n: number) => `contest:c0000000-0000-4000-8000-00000000000${n}`;
const row = (over: Partial<VersusRow>): VersusRow => ({
  context_key: G(1), sport_key: 'golf', occurred_on: '2026-09-01', side: null, outcome: null, headline: null, holes: 18, verified: false, ...over,
});

describe('encounterOf — one shared game from A\'s side', () => {
  it('golf stroke play: the lower gross wins, over the same holes only', () => {
    expect(encounterOf(row({ headline: 78 }), row({ headline: 82 }))?.result).toBe('W');
    expect(encounterOf(row({ headline: 85 }), row({ headline: 82 }))?.result).toBe('L');
    expect(encounterOf(row({ headline: 80 }), row({ headline: 80 }))?.result).toBe('T');
    expect(encounterOf(row({ headline: 40, holes: 9 }), row({ headline: 82, holes: 18 }))?.result).toBeNull();
  });
  it('a higher-is-better sport never uses the headline outside a golf round', () => {
    const a = row({ context_key: R(1), sport_key: 'basketball', headline: 30 });
    expect(encounterOf(a, { ...a, headline: 10 })?.result).toBeNull();
  });
  it('a match or a game: A\'s outcome decides, opposite sides', () => {
    expect(encounterOf(row({ side: 1, outcome: 'win' }), row({ side: 2, outcome: 'loss' }))).toMatchObject({ together: false, result: 'W' });
    expect(encounterOf(row({ context_key: R(1), sport_key: 'ice_hockey', side: 2, outcome: 'tie' }), row({ context_key: R(1), sport_key: 'ice_hockey', side: 1, outcome: 'tie' }))).toMatchObject({ together: false, result: 'T' });
  });
  it('the same side is the TOGETHER record', () => {
    expect(encounterOf(row({ context_key: R(1), sport_key: 'soccer', side: 1, outcome: 'win' }), row({ context_key: R(1), sport_key: 'soccer', side: 1, outcome: 'win' }))).toMatchObject({ together: true, result: 'W' });
  });
  it('no sides: the same win means teammates; two ties are ambiguous', () => {
    const r = { context_key: R(2), sport_key: 'soccer' };
    expect(encounterOf(row({ ...r, outcome: 'win' }), row({ ...r, outcome: 'win' }))).toMatchObject({ together: true, result: 'W' });
    expect(encounterOf(row({ ...r, outcome: 'tie' }), row({ ...r, outcome: 'tie' }))).toMatchObject({ together: false, result: null });
    expect(encounterOf(row({ ...r, outcome: 'loss' }), row({ ...r, outcome: 'win' }))).toMatchObject({ together: false, result: 'L' });
  });
  it('a contest line or a session: played, no result', () => {
    const a = row({ context_key: C(1), sport_key: 'volleyball', headline: 12 });
    expect(encounterOf(a, { ...a, headline: 3 })).toMatchObject({ result: null, together: false });
  });
  it('different games or sports are no encounter', () => {
    expect(encounterOf(row({}), row({ context_key: G(2) }))).toBeNull();
    expect(encounterOf(row({ context_key: null }), row({ context_key: null }))).toBeNull();
    expect(encounterOf(row({}), row({ sport_key: 'tennis' }))).toBeNull();
  });
  it('verified only when BOTH rows are and a result was decided', () => {
    expect(encounterOf(row({ headline: 70, verified: true }), row({ headline: 71, verified: true }))?.verified).toBe(true);
    expect(encounterOf(row({ headline: 70, verified: true }), row({ headline: 71 }))?.verified).toBe(false);
    expect(encounterOf(row({ headline: 40, holes: 9, verified: true }), row({ headline: 80, verified: true }))?.verified).toBe(false);
  });
});

describe('foldHeadToHead — the record per sport', () => {
  it('counts the record, the together record, the last five newest first, per sport', () => {
    const a: VersusRow[] = [
      row({ context_key: G(1), occurred_on: '2026-09-01', headline: 78, verified: true }),
      row({ context_key: G(2), occurred_on: '2026-09-03', headline: 85 }),
      row({ context_key: G(3), occurred_on: '2026-09-05', headline: 80 }),
      row({ context_key: G(4), occurred_on: '2026-09-07', headline: 41, holes: 9 }),
      row({ context_key: R(1), sport_key: 'soccer', occurred_on: '2026-08-01', side: 1, outcome: 'win' }),
      row({ context_key: G(9), occurred_on: '2026-09-09', headline: 70 }), // B never played this one
    ];
    const b: VersusRow[] = [
      row({ context_key: G(1), headline: 82, verified: true }),
      row({ context_key: G(2), headline: 80 }),
      row({ context_key: G(3), headline: 80 }),
      row({ context_key: G(4), headline: 80, holes: 18 }),
      row({ context_key: R(1), sport_key: 'soccer', side: 1, outcome: 'win' }),
    ];
    const [golf, soccer] = foldHeadToHead(a, b);
    expect(golf).toEqual({
      sportKey: 'golf', encounters: 4,
      versus: { wins: 1, losses: 1, ties: 1, undecided: 1 },
      together: { wins: 0, losses: 0, ties: 0 },
      lastFive: ['T', 'L', 'W'],
      verified: 1, lastPlayed: '2026-09-07',
    });
    expect(soccer).toMatchObject({ sportKey: 'soccer', encounters: 1, together: { wins: 1, losses: 0, ties: 0 }, lastFive: [] });
  });
  it('nobody in common → nothing', () => {
    expect(foldHeadToHead([row({})], [row({ context_key: G(2) })])).toEqual([]);
  });
  it('the last five stop at five', () => {
    const a = Array.from({ length: 7 }, (_, i) => row({ context_key: G(i), occurred_on: `2026-09-0${i + 1}`, headline: 70 }));
    const b = Array.from({ length: 7 }, (_, i) => row({ context_key: G(i), headline: 80 }));
    expect(foldHeadToHead(a, b)[0]).toMatchObject({ versus: { wins: 7 }, lastFive: ['W', 'W', 'W', 'W', 'W'] });
  });
});

describe('recordLine', () => {
  it('omits ties when none', () => {
    expect(recordLine({ wins: 7, losses: 4, ties: 1 })).toBe('7–4–1');
    expect(recordLine({ wins: 3, losses: 0, ties: 0 })).toBe('3–0');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PAR_SETTLE_WRITES, decideHolePar, settleAfterEvidence, settleCoursePars, sweepParSettlement } from '../par-evidence-server';

// Phase 2 (Nov 20 2026): a saved card is judged against its evidence and a
// settled or admin-decided hole is corrected, logged. Champlain's real shape.
const pars = (s: string) => s.split('').map(Number);
const SAVED_WRONG = '535344344534443444'; // hole 5 saved as a par 4 (total 70)
const TRUE_CARD = '535354344534443444';   // the club's card: hole 5 is a par 5 (71)
const BOXES = [['blue', true, TRUE_CARD], ['white', true, '535344344534443444'], ['yellow', true, '434344344434443444'], ['red', true, '434344344434443444'], ['white (f)', false, '535355344535443444']]
  .map(([label, votes, p]) => ({ source: 'golfcourseapi', label, votes, pars: pars(p as string) }));
const WEBSITE = { source: 'website', label: '', votes: false, pars: pars(TRUE_CARD) };
const only = (hole: number, par: number) => Array.from({ length: 18 }, (_, i) => (i === hole - 1 ? par : null));

function fake(over: { card?: string | null; evidence?: unknown[]; sources?: Record<string, unknown> | null; geometry?: unknown; updateRows?: unknown[]; updateError?: boolean; logError?: boolean; movedCard?: string } = {}) {
  const card = over.card === undefined ? SAVED_WRONG : over.card;
  const course = { id: 'c1', name: 'Champlain', total_par: card ? pars(card).reduce((a, b) => a + b, 0) : null, hole_data: card ? pars(card).map((par, i) => ({ number: i + 1, par, yardage: { blue: (par === 3 ? 150 : 400) + i }, handicap: i + 1 })) : null, sheet_sources: over.sources === undefined ? { pars: 'golfcourseapi', parsDisputed: [1, 3, 5, 10] } : over.sources, hole_geometry: over.geometry ?? null };
  const updates: Array<{ fields: Record<string, unknown>; guard: Array<[string, unknown]> }> = [];
  // The card as a second read finds it (someone else wrote it meanwhile).
  const moved = over.movedCard ? { ...course, hole_data: pars(over.movedCard).map((par, i) => ({ number: i + 1, par, yardage: { blue: 400 + i }, handicap: i + 1 })) } : course;
  let reads = 0;
  const logs: Array<Record<string, unknown>> = [];
  const admin = {
    from: (table: string) => {
      if (table === 'golf_courses') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: reads++ === 0 ? course : moved, error: null }) }) }),
        update: (fields: Record<string, unknown>) => {
          const guard: Array<[string, unknown]> = [];
          const chain: Record<string, unknown> = {};
          chain.eq = (c: string, v: unknown) => { guard.push([c, v]); return chain; };
          chain.is = (c: string, v: unknown) => { guard.push([c, v]); return chain; };
          chain.select = async () => { updates.push({ fields, guard }); return over.updateError ? { data: null, error: { message: 'x' } } : { data: over.updateRows ?? [{ id: 'c1' }], error: null }; };
          return chain;
        },
      };
      if (table === 'golf_par_changes') return { insert: async (rows: Array<Record<string, unknown>>) => { logs.push(...rows); return { error: over.logError ? { message: 'log down' } : null }; } };
      // golf_par_evidence: the read by course, and the sweep's list of courses.
      return { select: (cols: string) => ({ eq: (c: string) => (cols === 'course_id' ? { limit: async () => ({ data: [{ course_id: 'c1' }, { course_id: 'c1' }], error: null }) } : c === 'course_id' ? Promise.resolve({ data: over.evidence ?? [...BOXES, WEBSITE], error: null }) : null) }) };
    },
  };
  return { admin: admin as never, updates, logs };
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('settleCoursePars', () => {
  it('a hole settled by the course\'s own website is corrected: that par, the total and the disputed list, nothing else; and it is logged', async () => {
    const f = fake();
    const r = await settleCoursePars(f.admin, 'c1', { actor: 'system' });
    expect(r).toMatchObject({ applied: true, corrections: [{ hole: 5, from: 4, to: 5, reason: 'settled', settledBy: ['website'] }], disputed: [] });
    expect(f.updates).toHaveLength(1);
    const { fields, guard } = f.updates[0];
    const holes = fields.hole_data as Array<{ number: number; par: number; yardage: Record<string, number>; handicap: number }>;
    expect(holes.map(h => h.par).join('')).toBe(TRUE_CARD);
    expect(holes[4]).toEqual({ number: 5, par: 5, yardage: { blue: 404 }, handicap: 5 });
    expect(fields.total_par).toBe(71);
    expect(fields.sheet_sources).toEqual({ pars: 'golfcourseapi' });
    // Only the card that was judged.
    expect(guard).toEqual([['id', 'c1'], ['total_par', 70]]);
    expect(f.logs).toEqual([expect.objectContaining({ course_id: 'c1', course_name: 'Champlain', hole: 5, from_par: 4, to_par: 5, reason: 'settled', settled_by: 'website', actor: 'system' })]);
    expect((f.logs[0].evidence as { boxes: Record<string, number> }).boxes).toEqual({ blue: 5, white: 4, yellow: 4, red: 4, 'white (f)': 5 });
  });

  it('a dry run reports the same correction and writes nothing; the hole stays open until the card is corrected', async () => {
    const f = fake();
    const r = await settleCoursePars(f.admin, 'c1', { dryRun: true });
    expect(r).toMatchObject({ applied: false, corrections: [{ hole: 5, to: 5 }], disputed: [5] });
    expect(f.updates).toEqual([]);
    expect(f.logs).toEqual([]);
  });

  it('with no independent source nothing waits and the saved card is not touched: the rule decided', async () => {
    const f = fake({ evidence: BOXES });
    const r = await settleCoursePars(f.admin, 'c1');
    expect(r).toMatchObject({ applied: false, corrections: [], disputed: [] });
    expect(r!.judged.filter(j => j.status === 'accepted' || j.status === 'leaning').map(j => j.hole)).toEqual([1, 3, 5, 10]);
    expect(f.updates).toEqual([]);
  });

  it('the tagged map alone changes nothing and leaves nothing waiting, whichever way it leans', async () => {
    const mapSays = (par: number) => ({ holes: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: i === 4 ? par : null })) });
    const against = await settleCoursePars(fake({ evidence: BOXES, geometry: mapSays(5) }).admin, 'c1');
    expect(against).toMatchObject({ applied: false, corrections: [], disputed: [] });
    // The fixture's blue tee plays the hole at 404 yards: its length says 4, the map says 5, so nothing is confirmed.
    expect(against!.judged[4]).toMatchObject({ status: 'accepted', par: 4, independent: { map: 5, length: 4 } });
    // The map and the length together confirm the saved par: settled, and nothing to correct.
    const withIt = await settleCoursePars(fake({ evidence: BOXES, geometry: mapSays(4) }).admin, 'c1');
    expect(withIt!.judged[4]).toMatchObject({ status: 'settled', par: 4, settledBy: ['length', 'map'] });
    expect(withIt!.corrections).toEqual([]);
    expect((await settleCoursePars(fake({ evidence: BOXES, geometry: mapSays(4) }).admin, 'c1'))!.disputed).toEqual([]);
  });

  it('the map and the course\'s website together settle a hole; a map the card overruled is not evidence against it', async () => {
    const geometry = { holes: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: i === 4 ? 5 : null })) };
    const site = { source: 'website', label: '', votes: false, pars: only(5, 5) };
    expect((await settleCoursePars(fake({ evidence: [...BOXES, site], geometry }).admin, 'c1', { dryRun: true }))!.corrections).toEqual([expect.objectContaining({ hole: 5, to: 5, settledBy: ['map', 'website'] })]);
    expect((await settleCoursePars(fake({ evidence: [...BOXES, site], geometry, sources: { pars: 'golfcourseapi', mapOverruled: true } }).admin, 'c1', { dryRun: true }))!.corrections).toEqual([expect.objectContaining({ settledBy: ['website'] })]);
  });

  it('a caller allowed admin decisions only does not write a settled hole, and writes an admin one', async () => {
    const settledOnly = fake();
    expect((await settleCoursePars(settledOnly.admin, 'c1', { allow: ['admin'] }))!.corrections).toEqual([]);
    expect(settledOnly.updates).toEqual([]);
    const f = fake({ evidence: [...BOXES, { source: 'admin', label: '', votes: false, pars: only(5, 5) }] });
    const r = await settleCoursePars(f.admin, 'c1', { allow: ['admin'], actor: 'tom@example.test', note: 'the club card' });
    expect(r).toMatchObject({ applied: true, corrections: [{ hole: 5, reason: 'admin' }] });
    expect(f.logs[0]).toMatchObject({ reason: 'admin', actor: 'tom@example.test', note: 'the club card', settled_by: null });
  });

  it('no card, or no provider boxes: nothing is judged', async () => {
    expect(await settleCoursePars(fake({ card: null }).admin, 'c1')).toMatchObject({ skipped: 'no_card', applied: false });
    expect(await settleCoursePars(fake({ evidence: [WEBSITE] }).admin, 'c1')).toMatchObject({ skipped: 'no_evidence', applied: false });
  });

  it('a card that moved since it was read is not written, and nothing is logged', async () => {
    const f = fake({ updateRows: [] });
    expect(await settleCoursePars(f.admin, 'c1')).toMatchObject({ applied: false, skipped: 'changed_meanwhile' });
    expect(f.logs).toEqual([]);
    expect(await settleCoursePars(fake({ updateError: true }).admin, 'c1')).toMatchObject({ applied: false, skipped: 'write_failed' });
  });

  it('two holes that moved in opposite directions keep the total and are still caught: nothing is written', async () => {
    // Hole 1 went 5 → 4 and hole 2 went 3 → 4 since the card was judged: the total is still 70.
    const f = fake({ movedCard: '445344344534443444' });
    expect(await settleCoursePars(f.admin, 'c1')).toMatchObject({ applied: false, skipped: 'changed_meanwhile' });
    expect(f.updates).toEqual([]);
    expect(f.logs).toEqual([]);
  });

  it('a record that fails to save is loud, and the correction still stands', async () => {
    const f = fake({ logError: true });
    expect((await settleCoursePars(f.admin, 'c1'))!.applied).toBe(true);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('the record could not be saved'), 'log down');
  });
});

describe('the app\'s own corrections are on (Nov 20 2026, at Tom\'s word)', () => {
  it('the switch is on in this release', () => expect(PAR_SETTLE_WRITES).toBe(true));

  it('after evidence on a golfer\'s pick: a hole the club\'s website settles is corrected and logged as the system\'s', async () => {
    const f = fake();
    await settleAfterEvidence(f.admin, 'c1');
    expect(f.updates).toHaveLength(1);
    expect(f.updates[0].fields.total_par).toBe(71);
    expect(f.logs).toEqual([expect.objectContaining({ hole: 5, from_par: 4, to_par: 5, reason: 'settled', settled_by: 'website', actor: 'system' })]);
  });

  it('two weak sources never change a card: the map and the hole\'s length agreeing against the saved par leave it alone and list nothing', async () => {
    // Hole 5 saved as a par 5 here; the blue tee plays it at 404 yards (length says 4) and the map says 4.
    const geometry = { holes: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: i === 4 ? 4 : null })) };
    const f = fake({ card: TRUE_CARD, evidence: BOXES, geometry });
    const r = await settleCoursePars(f.admin, 'c1');
    expect(r!.judged[4]).toMatchObject({ status: 'settled', par: 4, settledBy: ['length', 'map'] });
    expect(r).toMatchObject({ applied: false, corrections: [], disputed: [] });
    expect(f.updates).toEqual([]);
  });

  it('the sweep is dry unless asked to write; asked, it corrects, each course judged once', async () => {
    const dry = fake();
    const sweep = await sweepParSettlement(dry.admin);
    expect(sweep).toMatchObject({ dryRun: true, courses: 1 });
    expect(sweep.changed.map(r => [r.name, r.applied, r.corrections.map(c => c.hole)])).toEqual([['Champlain', false, [5]]]);
    expect(dry.updates).toEqual([]);
    const wet = fake();
    const written = await sweepParSettlement(wet.admin, { dryRun: false });
    expect(written).toMatchObject({ dryRun: false, courses: 1 });
    expect(written.changed.map(r => [r.name, r.applied])).toEqual([['Champlain', true]]);
    expect(wet.updates).toHaveLength(1);
    const waiting = await sweepParSettlement(fake({ evidence: BOXES }).admin);
    expect(waiting.changed).toEqual([]);
    expect(waiting.waiting).toEqual([]);
  });
});

describe('decideHolePar: refusals', () => {
  const decide = (over: Parameters<typeof fake>[0], input: { hole: number; par: number; note?: string }) => {
    const f = fake(over);
    return decideHolePar(f.admin, { courseId: 'c1', actor: 'tom@example.test', ...input }).then(r => ({ r, f }));
  };
  it('a par outside 3 to 6, a hole not on the card, a course with no card', async () => {
    expect((await decide({}, { hole: 5, par: 7 })).r).toEqual({ ok: false, error: 'bad_par' });
    expect((await decide({}, { hole: 19, par: 4 })).r).toEqual({ ok: false, error: 'bad_hole' });
    expect((await decide({ card: null }, { hole: 1, par: 4 })).r).toEqual({ ok: false, error: 'no_card' });
  });
  it('a par no source gave needs a note; nothing is written without one', async () => {
    const { r, f } = await decide({}, { hole: 5, par: 6 });
    expect(r).toEqual({ ok: false, error: 'note_required' });
    expect(f.updates).toEqual([]);
    expect(f.logs).toEqual([]);
  });
});

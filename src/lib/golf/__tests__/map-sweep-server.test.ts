import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCellPayload, runGeometryBatch, runElevationBatch, sweepCellCourses } from '../map-sweep-server';
import { CELL_TTL_MS } from '../map-sweep';
import rideauView from './fixtures/overpass-rideau-view.json';

// Map sweep PR 6 — the state machine, against a fake admin and a stubbed
// fetch: a dry run touches nothing; a refused budget releases; a transport
// failure parks the cell with a backoff and writes NO course; a success
// stamps every course (nulls included) and the cell's metrics; the
// re-attest; the deadline; the empty-answer regression guard.

// The server stamps with the real clock; the tests hand it the same clock.
const now = Date.now();
const CELL = 'c05:45.0:-76.0'; // Rideau View's cell
const rideauCentroid = (() => {
  const pts = (rideauView as { elements: Array<{ tags?: Record<string, string>; geometry?: Array<{ lat: number; lon: number }> }> }).elements
    .filter(e => e.tags?.golf === 'hole').flatMap(h => h.geometry ?? []);
  return [pts.reduce((s, p) => s + p.lat, 0) / pts.length, pts.reduce((s, p) => s + p.lon, 0) / pts.length] as [number, number];
})();

interface Course { id: string; name: string; lat: number; lng: number; club_id: string | null; holes_count: number | null; hole_geometry: unknown; hole_elevation_at: string | null }

/** A fake admin: cells claimed from `cells`, courses from `courses`; every
 *  update / upsert / rpc recorded. The builder answers the course box read,
 *  the sibling read, the meta reads and the remaining count. */
function fakeAdmin(cells: Array<Record<string, unknown>>, courses: Course[]) {
  const log: Array<{ table: string; op: string; fields?: Record<string, unknown>; id?: string }> = [];
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ['select', 'eq', 'neq', 'gte', 'lt', 'gt', 'lte', 'not', 'in', 'is', 'or', 'order', 'limit']) b[m] = chain;
    b.maybeSingle = async () => ({ data: table === 'golf_courses' ? (courses[0] ?? null) : null, error: null });
    b.single = async () => ({ data: null, error: null });
    b.then = (resolve: (v: unknown) => void) => {
      if (table === 'golf_courses') resolve({ data: courses, error: null, count: courses.length });
      else if (table === 'golf_map_sweep_cells') resolve({ data: cells, error: null, count: cells.filter(c => c.status !== 'running').length });
      else resolve({ data: [], error: null, count: 0 });
    };
    b.update = (fields: Record<string, unknown>) => {
      const u: Record<string, unknown> = {};
      u.eq = (_c: string, id: string) => { log.push({ table, op: 'update', fields, id }); const r = { data: cells.filter(c => c.cell_key === id), error: null }; const p = Promise.resolve(r); return Object.assign(p, { select: () => p }); };
      return u;
    };
    b.upsert = (rows: unknown) => { log.push({ table, op: 'upsert', fields: rows as Record<string, unknown> }); return Promise.resolve({ error: null }); };
    return b;
  };
  const admin = {
    from: (table: string) => builder(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      log.push({ table: name, op: 'rpc', fields: args });
      if (name === 'golf_map_sweep_claim') return Promise.resolve({ data: cells.filter(c => c.status !== 'running').slice(0, args.p_n as number), error: null });
      if (name === 'golf_map_sweep_elevation_due') return Promise.resolve({ data: courses.map(c => ({ id: c.id })), error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { admin: admin as never, log };
}

const okFetch = (payload: unknown = rideauView) => vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })) as unknown as typeof fetch;
const cell = (over: Record<string, unknown> = {}) => ({ cell_key: CELL, attempts: 0, mapped: 0, status: 'pending', ...over });
const rideau = (over: Partial<Course> = {}): Course => ({ id: 'rv', name: 'Rideau View Golf Club', lat: rideauCentroid[0], lng: rideauCentroid[1], club_id: null, holes_count: 18, hole_geometry: null, hole_elevation_at: null, ...over });
const courseUpdates = (log: ReturnType<typeof fakeAdmin>['log']) => log.filter(l => l.table === 'golf_courses' && l.op === 'update');
const cellUpdates = (log: ReturnType<typeof fakeAdmin>['log']) => log.filter(l => l.table === 'golf_map_sweep_cells' && l.op === 'update');

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('runGeometryBatch', () => {
  it('a dry run reads, releases, and writes no course and no fetch', async () => {
    const f = okFetch();
    const { admin, log } = fakeAdmin([cell()], [rideau()]);
    const s = await runGeometryBatch(admin, { cells: 2, dryRun: true, now, fetchImpl: f, budget: async () => true });
    expect('cells' in s && s.cells[0].outcome).toBe('dry_run');
    expect(f).not.toHaveBeenCalled();
    expect(courseUpdates(log)).toHaveLength(0);
    expect(cellUpdates(log).map(u => u.fields!.status)).toEqual(['pending']);
  });
  it('a refused budget releases the cell, fetches nothing, and reports budgetExhausted', async () => {
    const f = okFetch();
    const { admin, log } = fakeAdmin([cell()], [rideau()]);
    const s = await runGeometryBatch(admin, { cells: 2, dryRun: false, now, fetchImpl: f, budget: async () => false });
    expect('budgetExhausted' in s && s.budgetExhausted).toBe(true);
    expect('cells' in s && s.cells[0].outcome).toBe('skipped_budget');
    expect(f).not.toHaveBeenCalled();
    expect(courseUpdates(log)).toHaveLength(0);
  });
  it('a transport failure (every mirror down, a stub, a partial) parks the cell with a backoff and writes NO course', async () => {
    for (const impl of [
      vi.fn(async () => { throw new Error('down'); }),
      vi.fn(async () => ({ ok: false, status: 504, json: async () => ({}) })),
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ elements: [] }) })), // no envelope — a stub
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ version: 0.6, remark: 'runtime error: Query timed out', elements: [] }) })),
    ]) {
      const { admin, log } = fakeAdmin([cell({ attempts: 1 })], [rideau()]);
      const s = await runGeometryBatch(admin, { cells: 1, dryRun: false, now, fetchImpl: impl as unknown as typeof fetch, budget: async () => true });
      expect('cells' in s && s.cells[0].outcome).toBe('transport');
      expect(courseUpdates(log)).toHaveLength(0);
      const parked = cellUpdates(log).find(u => u.fields!.attempts === 2)!;
      expect(parked.fields!.status).toBe('pending');
      expect(Date.parse(parked.fields!.next_due_at as string)).toBeGreaterThan(now + 10 * 60_000);
    }
  });
  it('a success stamps every course in the cell (a null too), writes the metrics and the 28-day due date', async () => {
    const nowhere = rideau({ id: 'nowhere', name: 'Empty Links', lat: 45.49, lng: -75.51 }); // in the cell, no OSM data near it
    const { admin, log } = fakeAdmin([cell()], [rideau(), nowhere]);
    const s = await runGeometryBatch(admin, { cells: 1, dryRun: false, now, fetchImpl: okFetch(), budget: async () => true });
    expect('cells' in s && s.cells[0].outcome).toBe('done');
    const writes = courseUpdates(log);
    expect(writes.map(w => w.id).sort()).toEqual(['nowhere', 'rv']);
    const rv = writes.find(w => w.id === 'rv')!.fields!;
    expect((rv.hole_geometry as { holes: unknown[] }).holes).toHaveLength(18);
    expect((rv.hole_geometry as { greens: unknown[] }).greens).toEqual([]);
    expect(rv.hole_geometry_at).toBeTruthy();
    expect('hole_elevation_at' in rv).toBe(false); // no prior profile → no re-attest
    expect(writes.find(w => w.id === 'nowhere')!.fields!.hole_geometry).toBeNull();
    const done = cellUpdates(log).find(u => u.fields!.status === 'done')!.fields!;
    expect(done).toMatchObject({ courses: 2, attempted: 2, mapped: 1, null_no_coverage: 1, attempts: 0, error: null });
    expect(Date.parse(done.next_due_at as string) - now).toBeGreaterThanOrEqual(CELL_TTL_MS - 5000);
    expect('cells' in s && s.cells[0].metrics?.elements).toBe((rideauView as { elements: unknown[] }).elements.length);
  });
  it('the re-attest: unchanged lines and a prior profile move the elevation stamp with the geometry stamp', async () => {
    const first = fakeAdmin([cell()], [rideau()]);
    await runGeometryBatch(first.admin, { cells: 1, dryRun: false, now, fetchImpl: okFetch(), budget: async () => true });
    const stored = courseUpdates(first.log)[0].fields!.hole_geometry;
    const second = fakeAdmin([cell()], [rideau({ hole_geometry: stored, hole_elevation_at: new Date(now - 1000).toISOString() })]);
    await runGeometryBatch(second.admin, { cells: 1, dryRun: false, now, fetchImpl: okFetch(), budget: async () => true });
    const w = courseUpdates(second.log)[0].fields!;
    expect(w.hole_elevation_at).toBe(w.hole_geometry_at);
  });
  it('the empty-answer regression guard: a cell that had mapped courses and now sees nothing is transport, not a vanished course', async () => {
    const { admin, log } = fakeAdmin([cell({ mapped: 3 })], [rideau()]);
    const s = await runGeometryBatch(admin, { cells: 1, dryRun: false, now, fetchImpl: okFetch({ version: 0.6, elements: [] }), budget: async () => true });
    expect('cells' in s && s.cells[0].error).toBe('empty_answer_regression');
    expect(courseUpdates(log)).toHaveLength(0);
  });
  it('the deadline releases the cells it had no time to start', async () => {
    const { admin, log } = fakeAdmin([cell(), cell({ cell_key: 'c05:45.5:-76.0' })], [rideau()]);
    const s = await runGeometryBatch(admin, { cells: 2, dryRun: false, now: now - 60_000 /* the budget is already spent */, fetchImpl: okFetch(), budget: async () => true });
    expect('cells' in s && s.cells.map(c => c.outcome)).toEqual(['released', 'released']);
    expect(courseUpdates(log)).toHaveLength(0);
  });
  it('a named cell is claimed whatever its due date; a bad key is refused', async () => {
    const { admin } = fakeAdmin([cell({ status: 'done' })], [rideau()]);
    const s = await runGeometryBatch(admin, { cells: 1, dryRun: true, cellKey: CELL, now, fetchImpl: okFetch(), budget: async () => true });
    expect('cells' in s && s.cells[0].cell_key).toBe(CELL);
    expect(await runGeometryBatch(admin, { cells: 1, dryRun: true, cellKey: 'junk', now })).toEqual({ ok: false, error: 'bad cell key' });
  });
});

describe('sweepCellCourses metrics', () => {
  it('counts the tiers and the refusals', async () => {
    const { admin } = fakeAdmin([], []);
    const r = await sweepCellCourses(admin, [rideau() as unknown as Parameters<typeof sweepCellCourses>[1][number]], (rideauView as unknown as { elements: Parameters<typeof sweepCellCourses>[2] }).elements, now);
    expect(r.ok && r.metrics).toMatchObject({ courses: 1, attempted: 1, mapped: 1, with_greens: 0, null_no_coverage: 0 });
  });
});

describe('fetchCellPayload', () => {
  it('walks the ladder, cools a 429 for 15 minutes and a 5xx for 5, and returns the first real answer', async () => {
    const calls: string[] = [];
    const impl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === 'a') return { ok: false, status: 429, json: async () => ({}) };
      if (url === 'b') return { ok: false, status: 504, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => rideauView };
    }) as unknown as typeof fetch;
    const cooldowns: Record<string, string> = {};
    const r = await fetchCellPayload(CELL, ['a', 'b', 'c'], cooldowns, impl, now);
    expect(r.reached).toBe(true);
    expect(r.mirror).toBe('c');
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(Date.parse(cooldowns.a) - now).toBe(15 * 60_000);
    expect(Date.parse(cooldowns.b) - now).toBe(5 * 60_000);
    // Next time, c leads and the cooling mirrors go last.
    const again = await fetchCellPayload(CELL, ['a', 'b', 'c'], cooldowns, impl, now + 1000);
    expect(again.mirror).toBe('c');
    expect(calls[3]).toBe('c');
  });
});

describe('runElevationBatch', () => {
  it('a dry run lists the due courses and touches nothing; a refused budget stops the batch', async () => {
    const { admin, log } = fakeAdmin([], [rideau({ hole_geometry: { holes: [{ hole: 1, par: 4, line: [[45.3, -75.7], [45.303, -75.7]] }], source: 'osm', greens: [] } })]);
    const dry = await runElevationBatch(admin, { courses: 5, dryRun: true, now });
    expect('due' in dry && dry.due).toEqual(['rv']);
    expect(courseUpdates(log)).toHaveLength(0);
    const live = await runElevationBatch(admin, { courses: 5, dryRun: false, now, budget: async () => false });
    expect('budgetExhausted' in live && live.budgetExhausted).toBe(true);
  });
});

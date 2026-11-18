import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { CRON_CARD_PHASE_MS, ROW_START_RESERVE_MS, runCardFillBatch, runCardLink } from '../card-fill-server';

// Nov 17 2026: the fill's writer against a recorded database. The provider's
// answer is the live detail shape the normaliser's tests pin.

vi.mock('@/lib/observability/report', () => ({ reportRouteWarning: vi.fn(), reportRouteError: vi.fn() }));

interface Call { table: string; op: 'select' | 'update' | 'upsert'; columns?: string; fields?: Record<string, unknown>; filters: string[] }

/** `answer(call)` decides what each awaited query returns. */
function fakeAdmin(answer: (c: Call) => { data?: unknown; error?: { code?: string; message?: string } | null }, budget: boolean[] = []) {
  const calls: Call[] = [];
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const answers = [...budget];
  const chain = (call: Call) => {
    const q: Record<string, unknown> = {};
    for (const m of ['eq', 'neq', 'in', 'is', 'not', 'or', 'order', 'limit', 'range']) {
      q[m] = (...args: unknown[]) => { call.filters.push(`${m}(${args.map(a => JSON.stringify(a)).join(',')})`); return q; };
    }
    q.select = (columns: string) => { if (call.op === 'select') call.columns = columns; return q; };
    q.maybeSingle = async () => ({ data: null, error: null, ...answer(call) });
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...answer(call) }).then(resolve);
    return q;
  };
  const admin = {
    from: (table: string) => ({
      select: (columns: string) => { const c: Call = { table, op: 'select', columns, filters: [] }; calls.push(c); return chain(c); },
      update: (fields: Record<string, unknown>) => { const c: Call = { table, op: 'update', fields, filters: [] }; calls.push(c); return chain(c); },
      upsert: async (fields: Record<string, unknown>) => { calls.push({ table, op: 'upsert', fields, filters: [] }); return { error: null }; },
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === 'rate_limit_hit') return { single: async () => ({ data: { allowed: answers.shift() ?? true }, error: null }) };
      return Promise.resolve({ data: (args.p_pairs as unknown[]).length, error: null });
    },
  };
  return { admin: admin as never, calls, rpcs };
}

const fillRow = (over: Record<string, unknown> = {}) => ({
  id: 'c1', external_source: 'osm', external_id: 'way/1', name: 'Pebble Beach Golf Links', lat: 36.5685, lng: -121.949, country_code: 'US',
  total_par: null, holes_count: null, hole_data: null, course_rating: {}, slope_rating: {}, opengolf_id: 'og-1', ...over,
});
const EIGHTEEN = Array.from({ length: 18 }, (_, i) => i + 1);
const detail = (over: Record<string, unknown> = {}) => ({
  id: 'og-1', course_name: 'Pebble Beach Golf Links', club_name: 'Pebble Beach Golf Links', city: 'Pebble Beach', state: 'CA', lat: 36.5685, lng: -121.949, par: 72, holes: 18,
  tees: [{ tee_key: 'blue-male', tee_name: 'Blue', tee_color: 'blue', gender: 'Male', course_rating: 74.9, slope: 144 }],
  holes_data: EIGHTEEN.map(n => ({ number: n, par: 4, handicap_index: n, yardages: { blue: 380 + n } })),
  ...over,
});
const stubDetail = (body: unknown, ok = true) => {
  const fetchMock = vi.fn(async (url: string) => ({ ok, status: ok ? 200 : 503, url, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
const queue = (rows: unknown[]) => (c: Call) => {
  if (c.op === 'select' && c.columns?.includes('opengolf_id') && c.columns.includes('name')) return { data: rows };
  if (c.op === 'select' && c.columns === 'hole_geometry') return { data: { hole_geometry: null } };
  if (c.op === 'select' && c.columns === 'sheet_sources') return { data: { sheet_sources: null } };
  if (c.op === 'update') return { data: [{ id: 'c1' }] };
  return {};
};

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('runCardFillBatch', () => {
  it('a dry run asks nobody and writes nothing', async () => {
    const fetchMock = stubDetail(detail());
    const { admin, calls, rpcs } = fakeAdmin(queue([fillRow()]));
    const r = await runCardFillBatch(admin, { rows: 5, dryRun: true });
    expect(r).toMatchObject({ phase: 'cards', dryRun: true, due: 1, outcomes: {} });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpcs).toEqual([]);
    expect(calls.filter(c => c.op === 'update')).toEqual([]);
  });

  it('only linked rows with no card are in the queue', async () => {
    const { admin, calls } = fakeAdmin(queue([]));
    await runCardFillBatch(admin, { rows: 5, dryRun: true });
    expect(calls[0].filters).toEqual(expect.arrayContaining(['not("opengolf_id","is",null)', 'is("hole_data",null)', 'neq("external_source","qa-e2e")']));
  });

  it('saves a good card by ONE detail call, credited, on a row that still has none', async () => {
    const fetchMock = stubDetail(detail());
    const { admin, calls, rpcs } = fakeAdmin(queue([fillRow()]));
    const r = await runCardFillBatch(admin, { rows: 5, dryRun: false });
    expect(r).toMatchObject({ outcomes: { ok: 1 }, budgetExhausted: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.opengolfapi.org/api/v1/courses/og-1');
    // The fill's own cap is spent before the shared key.
    expect(rpcs.map(x => x.args.p_key)).toEqual(['golf-provider:card-fill', 'golf-provider:opengolfapi']);
    const write = calls.find(c => c.op === 'update')!;
    expect(write.fields).toMatchObject({ total_par: 72, holes_count: 18, sheet_fill_outcome: 'ok', course_rating: { blue: 74.9 }, slope_rating: { blue: 144 } });
    expect((write.fields!.hole_data as unknown[]).length).toBe(18);
    expect(write.fields!.sheet_sources).toMatchObject({ pars: 'opengolfapi', strokeIndex: 'opengolfapi', tees: { blue: 'opengolfapi' } });
    expect(write.filters).toEqual(expect.arrayContaining(['eq("id","c1")', 'is("hole_data",null)']));
  });

  it('the time the cron tick gives it is enough to ask its rows', async () => {
    // Production, Nov 17: the tick passed less than the row reserve and every
    // batch ended before its first row.
    expect(CRON_CARD_PHASE_MS).toBeGreaterThan(ROW_START_RESERVE_MS + 2000);
    const fetchMock = stubDetail(detail());
    const { admin } = fakeAdmin(queue([fillRow()]));
    const r = await runCardFillBatch(admin, { rows: 2, dryRun: false, deadlineMs: CRON_CARD_PHASE_MS });
    expect(r).toMatchObject({ due: 1, outcomes: { ok: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('no row starts inside the reserve', async () => {
    const fetchMock = stubDetail(detail());
    const { admin, rpcs } = fakeAdmin(queue([fillRow()]));
    const r = await runCardFillBatch(admin, { rows: 2, dryRun: false, deadlineMs: ROW_START_RESERVE_MS - 1 });
    expect(r).toMatchObject({ due: 1, outcomes: {} });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpcs).toEqual([]);
  });

  it('a card that fails a check is stamped with its reason and nothing else', async () => {
    // Ten holes on a course the provider itself calls nine holes.
    const ten = Array.from({ length: 10 }, (_, i) => ({ number: i + 1, par: 4, yardages: { white: 300 } }));
    stubDetail(detail({ holes: 9, par: 36, holes_data: ten }));
    const { admin, calls } = fakeAdmin(queue([fillRow()]));
    const r = await runCardFillBatch(admin, { rows: 5, dryRun: false });
    expect(r).toMatchObject({ outcomes: { hole_count: 1 } });
    const write = calls.find(c => c.op === 'update')!;
    expect(Object.keys(write.fields!).sort()).toEqual(['sheet_fill_at', 'sheet_fill_outcome']);
    expect(write.fields!.sheet_fill_outcome).toBe('hole_count');
  });

  it('a card the course\'s map disagrees with is refused', async () => {
    stubDetail(detail());
    const line = [[36.56, -121.95], [36.561, -121.951]];
    const answer = (c: Call) =>
      c.op === 'select' && c.columns === 'hole_geometry'
        ? { data: { hole_geometry: { holes: EIGHTEEN.map(n => ({ hole: n, par: 5, line })) } } }
        : queue([fillRow()])(c);
    const { admin, calls } = fakeAdmin(answer);
    const r = await runCardFillBatch(admin, { rows: 5, dryRun: false });
    expect(r).toMatchObject({ outcomes: { map_disagrees: 1 } });
    expect(calls.find(c => c.op === 'update')!.fields).not.toHaveProperty('hole_data');
  });

  it('stops when the fill\'s daily cap is spent, before any call', async () => {
    const fetchMock = stubDetail(detail());
    const { admin, calls } = fakeAdmin(queue([fillRow(), fillRow({ id: 'c2' })]), [false]);
    const r = await runCardFillBatch(admin, { rows: 5, dryRun: false });
    expect(r).toMatchObject({ budgetExhausted: true, outcomes: {} });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.filter(c => c.op === 'update')).toEqual([]);
  });

  it('two provider failures in a row end the batch', async () => {
    const fetchMock = stubDetail({}, false);
    const { admin } = fakeAdmin(queue([fillRow(), fillRow({ id: 'c2' }), fillRow({ id: 'c3' })]));
    const r = await runCardFillBatch(admin, { rows: 5, dryRun: false });
    expect(r).toMatchObject({ outcomes: { provider_error: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a database without migration 314 says so', async () => {
    const { admin } = fakeAdmin(() => ({ error: { code: '42703', message: 'column golf_courses.opengolf_id does not exist' } }));
    expect(await runCardFillBatch(admin, { rows: 5, dryRun: true })).toEqual({ ok: false, error: 'migration 314 has not run' });
  });
});

describe('runCardLink', () => {
  const dataset = async () => [
    { id: 'og-1', name: 'Pebble Beach Golf Links', lat: 36.5685, lng: -121.949 },
    { id: 'og-2', name: 'Spyglass Hill Golf Course', lat: 36.583, lng: -121.955 },
  ];
  const answer = (c: Call) => {
    if (c.columns === 'id, name, lat, lng') return { data: [{ id: 'c1', name: 'Pebble Beach Golf Links', lat: 36.568, lng: -121.95 }, { id: 'c2', name: 'Spyglass Hill Golf Course', lat: 36.5835, lng: -121.9555 }] };
    if (c.columns === 'opengolf_id, external_id') return { data: [{ opengolf_id: 'og-2', external_id: 'way/9' }] };
    return {};
  };

  it('a dry run reports the matches and writes nothing', async () => {
    const { admin, rpcs, calls } = fakeAdmin(answer);
    const r = await runCardLink(admin, { dryRun: true, fetchDataset: dataset });
    // og-2 is already another row's: only Pebble Beach is matched.
    expect(r).toMatchObject({ phase: 'link', dryRun: true, dataset: 2, ours: 2, matched: 1, linked: 0, unmatched: 1 });
    expect(rpcs).toEqual([]);
    expect(calls.filter(c => c.op !== 'select')).toEqual([]);
  });

  it('a live run writes the links in one trip and records the run', async () => {
    const { admin, rpcs, calls } = fakeAdmin(answer);
    const r = await runCardLink(admin, { dryRun: false, fetchDataset: dataset });
    expect(r).toMatchObject({ matched: 1, linked: 1 });
    expect(rpcs).toEqual([{ fn: 'golf_card_fill_link', args: { p_pairs: [{ id: 'c1', og: 'og-1' }] } }]);
    const stamps = calls.filter(c => c.op === 'upsert').map(c => (c.fields as { key?: string }).key);
    // The attempt is stamped first, the finish last.
    expect(stamps).toEqual(['card_link_try', 'card_link']);
  });

  it('only US rows that are not already linked or OpenGolfAPI\'s own are read', async () => {
    const { admin, calls } = fakeAdmin(answer);
    await runCardLink(admin, { dryRun: true, fetchDataset: dataset });
    expect(calls[0].filters).toEqual(expect.arrayContaining(['eq("country_code","US")', 'is("opengolf_id",null)', 'in("external_source",["osm","seed","golfcourseapi"])']));
  });

  it('a file that cannot be read links nothing', async () => {
    const { admin, rpcs } = fakeAdmin(answer);
    expect(await runCardLink(admin, { dryRun: false, fetchDataset: async () => null })).toEqual({ ok: false, error: 'the OpenGolfAPI file could not be read' });
    expect(rpcs).toEqual([]);
  });
});

// Nov 18 2026: the published file lists some courses several times (the same
// name at the same point under different ids). They are one candidate; the
// other ids are kept for the fill to ask in turn.
describe('a course the file lists several times', () => {
  const dataset = async () => [
    { id: 'og-a', name: 'Olympic Club Lake Course', lat: 37.7141, lng: -122.4931 },
    { id: 'og-b', name: 'Olympic Club Lake Course', lat: 37.7141, lng: -122.4931 },
    { id: 'og-c', name: 'Olympic Club Lake Course', lat: 37.7141, lng: -122.4931 },
  ];
  const ours = [{ id: 'c1', name: 'Olympic Club Lake Course', lat: 37.714, lng: -122.493 }];
  const metaOf = (c: Call, key: string) => c.table === 'golf_map_sweep_meta' && c.op === 'select' && c.filters.includes(`eq("key","${key}")`);

  it('links to the first id and records the others', async () => {
    const { admin, rpcs, calls } = fakeAdmin(c => {
      if (c.columns === 'id, name, lat, lng') return { data: ours };
      if (c.columns === 'opengolf_id, external_id') return { data: [] };
      return {};
    });
    const r = await runCardLink(admin, { dryRun: false, fetchDataset: dataset });
    expect(r).toMatchObject({ matched: 1, linked: 1, ambiguous: 0 });
    expect(rpcs[0].args.p_pairs).toEqual([{ id: 'c1', og: 'og-a', alts: ['og-b', 'og-c'] }]);
    const alts = calls.find(c => c.op === 'upsert' && (c.fields as { key?: string }).key === 'card_link_alts');
    expect((alts!.fields as { value: unknown }).value).toEqual({ c1: ['og-b', 'og-c'] });
  });

  it('an entry one of whose ids is already a row\'s is offered to nobody else', async () => {
    const { admin, rpcs } = fakeAdmin(c => {
      if (c.columns === 'id, name, lat, lng') return { data: ours };
      // og-b is another row's alternate already.
      if (metaOf(c, 'card_link_alts')) return { data: { value: { other: ['og-b'] } } };
      if (c.columns === 'opengolf_id, external_id') return { data: [] };
      return {};
    });
    const r = await runCardLink(admin, { dryRun: false, fetchDataset: dataset });
    expect(r).toMatchObject({ matched: 0, unmatched: 1 });
    expect(rpcs).toEqual([]);
  });

  it('the fill asks the ids in turn, saves the first card that passes and makes that id the row\'s', async () => {
    // og-1 answers ten holes for a nine-hole course (refused); og-b answers a whole card.
    const ten = Array.from({ length: 10 }, (_, i) => ({ number: i + 1, par: 4, yardages: { white: 300 } }));
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, url, json: async () => (url.endsWith('/og-1') ? detail({ holes: 9, par: 36, holes_data: ten }) : detail({ id: 'og-b' })) }));
    vi.stubGlobal('fetch', fetchMock);
    const base = queue([fillRow()]);
    const { admin, calls } = fakeAdmin(c => (metaOf(c, 'card_link_alts') ? { data: { value: { c1: ['og-b'] } } } : base(c)));
    const r = await runCardFillBatch(admin, { rows: 2, dryRun: false });
    expect(r).toMatchObject({ due: 1, outcomes: { ok: 1 } });
    expect(fetchMock.mock.calls.map(c => String(c[0]).split('/').pop())).toEqual(['og-1', 'og-b']);
    const writes = calls.filter(c => c.op === 'update');
    // The first id's refusal is NOT stamped (another id was still to be asked); the card is.
    expect(writes).toHaveLength(1);
    expect(writes[0].fields).toMatchObject({ sheet_fill_outcome: 'ok', opengolf_id: 'og-b', holes_count: 18 });
  });

  it('when every id is refused, the last refusal is stamped once', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ number: i + 1, par: 4, yardages: { white: 300 } }));
    const fetchMock = stubDetail(detail({ holes: 9, par: 36, holes_data: ten }));
    const base = queue([fillRow()]);
    const { admin, calls } = fakeAdmin(c => (metaOf(c, 'card_link_alts') ? { data: { value: { c1: ['og-b', 'og-c'] } } } : base(c)));
    const r = await runCardFillBatch(admin, { rows: 2, dryRun: false });
    expect(r).toMatchObject({ outcomes: { hole_count: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const writes = calls.filter(c => c.op === 'update');
    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0].fields!).sort()).toEqual(['sheet_fill_at', 'sheet_fill_outcome']);
  });

  it('an id the provider no longer serves (404) is passed over for the next one', async () => {
    const fetchMock = vi.fn(async (url: string) => (url.endsWith('/og-1') || url.endsWith('/og-b')
      ? { ok: false, status: 404, url, json: async () => ({ error: 'Course not found' }) }
      : { ok: true, status: 200, url, json: async () => detail({ id: 'og-c' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const base = queue([fillRow()]);
    const { admin, calls } = fakeAdmin(c => (metaOf(c, 'card_link_alts') ? { data: { value: { c1: ['og-b', 'og-c'] } } } : base(c)));
    const r = await runCardFillBatch(admin, { rows: 2, dryRun: false });
    expect(r).toMatchObject({ outcomes: { ok: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calls.filter(c => c.op === 'update').map(c => c.fields!.opengolf_id)).toEqual(['og-c']);
  });

  it('a lone id that answers 404 is stamped no_card, so it does not lead the queue for ever', async () => {
    stubDetail({ error: 'Course not found' }, false);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: false, status: 404, url, json: async () => ({}) })));
    const { admin, calls } = fakeAdmin(queue([fillRow()]));
    const r = await runCardFillBatch(admin, { rows: 2, dryRun: false });
    expect(r).toMatchObject({ outcomes: { no_card: 1 } });
    expect(calls.find(c => c.op === 'update')!.fields).toMatchObject({ sheet_fill_outcome: 'no_card' });
  });

  it('a transport failure (503) is still a provider error: nothing stamped, the other ids not tried', async () => {
    const fetchMock = stubDetail({}, false);
    const base = queue([fillRow()]);
    const { admin, calls } = fakeAdmin(c => (metaOf(c, 'card_link_alts') ? { data: { value: { c1: ['og-b'] } } } : base(c)));
    const r = await runCardFillBatch(admin, { rows: 2, dryRun: false });
    expect(r).toMatchObject({ outcomes: { provider_error: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls.filter(c => c.op === 'update')).toEqual([]);
  });

  it('a row with no other ids is asked once, as before', async () => {
    const fetchMock = stubDetail(detail());
    const { admin, calls } = fakeAdmin(queue([fillRow()]));
    await runCardFillBatch(admin, { rows: 2, dryRun: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls.find(c => c.op === 'update')!.fields).not.toHaveProperty('opengolf_id');
  });
});

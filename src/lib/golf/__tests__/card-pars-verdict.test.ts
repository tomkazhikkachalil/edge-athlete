import { describe, it, expect, vi } from 'vitest';
import { cardParsVerdict } from '../sheet-merge';
import { cardFillVerdict } from '../card-fill';
import { AUDIT_WITHDRAW_MAX, runCardAudit } from '../card-fill-server';
import { hydrateCourseDetailed, type CatalogRow } from '../course-catalog';
import { describeCardFill } from '@/components/admin/GolfCardFillPanel';

// Nov 24 2026. Seven cards on production failed their own arithmetic: the
// pick-time refresh saved whatever the row's provider answered, and only the
// background fill checked. The pars below are production's.

vi.mock('@/lib/observability/report', () => ({ reportRouteWarning: vi.fn(), reportRouteError: vi.fn() }));

const holes = (pars: number[]) => pars.map((par, i) => ({ number: i + 1, par, yardage: { white: 300 + i }, handicap: i + 1 }));
const UNIVERSITY_PARK = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 3, 4, 4]; // 85 against a stated 72
const GOOD = [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 4, 3, 5, 4, 3, 4, 4, 5]; // 72

describe('cardParsVerdict', () => {
  it('a card that adds up is ok, with or without a stated total', () => {
    expect(cardParsVerdict({ hole_data: holes(GOOD), total_par: 72, holes_count: 18 })).toBe('ok');
    expect(cardParsVerdict({ hole_data: holes(GOOD), total_par: null })).toBe('ok');
    expect(cardParsVerdict({ hole_data: holes(GOOD.slice(0, 9)), total_par: 36 })).toBe('ok');
  });
  it('production\'s cards: 85 against 72, and ten holes of a stated eighteen', () => {
    expect(cardParsVerdict({ hole_data: holes(UNIVERSITY_PARK), total_par: 72, holes_count: 18 })).toBe('par_sum');
    expect(cardParsVerdict({ hole_data: holes(Array.from({ length: 10 }, () => 4)), total_par: null, holes_count: 18 })).toBe('hole_count');
  });
  it('holes not numbered 1..n, a stated count that differs, a par outside 3 to 6', () => {
    expect(cardParsVerdict({ hole_data: holes(GOOD).map(h => ({ ...h, number: h.number + 1 })), total_par: 72 })).toBe('hole_count');
    expect(cardParsVerdict({ hole_data: holes(GOOD.slice(0, 9)), total_par: 36, holes_count: 18 })).toBe('hole_count');
    expect(cardParsVerdict({ hole_data: holes([7, ...GOOD.slice(1)]), total_par: null })).toBe('par_sum');
    expect(cardParsVerdict({ hole_data: null })).toBe('hole_count');
  });
  it('the background fill still answers what it answered', () => {
    const at = { lat: 45, lng: -75, holes_count: null };
    expect(cardFillVerdict(at, { total_par: 72, holes_count: 18, hole_data: holes(GOOD) }, null)).toBe('ok');
    expect(cardFillVerdict(at, { total_par: 72, holes_count: 18, hole_data: holes(UNIVERSITY_PARK) }, null)).toBe('par_sum');
    expect(cardFillVerdict({ ...at, holes_count: 9 }, { total_par: 72, holes_count: 18, hole_data: holes(GOOD) }, null)).toBe('hole_count');
  });
});

describe('a provider\'s answer never becomes a first card when it fails its arithmetic', () => {
  const row = (over: Partial<CatalogRow> = {}): CatalogRow => ({
    id: 'c1', external_source: 'golfcourseapi', external_id: '42', name: 'QA Links', club_name: null, city: null, region: null,
    country: null, total_par: null, holes_count: null, hole_data: null, course_rating: null, slope_rating: null, lat: 45.3, lng: -75.7,
    description: null, description_attribution: null, architect: null, year_built: null, course_type: null, website: null, phone: null,
    hydrated_at: null, place_id: null, country_code: null, region_code: null, location_source: null, club_id: null, section_name: null, section_kind: null,
    ...over,
  } as CatalogRow);
  function fakeAdmin() {
    const updates: Array<Record<string, unknown>> = [];
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'maybeSingle']) b[m] = () => b;
    b.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
    b.update = (fields: Record<string, unknown>) => {
      updates.push(fields);
      const chain: Record<string, unknown> = {};
      for (const m of ['eq', 'select']) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: { ...row(), ...fields }, error: null });
      chain.then = (resolve: (v: unknown) => void) => resolve({ error: null });
      return chain;
    };
    return { admin: { rpc: () => ({ single: async () => ({ data: { allowed: true }, error: null }) }), from: () => b } as never, updates };
  }
  const answer = (pars: number[]) => ({ course: { id: '42', club_name: 'QA Links', course_name: 'QA Links', tees: { male: [{ tee_name: 'White', course_rating: 70.1, slope_rating: 125, par_total: 72, number_of_holes: 18, holes: pars.map((par, i) => ({ par, yardage: 300 + i, handicap: i + 1 })) }] } } });
  const stub = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('golfcourseapi.com') ? { ok: true, json: async () => body } : { ok: false, status: 503, json: async () => ({}) })));

  it('85 against a stated 72: no card is saved, the ratings are, and the outcome says why', async () => {
    vi.stubEnv('GOLF_COURSE_API_KEY', 'k');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stub(answer(UNIVERSITY_PARK));
    const { admin, updates } = fakeAdmin();
    const { outcome, course } = await hydrateCourseDetailed(admin, row());
    expect(outcome.outcome).toBe('card_refused');
    const saved = updates[updates.length - 1];
    expect(saved.hole_data).toBeNull();
    expect(saved.course_rating).toEqual({ white: 70.1 });
    expect(course.holes).toEqual([]);
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });
  it('a card that adds up is saved as before', async () => {
    vi.stubEnv('GOLF_COURSE_API_KEY', 'k');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stub(answer(GOOD));
    const { admin, updates } = fakeAdmin();
    const { outcome } = await hydrateCourseDetailed(admin, row());
    expect(outcome.outcome).toBe('ok');
    expect((updates[updates.length - 1].hole_data as unknown[]).length).toBe(18);
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });
});

describe('runCardAudit — the owner\'s check of saved cards', () => {
  type R = { id: string; name: string; total_par: number | null; holes_count: number | null; hole_data: ReturnType<typeof holes> | null };
  function fakeAdmin(rows: R[]) {
    const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const filters: string[] = [];
    const admin = {
      from: () => ({
        select: () => {
          const q: Record<string, unknown> = {};
          q.not = (col: string, op: string, val: unknown) => { filters.push(`${col} ${op} ${String(val)}`); return q; };
          q.order = () => q;
          q.range = async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null });
          return q;
        },
        update: (fields: Record<string, unknown>) => ({ eq: (_c: string, id: string) => ({ not: () => ({ select: async () => { updates.push({ id, fields }); return { data: [{ id }], error: null }; } }) }) }),
      }),
    };
    return { admin: admin as never, updates, filters };
  }
  const good: R = { id: 'g', name: 'Good Links', total_par: 72, holes_count: 18, hole_data: holes(GOOD) };
  const bad: R = { id: 'b', name: '1 10 At University Park Country Club', total_par: 72, holes_count: 18, hole_data: holes(UNIVERSITY_PARK) };

  it('a dry run lists the failing cards and writes nothing; seed and test rows are never read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { admin, updates, filters } = fakeAdmin([good, bad]);
    const r = await runCardAudit(admin, { dryRun: true });
    expect(r).toMatchObject({ phase: 'audit', dryRun: true, cards: 2, withdrawn: 0, failing: [{ id: 'b', verdict: 'par_sum', holes: 18, sum: 85, total: 72 }] });
    expect(updates).toEqual([]);
    expect(filters).toContain('external_source in (seed,qa-e2e)');
    expect(describeCardFill(r as never)).toBe('1 of 2 saved cards fail their own arithmetic: 1 10 At University Park Country Club (85 over 18 holes, stated 72) (dry run, nothing written)');
    vi.restoreAllMocks();
  });
  it('a live run withdraws the holes, the total and the credits, stamps the reason, and leaves the ratings', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { admin, updates } = fakeAdmin([good, bad]);
    const r = await runCardAudit(admin, { dryRun: false });
    expect(r).toMatchObject({ withdrawn: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('b');
    expect(updates[0].fields).toMatchObject({ hole_data: null, total_par: null, holes_count: null, sheet_sources: null, sheet_fill_outcome: 'par_sum' });
    expect(updates[0].fields).not.toHaveProperty('course_rating');
    vi.restoreAllMocks();
  });
  it('more failing cards than the cap is not a few bad cards: nothing is withdrawn', async () => {
    const many = Array.from({ length: AUDIT_WITHDRAW_MAX + 1 }, (_, i) => ({ ...bad, id: `b${i}` }));
    const { admin, updates } = fakeAdmin(many);
    const r = await runCardAudit(admin, { dryRun: false });
    expect(r).toMatchObject({ ok: false });
    expect(updates).toEqual([]);
  });
});

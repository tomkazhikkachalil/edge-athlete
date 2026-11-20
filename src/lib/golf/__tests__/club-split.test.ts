import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { clubSectionsFromCandidates, findOfficialSheet, pickSheetCandidate, type CatalogRow, type SheetCandidate } from '../course-catalog';
import { splitClubIntoSections } from '../club-split-server';

// Nov 19 2026 (Tom: split the club into its courses). "Angus Glen Golf Club"
// is one row of ours; GolfCourseAPI lists its South Course and North Course at
// the club's one address (the real search answer below). The catalog takes one
// row per course, without a card, and the golfer is asked which one.

vi.mock('@/lib/observability/report', () => ({ reportRouteWarning: vi.fn(), reportRouteError: vi.fn() }));

const MARKHAM = { lat: 43.902072, lng: -79.324842 };
const c = (id: string, name: string, extra: Partial<SheetCandidate> = {}): SheetCandidate => ({ id, name, city: 'Markham', region_code: 'ON', country_code: 'CA', ...MARKHAM, ...extra });
const ANGUS = () => [c('chq2vc5r', 'Angus Glen Golf Club – South Course'), c('x9zaxgqm', 'Angus Glen Golf Club – North Course')];
const club = { name: 'Angus Glen Golf Club', city: 'Markham', region_code: 'ON', country_code: 'CA', lat: 43.8984, lng: -79.3327, section_name: null, section_kind: null };

describe('clubSectionsFromCandidates', () => {
  it('Angus Glen: two named courses at the club\'s one point', () => {
    expect(clubSectionsFromCandidates(club, ANGUS())).toEqual([{ label: 'North', id: 'x9zaxgqm' }, { label: 'South', id: 'chq2vc5r' }]);
    // …and it is still not a pick: neither course is the club.
    expect(pickSheetCandidate(club, ANGUS())).toBeNull();
  });
  it('a course listed twice counts once', () => {
    expect(clubSectionsFromCandidates(club, [...ANGUS(), c('dup', 'Angus Glen Golf Club – North Course')])).toHaveLength(2);
  });
  it('null: one listing, a listing that is the club itself, two alike, or too many', () => {
    expect(clubSectionsFromCandidates(club, [ANGUS()[0]])).toBeNull();
    expect(clubSectionsFromCandidates(club, [ANGUS()[0], c('club', 'Angus Glen Golf Club')])).toBeNull();
    expect(clubSectionsFromCandidates(club, [c('a', 'Angus Glen Golf Club – North Course'), c('b', 'Angus Glen Golf Club – North Course', { lat: 43.95, lng: -79.3 })])).toBeNull();
    expect(clubSectionsFromCandidates(club, ['North', 'South', 'East', 'West', 'Valley'].map((n, i) => c(String(i), `Angus Glen Golf Club – ${n}`)))).toBeNull();
  });
  it('null: the listings are not at one point, not at the row, or not located', () => {
    expect(clubSectionsFromCandidates(club, [ANGUS()[0], c('n', 'Angus Glen Golf Club – North Course', { lat: 43.95, lng: -79.32 })])).toBeNull();
    expect(clubSectionsFromCandidates({ ...club, lat: 44.9, lng: -79.3 }, ANGUS())).toBeNull();
    expect(clubSectionsFromCandidates({ ...club, lat: null, lng: null }, ANGUS())).toBeNull();
    expect(clubSectionsFromCandidates(club, ANGUS().map(x => ({ ...x, lat: null, lng: null })))).toBeNull();
  });
  it('null: the row is already a course of a club, or names one', () => {
    expect(clubSectionsFromCandidates({ ...club, section_name: 'North' }, ANGUS())).toBeNull();
    expect(clubSectionsFromCandidates({ ...club, section_kind: 'course_18' }, ANGUS())).toBeNull();
    expect(clubSectionsFromCandidates({ ...club, name: 'Angus Glen Golf Club (North)' }, ANGUS())).toBeNull();
    // A club's generic row ('unspecified') is still the club.
    expect(clubSectionsFromCandidates({ ...club, section_kind: 'unspecified' }, ANGUS())).toHaveLength(2);
  });
  it('null: another country or region, or another club\'s name', () => {
    expect(clubSectionsFromCandidates(club, ANGUS().map(x => ({ ...x, region_code: 'BC' })))).toBeNull();
    expect(clubSectionsFromCandidates(club, [c('a', 'Other Glen Golf Club – North'), c('b', 'Other Glen Golf Club – South')])).toBeNull();
  });
  it('a label of more than two words is not a course name we will make', () => {
    expect(clubSectionsFromCandidates(club, [ANGUS()[0], c('x', 'Angus Glen Golf Club – Old Championship Links Layout')])).toBeNull();
  });
});

// ── The writer and the lookup, against a small in-memory catalog ─────────────
type Row = Record<string, unknown>;
function fakeDb(row: CatalogRow, opts: { failClub?: boolean } = {}) {
  const clubs: Row[] = [];
  const courses: Row[] = [{ ...row }];
  const query = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let wantsDelete = false;
    const rows = () => (table === 'golf_clubs' ? clubs : courses);
    const run = () => {
      const hit = rows().filter(r => filters.every(f => f(r)));
      if (patch) for (const r of hit) Object.assign(r, patch);
      if (wantsDelete) for (const r of hit) rows().splice(rows().indexOf(r), 1);
      return hit;
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return q; },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
      order: () => q,
      limit: async () => ({ data: run(), error: null }),
      maybeSingle: async () => ({ data: table === 'golf_courses' && filters.length ? run()[0] ?? null : { hole_geometry: null }, error: null }),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      update: (fields: Row) => { patch = fields; return q; },
      delete: () => { wantsDelete = true; return q; },
      insert: (fields: Row) => {
        if (opts.failClub) return { select: () => ({ single: async () => ({ data: null, error: { message: 'no' } }) }) };
        const made = { id: `club-${clubs.length + 1}`, ...fields };
        clubs.push(made);
        return { select: () => ({ single: async () => ({ data: made, error: null }) }) };
      },
      upsert: async (list: Row[]) => {
        for (const r of list) if (!courses.some(x => x.external_source === r.external_source && x.external_id === r.external_id)) courses.push({ id: `course-${courses.length + 1}`, holes_count: null, ...r });
        return { error: null };
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: run(), error: null }),
    };
    return q;
  };
  const admin = { from: (table: string) => query(table), rpc: () => ({ single: async () => ({ data: { allowed: true }, error: null }) }) };
  return { admin: admin as never, clubs, courses };
}

const catalogRow = (over: Partial<CatalogRow> = {}): CatalogRow => ({
  id: 'angus', external_source: 'osm', external_id: 'way/9', name: 'Angus Glen Golf Club', club_name: null, city: 'Markham', region: 'Ontario',
  country: 'Canada', total_par: null, holes_count: null, hole_data: null, course_rating: {}, slope_rating: {}, lat: 43.8984, lng: -79.3327,
  description: null, description_attribution: null, architect: null, year_built: null, course_type: null, website: null, phone: null,
  hydrated_at: null, place_id: null, country_code: 'CA', region_code: 'ON', location_source: 'osm', club_id: null, section_name: null, section_kind: null,
  ...over,
} as CatalogRow);

beforeEach(() => {
  vi.stubEnv('GOLF_COURSE_API_KEY', 'k');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('splitClubIntoSections', () => {
  const found = [{ label: 'North', id: 'x9zaxgqm' }, { label: 'South', id: 'chq2vc5r' }];
  it('makes the club, links the row as its generic row, and one course row each, with no card', async () => {
    const { admin, clubs, courses } = fakeDb(catalogRow());
    const out = await splitClubIntoSections(admin, catalogRow(), found);
    expect(clubs).toHaveLength(1);
    expect(clubs[0]).toMatchObject({ name: 'Angus Glen Golf Club', city: 'Markham', lat: 43.8984 });
    expect(courses[0]).toMatchObject({ id: 'angus', club_id: 'club-1', section_kind: 'unspecified' });
    expect(courses.slice(1).map(r => [r.name, r.section_name, r.section_kind, r.external_source, r.external_id])).toEqual([
      ['Angus Glen Golf Club (North)', 'North', 'unspecified', 'seed', 'split:angus:north'],
      ['Angus Glen Golf Club (South)', 'South', 'unspecified', 'seed', 'split:angus:south'],
    ]);
    // Never fabricated: no holes, no par, no ratings.
    for (const r of courses.slice(1)) expect(r).toMatchObject({ course_rating: {}, slope_rating: {} });
    for (const r of courses.slice(1)) expect(r.hole_data ?? null).toBeNull();
    expect(out).toEqual({ club: { id: 'club-1', name: 'Angus Glen Golf Club' }, siblings: [expect.objectContaining({ name: 'Angus Glen Golf Club (North)', sectionName: 'North' }), expect.objectContaining({ name: 'Angus Glen Golf Club (South)', sectionName: 'South' })] });
  });
  // Nov 20 2026: Angus Glen's two courses were made without the club's website.
  it('each course row carries the club row\'s website; a club with none gives none', async () => {
    const withSite = fakeDb(catalogRow({ website: 'https://angusglen.com/' }));
    await splitClubIntoSections(withSite.admin, catalogRow({ website: 'https://angusglen.com/' }), found);
    expect(withSite.courses.slice(1).map(r => r.website)).toEqual(['https://angusglen.com/', 'https://angusglen.com/']);
    const none = fakeDb(catalogRow());
    await splitClubIntoSections(none.admin, catalogRow(), found);
    expect(none.courses.slice(1).map(r => r.website ?? null)).toEqual([null, null]);
  });
  it('run twice: one club, two course rows', async () => {
    const db = fakeDb(catalogRow());
    await splitClubIntoSections(db.admin, catalogRow(), found);
    await splitClubIntoSections(db.admin, catalogRow({ club_id: 'club-1' }), found);
    expect(db.clubs).toHaveLength(1);
    expect(db.courses).toHaveLength(3);
  });
  it('a failed club write changes nothing', async () => {
    const db = fakeDb(catalogRow(), { failClub: true });
    expect(await splitClubIntoSections(db.admin, catalogRow(), found)).toBeNull();
    expect(db.courses).toHaveLength(1);
    expect(db.courses[0].club_id).toBeNull();
  });
});

describe('the lookup: a club listed as several courses', () => {
  const markham = { city: 'Markham', state: 'ON', country: 'Canada', latitude: 43.902072, longitude: -79.324842 };
  const search = { courses: [{ id: 'chq2vc5r', club_name: 'Angus Glen Golf Club', course_name: 'South Course', location: markham }, { id: 'x9zaxgqm', club_name: 'Angus Glen Golf Club', course_name: 'North Course', location: markham }] };
  const stub = () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const host = url.includes('opengolfapi.org') ? 'opengolfapi' : 'golfcourseapi';
      const kind = url.includes('search') ? 'search' : 'detail';
      calls.push(`${host}:${kind}`);
      return { ok: true, json: async () => (host === 'opengolfapi' ? { courses: [] } : search) };
    }));
    return calls;
  };
  it('answers `split` with the club and its courses, saves no card, asks for no detail', async () => {
    const calls = stub();
    const db = fakeDb(catalogRow());
    const r = await findOfficialSheet(db.admin, catalogRow());
    expect(r).toMatchObject({ found: false, outcome: 'split', club: { name: 'Angus Glen Golf Club' } });
    expect(r.siblings!.map(s => s.sectionName)).toEqual(['North', 'South']);
    expect(r.course.clubId).toBe('club-1');
    expect(r.trace!.find(t => t.source === 'golfcourseapi')!.result).toBe('not_narrowed');
    expect(calls).not.toContain('golfcourseapi:detail');
    expect(db.courses.every(x => (x.hole_data ?? null) === null)).toBe(true);
  });
  it('a course made by the split takes its own listing\'s card when picked, and learns it is an 18', async () => {
    const detail = { course: { id: 'x9zaxgqm', club_name: 'Angus Glen Golf Club', course_name: 'North Course', location: markham, tees: { male: [{ tee_name: 'Blue', course_rating: 73.1, slope_rating: 135, number_of_holes: 18, par_total: 72, holes: Array.from({ length: 18 }, (_, i) => ({ par: [4, 5, 3][i % 3], yardage: 380 + i, handicap: i + 1 })) }] } } };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const host = url.includes('opengolfapi.org') ? 'opengolfapi' : 'golfcourseapi';
      const kind = url.includes('search') ? 'search' : 'detail';
      calls.push(`${host}:${kind}:${kind === 'detail' ? url.split('/').pop() : ''}`);
      return { ok: true, json: async () => (host === 'opengolfapi' ? { courses: [] } : kind === 'search' ? search : detail) };
    }));
    const north = catalogRow({ id: 'north', external_source: 'seed', external_id: 'split:angus:north', name: 'Angus Glen Golf Club (North)', club_id: 'club-1', club_name: 'Angus Glen Golf Club', section_name: 'North', section_kind: 'unspecified' } as Partial<CatalogRow>);
    const db = fakeDb(north);
    const r = await findOfficialSheet(db.admin, north);
    expect(r).toMatchObject({ found: true, outcome: 'found' });
    expect(calls).toContain('golfcourseapi:detail:x9zaxgqm');
    expect(calls).not.toContain('golfcourseapi:detail:chq2vc5r');
    expect(db.courses[0]).toMatchObject({ section_kind: 'course_18', holes_count: 18, total_par: 72 });
    expect(r.course.holes).toHaveLength(18);
  });

  it('a club that is already linked is never split again', async () => {
    stub();
    const db = fakeDb(catalogRow({ club_id: 'curated', section_kind: 'unspecified' } as Partial<CatalogRow>));
    const r = await findOfficialSheet(db.admin, catalogRow({ club_id: 'curated', section_kind: 'unspecified' } as Partial<CatalogRow>));
    expect(r.outcome).not.toBe('split');
    expect(db.clubs).toHaveLength(0);
    expect(db.courses).toHaveLength(1);
  });
});

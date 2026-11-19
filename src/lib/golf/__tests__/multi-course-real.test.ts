import { describe, it, expect } from 'vitest';
import { foldSheetTwins, normalizeGcaSummary, normalizeOpenGolfSummary, pickSheetCandidate, sectionWordIn, sheetMissReason, type SheetCandidate } from '../course-catalog';

// The providers' REAL search answers for the clubs the lookup could not narrow
// (read live Nov 19 2026), against production's rows for them.
const gca = (id: string, club: string, course: string, location: Record<string, unknown>): SheetCandidate => {
  const n = normalizeGcaSummary({ id, club_name: club, course_name: course, location } as never);
  return { id, name: n.name, city: n.city, region_code: n.region_code, country_code: n.country_code, ...(typeof location.latitude === 'number' ? { lat: location.latitude as number, lng: location.longitude as number } : {}) };
};
const og = (id: string, name: string, extra: Record<string, unknown>): SheetCandidate => {
  const n = normalizeOpenGolfSummary({ id, course_name: name, ...extra } as never);
  return { id, name: n.name, city: n.city, region_code: n.region_code, country_code: n.country_code, ...(n.lat != null && n.lng != null ? { lat: n.lat, lng: n.lng } : {}), ...(n.total_par ? { par: n.total_par } : {}), ...(n.holes_count ? { holes: n.holes_count } : {}) };
};
const OAKVILLE = { address: '1333 Dorval Dr, Oakville, ON L6M 4G2, Canada', city: 'Oakville', state: 'ON', country: 'Canada', latitude: 43.4524049, longitude: -79.717847 };
const MARKHAM = { address: '10080 Kennedy Rd, Markham, ON L6C 1N9, Canada', city: 'Markham', state: 'ON', country: 'Canada', latitude: 43.902072, longitude: -79.324842 };
const HUNT = { address: '1 Hunt Club Rd, Ottawa, ON K1V 1N1, Canada', city: 'Ottawa', state: 'ON', country: 'Canada', latitude: 45.3379788, longitude: -75.6852228 };
const NOWHERE = { state: 'Unknown', country: 'Unknown' };


const ON = { region_code: 'ON', country_code: 'CA' };
const glenAbbey = { name: 'Glen Abbey', city: 'Oakville', ...ON, lat: 43.4527, lng: -79.7169 };
const angusGlen = { name: 'Angus Glen Golf Club', city: 'Markham', ...ON, lat: 43.8984, lng: -79.3327 };
const greensmere = (s: string) => ({ name: `Greensmere Golf & Country Club (${s})`, city: 'Mississippi Mills', ...ON, lat: 45.3024, lng: -76.087, section_name: s, holes_count: 18 });
const hunt = (s: string) => ({ name: `Ottawa Hunt and Golf Club (${s} Nine)`, city: 'Nepean', ...ON, lat: 45.3417, lng: -75.6829, section_name: `${s} Nine`, holes_count: 9 });
const GLEN_ABBEY_GCA = () => [gca('b22xntx9', 'Glen Abbey Golf Club', 'Glen Abbey Golf Club', OAKVILLE), gca('vrqw2fvh', 'Glen Abbey Golf Club', 'Glen Abbey Golf Club', OAKVILLE)];
const ANGUS_GCA = () => [gca('chq2vc5r', 'Angus Glen Golf Club', 'South Course', MARKHAM), gca('x9zaxgqm', 'Angus Glen Golf Club', 'North Course', MARKHAM)];
const GREENSMERE_GCA = () => [gca('d0rc26ak', 'Greensmere G & Cc', 'Legacy', NOWHERE), gca('snm23pnx', 'Greensmere G & Cc', 'Premiere', NOWHERE)];
const HUNT_GCA = () => [gca('wfyry8me', 'Ottawa Hunt & Golf Club', 'West', HUNT), gca('qjxgwhx7', 'Ottawa Hunt & Golf Club', 'North', HUNT), gca('7t91wa4y', 'Ottawa Hunt & Golf Club', 'South', HUNT)];

describe('one course listed twice is one candidate (Glen Abbey, Oakville)', () => {
  it('the same name at the same point folds into one, keeping the other id', () => {
    const folded = foldSheetTwins(GLEN_ABBEY_GCA());
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ id: 'b22xntx9', twins: ['vrqw2fvh'] });
    expect(pickSheetCandidate(glenAbbey, GLEN_ABBEY_GCA())).toMatchObject({ id: 'b22xntx9', twins: ['vrqw2fvh'] });
  });
  it('not folded: a different name, a different point, or no point at all', () => {
    expect(foldSheetTwins(ANGUS_GCA())).toHaveLength(2); // same point, North and South
    const far = gca('zzzzzzzz', 'Glen Abbey Golf Club', 'Glen Abbey Golf Club', { ...OAKVILLE, latitude: 43.5, longitude: -79.7 });
    expect(foldSheetTwins([GLEN_ABBEY_GCA()[0], far])).toHaveLength(2);
    const c = (id: string) => ({ id, name: 'Glen Abbey Golf Club', city: 'Oakville', ...ON });
    expect(foldSheetTwins([c('1'), c('2')])).toHaveLength(2);
    expect(pickSheetCandidate(glenAbbey, [c('1'), c('2')])).toBeNull(); // still no guess between unlocated twins
  });
  it('OpenGolfAPI: the unlocated-by-region Canadian listing, never the Florida club', () => {
    const cands = [og('ffbdd0bc', 'Glen Abbey', { country_iso: 'CA', lat: 43.4527274, lng: -79.7169114 }), og('a8010fad', 'Glen Abbey Golf Club', { city: 'DeBary', state: 'FL', country_iso: 'US', lat: 28.8976614, lng: -81.299588, par: 72, holes: 18 })];
    expect(pickSheetCandidate(glenAbbey, cands)?.id).toBe('ffbdd0bc');
  });
});

describe('a section spelled one letter apart is the same section (Greensmere Premier / "Premiere")', () => {
  it('Legacy and Premier each take their own listing', () => {
    expect(pickSheetCandidate(greensmere('Legacy'), GREENSMERE_GCA())?.id).toBe('d0rc26ak');
    expect(pickSheetCandidate(greensmere('Premier'), GREENSMERE_GCA())?.id).toBe('snm23pnx');
  });
  it('only a trailing letter on a long word; different words stay different', () => {
    expect(sectionWordIn(new Set(['premiere']), 'premier')).toBe(true);
    expect(sectionWordIn(new Set(['premier']), 'premiere')).toBe(true);
    expect(sectionWordIn(new Set(['north']), 'south')).toBe(false);
    expect(sectionWordIn(new Set(['easts']), 'east')).toBe(false); // too short to be a spelling
    expect(sectionWordIn(new Set(['legacies']), 'legacy')).toBe(false);
    expect(sectionWordIn(new Set(['premierxx']), 'premier')).toBe(false);
  });
});

describe('Ottawa Hunt: each nine takes its own listing', () => {
  it.each([['North', 'qjxgwhx7'], ['South', '7t91wa4y'], ['West', 'wfyry8me']])('%s', (s, id) => {
    expect(pickSheetCandidate(hunt(s), HUNT_GCA())?.id).toBe(id);
  });
});

describe('two courses of one club stay a tie (Angus Glen North / South)', () => {
  it('no pick: both are at the club, neither is the club', () => {
    expect(pickSheetCandidate(angusGlen, ANGUS_GCA())).toBeNull();
    expect(sheetMissReason(angusGlen, ANGUS_GCA())).toBe('not_narrowed');
  });
  it('even when only ONE of them is listed near the row and a same-named club is far away', () => {
    const far = gca('faraway1', 'Angus Glen Golf Club', 'Angus Glen Golf Club', { city: 'Markham', state: 'ON', country: 'Canada', latitude: 44.9, longitude: -79.3 });
    const farTwo = gca('faraway2', 'Angus Glen Golf Club', 'Angus Glen Golf Club', { city: 'Markham', state: 'ON', country: 'Canada', latitude: 45.9, longitude: -79.3 });
    // North is at the row; the two plain-named clubs are not: nothing is at the row that is the club itself.
    expect(pickSheetCandidate(angusGlen, [ANGUS_GCA()[1], far, farTwo])).toBeNull();
  });
});

describe('what the search says decides between plain same-named candidates', () => {
  const row = { name: 'Pine Ridge Golf Club', city: null, region_code: 'ON', country_code: 'CA', lat: 45.0, lng: -75.0, holes_count: null as number | null };
  const c = (id: string, extra: Partial<SheetCandidate>): SheetCandidate => ({ id, name: 'Pine Ridge Golf Club', city: null, region_code: 'ON', country_code: 'CA', ...extra });
  it('the only one at the row\'s point', () => {
    expect(pickSheetCandidate(row, [c('near', { lat: 45.005, lng: -75.004 }), c('far', { lat: 46.2, lng: -78.1 })])?.id).toBe('near');
    expect(pickSheetCandidate(row, [c('a', { lat: 45.005, lng: -75.004 }), c('b', { lat: 45.4, lng: -75.3 }), c('c', {})])?.id).toBe('a');
    // Both far, or neither located: no pick.
    expect(pickSheetCandidate(row, [c('a', { lat: 46, lng: -75 }), c('b', { lat: 47, lng: -75 })])).toBeNull();
    expect(pickSheetCandidate(row, [c('a', {}), c('b', {})])).toBeNull();
  });
  it('the only one with the row\'s hole count, then the only one with the map\'s tagged par', () => {
    const noPoint = { ...row, lat: null, lng: null };
    expect(pickSheetCandidate({ ...noPoint, holes_count: 9 }, [c('nine', { holes: 9 }), c('eighteen', { holes: 18 })])?.id).toBe('nine');
    expect(pickSheetCandidate(noPoint, [c('p72', { par: 72, holes: 18 }), c('p70', { par: 70, holes: 18 })], { par: 70, holes: 18 })?.id).toBe('p70');
    expect(pickSheetCandidate(noPoint, [c('p72', { par: 72, holes: 18 }), c('p70', { par: 70, holes: 18 })])).toBeNull();
    expect(pickSheetCandidate(noPoint, [c('x', { par: 70, holes: 18 }), c('y', { par: 70, holes: 18 })], { par: 70, holes: 18 })).toBeNull();
  });
});

describe('why nothing was picked', () => {
  it('names the reason', () => {
    expect(sheetMissReason(angusGlen, [])).toBe('no_candidates');
    expect(sheetMissReason(angusGlen, [gca('x', 'Other Club', 'Other Club', MARKHAM)])).toBe('no_name_match');
    // A section row whose provider lists only the club or a sibling: nothing names the section.
    expect(sheetMissReason(greensmere('Legacy'), [GREENSMERE_GCA()[1]])).toBe('no_section_match');
    expect(sheetMissReason(hunt('North'), [gca('c', 'Ottawa Hunt & Golf Club', 'Ottawa Hunt & Golf Club', HUNT)])).toBe('no_section_match');
  });
});

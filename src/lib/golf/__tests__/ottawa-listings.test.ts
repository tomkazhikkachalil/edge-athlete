import { describe, it, expect } from 'vitest';
import { clubSectionsFromCandidates, foldSheetTwins, pickSheetCandidate, placeConfirms, sectionLabelKey, sectionPart, sheetAskKey, sheetMissReason, type SheetCandidate } from '../course-catalog';

// Nov 24 2026. Tom could find no Ottawa course that worked. Measured against
// both providers: OpenGolfAPI holds no holes for any Ottawa course, and
// GolfCourseAPI holds most of them in shapes our rules rejected. Every listing
// below is GolfCourseAPI's real search answer of that day (id, name, town,
// codes, point); every row is production's.

const row = (name: string, city: string, lat: number, lng: number, extra: Record<string, unknown> = {}) => ({ name, city, region_code: 'ON', country_code: 'CA', lat, lng, section_name: null as string | null, section_kind: null as string | null, ...extra });
const l = (id: string, name: string, city: string | null, region_code: string | null, country_code: string | null, point?: [number, number]): SheetCandidate => ({ id, name, city, region_code, country_code, ...(point ? { lat: point[0], lng: point[1] } : {}) });

const HYLANDS = row('Hylands Golf Course', 'Gloucester', 45.3185821, -75.6445633);
const HYLANDS_GCA = () => [
  l('5qhd0rr1', 'Hylands Golf Complex – Hylands', 'Ingatestone', null, 'GB'),
  l('rk1sgj9x', 'Ottawa Hylands – North', 'Gloucester', 'ON', 'CA'),
  l('n97krmzh', 'Ottawa Hylands – South', 'Gloucester', 'ON', 'CA'),
  l('7814fq9s', 'Hylands Golf Club – North Old', 'Gloucester', 'ON', 'CA'),
  l('cpj4b6cv', 'Hylands Golf Club – South Old', 'Gloucester', 'ON', 'CA'),
  l('2gf045fq', 'Royal Hylands Golf Club', 'Knightstown', 'IN', 'US', [39.8197541, -85.5220332]),
];

const PAKENHAM = row('Pakenham Golf & Country Club', 'Arnprior', 45.3265899, -76.2994401);
const AT_PAKENHAM: [number, number] = [45.3257374, -76.2924927];
const PAKENHAM_GCA = () => [
  l('ndzskt1x', 'Pakenham Highlands – Lake (Old)', 'Pakenham', 'ON', 'CA', AT_PAKENHAM),
  l('mjkcpnwh', 'Pakenham Highlands – Island/Lake', 'Pakenham', 'ON', 'CA', AT_PAKENHAM),
  l('g7fkrd5z', 'Pakenham Highlands – Lake/Canyon', 'Pakenham', 'ON', 'CA', AT_PAKENHAM),
  l('zgd4zany', 'Pakenham Highlands – Lake / Island', 'Pakenham', 'ON', 'CA', AT_PAKENHAM),
  l('gt5yrs81', 'Pakenham Highlands – Canyon/Island', 'Pakenham', 'ON', 'CA', AT_PAKENHAM),
  l('g42nwpwb', 'Pakenham Highlands – Lake/Canyon', 'Pakenham', 'ON', 'CA', AT_PAKENHAM),
  l('bt5q803t', 'Pakenham & District Golf Club', 'Pakenham', null, 'AU', [-38.0780257, 145.5011447]),
];

const IRISH = row('Irish Hills Golf & Country Club', 'Kanata-Lakes', 45.3282207, -76.0032073);
const IRISH_GCA = () => [
  l('02httr9j', 'Irish Hills Golf Club', 'Mount Vernon', 'OH', 'US', [40.335539, -82.462897]),
  l('8e6rv070', 'Irish Hills Golf And Country Club – Yellow/Red', 'Carp', 'ON', 'CA'),
  l('0dr30g61', 'Irish Hills Golf And Country Club – Blue/Yellow', 'Carp', 'ON', 'CA'),
  l('rm143jx4', 'Irish Hills Golf And Country Club – Red/Blue', 'Carp', 'ON', 'CA'),
  l('d7w1n13g', 'Irish Hills Golf And Country Club – Red (9 Hole)', 'Carp', 'ON', 'CA'),
  l('1y6sbbtf', 'Irish Hills Golf And Country Club – Blue (9 Hole)', 'Carp', 'ON', 'CA'),
  l('1q840hxt', 'Irish Hills Golf And Country Club – Yellow (9 Hole)', 'Carp', 'ON', 'CA'),
];

const RIDEAU_GLEN = row('Rideau Glen Golf Club', 'Greely', 45.0475758, -75.673211);
const RIDEAU_GLEN_GCA = () => [l('kfjzs9v4', 'Rideau Glen', 'Kemptville', 'QC', 'CA', [45.0459249, -75.6775134])];

const MEADOWS = row('The Meadows Golf and Country Club', 'Ottawa', 45.3309874, -75.5657197);
const MEADOWS_GCA = () => [
  l('jg4vdks4', 'Osoyoos Golf Course – Park Meadows', 'Osoyoos', 'BC', 'CA', [49.015948, -119.490662]),
  l('935qvkw0', 'Grande Meadows', "Frenchman'S Cove", 'NL', 'CA', [47.2150152, -55.4042585]),
  l('ypee7t51', 'Gosfield Lake Golf Club – Meadows', 'Gosfield', null, 'GB', [51.9400986, 0.5770256]),
  l('0s1jhhkv', 'Grand Meadows', null, null, null),
];

// Production holds this row with country US (a default of the OpenGolfAPI reader).
const MARSHES = row('The Marshes Golf Club', 'Beaverbrook', 45.3532036, -75.9081427, { country_code: 'US' });
const MARSHES_GCA = () => [l('5hdbstsf', 'Wildwood Marshes', 'Hayward', 'WI', 'US', [46.039769, -91.2204715])];

const GREYHAWK = row('GreyHawk Golf Club', 'Carlsbad Springs', 45.3584978, -75.4408758);
const AT_GREYHAWK: [number, number] = [45.356146, -75.447007];
const AT_WHITE_HAWK: [number, number] = [41.4367865, -87.3824388];
const GREYHAWK_GCA = () => [
  l('c9dg0dta', 'Greyhawk – Predator', 'Cumberland', 'ON', 'CA', AT_GREYHAWK),
  l('fpzmh5wc', 'Greyhawk – Talon', 'Cumberland', 'ON', 'CA', AT_GREYHAWK),
  l('2ydkqb0a', 'White Hawk Country Club – Redhawk/Greyhawk', 'Crown Point', 'IN', 'US', AT_WHITE_HAWK),
  l('vve2k924', 'White Hawk Country Club – Greyhawk/Blackhawk', 'Crown Point', 'IN', 'US', AT_WHITE_HAWK),
  l('c9p5qfjd', 'White Hawk Country Club – Greyhawk/Silverhawk', 'Crown Point', 'IN', 'US', AT_WHITE_HAWK),
];

/** The row the split makes for one course of a club (club-split-server.ts). */
const course = (club: ReturnType<typeof row>, label: string) => ({ ...club, name: `${club.name} (${label})`, section_name: label, section_kind: 'unspecified' });

describe('the course\'s own part of a listing', () => {
  it('what follows the dash, else what the brackets hold', () => {
    expect(sectionPart('Ottawa Hylands – North')).toBe('North');
    expect(sectionPart('Pakenham Highlands – Lake (Old)')).toBe('Lake (Old)');
    expect(sectionPart('Ottawa Hunt and Golf Club (North Nine)')).toBe('North Nine');
    expect(sectionPart('Mont-Cascades')).toBe('');
  });
  it('compared in the provider\'s order, without the words every course has', () => {
    expect(sectionLabelKey('Lake / Island')).toBe('lake/island');
    expect(sectionLabelKey('Island/Lake')).toBe('island/lake');
    expect(sectionLabelKey('Red (9 Hole)')).toBe('red');
    expect(sectionLabelKey('South Course')).toBe('south');
    expect(sectionLabelKey('')).toBe('');
  });
});

describe('a name with a word ours lacks needs the place to agree', () => {
  it('The Meadows (Ottawa) is not "Grand Meadows": no listing is picked', () => {
    // Until Nov 24 2026 the listing with no location at all was picked.
    expect(pickSheetCandidate(MEADOWS, MEADOWS_GCA())).toBeNull();
    expect(placeConfirms(MEADOWS, MEADOWS_GCA()[3])).toBe(false);
    expect(sheetMissReason(MEADOWS, MEADOWS_GCA())).toBe('no_name_match');
  });
  it('The Marshes is not "Wildwood Marshes", and the miss says so', () => {
    expect(pickSheetCandidate(MARSHES, MARSHES_GCA())).toBeNull();
    expect(sheetMissReason(MARSHES, MARSHES_GCA())).toBe('no_name_match');
  });
  it('the extra word stands where the place agrees: the same town, or the same point', () => {
    expect(placeConfirms(HYLANDS, HYLANDS_GCA()[1])).toBe(true); // "Ottawa" Hylands, Gloucester
    expect(placeConfirms(HYLANDS, HYLANDS_GCA()[5])).toBe(false); // "Royal" Hylands, Indiana
    expect(placeConfirms(PAKENHAM, PAKENHAM_GCA()[1])).toBe(true); // Pakenham "Highlands", 0.5 km away
    expect(placeConfirms(PAKENHAM, PAKENHAM_GCA()[6])).toBe(false); // Pakenham "& District", Australia
  });
  it('a name that adds nothing needs no proof of place', () => {
    expect(placeConfirms({ name: 'Carleton Golf & Yacht Club' }, l('x', 'Carleton', null, null, null))).toBe(true);
    expect(placeConfirms({ name: 'Rideau View Golf Club' }, l('x', 'Rideau View Country Club', 'Manotick', 'ON', 'CA'))).toBe(true);
  });
  it('the same name only in another country reads `not_here`, not a tie', () => {
    const pineview = row('Pineview Golf Course', 'Blackburn Hamlet', 45.4303, -75.5955);
    const listings = [l('a', 'Pineview Country Club', 'Atchison', 'KS', 'US', [39.5239, -95.18]), l('b', 'Pineview Highlands Gc', 'Houghton Lake', 'MI', 'US', [44.2979, -84.7347])];
    expect(pickSheetCandidate(pineview, listings)).toBeNull();
    expect(sheetMissReason(pineview, listings)).toBe('not_here');
  });
});

describe('place before province', () => {
  it('Rideau Glen: the one listing 0.4 km from the row is taken, though the provider wrote QC', () => {
    expect(pickSheetCandidate(RIDEAU_GLEN, RIDEAU_GLEN_GCA())?.id).toBe('kfjzs9v4');
  });
  it('the same listing far from the row is still another province\'s course', () => {
    expect(pickSheetCandidate({ ...RIDEAU_GLEN, lat: 43.7, lng: -79.4 }, RIDEAU_GLEN_GCA())).toBeNull();
  });
});

describe('a club listed as several courses', () => {
  it('Hylands: North and South, with no point on any listing and the "Old" ones left out', () => {
    expect(clubSectionsFromCandidates(HYLANDS, HYLANDS_GCA())).toEqual([{ label: 'North', id: 'rk1sgj9x' }, { label: 'South', id: 'n97krmzh' }]);
    expect(pickSheetCandidate(HYLANDS, HYLANDS_GCA())).toBeNull();
  });
  it('…and each course, once picked, takes its own current listing', () => {
    expect(pickSheetCandidate(course(HYLANDS, 'North'), HYLANDS_GCA())?.id).toBe('rk1sgj9x');
    expect(pickSheetCandidate(course(HYLANDS, 'South'), HYLANDS_GCA())?.id).toBe('n97krmzh');
  });
  it('Pakenham: four routings of three nines, the repeat counted once, the old nine left out', () => {
    expect(clubSectionsFromCandidates(PAKENHAM, PAKENHAM_GCA())).toEqual([
      { label: 'Canyon/Island', id: 'gt5yrs81' },
      { label: 'Island/Lake', id: 'mjkcpnwh' },
      { label: 'Lake/Canyon', id: 'g7fkrd5z' },
      { label: 'Lake/Island', id: 'zgd4zany' },
    ]);
  });
  it('…"Lake/Island" and "Island/Lake" are two courses: each takes its own listing', () => {
    expect(pickSheetCandidate(course(PAKENHAM, 'Lake/Island'), PAKENHAM_GCA())?.id).toBe('zgd4zany');
    expect(pickSheetCandidate(course(PAKENHAM, 'Island/Lake'), PAKENHAM_GCA())?.id).toBe('mjkcpnwh');
    // The course listed twice is one candidate that keeps the other id.
    const twice = pickSheetCandidate(course(PAKENHAM, 'Lake/Canyon'), PAKENHAM_GCA());
    expect(twice).toMatchObject({ id: 'g7fkrd5z', twins: ['g42nwpwb'] });
    expect(foldSheetTwins(PAKENHAM_GCA().slice(1, 6))).toHaveLength(4);
  });
  it('Irish Hills: nines listed alone and combined split into the nines', () => {
    // No listing has a point and the town differs (Carp / Kanata-Lakes): the club's name is exactly ours.
    expect(clubSectionsFromCandidates(IRISH, IRISH_GCA())).toEqual([{ label: 'Blue', id: '1y6sbbtf' }, { label: 'Red', id: 'd7w1n13g' }, { label: 'Yellow', id: '1q840hxt' }]);
  });
  it('…and a nine takes the listing that IS the nine, not a combination holding it', () => {
    expect(pickSheetCandidate(course(IRISH, 'Red'), IRISH_GCA())?.id).toBe('d7w1n13g');
    expect(pickSheetCandidate(course(IRISH, 'Yellow'), IRISH_GCA())?.id).toBe('1q840hxt');
  });
  it('GreyHawk still splits into Predator and Talon; another club\'s "Greyhawk" nines are not its courses', () => {
    expect(clubSectionsFromCandidates(GREYHAWK, GREYHAWK_GCA())).toEqual([{ label: 'Predator', id: 'c9dg0dta' }, { label: 'Talon', id: 'fpzmh5wc' }]);
  });
  it('unlocated listings in another town under a name that is not exactly ours are not split', () => {
    const elsewhere = HYLANDS_GCA().slice(1, 3).map(x => ({ ...x, city: 'Nepean' }));
    expect(clubSectionsFromCandidates(HYLANDS, elsewhere)).toBeNull();
  });
});

describe('the day\'s ask', () => {
  it('carries the rules\' version, so a course asked under the old rules is asked again', () => {
    expect(sheetAskKey('c1')).toBe('golf-sheet-ask:v2:c1');
  });
});

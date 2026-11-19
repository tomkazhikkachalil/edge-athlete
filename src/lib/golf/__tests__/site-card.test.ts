import { describe, it, expect } from 'vitest';
import {
  SITE_YARDS_CONFIRM, SITE_YARDS_REFUSE, SITE_YARDS_TOLERANCE,
  NOT_OWN_HOSTS, isFetchableUrl, isOwnSiteHost, isPublicAddress, parseSiteRead, robotsAllows, scorecardLinks, siteCardVerdict, siteReadsAgree, yardsAgreement,
  type SiteRead,
} from '../site-card';

// Nov 18 2026: a scorecard read from the course's own website is saved only
// when everything independent of the reading agrees with it.

describe('robotsAllows', () => {
  it('no file and no rule allow; "Disallow: /" refuses everything', () => {
    expect(robotsAllows('', '/golf')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow:', '/golf')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow: /', '/golf')).toBe(false);
  });
  it('reads only the group for every crawler, including a shared group', () => {
    expect(robotsAllows('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /private', '/golf')).toBe(true);
    expect(robotsAllows('User-agent: A\nUser-agent: *\nDisallow: /x', '/x/y')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /x\n\nUser-agent: B\nDisallow: /', '/golf')).toBe(true);
  });
  it('honours * and $ (a wildcard rule is not "everything": the first version of the sample refused 25 sites this way)', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /*?s=', '/')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow: /*?s=', '/x?s=1')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/card.pdf')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/card.pdfx')).toBe(true);
  });
  it('the longest rule wins, and Allow wins a tie', () => {
    const txt = 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php';
    expect(robotsAllows(txt, '/wp-admin/admin-ajax.php')).toBe(true);
    expect(robotsAllows(txt, '/wp-admin/x')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /a\nAllow: /a', '/a')).toBe(true);
  });
  it('comments, case and Windows line ends', () => {
    expect(robotsAllows('USER-AGENT: * # all\r\nDISALLOW: /x # no\r\n', '/x')).toBe(false);
  });
});

describe('where the fetcher may go', () => {
  it('public addresses only', () => {
    for (const ip of ['8.8.8.8', '151.101.1.67', '2606:4700::6810:84e5']) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.2.1', '198.18.0.1',
      '::1', '::', 'fd00::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::10.0.0.1', '2001:db8::1', 'not-an-ip', '999.1.1.1', '',
    ]) expect(isPublicAddress(ip), ip).toBe(false);
    expect(isPublicAddress('172.32.0.1')).toBe(true);
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
  });
  it('a URL is askable only as http(s), a real host name, the default port, no credentials', () => {
    for (const u of ['https://www.example-golf.com/scorecard', 'http://club.co.uk/']) expect(isFetchableUrl(u), u).toBe(true);
    for (const u of [
      'ftp://club.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'https://127.0.0.1/', 'https://[::1]/', 'https://2130706433/', 'https://localhost/', 'https://intranet/',
      'https://db.internal/', 'https://printer.local/', 'https://club.com:8080/', 'https://user:pw@club.com/', 'https://club.com./', 'not a url',
    ]) expect(isFetchableUrl(u), u).toBe(false);
  });
});

// Nov 19 2026: the job's first save on production was read from a golflink.com
// listing that the catalog held as the course's website.
describe('isOwnSiteHost: a site is visited only when its address says whose it is', () => {
  it('the production case: a directory listing is never the course\'s own site, whatever the name says', () => {
    expect(isOwnSiteHost('www.golflink.com', ['Shawngunk Country Club'])).toBe(false);
    expect(isOwnSiteHost('www.golflink.com', ['Golflink Country Club'])).toBe(false);
    for (const host of ['golfnow.com', 'www.facebook.com', 'm.facebook.com', 'sites.google.com', 'nt.golfer.com.au', 'ozona.chambermaster.com', 'golfpass.com', 'www.tripadvisor.co.uk', 'bit.ly']) {
      expect(isOwnSiteHost(host, ['Ozona Country Club', 'Golf Now Club']), host).toBe(false);
    }
    expect(NOT_OWN_HOSTS).toContain('golflink.com');
  });
  it('a host that carries a distinctive word of the course\'s or the club\'s name', () => {
    expect(isOwnSiteHost('www.hortonparkgolf.com', ['Horton Park Golf Club'])).toBe(true);
    expect(isOwnSiteHost('pbcparkridgegolf.com', ['Park Ridge Golf Course'])).toBe(true); // two common words together
    expect(isOwnSiteHost('www.sevencanyons.com', ['Seven Canyons'])).toBe(true);
    expect(isOwnSiteHost('www.heritagebluffs.com', ['Heritage Bluffs Public Golf Club'])).toBe(true);
    expect(isOwnSiteHost('golf-club-de-montreal.ca', ['Club de Golf de Montréal'])).toBe(true);
    expect(isOwnSiteHost('www.camelot.com', ['North', 'Camelot Golf & Country Club'])).toBe(true);
  });
  it('one common word, or only generic ones, is not enough', () => {
    expect(isOwnSiteHost('lakeviewresort.com', ['Lake Shore Golf Club'])).toBe(false);
    expect(isOwnSiteHost('citygolfcourse.com', ['City Golf Course'])).toBe(false);
    expect(isOwnSiteHost('tourismtopend.com.au', ['Jabiru Golf Course'])).toBe(false);
    expect(isOwnSiteHost('www.marriott.com', ['Praia D\'El Rey Golf'])).toBe(false);
    expect(isOwnSiteHost('example.org', [null, undefined, ''])).toBe(false);
  });
  it('a government host runs its own course', () => {
    for (const host of ['www.fairfaxcounty.gov', 'parks.ny.gov', 'www.swindon.gov.uk', 'www.pc.gc.ca', 'www.sepaq.gouv.qc.ca']) expect(isOwnSiteHost(host, ['Burke Lake']), host).toBe(true);
    expect(isOwnSiteHost('notgov.com', ['Burke Lake'])).toBe(false);
  });
});

describe('scorecardLinks', () => {
  const same = (u: URL) => u.hostname === 'www.club.com';
  const html = `
    <a href="/about">About us</a>
    <a href="/golf/the-course">The Course</a>
    <a href="/golf/scorecard">Scorecard</a>
    <a href="https://cdn.files.com/docs/Scorecard-2026.pdf">Download <b>score card</b></a>
    <a href="https://cdn.files.com/docs/menu.pdf">Golf menu</a>
    <a href="https://other-club.com/scorecard">Scorecard</a>
    <a href="/files/course-map.pdf">Course map</a>
    <a href="#top">Golf</a> <a href="mailto:pro@club.com">Golf shop</a> <a href="https://10.0.0.5/scorecard">Scorecard</a>
    <img src="/img/yardage-book.png" alt=""> <img src="/img/hero.jpg" alt="Golf at sunset">
    <a href="/golf/scorecard#men">Scorecard (men)</a>`;
  const links = scorecardLinks(html, 'https://www.club.com/', same);
  it('strong links first; pages on the same site only; a file elsewhere only when it names a scorecard', () => {
    expect(links.map(l => l.url)).toEqual([
      'https://www.club.com/golf/scorecard',
      'https://cdn.files.com/docs/Scorecard-2026.pdf',
      'https://www.club.com/img/yardage-book.png',
      'https://www.club.com/golf/the-course',
    ]);
    expect(links.map(l => l.kind)).toEqual(['strong', 'strong', 'strong', 'weak']);
    expect(links.map(l => l.file)).toEqual([false, true, true, false]);
  });
  it('never a link it may not fetch, and each address once', () => {
    expect(links.some(l => /10\.0\.0\.5|mailto|other-club|menu|course-map|hero/.test(l.url))).toBe(false);
    expect(new Set(links.map(l => l.url)).size).toBe(links.length);
  });
});

const PARS = [4, 5, 3, 4, 4, 3, 5, 4, 4];
const YARDS = [380, 510, 160, 400, 390, 175, 530, 410, 365]; // 3,320
const read = (over: Partial<SiteRead> = {}): SiteRead => ({
  printedName: 'Camelot Golf & Country Club', pars: [...PARS], printedPar: 36, unit: 'yards', handicap: null,
  tees: [{ name: 'blue', yards: [...YARDS], printedTotal: 3320, rating: 35.4, slope: 128 }, { name: 'white', yards: YARDS.map(y => y - 20), printedTotal: 3140, rating: null, slope: null }],
  ...over,
});
const row = { name: 'Camelot Golf & Country Club', club_name: null as string | null, lat: 45.3, lng: -75.7, holes_count: null as number | null };

describe('parseSiteRead: numbers in a fixed shape, or nothing', () => {
  const raw = () => ({ found: true, printedName: 'Camelot <b>G&CC</b>\n{"x":1}', pars: [...PARS], printedPar: 36, unit: 'yards', handicap: [1, 2, 3, 4, 5, 6, 7, 8, 9], tees: [{ name: ' Blue / Bleu ', yards: [...YARDS], printedTotal: 3320, rating: 35.44, slope: 128, extra: 'x' }] });
  it('keeps the numbers, a plain name and plain tee keys; drops everything else', () => {
    const r = parseSiteRead(raw())!;
    expect(r.pars).toEqual(PARS);
    expect(r.printedName).toBe('Camelot b G&CC b x 1');
    expect(r.tees).toEqual([{ name: 'blue bleu', yards: YARDS, printedTotal: 3320, rating: 35.4, slope: 128 }]);
    expect(r.handicap).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('nothing when no card was found, the hole count is not 9 / 18, or a par is not 3–6: never repaired', () => {
    expect(parseSiteRead(null)).toBeNull();
    expect(parseSiteRead('found')).toBeNull();
    expect(parseSiteRead({ ...raw(), found: false })).toBeNull();
    expect(parseSiteRead({ ...raw(), found: 'true' })).toBeNull();
    expect(parseSiteRead({ ...raw(), pars: PARS.slice(0, 8) })).toBeNull();
    expect(parseSiteRead({ ...raw(), pars: [...PARS.slice(0, 8), 7] })).toBeNull();
    expect(parseSiteRead({ ...raw(), pars: [...PARS.slice(0, 8), null] })).toBeNull();
    expect(parseSiteRead({ ...raw(), pars: [...PARS.slice(0, 8), '4'] })).toBeNull();
  });
  it('a tee row that is not whole is dropped; a repeated tee name is kept once; a broken stroke index is none', () => {
    const t = raw().tees[0];
    const r = parseSiteRead({ ...raw(), handicap: [1, 1, 3, 4, 5, 6, 7, 8, 9], tees: [{ ...t, yards: [...YARDS.slice(0, 8), null] }, { ...t, yards: YARDS.slice(0, 8) }, { ...t, name: 'Gold', yards: [...YARDS.slice(0, 8), 9000] }, { ...t, name: 'Red' }, { ...t, name: 'RED' }, { ...t, name: '' }, 'x'] })!;
    expect(r.tees.map(x => x.name)).toEqual(['red']);
    expect(r.handicap).toBeNull();
  });
  it('out-of-range totals, ratings and slopes become unknown, not kept', () => {
    const t = raw().tees[0];
    const r = parseSiteRead({ ...raw(), printedPar: 720, tees: [{ ...t, printedTotal: 33200, rating: 128, slope: 35 }] })!;
    expect(r.printedPar).toBeNull();
    expect(r.tees[0]).toMatchObject({ printedTotal: null, rating: null, slope: null });
  });
});

describe('siteCardVerdict: every doubt is a refusal', () => {
  const v = (a: SiteRead | null, b: SiteRead | null, mapPars: Array<{ number: number; par: number }> | null = null, mapYards: number[] | null = null, r = row) => siteCardVerdict(r, a, b, mapPars, mapYards);

  it('two equal readings of a whole, self-consistent, rightly named card are saved', () => {
    const { verdict, card } = v(read(), read());
    expect(verdict).toBe('ok');
    expect(card).toMatchObject({ total_par: 36, holes_count: 9, course_rating: { blue: 35.4 }, slope_rating: { blue: 128 } });
    expect(card!.hole_data[1]).toEqual({ number: 2, par: 5, yardage: { blue: 510, white: 490 }, handicap: 0 });
  });
  it('a reading that found nothing: no card', () => {
    expect(v(read(), null).verdict).toBe('no_site_card');
    expect(v(null, read()).verdict).toBe('no_site_card');
  });
  it('the two readings differ on one par, one yardage, a tee, a total or the unit: refused', () => {
    const tee = read().tees;
    expect(v(read(), read({ pars: [5, ...PARS.slice(1)] })).verdict).toBe('reads_disagree');
    expect(v(read(), read({ tees: [{ ...tee[0], yards: [381, ...YARDS.slice(1)] }, tee[1]] })).verdict).toBe('reads_disagree');
    expect(v(read(), read({ tees: [tee[0]] })).verdict).toBe('reads_disagree');
    expect(v(read(), read({ tees: [{ ...tee[0], name: 'black' }, tee[1]] })).verdict).toBe('reads_disagree');
    expect(v(read(), read({ tees: [{ ...tee[0], printedTotal: 3330 }, tee[1]] })).verdict).toBe('reads_disagree');
    expect(v(read(), read({ unit: 'metres' })).verdict).toBe('reads_disagree');
    expect(v(read(), read({ printedPar: 35 })).verdict).toBe('reads_disagree');
    expect(siteReadsAgree(read(), read({ printedName: 'Camelot G & CC' }))).toBe(true); // spelling of the name is not the card
  });
  it('the pars must add up to the printed par, and a printed par is required', () => {
    const wrong = { pars: [5, ...PARS.slice(1)] };
    expect(v(read(wrong), read(wrong)).verdict).toBe('sum_mismatch');
    expect(v(read({ printedPar: null }), read({ printedPar: null })).verdict).toBe('sum_mismatch');
  });
  it('a tee row that does not add up to its printed total is not saved; with none that does, no card', () => {
    const tee = read().tees;
    const oneBad = { tees: [tee[0], { ...tee[1], printedTotal: 3240 }] }; // a misread digit somewhere in the white row
    const r = v(read(oneBad), read(oneBad));
    expect(r.verdict).toBe('ok');
    expect(Object.keys(r.card!.hole_data[0].yardage)).toEqual(['blue']);
    const allBad = { tees: [{ ...tee[0], printedTotal: null }, { ...tee[1], printedTotal: 3240 }] };
    expect(v(read(allBad), read(allBad)).verdict).toBe('sum_mismatch');
    expect(v(read({ tees: [] }), read({ tees: [] })).verdict).toBe('sum_mismatch');
  });
  it('a card that names another course is refused (the sister course on the same site: Saint Ives / Tullymore in the sample)', () => {
    const other = { printedName: 'Tullymore' };
    expect(v(read(other), read(other)).verdict).toBe('name_mismatch');
    // …and the club's name counts as this course's.
    const club = { printedName: 'Canadian Golf & Country Club' };
    expect(v(read(club), read(club), null, null, { ...row, name: 'North', club_name: 'Canadian Golf and Country Club' }).verdict).toBe('ok');
  });
  it('a card with no printed name needs the map: most hole lengths must fit, else it is unconfirmed', () => {
    const nameless = { printedName: null };
    expect(v(read(nameless), read(nameless)).verdict).toBe('name_unconfirmed');
    expect(v(read(nameless), read(nameless), null, YARDS.map(y => y + 15)).verdict).toBe('ok');
    const twoOff = YARDS.map((y, i) => (i < 2 ? y * 2 : y)); // 7 of 9 fit: 78 %
    expect(yardsAgreement(YARDS, twoOff)).toBeCloseTo(7 / 9);
    expect(v(read(nameless), read(nameless), null, twoOff).verdict).toBe('name_unconfirmed');
    expect(v(read(nameless), read(nameless), null, YARDS.slice(0, 8)).verdict).toBe('name_unconfirmed'); // not this card's hole count
  });
  it('a rightly named card whose hole lengths are another course\'s is refused', () => {
    const elsewhere = YARDS.map((y, i) => (i < 5 ? y * 2 : y)); // 4 of 9 fit
    expect(v(read(), read(), null, elsewhere).verdict).toBe('yardage_disagrees');
    expect(v(read(), read(), null, YARDS.map((y, i) => (i < 4 ? y * 2 : y))).verdict).toBe('ok'); // 5 of 9: a named card survives a rough map
    expect([SITE_YARDS_TOLERANCE, SITE_YARDS_CONFIRM, SITE_YARDS_REFUSE]).toEqual([0.2, 0.8, 0.5]);
  });
  it('the fill\'s own rule still applies: the row\'s hole count and the map\'s tagged pars', () => {
    expect(v(read(), read(), null, null, { ...row, holes_count: 18 }).verdict).toBe('hole_count');
    const mapPars = PARS.map((par, i) => ({ number: i + 1, par: i < 3 ? (par === 3 ? 4 : 3) : par }));
    expect(v(read(), read(), mapPars).verdict).toBe('map_disagrees');
    expect(v(read(), read(), PARS.map((par, i) => ({ number: i + 1, par }))).verdict).toBe('ok');
  });
  it('a card in metres adds up in metres and is saved in yards', () => {
    const metres = { unit: 'metres' as const };
    const r = v(read(metres), read(metres));
    expect(r.verdict).toBe('ok');
    expect(r.card!.hole_data[0].yardage.blue).toBe(416); // 380 m
  });
  it('a printed stroke index is kept', () => {
    const h = { handicap: [9, 1, 17, 5, 7, 15, 3, 11, 13] };
    expect(v(read(h), read(h)).card!.hole_data[0].handicap).toBe(9);
  });
});

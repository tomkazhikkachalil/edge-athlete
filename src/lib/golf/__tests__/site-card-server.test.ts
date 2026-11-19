import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_COURSE_BUDGET_MS, SITE_FETCH_MIN_MS, SITE_MAX_FETCHES, SITE_TICK_BUDGET_MS, mapEvidence, siteHomeUrl, visitCourseSite, type SiteVisitRow } from '../site-card-server';
import { SITE_FETCH_TIMEOUT_MS } from '../site-fetch-server';

// Nov 18 2026: one course's website, visited. No network: the resolver, fetch
// and the PDF reader are injected.

const PUBLIC = async () => [{ address: '151.101.1.67' }];
const html = (body: string) => () => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const file = (type: string) => () => new Response(new Uint8Array(20), { status: 200, headers: { 'content-type': type } });

const PARS = ['4', '5', '3', '4', '4', '3', '5', '4', '4'];
const YARDS = ['380', '510', '160', '400', '390', '175', '530', '410', '365'];
const tr = (cells: string[]) => `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
const cardTable = (title = 'Scorecard') => `<title>${title}</title><table>${tr(['Hole', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Out'])}${tr(['Par', ...PARS, '36'])}${tr(['Blue', ...YARDS, '3320'])}</table>`;
const cardLines = [['Par', ...PARS, '36'], ['Blue', ...YARDS, '3320']];

const row: SiteVisitRow = { id: 'c1', name: 'Camelot Golf & Country Club', club_name: null, lat: 45.3, lng: -75.7, holes_count: null, website: 'https://www.camelot.com/' };
const none = { mapPars: null, mapYards: null, siteIsThisCourseAlone: false };
const alone = { ...none, siteIsThisCourseAlone: true };

function site(pages: Record<string, () => Response>, pdf: Record<string, string[][]> = {}) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string) => {
    asked.push(url);
    const answer = pages[url];
    if (!answer) return new Response('gone', { status: 404 });
    return answer();
  }) as unknown as typeof fetch;
  let pdfReads = 0;
  // The fake PDF reader answers by read order (the bytes are placeholders).
  const queue = Object.values(pdf);
  const pdfLines = async () => queue[pdfReads++] ?? [];
  return { deps: { fetchImpl, lookup: PUBLIC, pdfLines }, asked, pdfReads: () => pdfReads };
}

describe('siteHomeUrl', () => {
  it('a bare host gets https; what the fetcher may not ask for is no site', () => {
    expect(siteHomeUrl('www.club.com/golf')?.href).toBe('https://www.club.com/golf');
    expect(siteHomeUrl(' http://club.com ')?.href).toBe('http://club.com/');
    for (const bad of [null, '', '   ', 'http://127.0.0.1/', 'https://localhost', 'ftp://club.com', 'https://club.com:8080/']) expect(siteHomeUrl(bad), String(bad)).toBeNull();
  });
});

describe('visitCourseSite', () => {
  it('no website, or one the fetcher may not ask for: no_site, nothing fetched', async () => {
    const s = site({});
    expect(await visitCourseSite({ ...row, website: null }, none, s.deps)).toMatchObject({ outcome: 'no_site', fetches: 0 });
    expect(await visitCourseSite({ ...row, website: 'http://10.0.0.1/' }, none, s.deps)).toMatchObject({ outcome: 'no_site', fetches: 0 });
    expect(s.asked).toHaveLength(0);
  });

  it('the production case (Nov 19 2026): a website that is a directory listing is not visited at all', async () => {
    const page = `<title>Shawngunk Country Club</title>${cardTable('Shawngunk Country Club')}`;
    const s = site({ 'https://www.golflink.com/golf-courses/ny/ellenville/shawangunk-country-club': html(page) });
    const v = await visitCourseSite({ ...row, name: 'Shawngunk Country Club', website: 'https://www.golflink.com/golf-courses/ny/ellenville/shawangunk-country-club' }, alone, s.deps);
    expect(v).toEqual({ outcome: 'not_own_site', card: null, url: null, fetches: 0 });
    expect(s.asked).toHaveLength(0);
  });
  it('a host that does not carry the course\'s name is not visited either', async () => {
    const s = site({ 'https://www.someresort.com/': html(cardTable('Camelot Golf & Country Club')) });
    expect(await visitCourseSite({ ...row, website: 'https://www.someresort.com/' }, alone, s.deps)).toMatchObject({ outcome: 'not_own_site', fetches: 0 });
    expect(s.asked).toHaveLength(0);
  });

  it('robots.txt is read first and obeyed: a refused home page is not fetched', async () => {
    const s = site({ 'https://www.camelot.com/robots.txt': () => new Response('User-agent: *\nDisallow: /', { headers: { 'content-type': 'text/plain' } }), 'https://www.camelot.com/': html(cardTable()) });
    expect(await visitCourseSite(row, alone, s.deps)).toMatchObject({ outcome: 'robots', card: null });
    expect(s.asked).toEqual(['https://www.camelot.com/robots.txt']);
  });

  it('a dead home page is unreachable', async () => {
    expect(await visitCourseSite(row, alone, site({}).deps)).toMatchObject({ outcome: 'unreachable', fetches: 2 });
  });

  it('a card in the home page\'s own table, named in the title, is read and returned with where it was read', async () => {
    const s = site({ 'https://www.camelot.com/': html(cardTable('Scorecard | Camelot Golf & Country Club')) });
    const v = await visitCourseSite(row, none, s.deps);
    expect(v).toMatchObject({ outcome: 'ok', url: 'https://www.camelot.com/' });
    expect(v.card).toMatchObject({ total_par: 36, holes_count: 9 });
    expect(v.card!.hole_data[1]).toEqual({ number: 2, par: 5, yardage: { blue: 510 }, handicap: 0 });
  });

  it('a card with no name on it: saved only when the site is this course\'s alone', async () => {
    const pages = { 'https://www.camelot.com/': html('<a href="/golf/scorecard">Scorecard</a>'), 'https://www.camelot.com/golf/scorecard': html(cardTable()) };
    expect(await visitCourseSite(row, none, site(pages).deps)).toMatchObject({ outcome: 'name_unconfirmed', card: null });
    expect(await visitCourseSite(row, alone, site(pages).deps)).toMatchObject({ outcome: 'ok', url: 'https://www.camelot.com/golf/scorecard' });
  });

  it('follows a course page one level deeper to a scorecard PDF, and reads its text', async () => {
    const s = site({
      'https://www.camelot.com/': html('<a href="/the-course">The Course</a><a href="/contact">Contact</a>'),
      'https://www.camelot.com/the-course': html('<a href="https://cdn.files.com/Camelot-Scorecard.pdf">Download scorecard</a>'),
      'https://cdn.files.com/Camelot-Scorecard.pdf': file('application/pdf'),
    }, { a: cardLines });
    const v = await visitCourseSite(row, alone, s.deps);
    expect(v).toMatchObject({ outcome: 'ok', url: 'https://cdn.files.com/Camelot-Scorecard.pdf' });
    expect(s.asked).not.toContain('https://www.camelot.com/contact');
    expect(s.pdfReads()).toBe(1);
  });

  it('a scorecard that is a picture, or a PDF with no text, is not read: picture_only, and a picture is never downloaded', async () => {
    const s = site({ 'https://www.camelot.com/': html('<a href="/scorecard">Scorecard</a>'), 'https://www.camelot.com/scorecard': html('<img src="/img/scorecard-front.jpg" alt="scorecard">') });
    expect(await visitCourseSite(row, alone, s.deps)).toMatchObject({ outcome: 'picture_only', card: null });
    expect(s.asked.some(u => u.endsWith('.jpg'))).toBe(false);
    const scanned = site({ 'https://www.camelot.com/': html('<a href="/files/scorecard.pdf">Scorecard</a>'), 'https://www.camelot.com/files/scorecard.pdf': file('application/pdf') }, { a: [] });
    expect(await visitCourseSite(row, alone, scanned.deps)).toMatchObject({ outcome: 'picture_only' });
  });

  it('pages without any scorecard: no_card', async () => {
    const s = site({ 'https://www.camelot.com/': html('<a href="/golf">Golf</a>'), 'https://www.camelot.com/golf': html('<p>Eighteen holes of golf.</p>') });
    expect(await visitCourseSite(row, alone, s.deps)).toMatchObject({ outcome: 'no_card' });
  });

  it('two courses\' cards on one page: several_cards, even when the site is this course\'s alone', async () => {
    const other = ['5', '3', '4', '3', '4', '4', '4', '3', '5'];
    const two = `<table>${tr(['Par', ...PARS, '36', ...PARS, '36', '72'])}${tr(['Blue', ...YARDS, '3320', ...YARDS, '3320', '6640'])}${tr(['Par', ...other, '35', ...other, '35', '70'])}</table>`;
    expect(await visitCourseSite(row, alone, site({ 'https://www.camelot.com/': html(two) }).deps)).toMatchObject({ outcome: 'several_cards', card: null });
  });

  it('a card the checks refuse is reported by its refusal, and a later page may still give a good one', async () => {
    const bad = `<table>${tr(['Par', ...PARS, '37'])}${tr(['Blue', ...YARDS, '3320'])}</table>`;
    expect(await visitCourseSite(row, alone, site({ 'https://www.camelot.com/': html(bad) }).deps)).toMatchObject({ outcome: 'sum_mismatch' });
    const s = site({ 'https://www.camelot.com/': html(`${bad}<a href="/scorecard">Scorecard</a>`), 'https://www.camelot.com/scorecard': html(cardTable()) });
    expect(await visitCourseSite(row, alone, s.deps)).toMatchObject({ outcome: 'ok', url: 'https://www.camelot.com/scorecard' });
  });

  it('the map still decides: hole lengths of another course refuse a confirmed, self-consistent card', async () => {
    const elsewhere = YARDS.map((y, i) => (i < 5 ? Number(y) * 2 : Number(y)));
    const s = site({ 'https://www.camelot.com/': html(cardTable('Camelot Golf & Country Club')) });
    expect(await visitCourseSite(row, { mapPars: null, mapYards: elsewhere, siteIsThisCourseAlone: true }, s.deps)).toMatchObject({ outcome: 'yardage_disagrees' });
  });

  it('never more than the fetch limit, never a page of another site, and a path robots.txt refuses is skipped', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `<a href="/golf/page-${i}">Golf ${i}</a>`).join('');
    const pages: Record<string, () => Response> = {
      'https://www.camelot.com/robots.txt': () => new Response('User-agent: *\nDisallow: /golf/page-0', { headers: { 'content-type': 'text/plain' } }),
      'https://www.camelot.com/': html(`${many}<a href="https://other.com/scorecard">Scorecard</a>`),
    };
    for (let i = 0; i < 30; i++) pages[`https://www.camelot.com/golf/page-${i}`] = html('<p>golf</p>');
    const s = site(pages);
    const v = await visitCourseSite(row, alone, s.deps);
    expect(v.outcome).toBe('no_card');
    expect(v.fetches).toBe(SITE_MAX_FETCHES);
    expect(s.asked).toHaveLength(SITE_MAX_FETCHES);
    expect(s.asked.some(u => u.includes('other.com') || u.endsWith('/golf/page-0'))).toBe(false);
  });

  it('stops fetching when the course\'s time is nearly spent', async () => {
    let t = 0;
    const s = site({ 'https://www.camelot.com/': html('<a href="/golf">Golf</a><a href="/course">Course</a>'), 'https://www.camelot.com/golf': html('x'), 'https://www.camelot.com/course': html('x') });
    // Each look at the clock moves it on 15 s: robots and the home page fit, little else does.
    const v = await visitCourseSite(row, alone, { ...s.deps, now: () => (t += 15_000) });
    expect(v.fetches).toBeLessThan(4);
    expect(v.outcome).toBe('no_card');
  });
});

describe('mapEvidence', () => {
  const line = (i: number, span: number) => [[45.3 + i * 0.01, -75.7], [45.3 + i * 0.01 + span, -75.7]] as [number, number][];
  it('tagged pars are evidence; estimated ones never are; the measured lengths are evidence either way', () => {
    const tagged = { holes: Array.from({ length: 9 }, (_, i) => ({ hole: i + 1, par: 4, line: line(i, 0.003) })) };
    expect(mapEvidence(tagged).mapPars).toHaveLength(9);
    expect(mapEvidence(tagged).mapYards).toHaveLength(9);
    const bare = { holes: tagged.holes.map(h => ({ hole: h.hole, line: h.line })) };
    expect(mapEvidence(bare).mapPars).toBeNull();
    expect(mapEvidence(bare).mapYards).toHaveLength(9);
    expect(mapEvidence(bare).mapYards![0]).toBeGreaterThan(300);
    expect(mapEvidence(null)).toEqual({ mapPars: null, mapYards: null });
    expect(mapEvidence({ holes: tagged.holes.slice(0, 5) })).toEqual({ mapPars: null, mapYards: null });
  });
});

describe('the reader\'s clock', () => {
  const routeSrc = fs.readFileSync(path.join(__dirname, '../../../app/api/cron/golf-site-cards/route.ts'), 'utf8');
  const maxDuration = Number(/export const maxDuration = (\d+);/.exec(routeSrc)?.[1]);
  it('the route outlives the tick, the tick holds two courses, a course holds a few fetches', () => {
    expect(maxDuration * 1000).toBeGreaterThan(SITE_TICK_BUDGET_MS + SITE_FETCH_TIMEOUT_MS);
    expect(SITE_TICK_BUDGET_MS).toBeGreaterThanOrEqual(2 * SITE_COURSE_BUDGET_MS);
    expect(SITE_COURSE_BUDGET_MS).toBeGreaterThan(2 * SITE_FETCH_TIMEOUT_MS);
    expect(SITE_FETCH_MIN_MS).toBeLessThan(SITE_FETCH_TIMEOUT_MS);
    expect(routeSrc).toContain("runSiteCardBatch(admin, { rows: 2, dryRun: false })");
    expect(routeSrc).toContain('CRON_SECRET');
  });
});

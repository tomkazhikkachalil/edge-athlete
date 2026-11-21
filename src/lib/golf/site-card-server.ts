// ── The scorecard reader's visits and writes (Nov 18 2026) ──────────────────
// One course at a time: its own website, at most a handful of polite fetches,
// a text scorecard read by rule (site-card-parse.ts; no model: Tom ruled out
// AI in the app), and a card saved only when every check in site-card.ts
// passes. A card published as a picture is not read. Every visit is stamped
// with what it came to, so a course is asked once a season, not every day.

import type { SupabaseClient } from '@supabase/supabase-js';
import { consumeProviderBudget, readSheetSources } from '@/lib/golf/course-catalog';
import { polylineYards } from '@/lib/golf/hole-geometry';
import { recordParEvidence, settleAfterEvidence } from '@/lib/golf/par-evidence-server';
import { sheetFromGeometry, type MapSheetLine } from '@/lib/golf/map-sheet';
import { creditSources, mergeSheets, type Sheet } from '@/lib/golf/sheet-merge';
import { isFetchableUrl, isOwnSiteHost, parseSiteRead, robotsAllows, scorecardLinks, siteCardVerdict, type SiteCard, type SiteCardVerdict } from '@/lib/golf/site-card';
import { htmlTableLines, nameInText, parseCardLines } from '@/lib/golf/site-card-parse';
import { SITE_FILE_MAX_BYTES, SITE_PAGE_MAX_BYTES, siteFetch, type SiteFetchDeps, type SiteFetchResult } from '@/lib/golf/site-fetch-server';
import { pdfTextLines } from '@/lib/golf/site-text-server';

/** Fetches for one course, robots.txt included. */
export const SITE_MAX_FETCHES = 9;
/** One course's visit ends by this, whatever is still unread. */
export const SITE_COURSE_BUDGET_MS = 40_000;
/** A fetch is not started with less than this left. */
export const SITE_FETCH_MIN_MS = 3_000;
/** The tick's whole budget; a course is not started without one course's time left. */
export const SITE_TICK_BUDGET_MS = 90_000;
/** A visited course is visited again after this long (sites change slowly). */
export const SITE_REVISIT_DAYS = 90;
/** Due rows read per visit wanted: rows that are not visited are stamped on the way. */
export const SITE_DUE_FACTOR = 5;
const BUDGET_KEY = 'site-card';

export type SiteOutcome =
  | SiteCardVerdict
  /** No website the fetcher may ask for. */
  | 'no_site'
  /** The address is not the course's own site (a directory, a social page, or
   *  a host that does not carry its name): never visited. */
  | 'not_own_site'
  /** The site's robots.txt does not allow its home page. */
  | 'robots'
  /** The home page did not answer (dead link, blocked, error). */
  | 'unreachable'
  /** Pages were read and none carries a scorecard in text. */
  | 'no_card'
  /** A scorecard is linked, as a picture or a PDF without text: not read. */
  | 'picture_only'
  /** The text holds more than one course's card. */
  | 'several_cards'
  /** A pick saved a card while the visit ran. */
  | 'taken';

export interface SiteVisitRow {
  id: string;
  name: string;
  club_name: string | null;
  lat: number | null;
  lng: number | null;
  holes_count: number | null;
  website: string | null;
}

export interface SiteVisit {
  outcome: SiteOutcome;
  card: SiteCard | null;
  /** Where the saved card was read. */
  url: string | null;
  fetches: number;
}

export interface SiteVisitDeps extends SiteFetchDeps {
  pdfLines?: (bytes: Uint8Array) => Promise<string[][]>;
  now?: () => number;
}

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, '');

/** The website as a URL the fetcher may ask for, or null. */
export function siteHomeUrl(website: string | null | undefined): URL | null {
  const raw = (website ?? '').trim();
  if (!raw) return null;
  const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (!isFetchableUrl(href)) return null;
  try { return new URL(href); } catch { return null; }
}

/** Visit one course's website and read its scorecard, if it publishes one as
 *  text. Reads only: nothing is written here. `siteIsThisCourseAlone`: no other
 *  catalog course shares the site, so a card with no printed name is this
 *  course's (two courses' cards on one sheet are refused before that matters). */
export async function visitCourseSite(
  row: SiteVisitRow,
  evidence: { mapPars: ReadonlyArray<{ number: number; par: number }> | null; mapYards: ReadonlyArray<number> | null; siteIsThisCourseAlone: boolean },
  deps: SiteVisitDeps = {}
): Promise<SiteVisit> {
  const now = deps.now ?? Date.now;
  const pdfLines = deps.pdfLines ?? pdfTextLines;
  const deadline = now() + SITE_COURSE_BUDGET_MS;
  let fetches = 0;
  const done = (outcome: SiteOutcome, card: SiteCard | null = null, url: string | null = null): SiteVisit => ({ outcome, card, url, fetches });

  const home = siteHomeUrl(row.website);
  if (!home) return done('no_site');
  if (!isOwnSiteHost(home.hostname, [row.name, row.club_name])) return done('not_own_site');
  const sameSite = (u: URL) => bareHost(u.hostname) === bareHost(home.hostname);

  const get = async (url: string, maxBytes: number): Promise<SiteFetchResult | null> => {
    const left = deadline - now();
    if (fetches >= SITE_MAX_FETCHES || left < SITE_FETCH_MIN_MS) return null;
    fetches++;
    return siteFetch(url, { maxBytes, timeoutMs: Math.min(left, 12_000) }, deps);
  };

  const robotsAnswer = await get(`${home.origin}/robots.txt`, 200_000);
  const robots = robotsAnswer?.ok && robotsAnswer.type.startsWith('text/plain') ? new TextDecoder().decode(robotsAnswer.body) : '';
  const allowed = (u: URL) => !sameSite(u) || robotsAllows(robots, `${u.pathname}${u.search}`);
  if (!allowed(home)) return done('robots');

  // What was seen on the way, for the outcome when no card is saved.
  let refusal: SiteCardVerdict | null = null;
  let several = false;
  let unread = false; // a scorecard that is a picture, or a PDF without text

  const tryLines = (lines: string[][], title: string, url: string): SiteVisit | null => {
    const parsed = parseCardLines(lines);
    if (!parsed.ok) { if (parsed.why === 'several_cards') several = true; return null; }
    const named = nameInText(lines, title, [row.name, row.club_name]);
    const read = parseSiteRead({ ...parsed.raw, printedName: named ? row.name : null });
    const { verdict, card } = siteCardVerdict(row, read, null, evidence.mapPars, evidence.mapYards, { singleReading: true, nameConfirmed: evidence.siteIsThisCourseAlone });
    if (verdict === 'ok' && card) return done('ok', card, url);
    refusal ??= verdict;
    return null;
  };

  const homePage = await get(home.href, SITE_PAGE_MAX_BYTES);
  if (!homePage || !homePage.ok) return done('unreachable');
  if (!homePage.type.includes('html')) return done('no_card');
  const homeHtml = new TextDecoder().decode(homePage.body);
  const homeTable = htmlTableLines(homeHtml);
  const first = tryLines(homeTable.lines, homeTable.title, homePage.url);
  if (first) return first;

  const seen = new Set<string>([home.href, homePage.url]);
  const isPicture = (url: string) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
  const isPdf = (url: string) => /\.pdf(\?|$)/i.test(url);

  /** Read one linked file or page; returns a saved-card visit, the page's own
   *  links (for one level deeper), or nothing. */
  const follow = async (url: string, strong: boolean): Promise<{ visit?: SiteVisit; html?: string; pageUrl?: string }> => {
    if (seen.has(url)) return {};
    seen.add(url);
    let u: URL;
    try { u = new URL(url); } catch { return {}; }
    if (!allowed(u)) return {};
    if (isPicture(url)) { if (strong) unread = true; return {}; }
    const answer = await get(url, isPdf(url) ? SITE_FILE_MAX_BYTES : SITE_PAGE_MAX_BYTES);
    if (!answer || !answer.ok) return {};
    if (answer.type === 'application/pdf') {
      const lines = await pdfLines(answer.body);
      if (lines.length === 0) { if (strong) unread = true; return {}; }
      const visit = tryLines(lines, '', answer.url);
      return visit ? { visit } : {};
    }
    if (answer.type.startsWith('image/')) { if (strong) unread = true; return {}; }
    if (!answer.type.includes('html')) return {};
    const html = new TextDecoder().decode(answer.body);
    const table = htmlTableLines(html);
    const visit = tryLines(table.lines, table.title, answer.url);
    return visit ? { visit } : { html, pageUrl: answer.url };
  };

  for (const link of scorecardLinks(homeHtml, homePage.url, sameSite)) {
    const got = await follow(link.url, link.kind === 'strong');
    if (got.visit) return got.visit;
    if (!got.html || !got.pageUrl) continue;
    // One level deeper, and only what names a scorecard.
    for (const deeper of scorecardLinks(got.html, got.pageUrl, sameSite).filter(l => l.kind === 'strong')) {
      const inner = await follow(deeper.url, true);
      if (inner.visit) return inner.visit;
    }
  }
  if (refusal) return done(refusal);
  if (several) return done('several_cards');
  return done(unread ? 'picture_only' : 'no_card');
}

// ── The batch ────────────────────────────────────────────────────────────────

type DueRow = SiteVisitRow & Sheet & { hole_geometry: { holes?: MapSheetLine[] } | null };

export interface SiteCardSummary {
  ok: boolean;
  phase: 'site-cards';
  dryRun: boolean;
  due: number;
  outcomes: Record<string, number>;
  saved: Array<{ id: string; name: string; url: string | null }>;
  budgetExhausted: boolean;
  elapsedMs: number;
  error?: string;
}

const measure = (line: ReadonlyArray<readonly [number, number]>) => polylineYards(line as [number, number][]) ?? 0;

/** What the map can say about a course: its TAGGED pars (an estimate is never
 *  evidence) and the measured length of every hole line. */
export function mapEvidence(geometry: { holes?: MapSheetLine[] } | null | undefined) {
  const tagged = sheetFromGeometry(geometry?.holes, measure);
  const measured = tagged ?? sheetFromGeometry(geometry?.holes, measure, { estimate: true });
  return {
    mapPars: tagged ? tagged.map(h => ({ number: h.number, par: h.par })) : null,
    mapYards: measured ? measured.map(h => h.yardage.map) : null,
  };
}

/** Does any OTHER catalog course keep its website on this host? */
async function hostIsShared(admin: SupabaseClient, row: SiteVisitRow, host: string): Promise<boolean> {
  // hardening-ok: likeSafe — the host is a parsed hostname (letters, digits, dots, hyphens); % and _ are escaped all the same.
  const pattern = `%${host.replace(/[\\%_]/g, m => `\\${m}`)}%`;
  const { data, error } = await admin.from('golf_courses').select('id, website').ilike('website', pattern).neq('id', row.id).limit(50);
  if (error) return true; // cannot tell: treat the site as shared
  return (data ?? []).some(r => {
    const other = siteHomeUrl((r as { website: string | null }).website);
    return !!other && bareHost(other.hostname) === host;
  });
}

/** Visit up to `rows` due courses. Migration 315 must have run. */
export async function runSiteCardBatch(
  admin: SupabaseClient,
  opts: { rows: number; dryRun: boolean; courseId?: string; deadlineMs?: number },
  deps: SiteVisitDeps = {}
): Promise<SiteCardSummary> {
  const t0 = Date.now();
  const deadline = t0 + (opts.deadlineMs ?? SITE_TICK_BUDGET_MS);
  const summary: SiteCardSummary = { ok: true, phase: 'site-cards', dryRun: opts.dryRun, due: 0, outcomes: {}, saved: [], budgetExhausted: false, elapsedMs: 0 };
  const finish = () => { summary.elapsedMs = Date.now() - t0; return summary; };

  let ids: string[];
  if (opts.courseId) ids = [opts.courseId];
  else {
    // More than will be visited: a row whose address is not its own site is stamped without a visit.
    const due = await admin.rpc('golf_site_card_due', { p_limit: Math.max(1, Math.min(opts.rows * SITE_DUE_FACTOR, 20)) });
    if (due.error) { summary.ok = false; summary.error = /golf_site_card_due|PGRST202|42883/.test(`${due.error.code} ${due.error.message}`) ? 'migration 315 has not run' : due.error.message; return finish(); }
    ids = ((due.data ?? []) as Array<{ id: string }>).map(r => r.id);
  }
  summary.due = ids.length;
  if (ids.length === 0) return finish();
  const { data, error } = await admin
    .from('golf_courses')
    .select('id, name, club_name, lat, lng, holes_count, website, total_par, hole_data, course_rating, slope_rating, hole_geometry')
    .in('id', ids);
  if (error) { summary.ok = false; summary.error = error.message; return finish(); }
  const byId = new Map(((data ?? []) as unknown as DueRow[]).map(r => [r.id, r]));

  let visits = 0;
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const home = siteHomeUrl(row.website);
    const visitable = !!home && isOwnSiteHost(home.hostname, [row.name, row.club_name]);
    if (visitable) {
      if (visits >= opts.rows) break;
      if (Date.now() > deadline - SITE_COURSE_BUDGET_MS) break;
      if (!opts.dryRun && !(await consumeProviderBudget(admin, BUDGET_KEY))) { summary.budgetExhausted = true; break; }
      visits++;
    }
    const alone = visitable ? !(await hostIsShared(admin, row, bareHost(home!.hostname))) : false;
    const visit = await visitCourseSite(row, { ...mapEvidence(row.hole_geometry), siteIsThisCourseAlone: alone }, deps);
    let outcome: SiteOutcome = visit.outcome;
    if (!opts.dryRun) outcome = await saveVisit(admin, row, visit);
    summary.outcomes[outcome] = (summary.outcomes[outcome] ?? 0) + 1;
    if (outcome === 'ok') summary.saved.push({ id: row.id, name: row.name, url: visit.url });
  }
  return finish();
}

/** The visit, written: the card when there is one, the stamp either way. */
async function saveVisit(admin: SupabaseClient, row: DueRow, visit: SiteVisit): Promise<SiteOutcome> {
  const stamp = { site_card_at: new Date().toISOString() };
  if (visit.outcome !== 'ok' || !visit.card) {
    const { error } = await admin.from('golf_courses').update({ ...stamp, site_card_outcome: visit.outcome }).eq('id', row.id);
    if (error) throw new Error(`site card stamp failed for ${row.id}: ${error.message}`);
    return visit.outcome;
  }
  const before: Sheet = { total_par: row.total_par, holes_count: row.holes_count, hole_data: row.hole_data, course_rating: row.course_rating, slope_rating: row.slope_rating };
  const merged = mergeSheets(before, visit.card);
  const credits = await readSheetSources(admin, row.id);
  // `hole_data IS NULL` again in the write: a pick may have saved a card meanwhile.
  const { data, error } = await admin
    .from('golf_courses')
    .update({
      ...merged.sheet,
      ...(credits === undefined ? {} : { sheet_sources: creditSources(credits, before, merged.sheet, 'website') }),
      ...stamp,
      site_card_outcome: 'ok',
      site_card_url: visit.url,
    })
    .eq('id', row.id)
    .is('hole_data', null)
    .select('id');
  if (error) throw new Error(`site card write failed for ${row.id}: ${error.message}`);
  if ((data ?? []).length) return 'ok';
  await admin.from('golf_courses').update({ ...stamp, site_card_outcome: 'taken' }).eq('id', row.id);
  return 'taken';
}

// ── The website as a confirmation of a saved card's pars (Nov 20 2026; 318) ──
// A hole whose tees disagree on par is decided by logic (par-evidence.ts); the
// club's own published card is the strongest confirmation there is, and the
// reader above never visits a course that already has a card. This visit
// does: the same site, the same fetcher, robots rule, own-site check and
// parser, and the card's own arithmetic. Two differences. It does NOT require
// the card to agree with the map's par tags (the map is a separate, weaker
// vote there), and it never writes the card: it keeps one `website` row in
// golf_par_evidence and lets the judgement decide.

export type SiteEvidenceOutcome = SiteOutcome | 'other_card' | 'not_kept';

export interface SiteEvidenceSummary {
  ok: boolean;
  phase: 'site-evidence';
  dryRun: boolean;
  due: number;
  /** Sites actually visited (a row stamped without a visit is not one). */
  visits: number;
  outcomes: Record<string, number>;
  kept: Array<{ id: string; name: string; url: string | null }>;
  budgetExhausted: boolean;
  elapsedMs: number;
  error?: string;
}

/** Visit up to `rows` carded courses' own websites for their pars. Migration 318 must have run. */
export async function runSiteEvidenceBatch(
  admin: SupabaseClient,
  opts: { rows: number; dryRun: boolean; courseId?: string; deadlineMs?: number },
  deps: SiteVisitDeps = {}
): Promise<SiteEvidenceSummary> {
  const t0 = Date.now();
  const deadline = t0 + (opts.deadlineMs ?? SITE_TICK_BUDGET_MS);
  const summary: SiteEvidenceSummary = { ok: true, phase: 'site-evidence', dryRun: opts.dryRun, due: 0, visits: 0, outcomes: {}, kept: [], budgetExhausted: false, elapsedMs: 0 };
  const finish = () => { summary.elapsedMs = Date.now() - t0; return summary; };
  if (opts.rows < 1) return finish();

  let ids: string[];
  if (opts.courseId) ids = [opts.courseId];
  else {
    const due = await admin.rpc('golf_site_evidence_due', { p_limit: Math.max(1, Math.min(opts.rows * SITE_DUE_FACTOR, 20)) });
    if (due.error) { summary.ok = false; summary.error = /golf_site_evidence_due|PGRST202|42883/.test(`${due.error.code} ${due.error.message}`) ? 'migration 318 has not run' : due.error.message; return finish(); }
    ids = ((due.data ?? []) as Array<{ id: string }>).map(r => r.id);
  }
  summary.due = ids.length;
  if (ids.length === 0) return finish();
  const { data, error } = await admin
    .from('golf_courses')
    .select('id, name, club_name, lat, lng, holes_count, website, total_par, hole_data, course_rating, slope_rating, hole_geometry')
    .in('id', ids);
  if (error) { summary.ok = false; summary.error = error.message; return finish(); }
  const byId = new Map(((data ?? []) as unknown as DueRow[]).map(r => [r.id, r]));

  for (const id of ids) {
    const row = byId.get(id);
    if (!row || !row.hole_data?.length) continue;
    const home = siteHomeUrl(row.website);
    const visitable = !!home && isOwnSiteHost(home.hostname, [row.name, row.club_name]);
    if (visitable) {
      if (summary.visits >= opts.rows) break;
      if (Date.now() > deadline - SITE_COURSE_BUDGET_MS) break;
      if (!opts.dryRun && !(await consumeProviderBudget(admin, BUDGET_KEY))) { summary.budgetExhausted = true; break; }
      summary.visits++;
    }
    const alone = visitable ? !(await hostIsShared(admin, row, bareHost(home!.hostname))) : false;
    // No map pars: the card is not held to the map's tags here. The map's
    // hole LENGTHS still say whose card it is when no name is printed.
    const visit = await visitCourseSite(row, { mapPars: null, mapYards: mapEvidence(row.hole_geometry).mapYards, siteIsThisCourseAlone: alone }, deps);
    let outcome: SiteEvidenceOutcome = visit.outcome;
    // The card read must be THIS card's shape: a nine is not an eighteen's front.
    if (outcome === 'ok' && visit.card && visit.card.hole_data.length !== row.hole_data.length) outcome = 'other_card';
    if (!opts.dryRun) {
      if (outcome === 'ok' && visit.card) {
        const kept = await recordParEvidence(admin, row.id, [{ source: 'website', label: '', votes: false, pars: visit.card.hole_data.map(h => h.par) }]);
        if (kept) await settleAfterEvidence(admin, row.id);
        else outcome = 'not_kept';
      }
      const stamped = await admin.from('golf_courses').update({ site_evidence_at: new Date().toISOString(), site_evidence_outcome: outcome }).eq('id', row.id);
      if (stamped.error) throw new Error(`site evidence stamp failed for ${row.id}: ${stamped.error.message}`);
    }
    summary.outcomes[outcome] = (summary.outcomes[outcome] ?? 0) + 1;
    if (outcome === 'ok') summary.kept.push({ id: row.id, name: row.name, url: visit.url });
  }
  return finish();
}

// ── Progress ──────────────────────────────────────────────────────────────────

/** Every outcome a visit can be stamped with (the panel's rows, in this order). */
export const SITE_OUTCOMES: SiteOutcome[] = [
  'ok', 'no_card', 'picture_only', 'unreachable', 'robots', 'no_site', 'not_own_site', 'several_cards', 'name_unconfirmed', 'name_mismatch', 'sum_mismatch',
  'yardage_disagrees', 'map_disagrees', 'hole_count', 'par_sum', 'no_yardage', 'moved', 'taken', 'no_site_card', 'reads_disagree',
];

export type SiteCardProgress =
  | { ok: true; waiting: number; visited: number; outcomes: Record<string, number>; saved: Array<{ id: string; name: string; url: string | null; at: string | null }> }
  | { ok: false; error: string };

export async function readSiteCardProgress(admin: SupabaseClient): Promise<SiteCardProgress> {
  const count = (q: PromiseLike<{ count: number | null; error: { code?: string; message: string } | null }>) => q;
  const head = () => admin.from('golf_courses').select('id', { count: 'exact', head: true });
  const [waiting, visited, saved, ...byOutcome] = await Promise.all([
    count(head().not('website', 'is', null).is('hole_data', null).is('site_card_at', null)),
    count(head().not('site_card_at', 'is', null)),
    admin.from('golf_courses').select('id, name, site_card_url, site_card_at').eq('site_card_outcome', 'ok').order('site_card_at', { ascending: false }).limit(20),
    ...SITE_OUTCOMES.map(o => count(head().eq('site_card_outcome', o))),
  ]);
  const failed = [waiting, visited, saved, ...byOutcome].find(r => r.error);
  if (failed?.error) {
    const missing = failed.error.code === '42703' || failed.error.code === 'PGRST204' || /site_card_/.test(failed.error.message);
    return { ok: false, error: missing ? 'migration 315 has not run' : failed.error.message };
  }
  const outcomes: Record<string, number> = {};
  SITE_OUTCOMES.forEach((o, i) => { const n = byOutcome[i].count ?? 0; if (n > 0) outcomes[o] = n; });
  return {
    ok: true,
    waiting: waiting.count ?? 0,
    visited: visited.count ?? 0,
    outcomes,
    saved: ((saved.data ?? []) as Array<{ id: string; name: string; site_card_url: string | null; site_card_at: string | null }>).map(r => ({ id: r.id, name: r.name, url: r.site_card_url, at: r.site_card_at })),
  };
}

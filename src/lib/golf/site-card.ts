// ── A scorecard read from the course's OWN website — the rules (Nov 18 2026) ─
// Tom: build our own scorecard database from the web, from each course's own
// site only (never a directory site: their terms forbid copying), "production
// ready and hardened so it's accurate". Pars, yardages and ratings are facts a
// course publishes about itself; most publish them as a picture or a PDF, so a
// model reads them, and a model can misread. Everything here is therefore a
// check of the reading against something it did not come from:
//   robotsAllows      the site's robots.txt is obeyed
//   isPublicAddress   the fetcher never leaves the public internet
//   scorecardLinks    which of a page's links may lead to the card
//   parseSiteRead     the model's answer is numbers in a fixed shape, or nothing
//   siteCardVerdict   two independent readings agree, the card's own printed
//                     totals add up, the name on it is this course's, and it
//                     agrees with our row and the map
// A wrong card is worse than none: every doubt is a refusal, stamped with why.
//
// Measured that day on 150 course sites (100 with a card we already hold): a
// card was found on 36; of the 30 with a known card, 27 read hole for hole the
// same, one more was the site being right where the held card is not, one was
// the sister course on the same site (the name check), one too small to read
// (refused). Of 80 tee rows whose total matched a held tee, all 1,413 hole
// yardages were identical.

import { cardFillVerdict, type CardFillVerdict } from '@/lib/golf/card-fill';
import { sameFacilityName } from '@/lib/golf/course-catalog';

// ── robots.txt ───────────────────────────────────────────────────────────────

/** May `path` (with its query) be fetched under the rules for every crawler
 *  ("User-agent: *")? `*` and a trailing `$` are honoured; the longest matching
 *  rule wins and Allow wins a tie (RFC 9309). No file, or no rule: allowed. */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  let ours = false;
  let inAgents = false;
  const rules: Array<{ allow: boolean; pattern: string }> = [];
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(raw.replace(/#.*/, '').trim());
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!inAgents) ours = false; // a new group begins
      inAgents = true;
      if (value === '*') ours = true;
      continue;
    }
    inAgents = false;
    if (ours && (key === 'allow' || key === 'disallow') && value) rules.push({ allow: key === 'allow', pattern: value });
  }
  let best: { allow: boolean; pattern: string } | null = null;
  for (const rule of rules) {
    const anchored = rule.pattern.endsWith('$');
    const body = (anchored ? rule.pattern.slice(0, -1) : rule.pattern)
      .split('*')
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    if (!new RegExp(`^${body}${anchored ? '$' : ''}`).test(path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return !best || best.allow;
}

// ── Where the fetcher may go ─────────────────────────────────────────────────

/** Is this resolved address on the public internet? Loopback, private,
 *  link-local (the cloud metadata address is one), carrier NAT, multicast,
 *  reserved and unspecified ranges are refused, for IPv4, IPv6 and an IPv4
 *  address written inside an IPv6 one. Anything unparseable is refused. */
export function isPublicAddress(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some(n => n > 255)) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier NAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false; // private; 192.0.0/24 and 192.0.2/24
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false; // benchmarking; documentation
    if (a === 203 && b === 0) return false; // documentation
    return true;
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!/^[0-9a-f:.]+$/.test(v6) || !v6.includes(':')) return false;
  const mapped = /^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v6);
  if (mapped) return isPublicAddress(mapped[1]);
  if (v6 === '::' || v6 === '::1') return false;
  if (/^::ffff:/.test(v6)) return false; // a mapped address in hex form: refused rather than decoded
  if (/^f[cd]/.test(v6)) return false; // unique local
  if (/^fe[89ab]/.test(v6)) return false; // link-local
  if (/^ff/.test(v6)) return false; // multicast
  if (/^2001:db8:/.test(v6)) return false; // documentation
  return true;
}

/** A URL the fetcher may ask for at all: http(s), a host name (never a bare
 *  address, never a single-label or internal name), the default port, no
 *  credentials. The addresses it resolves to are checked separately. */
export function isFetchableUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.')) return false;
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
  if (/\.(local|localhost|internal|lan|home|corp|test|invalid|example)$/.test(host)) return false;
  return true;
}

// ── Which links may lead to the card ─────────────────────────────────────────

const STRONG = /score\s*-?\s*card|carte\s+de\s+pointage|yardage/i;
const WEAK = /course\s+(layout|tour|guide|details|info|map|overview)|hole\s*-?\s*by\s*-?\s*hole|the\s+course|\bcourses?\b|\bgolf\b|parcours|\bholes\b/i;
const FILE = /\.(pdf|png|jpe?g|webp)(\?|$)/i;

export interface SiteLink {
  url: string;
  /** 'strong' names a scorecard; 'weak' is a page that may hold one. */
  kind: 'strong' | 'weak';
  /** A PDF or picture by its address. */
  file: boolean;
}

const decoded = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** The links and pictures of a page that may lead to the scorecard, strong
 *  ones first, each address once. Pages are followed on the SAME site only; a
 *  PDF or picture may sit on another host (a CDN) but only when the link names
 *  a scorecard. `sameSite` decides what the same site is. */
export function scorecardLinks(html: string, pageUrl: string, sameSite: (url: URL) => boolean): SiteLink[] {
  const found = new Map<string, SiteLink>();
  const consider = (href: string, text: string) => {
    let u: URL;
    try { u = new URL(href, pageUrl); } catch { return; }
    u.hash = '';
    if (!isFetchableUrl(u.href)) return;
    const words = `${text} ${decoded(u.pathname)}`;
    const kind = STRONG.test(words) ? 'strong' : WEAK.test(words) ? 'weak' : null;
    if (!kind) return;
    const file = FILE.test(u.pathname);
    if (!sameSite(u) && !(file && kind === 'strong')) return;
    if (file && kind !== 'strong') return;
    const had = found.get(u.href);
    if (!had || (had.kind === 'weak' && kind === 'strong')) found.set(u.href, { url: u.href, kind, file });
  };
  const anchors = /<a\b[^>]*\bhref\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
  for (let m = anchors.exec(html); m; m = anchors.exec(html)) consider(m[1], m[2].replace(/<[^>]+>/g, ' '));
  const images = /<img\b[^>]*>/gi;
  for (let m = images.exec(html); m; m = images.exec(html)) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    if (src) consider(src, /\balt\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] ?? '');
  }
  return [...found.values()].sort((a, b) => Number(b.kind === 'strong') - Number(a.kind === 'strong'));
}

// ── The model's answer ───────────────────────────────────────────────────────

export interface SiteTee {
  /** The tee's name as a key: lower case, letters, digits and spaces. */
  name: string;
  yards: number[];
  /** The total PRINTED on the card for this row, in the card's own unit. */
  printedTotal: number | null;
  rating: number | null;
  slope: number | null;
}

export interface SiteRead {
  /** The course name printed on the card or its page, or null when none is. */
  printedName: string | null;
  pars: number[];
  /** The par total printed on the card. */
  printedPar: number | null;
  unit: 'yards' | 'metres';
  tees: SiteTee[];
  /** Men's stroke index per hole, or null when the card prints none. */
  handicap: number[] | null;
}

const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const teeKey = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const key = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 24);
  return key || null;
};

/** The model's JSON, held to the shape: numbers in range and short plain
 *  names, nothing else kept. Null when it says it found no card for this
 *  course, or when anything it must contain is missing or out of range. A tee
 *  row that is not whole is dropped; the pars are never repaired. */
export function parseSiteRead(raw: unknown): SiteRead | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.found !== true || !Array.isArray(o.pars)) return null;
  const n = o.pars.length;
  if (n !== 9 && n !== 18) return null;
  const pars = o.pars.map(p => int(p, 3, 6));
  if (pars.some(p => p == null)) return null;
  const tees: SiteTee[] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(o.tees) ? o.tees.slice(0, 12) : []) {
    if (!t || typeof t !== 'object') continue;
    const row = t as Record<string, unknown>;
    const name = teeKey(row.name);
    if (!name || seen.has(name) || !Array.isArray(row.yards) || row.yards.length !== n) continue;
    const yards = row.yards.map(y => int(y, 40, 800));
    if (yards.some(y => y == null)) continue;
    seen.add(name);
    tees.push({
      name,
      yards: yards as number[],
      printedTotal: int(row.printedTotal, 400, 9000),
      rating: typeof row.rating === 'number' && row.rating >= 25 && row.rating <= 85 ? Math.round(row.rating * 10) / 10 : null,
      slope: int(row.slope, 55, 155),
    });
  }
  let handicap: number[] | null = null;
  if (Array.isArray(o.handicap) && o.handicap.length === n) {
    const h = o.handicap.map(v => int(v, 1, 18));
    if (h.every(v => v != null) && new Set(h).size === n) handicap = h as number[];
  }
  const printedName = typeof o.printedName === 'string' ? o.printedName.replace(/[^\p{L}\p{N} &'().,-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || null : null;
  return { printedName, pars: pars as number[], printedPar: int(o.printedPar, 27, 80), unit: o.unit === 'metres' ? 'metres' : 'yards', tees, handicap };
}

// ── The verdict ──────────────────────────────────────────────────────────────

export type SiteCardVerdict =
  | CardFillVerdict
  /** A reading found no card for this course. */
  | 'no_site_card'
  /** The two readings differ on a par, a tee or a yardage. */
  | 'reads_disagree'
  /** The pars do not add up to the printed par, or no tee row adds up to its printed total. */
  | 'sum_mismatch'
  /** The card names another course. */
  | 'name_mismatch'
  /** The card names no course and nothing independent says it is this one. */
  | 'name_unconfirmed'
  /** The hole lengths are not this course's map. */
  | 'yardage_disagrees';

/** A hole agrees with the map when its longest tee is within this share of the
 *  measured line (a line runs back tee to green centre, with mapping slack). */
export const SITE_YARDS_TOLERANCE = 0.2;
/** A card with no printed name needs this share of its holes agreeing with the map. */
export const SITE_YARDS_CONFIRM = 0.8;
/** Under this share the card is some other course's. */
export const SITE_YARDS_REFUSE = 0.5;
const YARDS_PER_METRE = 1.0936133;

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

/** Do two readings say the same card? Pars, tee names, every yardage, the
 *  printed totals and the unit. (Names of the course may differ in spelling.) */
export function siteReadsAgree(a: SiteRead, b: SiteRead): boolean {
  if (a.unit !== b.unit || a.printedPar !== b.printedPar) return false;
  if (a.pars.length !== b.pars.length || a.pars.some((p, i) => p !== b.pars[i])) return false;
  if (a.tees.length !== b.tees.length) return false;
  const other = new Map(b.tees.map(t => [t.name, t]));
  return a.tees.every(t => {
    const o = other.get(t.name);
    return !!o && o.printedTotal === t.printedTotal && t.yards.every((y, i) => y === o.yards[i]);
  });
}

export interface SiteCard {
  total_par: number;
  holes_count: number;
  hole_data: Array<{ number: number; par: number; yardage: Record<string, number>; handicap: number }>;
  course_rating: Record<string, number>;
  slope_rating: Record<string, number>;
}

/** The share of holes whose longest tee is within tolerance of the map's line. */
export function yardsAgreement(longest: number[], mapYards: ReadonlyArray<number> | null): number | null {
  if (!mapYards || mapYards.length !== longest.length) return null;
  const ok = longest.filter((y, i) => mapYards[i] > 0 && Math.abs(y - mapYards[i]) <= mapYards[i] * SITE_YARDS_TOLERANCE).length;
  return ok / longest.length;
}

/** May this reading be saved on this course, and as what card?
 *  `first` / `second`: two independent readings of the same file (null = that
 *  reading found no card). `mapPars`: the course's TAGGED map card, never an
 *  estimated one. `mapYards`: the measured length of each hole line in order,
 *  when the map has every line. */
export function siteCardVerdict(
  row: { name: string; club_name?: string | null; lat: number | null; lng: number | null; holes_count: number | null },
  first: SiteRead | null,
  second: SiteRead | null,
  mapPars: ReadonlyArray<{ number: number; par: number }> | null,
  mapYards: ReadonlyArray<number> | null
): { verdict: SiteCardVerdict; card: SiteCard | null } {
  const no = (verdict: SiteCardVerdict) => ({ verdict, card: null });
  if (!first || !second) return no('no_site_card');
  if (!siteReadsAgree(first, second)) return no('reads_disagree');
  const read = first;
  // The card against its own arithmetic. A tee row whose holes do not add up
  // to its printed total is not saved; at least one must.
  if (read.printedPar == null || sum(read.pars) !== read.printedPar) return no('sum_mismatch');
  const tees = read.tees.filter(t => t.printedTotal != null && sum(t.yards) === t.printedTotal);
  if (tees.length === 0) return no('sum_mismatch');
  const toYards = (v: number) => (read.unit === 'metres' ? Math.round(v * YARDS_PER_METRE) : v);
  const longest = read.pars.map((_, i) => Math.max(...tees.map(t => toYards(t.yards[i]))));
  const agreement = yardsAgreement(longest, mapYards);
  // Whose card is it? A printed name must be this course's (or its club's). No
  // printed name: only the map's hole lengths can say so.
  if (read.printedName) {
    const names = [row.name, row.club_name].filter((v): v is string => !!v);
    if (!names.some(name => sameFacilityName(name, read.printedName as string))) return no('name_mismatch');
  } else if (agreement == null || agreement < SITE_YARDS_CONFIRM) {
    return no('name_unconfirmed');
  }
  if (agreement != null && agreement < SITE_YARDS_REFUSE) return no('yardage_disagrees');
  const hole_data = read.pars.map((par, i) => ({
    number: i + 1,
    par,
    yardage: Object.fromEntries(tees.map(t => [t.name, toYards(t.yards[i])])),
    handicap: read.handicap?.[i] ?? 0,
  }));
  const card: SiteCard = {
    total_par: read.printedPar,
    holes_count: read.pars.length,
    hole_data,
    course_rating: Object.fromEntries(tees.filter(t => t.rating != null).map(t => [t.name, t.rating as number])),
    slope_rating: Object.fromEntries(tees.filter(t => t.slope != null).map(t => [t.name, t.slope as number])),
  };
  // And against our row and the map's tagged pars, by the fill's own rule.
  const fill = cardFillVerdict(row, { total_par: card.total_par, holes_count: card.holes_count, hole_data: card.hole_data }, mapPars);
  return fill === 'ok' ? { verdict: 'ok', card } : no(fill);
}

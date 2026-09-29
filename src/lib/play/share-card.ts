import { getStatSchema } from '@/lib/sports/stat-schemas';

/**
 * The share card — the Play program (244). Pure, server-safe, every sport.
 *
 * ONE projection feeds the public result page (/r/[postId]), its metadata
 * and its 1200×630 image (card.png): a hero number with its label, a sub-
 * line, up to three supporting chips, the date and the verified mark. A
 * sport joins by its data — golf by the round, a stat-line sport by its
 * stat schema's `heroStat` + `supportKeys` — never by code here.
 *
 * Names arrive ALREADY masked (publicDisplayName) and only for a public
 * post of a public profile (share-server.ts decides); nothing personal
 * beyond the display name and the result ever enters a card.
 */

export type ShareKind = 'golf' | 'stat_line';

export interface ShareChip { label: string; value: string }

export interface ShareCard {
  kind: ShareKind;
  sportKey: string;
  sportName: string;
  athleteName: string;
  date: string; // YYYY-MM-DD
  hero: { value: string; label: string };
  subline: string | null;
  chips: ShareChip[];
  verified: boolean;
  /** "<name> shot 77 at Eagle Creek" — the page title and og:title. */
  title: string;
  /** The og:description. */
  description: string;
}

/** Which posts have a card: a PUBLISHED, PUBLIC result — a golf round post or a stat line. */
export function shareableKind(post: { visibility: string | null; status?: string | null; stats_data?: unknown; has_round?: boolean }): ShareKind | null {
  if (post.visibility !== 'public') return null;
  if (post.status && post.status !== 'published') return null;
  if (post.has_round) return 'golf';
  const data = post.stats_data as { type?: unknown } | null | undefined;
  return data?.type === 'stat_line' ? 'stat_line' : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shareDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ymd;
}

/** "+5" / "E" / "−2" — golf's to-par. */
export function toParLabel(toPar: number): string {
  if (toPar === 0) return 'E';
  return toPar > 0 ? `+${toPar}` : `−${Math.abs(toPar)}`;
}

export interface GolfShareInput {
  athleteName: string;
  date: string;
  gross: number;
  par: number | null;
  holes: number | null;
  course: string | null;
  tee?: string | null;
  metrics: Record<string, number>;
  verified: boolean;
}

export function golfShareCard(i: GolfShareInput): ShareCard {
  const toPar = typeof i.par === 'number' && i.par > 0 ? i.gross - i.par : null;
  const where = i.course?.trim() || null;
  const chips: ShareChip[] = [];
  const m = i.metrics;
  if (typeof m.aces === 'number' && m.aces > 0) chips.push({ label: m.aces === 1 ? 'Hole-in-one' : 'Aces', value: String(m.aces) });
  if (typeof m.eagles === 'number' && m.eagles > 0) chips.push({ label: m.eagles === 1 ? 'Eagle' : 'Eagles', value: String(m.eagles) });
  if (typeof m.birdies === 'number' && m.birdies > 0) chips.push({ label: m.birdies === 1 ? 'Birdie' : 'Birdies', value: String(m.birdies) });
  // A card shows what is worth sharing: a zero is usually an UNTRACKED stat
  // (a round entered without putts or greens), never a brag — so it is left off.
  if (typeof m.putts === 'number' && m.putts > 0) chips.push({ label: 'Putts', value: String(m.putts) });
  if (typeof m.gir_pct === 'number' && m.gir_pct > 0) chips.push({ label: 'GIR', value: `${Math.round(m.gir_pct)}%` });
  const holes = typeof i.holes === 'number' && i.holes > 0 ? `${i.holes} holes` : null;
  const subline = [where, holes].filter(Boolean).join(' · ') || null;
  return {
    kind: 'golf',
    sportKey: 'golf',
    sportName: 'Golf',
    athleteName: i.athleteName,
    date: i.date,
    hero: { value: String(i.gross), label: toPar === null ? 'Strokes' : `${toParLabel(toPar)} to par` },
    subline,
    chips: chips.slice(0, 3),
    verified: i.verified,
    title: `${i.athleteName} shot ${i.gross}${where ? ` at ${where}` : ''}`,
    description: [toPar === null ? null : `${toParLabel(toPar)} to par`, holes, shareDate(i.date), 'on Edge Athlete'].filter(Boolean).join(' · '),
  };
}

export interface StatLineShareInput {
  athleteName: string;
  sportKey: string;
  sportName: string;
  date: string;
  stats: Record<string, number>;
  opponent?: string | null;
  result?: string | null;
  resultScore?: string | null;
  verified: boolean;
}

export function statLineShareCard(i: StatLineShareInput): ShareCard | null {
  const schema = getStatSchema(i.sportKey);
  if (!schema) return null;
  const heroValue = schema.heroStat.compute(i.stats);
  const fieldLabel = (key: string) => schema.fields.find(f => f.key === key)?.label ?? key;
  const chips: ShareChip[] = [];
  for (const key of schema.supportKeys) {
    const v = i.stats[key];
    if (typeof v === 'number' && Number.isFinite(v)) chips.push({ label: fieldLabel(key), value: String(v) });
    if (chips.length === 3) break;
  }
  const vs = i.opponent?.trim() ? `vs ${i.opponent.trim()}` : null;
  const res = i.result === 'W' || i.result === 'L' || i.result === 'T' ? `${i.result}${i.resultScore ? ` ${i.resultScore}` : ''}` : null;
  const hero = heroValue === null
    ? { value: String(chips[0]?.value ?? '—'), label: chips[0]?.label ?? schema.activityNoun }
    : { value: String(Number.isInteger(heroValue) ? heroValue : heroValue.toFixed(2)), label: schema.heroStat.label };
  const subline = [vs, res].filter(Boolean).join(' · ') || null;
  return {
    kind: 'stat_line',
    sportKey: i.sportKey,
    sportName: i.sportName,
    athleteName: i.athleteName,
    date: i.date,
    hero,
    subline,
    chips,
    verified: i.verified,
    title: `${i.athleteName}: ${hero.value} ${hero.label.toLowerCase()}${vs ? ` ${vs}` : ''}`,
    description: [i.sportName, subline, shareDate(i.date), 'on Edge Athlete'].filter(Boolean).join(' · '),
  };
}

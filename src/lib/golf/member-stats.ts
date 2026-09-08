// ── Member stats from members' public rounds (Onboarding v2 R5) ─────────────
// The Club Model's page: "all seven surfaces are aggregations over rounds,
// scoped by membership — a club that plays and posts has a full page with
// zero admin work." course-stats.ts did this keyed by COURSE (a venue had to
// exist); this is the sibling keyed by MEMBERSHIP alone — every member, the
// rounds they posted anywhere, this year. Pure and node-tested; the reader
// in org-sites/member-stats.ts does the I/O and applies the two-key rule
// (a PUBLIC post on the round AND a public profile) and the crawlable-name
// masking before anything reaches here.
//
// Nine holes is normal: averages and lows key on the hole count; a 9-hole
// 38 and an 18-hole 76 never compete.

export interface MemberStatsRound {
  id: string;
  profileId: string;
  /** YYYY-MM-DD (a DATE column — compared as a string). */
  date: string;
  holes: number;
  gross: number;
  createdAt: string;
  courseName: string | null;
}

export interface MemberStatsPerson {
  profileId: string;
  /** Already masked (publicDisplayName). */
  name: string;
  /** Only a public profile links (publicHandle). */
  handle: string | null;
  /** Formatted index ("12.4", "+1.2") — only when the reader chose to show it. */
  handicap: string | null;
}

export interface MemberStatsRow extends MemberStatsPerson {
  rounds: number;
  roundsThisSeason: number;
  avg18: number | null;
  avg9: number | null;
  best18: { gross: number; date: string } | null;
  best9: { gross: number; date: string } | null;
}

export interface MemberStatsLeaderRow {
  name: string;
  value: number;
  playerHandle?: string;
  note?: string;
}

export interface MemberStatsBoard {
  label: string;
  valueLabel: string;
  rows: MemberStatsLeaderRow[];
}

export interface MemberStatsRecent {
  name: string;
  playerHandle?: string;
  date: string;
  gross: number;
  holes: number;
  courseName: string | null;
}

export interface MemberStats {
  memberCount: number;
  roundsPosted: number;
  members: MemberStatsRow[];
  boards: MemberStatsBoard[];
  recent: MemberStatsRecent[];
}

export const EMPTY_MEMBER_STATS: MemberStats = { memberCount: 0, roundsPosted: 0, members: [], boards: [], recent: [] };

const round1 = (n: number) => Math.round(n * 10) / 10;

function byDateDesc<T extends { date: string; createdAt: string }>(a: T, b: T): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

export function buildMemberStats(input: {
  /** Every member the reader chose to list (masked names; supervised omitted upstream). */
  people: MemberStatsPerson[];
  /** Public rounds only (the two-key rule applied upstream). */
  rounds: MemberStatsRound[];
  /** YYYY-MM-DD — rounds on/after count as "this season" (the calendar year by default). */
  seasonFrom: string;
  /** Rows needed before a scoring average makes a leaders board. */
  minRoundsForAverage?: number;
  recent?: number;
  boardSize?: number;
}): MemberStats {
  const minAvg = input.minRoundsForAverage ?? 3;
  const recentN = input.recent ?? 5;
  const boardSize = input.boardSize ?? 5;
  const rounds = input.rounds.filter(r => Number.isFinite(r.gross) && r.gross > 0 && (r.holes === 9 || r.holes === 18));
  const byPerson = new Map<string, MemberStatsRound[]>();
  for (const r of rounds) {
    if (!byPerson.has(r.profileId)) byPerson.set(r.profileId, []);
    byPerson.get(r.profileId)!.push(r);
  }
  const personById = new Map(input.people.map(p => [p.profileId, p]));

  const members: MemberStatsRow[] = input.people.map(p => {
    const rs = byPerson.get(p.profileId) ?? [];
    const r18 = rs.filter(r => r.holes === 18);
    const r9 = rs.filter(r => r.holes === 9);
    const best = (list: MemberStatsRound[]) => {
      if (list.length === 0) return null;
      const b = [...list].sort((a, c) => a.gross - c.gross || (a.date < c.date ? -1 : a.date > c.date ? 1 : 0))[0];
      return { gross: b.gross, date: b.date };
    };
    const avg = (list: MemberStatsRound[]) => (list.length ? round1(list.reduce((s, r) => s + r.gross, 0) / list.length) : null);
    return {
      ...p,
      rounds: rs.length,
      roundsThisSeason: rs.filter(r => r.date >= input.seasonFrom).length,
      avg18: avg(r18),
      avg9: avg(r9),
      best18: best(r18),
      best9: best(r9),
    };
  });
  // Most active first, then alphabetical — the roster reads like a tour list.
  members.sort((a, b) => b.roundsThisSeason - a.roundsThisSeason || b.rounds - a.rounds || a.name.localeCompare(b.name));

  const boards: MemberStatsBoard[] = [];
  const low = (holes: 9 | 18, label: string): MemberStatsBoard | null => {
    const rows: MemberStatsLeaderRow[] = [];
    for (const m of members) {
      const b = holes === 18 ? m.best18 : m.best9;
      if (b) rows.push({ name: m.name, value: b.gross, note: b.date, ...(m.handle ? { playerHandle: m.handle } : {}) });
    }
    rows.sort((a, b) => a.value - b.value || (a.note ?? '').localeCompare(b.note ?? ''));
    const top = rows.slice(0, boardSize);
    return top.length ? { label, valueLabel: 'Gross', rows: top } : null;
  };
  const avgBoard = (holes: 9 | 18, label: string): MemberStatsBoard | null => {
    const rows = members
      .filter(m => (holes === 18 ? m.avg18 : m.avg9) !== null && (byPerson.get(m.profileId) ?? []).filter(r => r.holes === holes).length >= minAvg)
      .map(m => ({ name: m.name, value: (holes === 18 ? m.avg18 : m.avg9) as number, ...(m.handle ? { playerHandle: m.handle } : {}) }))
      .sort((a, b) => a.value - b.value)
      .slice(0, boardSize);
    return rows.length ? { label, valueLabel: 'Average', rows } : null;
  };
  for (const b of [low(18, 'Low round (18)'), low(9, 'Low round (9)'), avgBoard(18, 'Scoring average (18)'), avgBoard(9, 'Scoring average (9)')]) {
    if (b) boards.push(b);
  }
  const mostRows = members
    .filter(m => m.roundsThisSeason > 0)
    .map(m => ({ name: m.name, value: m.roundsThisSeason, ...(m.handle ? { playerHandle: m.handle } : {}) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, boardSize);
  if (mostRows.length) boards.push({ label: 'Most rounds this season', valueLabel: 'Rounds', rows: mostRows });

  const recent: MemberStatsRecent[] = [...rounds]
    .sort(byDateDesc)
    .slice(0, recentN)
    .map(r => {
      const p = personById.get(r.profileId);
      return {
        name: p?.name ?? 'Member',
        ...(p?.handle ? { playerHandle: p.handle } : {}),
        date: r.date,
        gross: r.gross,
        holes: r.holes,
        courseName: r.courseName,
      };
    });

  return { memberCount: input.people.length, roundsPosted: rounds.length, members, boards, recent };
}

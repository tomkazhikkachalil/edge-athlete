// ── Golf leaders (phase 6e S5) — pure, node-tested ─────────────────────────
// The leaders module reads stat lines, and golf has no stat-line schema:
// a golf league's numbers live in contest_results (the sync engine's
// payloads). These boards are the ones a golf league actually posts on
// its wall: low gross by nine and by eighteen (principle 4 — a 38 and a
// 76 never compete), low net when the league plays net, most rounds
// posted, and the best week (the lowest rule score in one round). Names
// arrive masked; a null name is an omitted (supervised) athlete and
// never reaches a row. Completed rounds only — the board is the
// confirmed record, like the standings.

export interface GolfLeaderInputRow {
  contestId: string;
  contestRound: string | null;
  contestPlayFrom: string | null;
  entryId: string;
  gross: number | null;
  net: number | null;
  holes: number | null;
  /** The rule's score for the round (net on a net league, else gross). */
  score: number | null;
}

export interface GolfLeaderRow {
  name: string;
  value: number;
  note?: string;
}

export interface GolfLeaderBoard {
  label: string;
  valueLabel: string;
  rows: GolfLeaderRow[];
}

const holesLabel = (h: number) => (h === 9 ? '9 holes' : '18 holes');

function topN(
  rows: GolfLeaderRow[],
  direction: 'asc' | 'desc',
  top: number
): GolfLeaderRow[] {
  return [...rows]
    .sort((a, b) => (direction === 'asc' ? a.value - b.value : b.value - a.value) || a.name.localeCompare(b.name))
    .slice(0, top);
}

export function buildGolfLeaderBoards(input: {
  rows: GolfLeaderInputRow[];
  /** Masked name per entry id; null/absent = omitted (supervised). */
  nameByEntry: Map<string, string | null>;
  scoringRule: string | null;
  top?: number;
}): GolfLeaderBoard[] {
  const top = input.top ?? 5;
  const name = (entryId: string) => input.nameByEntry.get(entryId) ?? null;
  const rows = input.rows.filter(r => !!name(r.entryId));
  if (rows.length === 0) return [];
  const boards: GolfLeaderBoard[] = [];

  // Low gross / low net, per hole count.
  const lowest = (pick: (r: GolfLeaderInputRow) => number | null, holes: number) => {
    const best = new Map<string, number>();
    for (const r of rows) {
      if (r.holes !== holes) continue;
      const v = pick(r);
      if (v === null || !Number.isFinite(v) || v <= 0) continue;
      const cur = best.get(r.entryId);
      if (cur === undefined || v < cur) best.set(r.entryId, v);
    }
    return topN([...best.entries()].map(([entryId, value]) => ({ name: name(entryId)!, value })), 'asc', top);
  };
  for (const holes of [9, 18]) {
    const gross = lowest(r => r.gross, holes);
    if (gross.length) boards.push({ label: `Low gross (${holesLabel(holes)})`, valueLabel: 'Gross', rows: gross });
  }
  if (input.scoringRule === 'golf_net') {
    for (const holes of [9, 18]) {
      const net = lowest(r => r.net, holes);
      if (net.length) boards.push({ label: `Low net (${holesLabel(holes)})`, valueLabel: 'Net', rows: net });
    }
  }

  // Most rounds: distinct rounds (contests) with a result per entry.
  const contestsByEntry = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!contestsByEntry.has(r.entryId)) contestsByEntry.set(r.entryId, new Set());
    contestsByEntry.get(r.entryId)!.add(r.contestId);
  }
  const most = topN(
    [...contestsByEntry.entries()].map(([entryId, set]) => ({ name: name(entryId)!, value: set.size })),
    'desc',
    top
  );
  if (most.length) boards.push({ label: 'Most rounds', valueLabel: 'Rounds', rows: most });

  // Best week: the lowest rule score in ONE round, with the round as the note.
  const best = new Map<string, { value: number; note: string }>();
  for (const r of rows) {
    if (r.score === null || !Number.isFinite(r.score) || r.score <= 0) continue;
    const cur = best.get(r.entryId);
    if (cur === undefined || r.score < cur.value) {
      const note = [r.contestRound, r.contestPlayFrom].filter(Boolean).join(' · ');
      best.set(r.entryId, { value: r.score, note });
    }
  }
  const bestRows = topN(
    [...best.entries()].map(([entryId, b]) => ({ name: name(entryId)!, value: b.value, ...(b.note ? { note: b.note } : {}) })),
    'asc',
    top
  );
  if (bestRows.length) {
    boards.push({ label: 'Best week', valueLabel: input.scoringRule === 'golf_net' ? 'Net' : 'Gross', rows: bestRows });
  }
  return boards;
}

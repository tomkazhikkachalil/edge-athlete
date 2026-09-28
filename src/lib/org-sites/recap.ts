// ── One-click recap drafts — the words (sports-team website program, R1) ────
// Pure: a finished contest's view (the ONE reader's masked projection,
// `fetchContestView` — names already through `publicDisplayName`) becomes a
// news DRAFT the manager edits before anything is public: a headline, a
// one-line summary, and a few plain blocks (the result, the top of the
// table or the top performers). Nothing here guesses: an unfinished or
// unscored contest has no recap (null). A contest of a non-public
// competition drafts for MEMBERS — publishing it never widens its audience.

import type { ContestView } from '@/lib/competitions/contest-view';
import { ADVANCE_LABEL } from '@/lib/competitions/contest-outcome';

export type RecapBlock = { type: 'heading'; text: string } | { type: 'paragraph'; text: string };

export interface RecapDraft {
  title: string;
  summary: string;
  blocks: RecapBlock[];
  audience: 'public' | 'members';
}

export type RecapSource = Pick<ContestView, 'contest' | 'competition' | 'outcome' | 'statLines' | 'statFields' | 'org'>;

const TITLE_MAX = 120;
const SUMMARY_MAX = 280;
const PARAGRAPH_MAX = 2000;

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** "Saturday, September 20" in the contest's zone; '' when unscheduled. */
export function recapDay(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const at = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(at.getTime())) return '';
  try {
    return at.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: iso.length === 10 ? 'UTC' : timeZone });
  } catch {
    return at.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
}

function where(v: RecapSource): string {
  const round = v.contest.roundName ?? v.contest.round;
  return round ? `${v.competition.name} (${round})` : v.competition.name;
}

/** The three best stat lines on the sport's headline stat (the first in its
 *  vocabulary), ties by name. */
function topPerformers(v: RecapSource): string | null {
  const field = v.statFields[0];
  if (!field) return null;
  const rows = v.statLines
    .filter(l => typeof l.stats[field.key] === 'number' && l.stats[field.key] > 0)
    .sort((a, b) => b.stats[field.key] - a.stats[field.key] || a.name.localeCompare(b.name))
    .slice(0, 3);
  if (rows.length === 0) return null;
  // The stat names the column (no plural to get wrong): "Top performers (goals): Sam R. (Blazers) 2; …".
  const line = rows.map(l => `${l.name}${l.teamName ? ` (${l.teamName})` : ''} ${l.stats[field.key]}`).join('; ');
  return `Top performers (${field.label.toLowerCase()}): ${line}.`;
}

export function recapDraft(v: RecapSource): RecapDraft | null {
  if (v.contest.status !== 'completed') return null;
  const audience: RecapDraft['audience'] = v.competition.visibility === 'public' ? 'public' : 'members';
  const day = recapDay(v.contest.scheduledAt ?? v.contest.playFrom, v.contest.timezone);
  const o = v.outcome;

  if (o.kind === 'fixture' || o.kind === 'bracket') {
    const home = o.home;
    const away = o.away;
    if (!home || !away || home.score === null || away.score === null) return null;
    const scoreline = `${home.name} ${home.score}–${away.score} ${away.name}`;
    const winner = o.winnerEntryId === home.entryId ? home : o.winnerEntryId === away.entryId ? away : null;
    const loser = winner ? (winner === home ? away : home) : null;
    const settled = o.kind === 'bracket' && o.advancedBy ? ` (${ADVANCE_LABEL[o.advancedBy]})` : '';
    const title = winner && loser
      ? `${winner.name} beat ${loser.name} ${winner.score}–${loser.score}${settled}`
      : `${home.name} and ${away.name} draw ${home.score}–${away.score}`;
    const opening = `${home.name} hosted ${away.name} in ${where(v)}${day ? ` on ${day}` : ''}. Final: ${scoreline}${settled}.`;
    const blocks: RecapBlock[] = [{ type: 'paragraph', text: clip(opening, PARAGRAPH_MAX) }];
    const top = topPerformers(v);
    if (top) blocks.push({ type: 'paragraph', text: clip(top, PARAGRAPH_MAX) });
    blocks.push({ type: 'paragraph', text: 'Add a few lines about the game here — the turning point, a standout moment, what comes next.' });
    return { title: clip(title, TITLE_MAX), summary: clip(`${where(v)} — ${scoreline}.`, SUMMARY_MAX), blocks, audience };
  }

  if (o.kind === 'leaderboard') {
    const ranked = o.rows.filter(r => r.rank !== null && r.score !== null);
    if (ranked.length === 0) return null;
    const leader = ranked[0];
    const podium = ranked.slice(0, 3).map(r => `${r.rank}. ${r.name} — ${r.score}`).join('; ');
    const shared = ranked.filter(r => r.rank === leader.rank).length > 1;
    const title = shared ? `A shared lead in ${where(v)}` : `${leader.name} wins ${where(v)}`;
    const opening = `${where(v)}${day ? ` was played on ${day}` : ' is complete'}${v.contest.courseName ? ` at ${v.contest.courseName}` : ''}.`;
    const blocks: RecapBlock[] = [
      { type: 'paragraph', text: clip(opening, PARAGRAPH_MAX) },
      { type: 'heading', text: 'The top of the table' },
      { type: 'paragraph', text: clip(`${podium}.`, PARAGRAPH_MAX) },
      { type: 'paragraph', text: 'Add a few lines about the day here — the conditions, a standout round, what comes next.' },
    ];
    return { title: clip(title, TITLE_MAX), summary: clip(`${where(v)} — ${podium}.`, SUMMARY_MAX), blocks, audience };
  }

  return null;
}

/** The dedupe key a recap post carries (243's source_ref CHECK). */
export const recapSourceRef = (contestId: string): string => `contest:${contestId}`;

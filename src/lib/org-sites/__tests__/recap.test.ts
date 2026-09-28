import { describe, expect, it } from 'vitest';
import { recapDay, recapDraft, recapSourceRef, type RecapSource } from '../recap';
import { PageBodySchema, NewsEditSchema } from '../validate';

// R1 (sports-team website program, Sep 28 2026): a finished contest's MASKED
// view becomes a draft the manager edits — nothing guessed, nothing widened.

const base = (over: Partial<RecapSource> = {}): RecapSource => ({
  contest: { id: 'c1', status: 'completed', round: 'Week 3', scheduledAt: '2026-09-20T23:00:00Z', timezone: 'America/Toronto', holes: null, playFrom: null, playTo: null, eventId: null, venueName: null, facilityName: null, courseName: null, stage: null, slot: null, roundName: null },
  competition: { id: 'k1', name: 'Fall League', format: 'fixture', entrantType: 'team', sportKey: 'ice_hockey', sportName: 'Ice Hockey', scoringRule: null, status: 'active', visibility: 'public', seasonLabel: '2026' },
  org: { side: 'league', id: 'o1', name: 'QA League' },
  outcome: { kind: 'fixture', complete: true, home: { participantId: 'p1', entryId: 'e1', name: 'Comets', score: 2 }, away: { participantId: 'p2', entryId: 'e2', name: 'Blazers', score: 3 }, winnerEntryId: 'e2', tie: false, scoreline: '2–3' },
  statFields: [{ key: 'goals', label: 'Goals', shortLabel: 'G' }],
  statLines: [
    { name: 'Sam R.', handle: null, teamName: 'Blazers', stats: { goals: 2 }, provenance: 'club_recorded' },
    { name: 'Alex P.', handle: null, teamName: 'Comets', stats: { goals: 1 }, provenance: 'club_recorded' },
    { name: 'Jo K.', handle: null, teamName: 'Blazers', stats: { goals: 0 }, provenance: 'club_recorded' },
  ],
  ...over,
});

describe('recapDraft', () => {
  it('a fixture: the winner leads the headline, the scoreline home-first in the summary, the top performers named as masked', () => {
    const d = recapDraft(base())!;
    expect(d.title).toBe('Blazers beat Comets 3–2');
    expect(d.summary).toBe('Fall League (Week 3) — Comets 2–3 Blazers.');
    expect(d.blocks[0]).toEqual({ type: 'paragraph', text: 'Comets hosted Blazers in Fall League (Week 3) on Sunday, September 20. Final: Comets 2–3 Blazers.' });
    expect(d.blocks[1]).toEqual({ type: 'paragraph', text: 'Top performers (goals): Sam R. (Blazers) 2; Alex P. (Comets) 1.' });
    expect(d.audience).toBe('public');
    // The draft fits the composer's own schemas.
    expect(PageBodySchema.safeParse(d.blocks).success).toBe(true);
    expect(NewsEditSchema.safeParse({ title: d.title, summary: d.summary, body: d.blocks, audience: d.audience }).success).toBe(true);
  });

  it('a draw reads as a draw; a bracket tie settled in the payload says how', () => {
    const draw = base({ outcome: { kind: 'fixture', complete: true, home: { participantId: 'p1', entryId: 'e1', name: 'Comets', score: 2 }, away: { participantId: 'p2', entryId: 'e2', name: 'Blazers', score: 2 }, winnerEntryId: null, tie: true, scoreline: '2–2' } });
    expect(recapDraft(draw)!.title).toBe('Comets and Blazers draw 2–2');
    const shootout = base({ outcome: { kind: 'bracket', complete: true, home: { participantId: 'p1', entryId: 'e1', name: 'Comets', score: 2 }, away: { participantId: 'p2', entryId: 'e2', name: 'Blazers', score: 2 }, winnerEntryId: 'e1', tie: false, scoreline: '2–2', stage: 2, slot: 1, roundName: 'Semi-final', advancedBy: 'shootout' } });
    expect(recapDraft(shootout)!.title).toBe('Comets beat Blazers 2–2 (won on a shootout)');
  });

  it('a leaderboard: the leader wins it, the podium listed; a shared lead is not called for one player', () => {
    const board = (rows: { name: string; rank: number; score: number }[]) =>
      base({ contest: { ...base().contest, courseName: 'Loch March' }, outcome: { kind: 'leaderboard', complete: true, direction: 'asc', columns: [], leaderEntryId: null, rows: rows.map((r, i) => ({ participantId: `p${i}`, entryId: `e${i}`, name: r.name, rank: r.rank, score: r.score, stats: {} })) }, statLines: [], statFields: [] });
    const d = recapDraft(board([{ name: 'Ann B.', rank: 1, score: 71 }, { name: 'Ben C.', rank: 2, score: 73 }, { name: 'Cy D.', rank: 3, score: 74 }, { name: 'Di E.', rank: 4, score: 80 }]))!;
    expect(d.title).toBe('Ann B. wins Fall League (Week 3)');
    expect(d.blocks.find(b => b.type === 'paragraph' && b.text.startsWith('1.'))!.text).toBe('1. Ann B. — 71; 2. Ben C. — 73; 3. Cy D. — 74.');
    expect(d.blocks[0].text).toContain('at Loch March');
    expect(recapDraft(board([{ name: 'Ann B.', rank: 1, score: 71 }, { name: 'Ben C.', rank: 1, score: 71 }]))!.title).toBe('A shared lead in Fall League (Week 3)');
  });

  it('nothing to recap: an unfinished game, an unscored side, an unscored contest → null', () => {
    expect(recapDraft(base({ contest: { ...base().contest, status: 'scheduled' } }))).toBeNull();
    expect(recapDraft(base({ outcome: { kind: 'fixture', complete: false, home: { participantId: 'p1', entryId: 'e1', name: 'Comets', score: null }, away: { participantId: 'p2', entryId: 'e2', name: 'Blazers', score: 3 }, winnerEntryId: null, tie: false, scoreline: null } }))).toBeNull();
    expect(recapDraft(base({ outcome: { kind: 'unscored', complete: false } }))).toBeNull();
  });

  it('a private competition drafts for members — publishing never widens its audience', () => {
    expect(recapDraft(base({ competition: { ...base().competition, visibility: 'private' } }))!.audience).toBe('members');
  });

  it('the dedupe key fits 243’s CHECK; the day reads in the contest’s zone; a date-only day reads as itself', () => {
    expect(recapSourceRef('6a1f5b0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b')).toMatch(/^contest:[0-9a-f-]{36}$/);
    expect(recapDay('2026-09-21T02:00:00Z', 'America/Toronto')).toBe('Sunday, September 20');
    expect(recapDay('2026-09-21', 'America/Toronto')).toBe('Monday, September 21');
    expect(recapDay(null, 'UTC')).toBe('');
  });
});

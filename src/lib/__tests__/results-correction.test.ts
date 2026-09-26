import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REPORT_REASONS } from '../tickets/types';
import { severityFor } from '../tickets/severity';
import { NO_INTAKE_TARGETS } from '../tickets/server';

// Results-kept round PR 4 (241, Sep 26 2026). Tom: "They might have just
// tagged the wrong person, but the information could be correct … the admin
// [should] be able to tag the right person and correct any mistakes … both
// sides stay accountable." Pinned by source (the writers are I/O).

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const SRC = read('src/lib/results/correction-server.ts');
const body = (fn: string) => SRC.split(`export async function ${fn}(`)[1].split('\nexport ')[0];

describe('"This result isn’t me" — the report', () => {
  it('is a report reason, medium, never acted on at intake (the event target)', () => {
    expect(REPORT_REASONS).toContain('wrong_person');
    expect(severityFor({ type: 'report', reason: 'wrong_person', targetIsMinor: false })).toBe('medium');
    expect(NO_INTAKE_TARGETS.has('sport_event')).toBe(true);
  });
  it('only an event report offers it, and the event page opens it pre-picked for a player', () => {
    expect(read('src/components/tickets/ReportSheet.tsx')).toMatch(/r !== 'wrong_person' \|\| target\.type === 'sport_event'/);
    expect(read('src/components/sport-events/EventPlace.tsx')).toMatch(/initialReason=\{reportWrongPerson \? 'wrong_person' : undefined\}/);
  });
  it('the snapshot keeps the reporter’s result as it was', () => {
    expect(read('src/lib/tickets/snapshot-server.ts')).toMatch(/reporter_result: reporterResult/);
  });
});

describe('support moves a result WHOLE to the right person — nothing is lost', () => {
  const r = () => body('reassignResult');
  it('the event row, the cards, the mirrors, the dataset rows and the stat posts all move', () => {
    for (const re of [
      /from\('sport_event_participants'\)\.update\(\{ profile_id: to\.id/,
      /from\('group_post_participants'\)\.update\(\{ profile_id: to\.id \}\)/,
      /from\('golf_rounds'\)\.update\(\{ profile_id: to\.id \}\)/,
      /from\('athlete_performances'\)\.update\(\{ profile_id: to\.id \}\)\.eq\('natural_key', `golf_round:/,
      /from\('sport_event_stat_lines'\)\.update\(\{ profile_id: to\.id \}\)/,
      /from\('athlete_performances'\)\.update\(\{ profile_id: to\.id \}\)\.eq\('natural_key', `post:/,
    ]) expect(r(), String(re)).toMatch(re);
    expect(r()).not.toMatch(/\.delete\(\)/);
  });
  it('the org’s contest drops the wrong person BEFORE the re-sync adds the right one', () => {
    expect(r().indexOf('dropFromContests(')).toBeGreaterThan(-1);
    expect(r().indexOf('dropFromContests(')).toBeLessThan(r().indexOf('resync('));
  });
  it('refuses the host, a deleted account, and a person already in the event (no silent merge)', () => {
    expect(r()).toMatch(/from\.profile_id === event\.host_profile_id/);
    expect(r()).toMatch(/to\.departed/);
    expect(r()).toMatch(/already in this event/);
  });
});

describe('every act is accountable', () => {
  it.each(['reassignResult', 'correctCard', 'correctStatLine', 'removeMistakenResult'])('%s: a platform audit row on the ticket, a ticket step, and bells', fn => {
    const b = body(fn);
    expect(b).toMatch(/actor: \{ kind: 'platform', profileId: ctx\.actorId \}/);
    expect(b).toMatch(/ticketId: ctx\.ticketId/);
    expect(b).toMatch(/await ticketStep\(admin, ctx,/);
    expect((b.match(/await bell\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('both people are told on a move', () => {
    expect(body('reassignResult')).toMatch(/await bell\(admin, \[oldId\]/);
    expect(body('reassignResult')).toMatch(/await bell\(admin, \[to\.id\]/);
  });
  it('a correction keeps before and after, goes through the one writers, and re-syncs', () => {
    expect(body('correctCard')).toMatch(/writeHoleScores\(admin, cardId,/);
    expect(body('correctCard')).toMatch(/detail: \{ before, after/);
    expect(body('correctStatLine')).toMatch(/validateStatsAgainstSchema\(stats, schema\)/);
    expect(body('correctStatLine')).toMatch(/detail: \{ before: l\.stats \?\? \{\}, after: stats/);
    for (const fn of ['correctCard', 'correctStatLine', 'removeMistakenResult', 'reassignResult']) expect(body(fn), fn).toMatch(/await resync\(admin, event, rounds, ctx\.actorId\)/);
  });
  it('the actions are the event recovery route’s (owner-only, on a ticket)', () => {
    const route = read('src/app/api/admin/recovery/events/[id]/route.ts');
    for (const a of ['reassign_result', 'correct_card', 'correct_line', 'remove_result']) expect(route).toContain(`z.literal('${a}')`);
  });
});

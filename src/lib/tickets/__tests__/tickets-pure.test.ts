import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  HELP_CATEGORIES,
  REPORT_REASONS,
  RESOLUTION_CODES,
  SUGGESTION_AREAS,
  SUGGESTION_TAGS,
  TICKET_EVENT_KINDS,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
  TICKET_SUBTYPES,
  TICKET_TARGET_TYPES,
  TICKET_TYPES,
  isReasonForType,
  reasonLabel,
  type TicketEventRow,
  type TicketRow,
} from '../types';
import { formatTicketNumber, parseTicketNumber } from '../number';
import { SLA_TARGETS, addBusinessDays, firstResponseDue, isOverdue, severityFor } from '../severity';
import { transitionForUserReply, validateAdminTransition } from '../transitions';
import { eventsForChange, maskEmail } from '../events';
import { projectTicketForAdmin, projectTicketForUser, userVisibleEvents } from '../visibility';

// ── The vocabulary equals migration 222's CHECKs ────────────────────────────

function checkValues(sql: string, constraint: string): string[] {
  const m = new RegExp(`${constraint}\\s+CHECK \\(([\\s\\S]*?)\\)\\)`).exec(sql);
  if (!m) throw new Error(`no CHECK named ${constraint} in 222`);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

describe('the ticket vocabulary ↔ migration 222', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'database/migrations/222_tickets.sql'), 'utf8');

  it('every union equals the CHECK it stands for', () => {
    expect(checkValues(sql, 'tickets_type_check')).toEqual([...TICKET_TYPES]);
    expect(checkValues(sql, 'tickets_subtype_check')).toEqual([...TICKET_SUBTYPES]);
    expect(checkValues(sql, 'tickets_severity_check')).toEqual([...TICKET_SEVERITIES]);
    expect(checkValues(sql, 'tickets_status_check')).toEqual([...TICKET_STATUSES]);
    expect(checkValues(sql, 'tickets_target_type_check')).toEqual([...TICKET_TARGET_TYPES]);
    expect(checkValues(sql, 'tickets_suggestion_tag_check')).toEqual([...SUGGESTION_TAGS]);
    expect(checkValues(sql, 'ticket_events_kind_check')).toEqual([...TICKET_EVENT_KINDS]);
  });

  it('the resolution codes equal their LATEST CHECK (240 re-adds it with access_restored)', () => {
    const sql240 = fs.readFileSync(path.join(process.cwd(), 'database/migrations/240_authority.sql'), 'utf8');
    expect(checkValues(sql240, 'tickets_resolution_code_check')).toEqual([...RESOLUTION_CODES]);
  });

  it('the reason lists are disjoint from nothing but validated per type', () => {
    expect(isReasonForType('report', 'minor_safety')).toBe(true);
    expect(isReasonForType('help', 'minor_safety')).toBe(false);
    expect(isReasonForType('suggestion', 'stats')).toBe(true);
    expect(REPORT_REASONS).toHaveLength(8);
    expect(HELP_CATEGORIES).toContain('other');
    expect(SUGGESTION_AREAS).toContain('other');
    expect(reasonLabel('report', 'minor_safety')).toBe('Safety of a minor');
    expect(reasonLabel('help', 'not_a_key')).toBe('not_a_key');
  });
});

// ── Numbers ─────────────────────────────────────────────────────────────────

describe('ticket numbers', () => {
  it('formats and parses round-trip', () => {
    expect(formatTicketNumber(1000)).toBe('EA-1000');
    expect(parseTicketNumber('EA-1000')).toBe(1000);
    expect(parseTicketNumber('  ea-1042 ')).toBe(1042);
    expect(parseTicketNumber('EA1042')).toBe(1042);
    expect(parseTicketNumber('1042')).toBeNull();
    expect(parseTicketNumber('EA-')).toBeNull();
    expect(() => formatTicketNumber(-1)).toThrow();
    expect(() => formatTicketNumber(1.5)).toThrow();
  });
});

// ── Severity + targets ──────────────────────────────────────────────────────

describe('severityFor', () => {
  it('the matrix', () => {
    expect(severityFor({ type: 'suggestion', reason: 'feed' })).toBe('low');
    expect(severityFor({ type: 'help', reason: 'account' })).toBe('medium');
    expect(severityFor({ type: 'report', reason: 'minor_safety' })).toBe('critical');
    expect(severityFor({ type: 'report', reason: 'self_harm' })).toBe('critical');
    expect(severityFor({ type: 'report', reason: 'spam_scam', targetIsMinor: true })).toBe('critical');
    for (const r of ['harassment_bullying', 'hate_discrimination', 'sexual_content', 'impersonation']) {
      expect(severityFor({ type: 'report', reason: r })).toBe('high');
    }
    expect(severityFor({ type: 'report', reason: 'spam_scam' })).toBe('medium');
    expect(severityFor({ type: 'report', reason: 'other' })).toBe('medium');
  });

  it('a help ticket is never critical whatever the reason says', () => {
    expect(severityFor({ type: 'help', reason: 'minor_safety', targetIsMinor: true })).toBe('medium');
  });
});

describe('response targets', () => {
  it('business days skip weekends', () => {
    const fri = new Date('2026-09-18T15:00:00Z'); // Friday
    expect(addBusinessDays(fri, 1).toISOString()).toBe('2026-09-21T15:00:00.000Z'); // Monday
    expect(addBusinessDays(fri, 2).toISOString()).toBe('2026-09-22T15:00:00.000Z');
    const sat = new Date('2026-09-19T09:00:00Z');
    expect(addBusinessDays(sat, 1).toISOString()).toBe('2026-09-21T09:00:00.000Z');
  });

  it('critical is one hour; low is the weekly review', () => {
    const t = new Date('2026-09-16T10:00:00Z'); // Wednesday
    expect(firstResponseDue(t, 'critical').toISOString()).toBe('2026-09-16T11:00:00.000Z');
    expect(firstResponseDue(t, 'high').toISOString()).toBe('2026-09-17T10:00:00.000Z');
    expect(firstResponseDue(t, 'medium').toISOString()).toBe('2026-09-18T10:00:00.000Z');
    expect(firstResponseDue(t, 'low').toISOString()).toBe('2026-09-23T10:00:00.000Z');
    expect(SLA_TARGETS.critical.label).toBe('within 1 hour');
  });

  it('overdue only while unanswered and open', () => {
    const created = '2026-09-16T10:00:00Z';
    const late = new Date('2026-09-16T12:00:00Z');
    expect(isOverdue({ created_at: created, severity: 'critical', first_response_at: null, status: 'new' }, late)).toBe(true);
    expect(isOverdue({ created_at: created, severity: 'critical', first_response_at: '2026-09-16T10:30:00Z', status: 'in_review' }, late)).toBe(false);
    expect(isOverdue({ created_at: created, severity: 'critical', first_response_at: null, status: 'resolved' }, late)).toBe(false);
    expect(isOverdue({ created_at: created, severity: 'high', first_response_at: null, status: 'new' }, late)).toBe(false);
  });
});

// ── Transitions ─────────────────────────────────────────────────────────────

describe('admin transitions', () => {
  it('any to any, except closed reopens only to in_review and same is not a move', () => {
    expect(validateAdminTransition('new', 'in_review')).toMatchObject({ ok: true, reopened: false });
    expect(validateAdminTransition('in_review', 'resolved')).toMatchObject({ ok: true, reopened: false });
    expect(validateAdminTransition('resolved', 'closed')).toMatchObject({ ok: true, reopened: false });
    expect(validateAdminTransition('resolved', 'in_review')).toMatchObject({ ok: true, reopened: true });
    expect(validateAdminTransition('closed', 'in_review')).toMatchObject({ ok: true, reopened: true });
    expect(validateAdminTransition('closed', 'resolved')).toEqual({ ok: false, reason: 'closed_reopens_only_to_review' });
    expect(validateAdminTransition('new', 'new')).toEqual({ ok: false, reason: 'unchanged' });
  });
});

describe('user reply transitions', () => {
  it('new / in_review keep their status; waiting_on_user answers to in_review', () => {
    expect(transitionForUserReply({ status: 'new', appeal_used_at: null })).toMatchObject({ ok: true, next: 'new', appeal: false });
    expect(transitionForUserReply({ status: 'in_review', appeal_used_at: null })).toMatchObject({ ok: true, next: 'in_review' });
    expect(transitionForUserReply({ status: 'waiting_on_user', appeal_used_at: null })).toMatchObject({ ok: true, next: 'in_review', reopened: false });
  });

  it('resolved reopens ONCE (the appeal); closed is terminal', () => {
    expect(transitionForUserReply({ status: 'resolved', appeal_used_at: null })).toEqual({ ok: true, next: 'in_review', reopened: true, appeal: true });
    expect(transitionForUserReply({ status: 'resolved', appeal_used_at: '2026-09-20T00:00:00Z' })).toEqual({ ok: false, reason: 'appeal_used' });
    expect(transitionForUserReply({ status: 'closed', appeal_used_at: null })).toEqual({ ok: false, reason: 'closed' });
  });
});

// ── Events ──────────────────────────────────────────────────────────────────

const before = {
  id: 't1',
  status: 'new' as const,
  severity: 'medium' as const,
  assignee_profile_id: null,
  suggestion_tag: null,
  first_response_at: null,
  resolved_at: null,
  closed_at: null,
};
const NOW = new Date('2026-09-20T12:00:00Z');

describe('eventsForChange', () => {
  it('nothing changed → no events, no stamps', () => {
    expect(eventsForChange(before, {}, 'admin1', NOW)).toEqual({ events: [], stamps: {} });
    expect(eventsForChange(before, { status: 'new', severity: 'medium' }, 'admin1', NOW).events).toEqual([]);
  });

  it('a status change is visible; the first admin event stamps first_response_at', () => {
    const out = eventsForChange(before, { status: 'in_review' }, 'admin1', NOW);
    expect(out.events).toEqual([
      { ticket_id: 't1', actor_profile_id: 'admin1', kind: 'status_changed', old_value: 'new', new_value: 'in_review', body: null, visible_to_user: true },
    ]);
    expect(out.stamps).toEqual({ first_response_at: NOW.toISOString() });
  });

  it('resolving carries the note and stamps resolved_at; closing stamps both when never resolved', () => {
    const resolved = eventsForChange(before, { status: 'resolved', resolution_code: 'no_action', resolution_note: 'Looked fine.' }, 'a', NOW);
    expect(resolved.events[0]).toMatchObject({ kind: 'status_changed', new_value: 'resolved', body: 'Looked fine.', visible_to_user: true });
    expect(resolved.stamps).toMatchObject({ resolved_at: NOW.toISOString() });
    const closed = eventsForChange(before, { status: 'closed' }, 'a', NOW);
    expect(closed.stamps).toMatchObject({ closed_at: NOW.toISOString(), resolved_at: NOW.toISOString() });
  });

  it('reopening is its own kind and clears the terminal stamps', () => {
    const out = eventsForChange(
      { ...before, status: 'closed', first_response_at: '2026-09-19T00:00:00Z', resolved_at: '2026-09-19T00:00:00Z', closed_at: '2026-09-19T01:00:00Z' },
      { status: 'in_review' },
      'a',
      NOW
    );
    expect(out.events[0]).toMatchObject({ kind: 'reopened', old_value: 'closed', new_value: 'in_review', visible_to_user: true });
    expect(out.stamps).toEqual({ resolved_at: null, closed_at: null });
  });

  it('severity, assignee and tag changes are internal (never visible)', () => {
    const out = eventsForChange(before, { severity: 'high', assignee_profile_id: 'mod1', suggestion_tag: 'planned' }, 'a', NOW);
    expect(out.events.map(e => e.kind)).toEqual(['severity_changed', 'assigned', 'action_taken']);
    expect(out.events.every(e => e.visible_to_user === false)).toBe(true);
  });

  it('masks an email for the history', () => {
    expect(maskEmail('tom@example.com')).toBe('t***@example.com');
    expect(maskEmail('nonsense')).toBe('***');
  });
});

// ── Projections (the privacy boundary) ──────────────────────────────────────

const row: TicketRow = {
  id: 't1',
  number: 1042,
  type: 'report',
  subtype: 'post',
  reason: 'harassment_bullying',
  severity: 'high',
  status: 'resolved',
  subject: 'A post',
  description: 'They keep at it.',
  reporter_profile_id: 'me',
  reporter_email: 'me@example.com',
  guest_email: null,
  target_type: 'post',
  target_id: 'p1',
  target_profile_id: 'them',
  content_snapshot: { caption: 'the reported caption' },
  attachment_url: null,
  report_count: 3,
  merged_into_id: null,
  assignee_profile_id: 'mod1',
  resolution_code: 'warning',
  resolution_note: 'We warned the account.',
  suggestion_tag: null,
  contact_ok: true,
  appeal_used_at: null,
  first_response_at: '2026-09-19T00:00:00Z',
  resolved_at: '2026-09-19T01:00:00Z',
  closed_at: null,
  anonymized_at: null,
  created_at: '2026-09-18T00:00:00Z',
  updated_at: '2026-09-19T01:00:00Z',
};

describe('projectTicketForUser', () => {
  it('carries exactly the user keys — never assignee, target, snapshot, email or merge links', () => {
    const view = projectTicketForUser(row);
    expect(Object.keys(view).sort()).toEqual(
      [
        'id', 'number', 'type', 'subtype', 'reason', 'severity', 'status', 'subject', 'description',
        'canReply', 'replyIsAppeal', 'resolution_code', 'resolution_note', 'responseTarget', 'attachment',
        'created_at', 'updated_at', 'resolved_at',
      ].sort()
    );
    const json = JSON.stringify(view);
    for (const secret of ['mod1', 'them', 'reported caption', 'me@example.com', 'report_count', 'merged_into', 'first_response_at']) {
      expect(json).not.toContain(secret);
    }
    expect(view.number).toBe('EA-1042');
    expect(view.responseTarget).toBe('the same business day');
  });

  it('reply rules: resolved → the appeal once; closed → never', () => {
    expect(projectTicketForUser(row)).toMatchObject({ canReply: true, replyIsAppeal: true });
    expect(projectTicketForUser({ ...row, appeal_used_at: '2026-09-19T02:00:00Z' })).toMatchObject({ canReply: false, replyIsAppeal: false });
    expect(projectTicketForUser({ ...row, status: 'closed' })).toMatchObject({ canReply: false, replyIsAppeal: false });
    expect(projectTicketForUser({ ...row, status: 'in_review' })).toMatchObject({ canReply: true, replyIsAppeal: false });
  });
});

describe('userVisibleEvents', () => {
  const ev = (over: Partial<TicketEventRow>): TicketEventRow => ({
    id: 'e', ticket_id: 't1', actor_profile_id: null, kind: 'note', old_value: null, new_value: null, body: null, visible_to_user: false, created_at: '2026-09-19T00:00:00Z', ...over,
  });

  it('drops internal kinds even when mis-flagged visible; labels actors as you / support / system', () => {
    const out = userVisibleEvents(
      [
        ev({ id: '1', kind: 'note', body: 'internal', visible_to_user: true }),
        ev({ id: '2', kind: 'assigned', visible_to_user: true }),
        ev({ id: '3', kind: 'reply_to_user', body: 'Hi', actor_profile_id: 'mod1', visible_to_user: true }),
        ev({ id: '4', kind: 'user_reply', body: 'Thanks', actor_profile_id: 'me', visible_to_user: true }),
        ev({ id: '5', kind: 'created', visible_to_user: true }),
        ev({ id: '6', kind: 'status_changed', visible_to_user: false }),
      ],
      new Set(['me'])
    );
    expect(out.map(e => [e.id, e.by])).toEqual([['3', 'support'], ['4', 'you'], ['5', 'system']]);
    expect(JSON.stringify(out)).not.toContain('mod1');
    expect(JSON.stringify(out)).not.toContain('internal');
  });
});

describe('projectTicketForAdmin', () => {
  it('keeps everything and adds the label and overdue', () => {
    const view = projectTicketForAdmin({ ...row, status: 'new', first_response_at: null, created_at: '2026-09-16T10:00:00Z' }, new Date('2026-09-18T10:00:01Z'));
    expect(view.numberLabel).toBe('EA-1042');
    expect(view.overdue).toBe(true);
    expect(view.assignee_profile_id).toBe('mod1');
    expect(view.content_snapshot).toEqual({ caption: 'the reported caption' });
  });
});

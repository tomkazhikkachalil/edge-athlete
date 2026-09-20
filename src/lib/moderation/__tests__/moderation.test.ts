import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MODERATION_STATES,
  REPEAT_INCIDENT_THRESHOLD,
  SUSPENSION_DAYS,
  actionForResolution,
  authBanDurationFor,
  effectiveState,
  ladderSuggestion,
  mayWrite,
  moderationNoticeCopy,
  shouldLimitAtIntake,
  writeRefusalMessage,
} from '../state';

describe('the vocabulary ↔ migration 223', () => {
  it('the states equal the CHECK', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'database/migrations/223_moderation.sql'), 'utf8');
    const m = /profiles_moderation_state_check\s+CHECK \(moderation_state IN \(([^)]*)\)\)/.exec(sql);
    expect(m).toBeTruthy();
    expect([...m![1].matchAll(/'([^']+)'/g)].map(x => x[1])).toEqual([...MODERATION_STATES]);
    expect(sql).toMatch(/posts_status_check[\s\S]*'hidden'/);
    expect(sql).toMatch(/post_comments_status_check[\s\S]*'hidden'/);
  });
});

describe('effectiveState', () => {
  const now = new Date('2026-09-20T12:00:00Z');
  it('pre-223 and active read as active; limited and banned stand', () => {
    expect(effectiveState(undefined, now)).toBe('active');
    expect(effectiveState({ moderation_state: 'active' }, now)).toBe('active');
    expect(effectiveState({ moderation_state: 'limited' }, now)).toBe('limited');
    expect(effectiveState({ moderation_state: 'banned', moderation_until: '2026-01-01T00:00:00Z' }, now)).toBe('banned');
  });
  it('a suspension expires by its own clock', () => {
    expect(effectiveState({ moderation_state: 'suspended', moderation_until: '2026-09-27T12:00:00Z' }, now)).toBe('suspended');
    expect(effectiveState({ moderation_state: 'suspended', moderation_until: '2026-09-20T11:59:59Z' }, now)).toBe('active');
    expect(effectiveState({ moderation_state: 'suspended', moderation_until: null }, now)).toBe('suspended');
    expect(mayWrite({ moderation_state: 'suspended', moderation_until: '2026-09-19T00:00:00Z' }, now)).toBe(true);
  });
});

describe('the ladder and the action', () => {
  it('warning, then suspension, then ban', () => {
    expect(ladderSuggestion(0)).toBe('warning');
    expect(ladderSuggestion(1)).toBe('suspension');
    expect(ladderSuggestion(2)).toBe('ban');
    expect(ladderSuggestion(9)).toBe('ban');
  });
  it('the resolution code IS the action', () => {
    expect(actionForResolution('no_action')).toEqual({ kind: 'restore' });
    expect(actionForResolution('declined')).toEqual({ kind: 'restore' });
    expect(actionForResolution('content_removed')).toEqual({ kind: 'hide' });
    expect(actionForResolution('warning')).toEqual({ kind: 'warn' });
    expect(actionForResolution('suspension')).toEqual({ kind: 'suspend', days: SUSPENSION_DAYS });
    expect(actionForResolution('ban')).toEqual({ kind: 'ban' });
    expect(actionForResolution('feature_shipped')).toEqual({ kind: 'none' });
    expect(actionForResolution(null)).toEqual({ kind: 'none' });
  });
  it('the account is limited only on repeat incidents', () => {
    expect(shouldLimitAtIntake(0)).toBe(false);
    expect(shouldLimitAtIntake(REPEAT_INCIDENT_THRESHOLD - 1)).toBe(false);
    expect(shouldLimitAtIntake(REPEAT_INCIDENT_THRESHOLD)).toBe(true);
  });
});

describe('the auth ban and the words', () => {
  it('ban_duration per state', () => {
    const now = new Date('2026-09-20T12:00:00Z');
    expect(authBanDurationFor('banned', null, now)).toBe('876000h');
    expect(authBanDurationFor('suspended', new Date('2026-09-27T12:00:00Z'), now)).toBe('168h');
    expect(authBanDurationFor('suspended', new Date('2026-09-20T12:00:01Z'), now)).toBe('1h');
    expect(authBanDurationFor('active', null, now)).toBe('none');
    expect(authBanDurationFor('limited', null, now)).toBe('none');
  });
  it('a refused write says why; no action says nothing to the reported user', () => {
    expect(writeRefusalMessage('limited', null)).toContain('read-only');
    expect(writeRefusalMessage('banned', null)).toContain('banned');
    expect(moderationNoticeCopy({ kind: 'restore' }, 'EA-1', null, null)).toBeNull();
    expect(moderationNoticeCopy({ kind: 'none' }, 'EA-1', null, null)).toBeNull();
    const warn = moderationNoticeCopy({ kind: 'warn' }, 'EA-1042', 'Keep it civil.', null)!;
    expect(warn.title).toContain('EA-1042');
    expect(warn.message).toContain('Keep it civil.');
    expect(warn.message).toContain('reply once');
    const susp = moderationNoticeCopy({ kind: 'suspend', days: 7 }, 'EA-1', null, new Date('2026-09-27T12:00:00Z'))!;
    expect(susp.title).toContain('suspended');
    // Never who reported.
    for (const c of [warn, susp]) expect(JSON.stringify(c)).not.toMatch(/report(ed|er) by/i);
  });
});

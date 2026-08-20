import { describe, it, expect } from 'vitest';
import {
  transferStateChip,
  formatCountdown,
  bannerCopy,
  terminalTransferNotice,
  type TransferState,
  type TerminalTransferState,
} from '../transfer-ui';

const ACTIVE_STATES: TransferState[] = [
  'eligible_notified',
  'requested',
  'initiated',
  'credentials_pending',
  'dual_confirm',
  'cooling_off',
  'executing',
];

describe('transferStateChip', () => {
  it('returns a label and tone for every active state', () => {
    for (const state of ACTIVE_STATES) {
      const chip = transferStateChip(state);
      expect(chip.label.length).toBeGreaterThan(0);
      expect(['violet', 'amber', 'gray']).toContain(chip.tone);
    }
  });

  it('marks guardian-action states amber', () => {
    expect(transferStateChip('requested').tone).toBe('amber');
    expect(transferStateChip('dual_confirm').tone).toBe('amber');
  });

  it('marks waiting-on-athlete states gray', () => {
    expect(transferStateChip('initiated').tone).toBe('gray');
    expect(transferStateChip('credentials_pending').tone).toBe('gray');
  });
});

describe('formatCountdown', () => {
  const now = new Date('2026-07-28T12:00:00Z');
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();

  it('formats days and hours', () => {
    expect(formatCountdown(at(6 * 86_400_000 + 4 * 3_600_000 + 60_000), now)).toBe('6 days, 4 hours');
  });

  it('drops the hours part on exact days', () => {
    expect(formatCountdown(at(7 * 86_400_000 + 60_000), now)).toBe('7 days');
  });

  it('uses singular units', () => {
    expect(formatCountdown(at(86_400_000 + 3_600_000 + 60_000), now)).toBe('1 day, 1 hour');
  });

  it('formats hours only under a day', () => {
    expect(formatCountdown(at(3 * 3_600_000 + 60_000), now)).toBe('3 hours');
  });

  it('says under an hour below 60 minutes', () => {
    expect(formatCountdown(at(30 * 60_000), now)).toBe('under an hour');
  });

  it('clamps past deadlines to "any moment now"', () => {
    expect(formatCountdown(at(0), now)).toBe('any moment now');
    expect(formatCountdown(at(-86_400_000), now)).toBe('any moment now');
  });
});

describe('bannerCopy', () => {
  it('returns a non-empty line for every active state', () => {
    for (const state of ACTIVE_STATES) {
      expect(bannerCopy(state).length).toBeGreaterThan(0);
    }
  });
});

describe('terminalTransferNotice', () => {
  const TERMINAL: TerminalTransferState[] = ['completed', 'aborted', 'failed', 'expired'];

  it('completed is silent — the pages already render "Already handed over"', () => {
    expect(terminalTransferNotice('completed', 'guardian')).toBeNull();
    expect(terminalTransferNotice('completed', 'supervised')).toBeNull();
  });

  it('every dead state explains itself to both viewers', () => {
    for (const state of TERMINAL.filter(s => s !== 'completed')) {
      for (const viewer of ['guardian', 'supervised'] as const) {
        const notice = terminalTransferNotice(state, viewer);
        expect(notice, `${state}/${viewer}`).toBeTruthy();
        // Every dead-state notice must reassure that nothing changed/was lost.
        expect(notice!.toLowerCase()).toMatch(/nothing (changed|was lost)/);
      }
    }
  });

  it('failed keeps the athlete copy actionable by the guardian, not the child', () => {
    expect(terminalTransferNotice('failed', 'supervised')).toContain('guardian');
  });
});

import { describe, it, expect } from 'vitest';
import {
  buildUrgentBatches,
  safeInternalPath,
  type UrgentRecipientInfo,
  type UrgentRow,
} from '../urgent-email';

const row = (id: string, userId: string): UrgentRow => ({
  id,
  user_id: userId,
  type: 'safety_alert',
  title: `alert ${id}`,
  created_at: '2026-08-28T12:00:00Z',
});

const info = (over: Partial<UrgentRecipientInfo> = {}): UrgentRecipientInfo => ({
  email: 'g@example.com',
  displayName: 'Guardian',
  urgentEnabled: true,
  synthetic: false,
  ...over,
});

describe('buildUrgentBatches', () => {
  it('one batch per recipient, rows in input order', () => {
    const recipients = new Map([
      ['u1', info()],
      ['u2', info({ email: 'h@example.com' })],
    ]);
    const { batches, skipped } = buildUrgentBatches(
      [row('1', 'u1'), row('2', 'u2'), row('3', 'u1')],
      recipients
    );
    expect(skipped).toBe(0);
    expect(batches).toHaveLength(2);
    expect(batches[0].items.map(i => i.id)).toEqual(['1', '3']);
  });

  it('disabled, synthetic, missing-email, and unknown recipients are SKIPPED (never batched, so never stamped)', () => {
    const recipients = new Map([
      ['off', info({ urgentEnabled: false })],
      ['minor', info({ synthetic: true })],
      ['noaddr', info({ email: null })],
    ]);
    const { batches, skipped } = buildUrgentBatches(
      [row('1', 'off'), row('2', 'minor'), row('3', 'noaddr'), row('4', 'ghost')],
      recipients
    );
    expect(batches).toHaveLength(0);
    expect(skipped).toBe(4);
  });
});

describe('safeInternalPath', () => {
  it('admits app paths only', () => {
    expect(safeInternalPath('/app/guardian')).toBe('/app/guardian');
    expect(safeInternalPath('//evil.example/x')).toBeNull();
    expect(safeInternalPath('https://evil.example')).toBeNull();
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath('app/guardian')).toBeNull();
  });
});

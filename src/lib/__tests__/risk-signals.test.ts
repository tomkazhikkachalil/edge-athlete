import { describe, it, expect } from 'vitest';
import {
  BURST_MIN_CONTACTS,
  SPIKE_MIN_MESSAGES,
  detectNewContactBurst,
  detectVolumeSpike,
  signalCopy,
  startOfUtcDay,
} from '../risk-signals';

const NOW = new Date('2026-08-29T15:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('startOfUtcDay', () => {
  it('anchors to UTC midnight (the dedup key)', () => {
    expect(startOfUtcDay(NOW).toISOString()).toBe('2026-08-29T00:00:00.000Z');
  });
});

describe('detectNewContactBurst', () => {
  it('fires at the threshold inside 48h', () => {
    const joins = Array.from({ length: BURST_MIN_CONTACTS }, (_, i) => hoursAgo(i + 1));
    const s = detectNewContactBurst(joins, NOW);
    expect(s?.kind).toBe('new_contact_burst');
    expect(s?.magnitude.newContacts).toBe(BURST_MIN_CONTACTS);
    expect(s?.windowStart).toBe('2026-08-29T00:00:00.000Z');
  });

  it('stays quiet one below the threshold', () => {
    const joins = Array.from({ length: BURST_MIN_CONTACTS - 1 }, (_, i) => hoursAgo(i + 1));
    expect(detectNewContactBurst(joins, NOW)).toBeNull();
  });

  it('joins outside the 48h window do not count', () => {
    const joins = [
      ...Array.from({ length: BURST_MIN_CONTACTS - 1 }, (_, i) => hoursAgo(i + 1)),
      hoursAgo(49),
      hoursAgo(72),
    ];
    expect(detectNewContactBurst(joins, NOW)).toBeNull();
  });

  it('garbage and future timestamps are ignored', () => {
    expect(detectNewContactBurst(['not-a-date', hoursAgo(-2)], NOW)).toBeNull();
  });
});

describe('detectVolumeSpike', () => {
  const burst = (n: number, withinHours: number) =>
    Array.from({ length: n }, (_, i) => hoursAgo((i % withinHours) + 0.5));

  it('fires on a genuine spike over a quiet baseline', () => {
    const s = detectVolumeSpike(burst(SPIKE_MIN_MESSAGES, 20), NOW);
    expect(s?.kind).toBe('message_volume_spike');
    expect(s?.magnitude.last24).toBe(SPIKE_MIN_MESSAGES);
  });

  it('a chatty kid with a matching baseline never fires', () => {
    // 40/day today AND ~40/day all week — high volume, no spike.
    const today = burst(40, 20);
    const baseline: string[] = [];
    for (let d = 1; d <= 7; d++) {
      for (let i = 0; i < 40; i++) baseline.push(hoursAgo(d * 24 + (i % 20) + 0.5));
    }
    expect(detectVolumeSpike([...today, ...baseline], NOW)).toBeNull();
  });

  it('below the absolute floor never fires even at a huge ratio', () => {
    expect(detectVolumeSpike(burst(SPIKE_MIN_MESSAGES - 1, 20), NOW)).toBeNull();
  });
});

describe('signalCopy', () => {
  it('is calm and names the child for every kind', () => {
    for (const kind of ['new_contact_burst', 'message_volume_spike', 'report_filed', 'late_night_activity'] as const) {
      const c = signalCopy(kind, 'Junior');
      expect(c.title).toContain('Junior');
      expect(c.title.toLowerCase()).toContain('worth a look');
      expect(c.message.length).toBeGreaterThan(20);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ACTIVITY_SOURCES } from '../catalog';
import {
  CONNECTION_PROVIDERS,
  CONNECTION_SOURCES,
  PROVIDER_DEFS,
  projectConnections,
  stageNote,
  type ConnectionRow,
} from '../connections';
import { DEDUPE_START_WINDOW_S, findDuplicate, incomingIsRicher, isSameActivity } from '../dedupe';

import { readdirSync } from 'node:fs';

const SQL = readFileSync(path.join(process.cwd(), 'database/migrations/247_activity_connections.sql'), 'utf8');
const wordsOf = (re: RegExp, sql: string = SQL) => {
  const m = re.exec(sql);
  expect(m).not.toBeNull();
  return [...m![1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
};

/** The chain's LAST declaration of a named CHECK — a later migration may
 *  widen it (251 did for the sources and the types); the catalog mirrors
 *  the live one, not the first. */
export function lastCheckWords(constraint: string, column: string): string[] {
  const dir = path.join(process.cwd(), 'database/migrations');
  const files = readdirSync(dir).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();
  const re = new RegExp(`ADD CONSTRAINT ${constraint}\\s+CHECK \\(${column} IN \\(([^)]*)\\)\\)`);
  let last: string[] | null = null;
  for (const f of files) {
    const sql = readFileSync(path.join(dir, f), 'utf8');
    const m = re.exec(sql);
    if (m) last = [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
  }
  expect(last, `${constraint} declared nowhere`).not.toBeNull();
  return last!;
}

describe('the vocabulary and migration 247', () => {
  it('ACTIVITY_SOURCES equals the chain\'s LAST activities_source_check exactly', () => {
    expect(lastCheckWords('activities_source_check', 'source')).toEqual([...ACTIVITY_SOURCES]);
    // 247 declared the eight providers; 251 appended the phone recorder.
    expect(wordsOf(/ADD CONSTRAINT activities_source_check\s+CHECK \(source IN \(([^)]*)\)\)/)).toEqual(ACTIVITY_SOURCES.filter(s => s !== 'live'));
  });

  it('CONNECTION_PROVIDERS equals activity_connections_provider_check exactly', () => {
    expect(wordsOf(/activity_connections_provider_check\s+CHECK \(provider IN \(([^)]*)\)\)/)).toEqual([...CONNECTION_PROVIDERS]);
  });

  it('every source but a file and the phone recorder is a connection, and every connection is a source', () => {
    expect([...CONNECTION_PROVIDERS]).toEqual(ACTIVITY_SOURCES.filter(s => s !== 'file' && s !== 'live'));
    expect([...CONNECTION_SOURCES]).toEqual([...CONNECTION_PROVIDERS]);
  });

  it('every provider has a definition; a card that cannot connect says why', () => {
    for (const p of CONNECTION_PROVIDERS) {
      const def = PROVIDER_DEFS[p];
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.devices.endsWith('.')).toBe(true);
      if (def.stage === 'live') expect(stageNote(p)).toBeNull();
      else expect(stageNote(p)).toMatch(/\.$/);
    }
    expect(PROVIDER_DEFS.upload_link.kind).toBe('link');
  });

  it('Strava is not a source (left out by decision)', () => {
    expect((ACTIVITY_SOURCES as readonly string[]).includes('strava')).toBe(false);
    expect(SQL.match(/'strava'/)).toBeNull();
  });
});

describe('projectConnections', () => {
  const row = (over: Partial<ConnectionRow> & { provider: string }): ConnectionRow => ({
    status: 'active',
    connected_at: '2026-10-01T10:00:00.000Z',
    last_sync_at: null,
    last_error: null,
    ...over,
  });

  it('answers one entry per provider, in list order, with nothing connected', () => {
    const views = projectConnections([]);
    expect(views.map(v => v.provider)).toEqual([...CONNECTION_PROVIDERS]);
    for (const v of views) {
      expect(v.state === 'available' || v.state === 'coming').toBe(true);
      expect(v.state === 'available').toBe(PROVIDER_DEFS[v.provider].stage === 'live');
      expect(v.connectedAt).toBeNull();
    }
  });

  it('a stored row reads connected; revoked and error need attention, in our words', () => {
    const views = projectConnections([
      row({ provider: 'upload_link', last_sync_at: '2026-10-01T12:00:00.000Z' }),
      row({ provider: 'polar', status: 'revoked' }),
      row({ provider: 'wahoo', status: 'error', last_error: 'Wahoo did not answer.' }),
      row({ provider: 'coros', status: 'error' }),
    ]);
    const by = Object.fromEntries(views.map(v => [v.provider, v]));
    expect(by.upload_link.state).toBe('connected');
    expect(by.upload_link.lastSyncAt).toBe('2026-10-01T12:00:00.000Z');
    expect(by.upload_link.problem).toBeNull();
    expect(by.polar.state).toBe('needs_attention');
    expect(by.polar.problem).toMatch(/Polar stopped sharing/);
    expect(by.wahoo.problem).toBe('Wahoo did not answer.');
    expect(by.coros.problem).toMatch(/retried/);
  });

  it('never carries a secret or a token hash, even from a row selected too widely', () => {
    const wide = {
      ...row({ provider: 'polar' }),
      id: 'row-id',
      profile_id: 'profile-id',
      provider_user_id: 'polar-user-9001',
      secret_ciphertext: 'v1.SECRETSECRET.aaaa.bbbb',
      token_hash: 'f'.repeat(64),
    } as unknown as ConnectionRow;
    const json = JSON.stringify(projectConnections([wide]));
    for (const leak of ['SECRETSECRET', 'f'.repeat(64), 'polar-user-9001', 'profile-id', 'row-id', 'secret', 'token']) {
      expect(json).not.toContain(leak);
    }
  });

  it('drops a row for a provider this build does not know', () => {
    const views = projectConnections([row({ provider: 'strava' })]);
    expect(views.every(v => v.state !== 'connected')).toBe(true);
  });
});

describe('one activity, however many times it arrives', () => {
  const T = Date.parse('2026-10-01T07:00:00.000Z');

  it('the same start and duration is the same activity', () => {
    expect(isSameActivity({ startedAt: T, elapsedS: 1800 }, { startedAt: T + 3000, elapsedS: 1795 })).toBe(true);
  });

  it('a start more than a minute apart is another activity', () => {
    expect(isSameActivity({ startedAt: T, elapsedS: 1800 }, { startedAt: T + DEDUPE_START_WINDOW_S * 1000, elapsedS: 1800 })).toBe(true);
    expect(isSameActivity({ startedAt: T, elapsedS: 1800 }, { startedAt: T + DEDUPE_START_WINDOW_S * 1000 + 1, elapsedS: 1800 })).toBe(false);
  });

  it('a duration more than 10% apart is another activity (the warm-up beside the run)', () => {
    expect(isSameActivity({ startedAt: T, elapsedS: 1800 }, { startedAt: T, elapsedS: 1620 })).toBe(true); // exactly 10%
    expect(isSameActivity({ startedAt: T, elapsedS: 1800 }, { startedAt: T, elapsedS: 1619 })).toBe(false);
    expect(isSameActivity({ startedAt: T, elapsedS: 1800 }, { startedAt: T + 10_000, elapsedS: 300 })).toBe(false);
  });

  it('two zero-length records at the same start are the same', () => {
    expect(isSameActivity({ startedAt: T, elapsedS: 0 }, { startedAt: T, elapsedS: 0 })).toBe(true);
  });

  it('findDuplicate picks the closest start among those that qualify', () => {
    const candidates = [
      { id: 'far', startedAt: T - 50_000, elapsedS: 1800 },
      { id: 'near', startedAt: T + 2000, elapsedS: 1810 },
      { id: 'short', startedAt: T, elapsedS: 200 },
    ];
    expect(findDuplicate(candidates, { startedAt: T, elapsedS: 1800 })?.id).toBe('near');
    expect(findDuplicate(candidates, { startedAt: T + 3_600_000, elapsedS: 1800 })).toBeNull();
    expect(findDuplicate([], { startedAt: T, elapsedS: 1800 })).toBeNull();
  });

  it('a second delivery replaces the data only when it is richer', () => {
    const thin = { hasRoute: false, hasHeartRate: false };
    const hr = { hasRoute: false, hasHeartRate: true };
    const route = { hasRoute: true, hasHeartRate: false };
    const full = { hasRoute: true, hasHeartRate: true };
    expect(incomingIsRicher(thin, route)).toBe(true);
    expect(incomingIsRicher(thin, hr)).toBe(true);
    expect(incomingIsRicher(route, full)).toBe(true);
    expect(incomingIsRicher(hr, route)).toBe(true); // the route outranks the heart rate
    expect(incomingIsRicher(route, hr)).toBe(false);
    expect(incomingIsRicher(full, full)).toBe(false); // equal: what is stored stands
    expect(incomingIsRicher(full, thin)).toBe(false);
    expect(incomingIsRicher(thin, thin)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { PROFILE_FK_POLICY } from '../account-departure';
import { profileForeignKeys } from './helpers/live-schema';

/**
 * Departed accounts (migration 238): when the deletion engine KEEPS a profile
 * row as a tombstone, the 73 `ON DELETE CASCADE` foreign keys onto
 * profiles(id) stop cleaning up after the person. Every one of them must be
 * classified in PROFILE_FK_POLICY — the result survives, the engine deletes
 * it, or the engine decides row by row — so a table added later cannot leave
 * personal data behind a tombstone unseen. Read from the baseline plus every
 * migration above its head (the live state, from files).
 */
describe('every cascading FK onto profiles is classified for a departed row', () => {
  const fks = profileForeignKeys();
  const cascading = [...fks].filter(([, action]) => action === 'CASCADE').map(([k]) => k).sort();

  it('reads a plausible set (the parser found the baseline)', () => {
    expect(cascading.length).toBeGreaterThan(60);
    expect(cascading).toContain('posts.profile_id');
  });

  it('every cascading FK has a policy', () => {
    const missing = cascading.filter(k => !(k in PROFILE_FK_POLICY));
    expect(missing).toEqual([]);
  });

  it('no policy names an FK that no longer cascades (the list stays true)', () => {
    const stale = Object.keys(PROFILE_FK_POLICY).filter(k => !cascading.includes(k));
    expect(stale).toEqual([]);
  });

  it('238 made athlete_performances SET NULL (the dataset outlives the person)', () => {
    expect(fks.get('athlete_performances.profile_id')).toBe('SET NULL');
  });

  it('the results Tom named survive', () => {
    for (const k of [
      'competition_entries.profile_id',
      'contest_stat_lines.profile_id',
      'sport_event_participants.profile_id',
      'sport_event_stat_lines.profile_id',
      'sport_events.host_profile_id',
    ]) expect(PROFILE_FK_POLICY[k], k).toBe('survives');
  });
});

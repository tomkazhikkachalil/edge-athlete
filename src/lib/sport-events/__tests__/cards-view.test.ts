import { describe, expect, it } from 'vitest';
import { cardRows, notFinalNames } from '../cards-view';
import { tabsFor } from '../tabs';

const people = [{ profile_id: 'a', name: 'Ann L.', status: 'accepted', playing: true, role: 'organizer' }, { profile_id: 'b', name: 'Bo K.', status: 'accepted', playing: true, role: 'participant' }];
const card = (id: string, profile: string, status: string | null, holes: number, pstatus = 'confirmed') => ({ participant: { id, profile_id: profile, status: pstatus, role: 'participant' }, scores: { status, holes_completed: holes, total_score: holes ? 4 * holes : null, to_par: 0, hole_scores: [] } });

describe('the Scorecard tab rows', () => {
  it('joins by profile, reads the 204 status, and answers what the viewer may do', () => {
    const rows = cardRows([card('ra', 'a', 'in_progress', 3), card('rb', 'b', 'submitted', 9), card('rx', 'x', null, 0, 'declined')], people, { profileId: 'b', canManage: false });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ pid: 'ra', name: 'Ann L.', status: 'in_progress', holesCompleted: 3, isSelf: false, canSubmit: false, canFinalize: false, canReopen: false });
    expect(rows[1]).toMatchObject({ pid: 'rb', name: 'Bo K.', status: 'submitted', isSelf: true, canSubmit: false, canFinalize: false });
    const own = cardRows([card('rb', 'b', 'in_progress', 1)], people, { profileId: 'b', canManage: false });
    expect(own[0].canSubmit).toBe(true);
    expect(cardRows([card('rb', 'b', 'in_progress', 0)], people, { profileId: 'b', canManage: false })[0].canSubmit).toBe(false);
    const org = cardRows([card('ra', 'a', 'final', 9), card('rb', 'b', 'in_progress', 2)], people, { profileId: 'a', canManage: true });
    expect(org.map(r => [r.canFinalize, r.canReopen])).toEqual([[false, true], [true, false]]);
    expect(notFinalNames(org)).toEqual(['Bo K.']);
  });
  it('the Scorecard tab needs a minted round and a player or an organizer', () => {
    expect(tabsFor({ canManage: false, isPlayer: true, roundMinted: false })).not.toContain('scorecard');
    expect(tabsFor({ canManage: false, isPlayer: true, roundMinted: true })).toContain('scorecard');
    expect(tabsFor({ canManage: true, roundMinted: true })).toContain('scorecard');
    expect(tabsFor({ canManage: false, isPlayer: false, roundMinted: true })).not.toContain('scorecard');
  });
});

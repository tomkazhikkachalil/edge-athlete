import { describe, expect, it } from 'vitest';
import { projectEvent, projectParticipant, projectViewer, roundCounts, visibleParticipants } from '../view';
import type { SportEventParticipantRow, SportEventRow } from '../types';

const event: SportEventRow = {
  id: 'e1', host_profile_id: 'host', created_by_user_id: 'guardian-user', org_id: null, org: null, sport_key: 'golf', name: 'Open', description: null, cover_path: null,
  join_mode: 'invite', visibility: 'link', link_token: 'secret', format: 'stroke_gross', status: 'open', capacity: null, starts_on: '2026-10-03',
  opened_at: null, went_live_at: null, completed_at: null, cancelled_at: null, created_at: 'c', updated_at: 'u',
};
let n = 0;
const row = (over: Partial<SportEventParticipantRow> = {}): SportEventParticipantRow => ({
  id: `r${++n}`, sport_event_id: 'e1', profile_id: `p${n}`, role: 'participant', status: 'accepted', playing: true, handicap_index: 10, handicap_source: 'computed', flight: null,
  waitlist_position: null, hide_from_profile: true, invited_by: null, accepted_at: null, responded_at: null, created_at: 'c', updated_at: 'u', ...over,
});
const manage = { canView: true as const, canManage: true, canDelete: true, role: 'organizer' as const, participantStatus: 'accepted' as const };
const view = { canView: true as const, canManage: false, canDelete: false, role: 'viewer' as const, participantStatus: null };

describe('the event projection', () => {
  it('the link token reaches organizers only; created_by_user_id never leaves', () => {
    expect(projectEvent(event, manage).link_token).toBe('secret');
    expect(projectEvent(event, view).link_token).toBeNull();
    expect(JSON.stringify(projectEvent(event, manage))).not.toContain('guardian-user');
  });
  it('phase 3: `match` is null on a stroke format and the defaults-filled options on a match format', () => {
    expect(projectEvent(event, view).match).toBeNull();
    expect(projectEvent({ ...event, format: 'match_gross' }, view).match).toEqual({ sides: 'singles', bracket: false, allowance: 100 });
    expect(projectEvent({ ...event, format: 'match_net', format_config: { match: { sides: 'fourball', bracket: true } } }, view)).toMatchObject({ format_config: { match: { sides: 'fourball', bracket: true } }, match: { sides: 'fourball', bracket: true, allowance: 90 } });
  });
  it('a participant is masked like a contest player: a private profile prints "First L.", never an email or supervision state', () => {
    const r = row({ profile_id: 'p' });
    const priv = { id: 'p', first_name: 'Sam', last_name: 'Kim', full_name: 'Sam Kim', visibility: 'private', email: 'sam@example.com', supervision_state: null, handle: 'samk', avatar_url: null };
    const pub = { ...priv, visibility: 'public' };
    const out = projectParticipant(r, priv, { profileId: 'x', canManage: false });
    expect(out).toMatchObject({ name: 'Sam K.', handle: null, hide_from_profile: null });
    expect(JSON.stringify(out)).not.toContain('sam@example.com');
    expect(projectParticipant(r, pub, { profileId: 'x', canManage: false })).toMatchObject({ name: 'Sam Kim', handle: 'samk' });
    expect(projectParticipant(r, pub, { profileId: 'p', canManage: false }).hide_from_profile).toBe(true); // self
    expect(projectParticipant(r, pub, { profileId: 'x', canManage: true }).hide_from_profile).toBe(true); // organizer
    expect(projectParticipant(r, null, { profileId: 'x', canManage: false }).name).toBe('Athlete');
  });
  it("organizers see the whole roster; a player sees the live roster plus their own row — never another's queue place (phase 2)", () => {
    const rows = [row({ profile_id: 'me', status: 'declined' }), row({ status: 'removed' }), row({ status: 'withdrawn' }), row({ status: 'invited' }), row({ status: 'waitlisted', waitlist_position: 1 }), row()];
    expect(visibleParticipants(rows, { profileId: 'x', canManage: true })).toHaveLength(6);
    expect(visibleParticipants(rows, { profileId: 'x', canManage: false })).toHaveLength(2);
    expect(visibleParticipants(rows, { profileId: 'me', canManage: false })).toHaveLength(3);
    const q = row({ profile_id: 'queued', status: 'waitlisted', waitlist_position: 2 });
    expect(visibleParticipants([...rows, q], { profileId: 'queued', canManage: false }).map(r => r.profile_id)).toContain('queued'); // your own queue place, always
  });
  it('counts and the viewer block', () => {
    const rows = [row(), row({ role: 'follower', playing: false }), row({ status: 'waitlisted', waitlist_position: 1 }), row({ playing: false }), row({ status: 'invited' })];
    expect(roundCounts(rows)).toEqual({ playing: 1, followers: 1, waitlisted: 1 });
    expect(projectViewer('v', view, null)).toEqual({ profile_id: 'v', role: 'viewer', can_manage: false, can_delete: false, participant_id: null, participant_status: null, playing: false, hide_from_profile: false, waitlist_ahead: null, recorder: false });
    const q1 = row({ status: 'waitlisted', waitlist_position: 1 });
    const q2 = row({ status: 'waitlisted', waitlist_position: 2 });
    expect(projectViewer(q2.profile_id, view, q2, [row(), q1, q2]).waitlist_ahead).toBe(1); // phase 2: the queue in front
    expect(projectViewer(q1.profile_id, view, q1, [row(), q1, q2]).waitlist_ahead).toBe(0);
    expect(projectViewer('v', manage, row({ id: 'own', hide_from_profile: true }))).toMatchObject({ participant_id: 'own', can_manage: true, hide_from_profile: true, playing: true });
  });
});

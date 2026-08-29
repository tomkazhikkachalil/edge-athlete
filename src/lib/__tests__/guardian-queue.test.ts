import { describe, it, expect } from 'vitest';
import {
  AGING_BADGE_MS,
  buildQueueItems,
  flattenInviteRows,
  TRANSFER_NEEDS_GUARDIAN,
  type QueueFollowRow,
  type RawInviteRow,
  type RosterRow,
} from '../guardian-queue';

const kid = (id: string, over: Partial<RosterRow> = {}): RosterRow => ({
  id,
  first_name: id === 'a' ? 'Maya' : 'Jonah',
  last_name: 'Test',
  full_name: null,
  handle: `${id}-handle`,
  avatar_url: null,
  supervision_state: 'supervised',
  ...over,
});

const approvedConsent = (id: string) => [{ profile_id: id, action: 'review_approved' }];

const post = (id: string, profileId: string, createdAt: string, status = 'pending_approval') => ({
  id,
  profile_id: profileId,
  caption: `post ${id}`,
  created_at: createdAt,
  status,
  mediaCount: 0,
  thumbnailUrl: null,
});

const comment = (id: string, profileId: string, createdAt: string, status = 'pending_approval') => ({
  id,
  profile_id: profileId,
  content: `comment ${id}`,
  created_at: createdAt,
  status,
});

describe('buildQueueItems', () => {
  it('empty everything → empty queue', () => {
    expect(buildQueueItems([], [], [], [], [], [], [])).toEqual([]);
  });

  it('handover moment (Wave 8): a stamped adult eligible_notified row surfaces; unstamped stays silent', () => {
    const base = { profile_id: 'a', id: 'tr-h', created_at: '2026-08-28T10:00:00Z' };
    const stamped = buildQueueItems(
      [kid('a')], [], [], [], approvedConsent('a'),
      [{ user_id: 'a', profile_id: 'a' }],
      [{ ...base, state: 'eligible_notified', handover_prompted_at: '2026-08-29T10:00:00Z' }]
    );
    const item = stamped.find(i => i.kind === 'transfer_step');
    expect(item).toMatchObject({ handover: true, state: 'eligible_notified' });

    // Pre-adult parked rows (no stamp) never show — eligible_notified was
    // never a guardian action item before Wave 8, and stays quiet.
    const unstamped = buildQueueItems(
      [kid('a')], [], [], [], approvedConsent('a'),
      [{ user_id: 'a', profile_id: 'a' }],
      [{ ...base, state: 'eligible_notified', handover_prompted_at: null }]
    );
    expect(unstamped.find(i => i.kind === 'transfer_step')).toBeUndefined();
  });

  it('risk signals (Wave 7) shape after content, oldest first, roster-scoped', () => {
    const items = buildQueueItems(
      [kid('a')],
      [post('p1', 'a', '2026-08-20T10:00:00Z')],
      [],
      [],
      approvedConsent('a'),
      [{ user_id: 'a', profile_id: 'a' }],
      [],
      [],
      [],
      null,
      [
        { id: 'r2', profile_id: 'a', kind: 'message_volume_spike', created_at: '2026-08-29T09:00:00Z' },
        { id: 'r1', profile_id: 'a', kind: 'new_contact_burst', created_at: '2026-08-28T09:00:00Z' },
        // Not on this guardian's roster — must vanish, never leak.
        { id: 'rx', profile_id: 'stranger', kind: 'report_filed', created_at: '2026-08-29T09:00:00Z' },
      ]
    );
    expect(items.map(i => i.id)).toEqual(['p1', 'r1', 'r2']);
    const r1 = items[1];
    expect(r1.kind).toBe('risk_signal');
    if (r1.kind === 'risk_signal') {
      expect(r1.signalKind).toBe('new_contact_burst');
      expect(r1.athlete.name).toContain('Maya');
    }
  });

  it('interleaves posts and comments oldest-first ahead of everything else', () => {
    const items = buildQueueItems(
      [kid('a')],
      [post('p1', 'a', '2026-08-20T10:00:00Z'), post('p2', 'a', '2026-08-22T10:00:00Z')],
      [comment('c1', 'a', '2026-08-21T10:00:00Z')],
      [],
      approvedConsent('a'),
      [{ user_id: 'a', profile_id: 'a' }],
      []
    );
    expect(items.map(i => i.id)).toEqual(['p1', 'c1', 'p2']);
    expect(items.map(i => i.kind)).toEqual(['approve_post', 'release_comment', 'approve_post']);
  });

  it('gap derivation matches the old attention rules: supervised + consent none/rejected + no SELF row', () => {
    const items = buildQueueItems(
      [kid('a')],
      [],
      [],
      [],
      [{ profile_id: 'a', action: 'review_rejected' }],
      [],
      []
    );
    expect(items).toEqual([
      expect.objectContaining({ kind: 'consent_gap', consentState: 'rejected', href: '/app/guardian/consent/a' }),
      expect.objectContaining({ kind: 'credentials_gap', href: '/app/guardian/credentials/a' }),
    ]);
  });

  it('transferred (self) athletes get no consent/credentials gaps', () => {
    const items = buildQueueItems(
      [kid('a', { supervision_state: 'self' })],
      [],
      [],
      [],
      [],
      [],
      []
    );
    expect(items).toEqual([]);
  });

  it('a supervised SELF row counts as login; a supervised row pointing elsewhere does not', () => {
    const items = buildQueueItems(
      [kid('a')],
      [],
      [],
      [],
      approvedConsent('a'),
      [{ user_id: 'other', profile_id: 'a' }],
      []
    );
    expect(items).toEqual([expect.objectContaining({ kind: 'credentials_gap' })]);
  });

  it('consentBlocked is set on content until consent is approved', () => {
    const blocked = buildQueueItems(
      [kid('a')],
      [post('p1', 'a', '2026-08-20T10:00:00Z')],
      [],
      [],
      [{ profile_id: 'a', action: 'granted' }], // pending_review
      [{ user_id: 'a', profile_id: 'a' }],
      []
    );
    expect(blocked[0]).toMatchObject({ kind: 'approve_post', consentBlocked: true });

    const clear = buildQueueItems(
      [kid('a')],
      [post('p1', 'a', '2026-08-20T10:00:00Z')],
      [],
      [],
      approvedConsent('a'),
      [{ user_id: 'a', profile_id: 'a' }],
      []
    );
    expect(clear[0]).toMatchObject({ consentBlocked: false });
  });

  it('latest consent action wins — rows arrive created_at DESC', () => {
    const items = buildQueueItems(
      [kid('a')],
      [],
      [],
      [],
      [
        { profile_id: 'a', action: 'review_approved' }, // newest
        { profile_id: 'a', action: 'review_rejected' },
      ],
      [{ user_id: 'a', profile_id: 'a' }],
      []
    );
    expect(items.find(i => i.kind === 'consent_gap')).toBeUndefined();
  });

  it('follow requests unwrap object OR array follower embeds; missing follower rows drop', () => {
    const follower = {
      id: 'fan-1',
      first_name: 'Fan',
      last_name: 'One',
      full_name: null,
      handle: 'fan1',
      avatar_url: null,
    };
    const rows: QueueFollowRow[] = [
      { id: 'f1', following_id: 'a', message: 'hi', created_at: '2026-08-20T10:00:00Z', follower },
      { id: 'f2', following_id: 'a', message: null, created_at: '2026-08-21T10:00:00Z', follower: [follower] },
      { id: 'f3', following_id: 'a', message: null, created_at: '2026-08-22T10:00:00Z', follower: null },
    ];
    const items = buildQueueItems(
      [kid('a')],
      [],
      [],
      rows,
      approvedConsent('a'),
      [{ user_id: 'a', profile_id: 'a' }],
      []
    );
    expect(items.map(i => i.id)).toEqual(['f1', 'f2']);
    expect(items[0]).toMatchObject({
      kind: 'follow_request',
      follower: { id: 'fan-1', name: 'Fan One', handle: 'fan1' },
      message: 'hi',
    });
  });

  it('only guardian-court transfer states surface', () => {
    const items = buildQueueItems(
      [kid('a'), kid('b')],
      [],
      [],
      [],
      [...approvedConsent('a'), ...approvedConsent('b')],
      [
        { user_id: 'a', profile_id: 'a' },
        { user_id: 'b', profile_id: 'b' },
      ],
      [
        { profile_id: 'a', state: 'requested' },
        { profile_id: 'b', state: 'cooling_off' },
      ]
    );
    expect(items).toEqual([
      expect.objectContaining({ kind: 'transfer_step', state: 'requested', href: '/app/transfer/a' }),
    ]);
    expect(TRANSFER_NEEDS_GUARDIAN.has('cooling_off')).toBe(false);
  });

  it('rows for athletes outside the roster are ignored (parked athletes are filtered by the route)', () => {
    const items = buildQueueItems(
      [kid('a')],
      [post('p1', 'ghost', '2026-08-20T10:00:00Z')],
      [comment('c1', 'ghost', '2026-08-20T10:00:00Z')],
      [],
      approvedConsent('a'),
      [{ user_id: 'a', profile_id: 'a' }],
      [{ profile_id: 'ghost', state: 'requested' }]
    );
    expect(items).toEqual([]);
  });

  it('full ordering: content → follows → transfers → consent gaps → credentials gaps', () => {
    const follower = {
      id: 'fan-1', first_name: 'Fan', last_name: null, full_name: null, handle: null, avatar_url: null,
    };
    const items = buildQueueItems(
      [kid('a'), kid('b', { supervision_state: 'supervised' })],
      [post('p1', 'a', '2026-08-20T10:00:00Z')],
      [],
      [{ id: 'f1', following_id: 'a', message: null, created_at: '2026-08-19T10:00:00Z', follower }],
      approvedConsent('a'), // b has none → consent gap
      [{ user_id: 'a', profile_id: 'a' }], // b has no login → credentials gap
      [{ profile_id: 'a', state: 'dual_confirm' }]
    );
    expect(items.map(i => i.kind)).toEqual([
      'approve_post',
      'follow_request',
      'transfer_step',
      'consent_gap',
      'credentials_gap',
    ]);
  });
});

describe('changes_requested → waiting_on_child rows', () => {
  it('sent-back posts and comments become gray waiting rows sorted LAST, never action items', () => {
    const items = buildQueueItems(
      [kid('a')],
      [
        post('p1', 'a', '2026-08-22T10:00:00Z'),
        post('p2', 'a', '2026-08-20T10:00:00Z', 'changes_requested'),
      ],
      [comment('c1', 'a', '2026-08-21T10:00:00Z', 'changes_requested')],
      [],
      approvedConsent('a'),
      [{ user_id: 'a', profile_id: 'a' }],
      []
    );
    expect(items.map(i => [i.kind, i.id])).toEqual([
      ['approve_post', 'p1'],
      ['waiting_on_child', 'p2'],
      ['waiting_on_child', 'c1'],
    ]);
    expect(items[1]).toMatchObject({ contentKind: 'post' });
    expect(items[2]).toMatchObject({ contentKind: 'comment' });
  });

  it('waiting rows sort after gap items too', () => {
    const items = buildQueueItems(
      [kid('a')],
      [post('p1', 'a', '2026-08-20T10:00:00Z', 'changes_requested')],
      [],
      [],
      [], // consent none → consent_gap
      [],
      []
    );
    expect(items.map(i => i.kind)).toEqual(['consent_gap', 'credentials_gap', 'waiting_on_child']);
  });
});

describe('flattenInviteRows + calendar_invite items', () => {
  const NOW = Date.parse('2026-08-28T12:00:00Z');
  const inviteEvent = (id: string, over: Partial<RawInviteRow['events'] & object> = {}) => ({
    id,
    title: `event ${id}`,
    starts_at: '2026-08-29T15:00:00Z',
    ends_at: '2026-08-29T17:00:00Z',
    all_day: false,
    timezone: 'UTC',
    status: 'active',
    ...over,
  });

  it('unwraps object OR array embeds, drops cancelled and already-ended events', () => {
    const rows: RawInviteRow[] = [
      { id: 'g1', profile_id: 'a', created_at: '2026-08-27T10:00:00Z', events: inviteEvent('e1') },
      { id: 'g2', profile_id: 'a', created_at: '2026-08-27T11:00:00Z', events: [inviteEvent('e2')] },
      { id: 'g3', profile_id: 'a', created_at: '2026-08-27T12:00:00Z', events: inviteEvent('e3', { status: 'cancelled' }) },
      {
        id: 'g4', profile_id: 'a', created_at: '2026-08-27T13:00:00Z',
        events: inviteEvent('e4', { starts_at: '2026-08-20T15:00:00Z', ends_at: '2026-08-20T17:00:00Z' }),
      },
      { id: 'g5', profile_id: 'a', created_at: '2026-08-27T14:00:00Z', events: null },
    ];
    const flat = flattenInviteRows(rows, NOW);
    expect(flat.map(r => r.id)).toEqual(['g1', 'g2']);
    expect(flat[0].event).not.toHaveProperty('status');
  });

  it('calendar_invite items slot after follow requests and before the gap tail', () => {
    const follower = {
      id: 'fan-1', first_name: 'Fan', last_name: null, full_name: null, handle: null, avatar_url: null,
    };
    const items = buildQueueItems(
      [kid('a')],
      [],
      [],
      [{ id: 'f1', following_id: 'a', message: null, created_at: '2026-08-27T10:00:00Z', follower }],
      [], // consent none → gaps
      [],
      [],
      flattenInviteRows(
        [{ id: 'g1', profile_id: 'a', created_at: '2026-08-27T10:00:00Z', events: inviteEvent('e1') }],
        NOW
      )
    );
    expect(items.map(i => i.kind)).toEqual([
      'follow_request',
      'calendar_invite',
      'consent_gap',
      'credentials_gap',
    ]);
    expect(items[1]).toMatchObject({ id: 'g1', event: { id: 'e1', title: 'event e1' } });
  });
});

describe('AGING_BADGE_MS', () => {
  it('is exactly 48 hours — the badge and the PR-3 cron nudge must agree', () => {
    expect(AGING_BADGE_MS).toBe(48 * 3_600_000);
  });
});

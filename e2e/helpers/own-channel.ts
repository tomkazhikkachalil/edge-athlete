import type { SupabaseClient } from '@supabase/supabase-js';
import { test } from './test';
import { E2E_TARGET } from './qa-user';
import { MOCK_DEFAULT_CHANNEL, startYouTubeMock, type YouTubeMock } from './youtube-mock';

/**
 * Only the connected channel (Nov 11 2026): POST /api/videos saves a link
 * only when YouTube says the video belongs to the channel connected to the
 * owner. A spec that is NOT about the connection itself gets both halves
 * here:
 *
 *  - `useOwnChannel(ids)` — on staging the stand-in Google is started for
 *    the file and answers those ids as public videos on MOCK_DEFAULT_CHANNEL.
 *    On production (the sanctioned probe) nothing is started: the real
 *    YouTube answers through the server's key.
 *  - `seedOwnChannel(admin, owner, userId)` — a connection row for the owner
 *    naming that channel, written by the service role. It is `revoked` with
 *    no sealed grant (a QA account has no Google account), so the server
 *    checks ownership through its key alone — the same comparison, no token.
 *
 * On production the probes link YouTube's own first upload; its channel is
 * the constant below.
 */
const REAL_CHANNEL_OF: Record<string, string> = {
  jNQXAC9IVRw: 'UC4QobU6STFB0P71PMvOGN5A', // "Me at the zoo" — jawed
};

/** The channel the seeded connection names: the stand-in's default, or on production the real channel of `videoId`. */
export function ownChannelFor(videoId = 'jNQXAC9IVRw'): string {
  if (E2E_TARGET !== 'prod') return MOCK_DEFAULT_CHANNEL;
  const real = REAL_CHANNEL_OF[videoId];
  if (!real) throw new Error(`own-channel: no real channel is recorded for ${videoId} — a production probe links only the ids in REAL_CHANNEL_OF`);
  return real;
}

/** Start the stand-in for this file (staging only) and have it answer `ids` as the default channel's public videos. */
export function useOwnChannel(ids: readonly string[]): { mock: () => YouTubeMock | null } {
  let mock: YouTubeMock | null = null;
  test.beforeAll(async () => {
    if (E2E_TARGET === 'prod') return;
    mock = await startYouTubeMock();
    for (const id of ids) mock.videoChannels.set(id, MOCK_DEFAULT_CHANNEL);
  });
  test.afterAll(async () => {
    await mock?.close();
    mock = null;
  });
  return { mock: () => mock };
}

export type SeedOwner = { profileId: string } | { orgId: string };

/** The owner's connection names `channelId` (replacing any row); returns the undo. */
export async function seedOwnChannel(admin: SupabaseClient, owner: SeedOwner, connectedByUserId: string, channelId: string = ownChannelFor()): Promise<() => Promise<void>> {
  const column = 'profileId' in owner ? 'profile_id' : 'org_id';
  const id = 'profileId' in owner ? owner.profileId : owner.orgId;
  const remove = async () => { await admin.from('youtube_connections').delete().eq(column, id); };
  await remove();
  const { error } = await admin.from('youtube_connections').insert({
    [column]: id,
    connected_by_user_id: connectedByUserId,
    channel_id: channelId,
    channel_title: 'QA Seeded Channel',
    scopes: ['readonly'],
    status: 'revoked',
  });
  if (error) throw new Error(`own-channel: could not seed the connection: ${error.message}`);
  return remove;
}

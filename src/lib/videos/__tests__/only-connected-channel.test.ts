import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANNEL_REFUSALS, channelRefusalText, channelVerdict } from '../youtube-connection';
import { canAdvanceVideoStep } from '../video-steps';

/**
 * Only the connected channel (Nov 11 2026, Tom): a full game is linked only
 * when YouTube says the video belongs to the channel connected to that
 * profile or org — nobody posts another creator's game as their own.
 */
const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('channelVerdict', () => {
  it('no connection is unconnected, whatever the video', () => {
    expect(channelVerdict(null, { channelId: 'UCa' })).toBe('unconnected');
    expect(channelVerdict(undefined, undefined)).toBe('unconnected');
    expect(channelVerdict('', null)).toBe('unconnected');
  });
  it('the same channel is own; any other is other (exact, case-sensitive ids)', () => {
    expect(channelVerdict('UCa', { channelId: 'UCa' })).toBe('own');
    expect(channelVerdict('UCa', { channelId: 'UCb' })).toBe('other');
    expect(channelVerdict('UCa', { channelId: 'uca' })).toBe('other');
  });
  it('a read that failed, or one without a channel id, is unreadable — never own', () => {
    expect(channelVerdict('UCa', undefined)).toBe('unreadable');
    expect(channelVerdict('UCa', { channelId: null })).toBe('unreadable');
  });
  it('a video YouTube does not have is missing', () => {
    expect(channelVerdict('UCa', null)).toBe('missing');
  });
});

describe('the refusals', () => {
  it('every verdict but own has a status and a sentence', () => {
    expect(CHANNEL_REFUSALS.unconnected.status).toBe(409);
    expect(CHANNEL_REFUSALS.other.status).toBe(403);
    expect(CHANNEL_REFUSALS.missing.status).toBe(404);
    expect(CHANNEL_REFUSALS.unreadable.status).toBe(503);
    for (const r of Object.values(CHANNEL_REFUSALS)) expect(r.error.length).toBeGreaterThan(20);
  });
  it('another channel\'s refusal names the connected channel when it is known', () => {
    expect(channelRefusalText('other', 'Maple Ridge GC')).toContain('Only videos from Maple Ridge GC');
    expect(channelRefusalText('other', '  ')).toBe(CHANNEL_REFUSALS.other.error);
    expect(channelRefusalText('unconnected', 'Maple Ridge GC')).toBe(CHANNEL_REFUSALS.unconnected.error);
  });
});

describe('the flow refuses Next on it', () => {
  const base = { videoId: 'jNQXAC9IVRw', linkTyped: true, title: 't', owner: 'me' as const };
  it('on the Link step and on Where (the owner is chosen there); Details passes', () => {
    expect(canAdvanceVideoStep('link', { ...base, channelBlocked: 'no' })).toEqual({ ok: false, refusal: 'no' });
    expect(canAdvanceVideoStep('where', { ...base, channelBlocked: 'no' })).toEqual({ ok: false, refusal: 'no' });
    expect(canAdvanceVideoStep('details', { ...base, channelBlocked: 'no' })).toEqual({ ok: true });
    expect(canAdvanceVideoStep('link', base)).toEqual({ ok: true });
    expect(canAdvanceVideoStep('where', base)).toEqual({ ok: true });
  });
  it('someone who can still pick a club or league passes Link (a note) and is refused at Where — never a dead end', () => {
    expect(canAdvanceVideoStep('link', { ...base, channelBlocked: 'no', canChangeOwner: true })).toEqual({ ok: true });
    expect(canAdvanceVideoStep('where', { ...base, channelBlocked: 'no', canChangeOwner: true })).toEqual({ ok: false, refusal: 'no' });
  });
  it('a private video\'s sentence comes first', () => {
    expect(canAdvanceVideoStep('link', { ...base, blocked: 'private', channelBlocked: 'no' })).toEqual({ ok: false, refusal: 'private' });
  });
});

describe('the one writer enforces it', () => {
  it('POST /api/videos checks the channel before createVideo', () => {
    const route = src('src/app/api/videos/route.ts');
    const check = route.indexOf('videoChannelCheck(admin, channelOwner, link.id)');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(route.indexOf('await createVideo('));
  });
  it('the read carries snippet.channelId, and a check that cannot be made is never own', () => {
    expect(src('src/lib/videos/google-youtube-server.ts')).toContain('channelId: str(first.snippet?.channelId)');
    const server = src('src/lib/videos/youtube-connections-server.ts');
    expect(server).toContain("verdict: channelVerdict(row.channel_id, video)");
    expect(server).toContain("verdict: 'unconnected'");
  });
  it('no other route inserts a videos row', () => {
    expect(src('src/app/api/videos/youtube/broadcast/route.ts')).not.toContain('createVideo');
    expect(src('src/app/api/videos/youtube/upload-session/route.ts')).not.toContain('createVideo');
  });
});

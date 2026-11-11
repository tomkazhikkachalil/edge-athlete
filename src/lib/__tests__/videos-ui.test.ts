import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/**
 * Videos program (296) — the doors and the player, pinned at the source:
 * the Create sheet's fifth door, the composer's "too long" hint naming the
 * same door, the player built from the link helper and never a script, and
 * the pages that must stay reachable.
 */
describe('the Videos program\'s doors', () => {
  it('the Create sheet has the Full game door and the header opens /videos/new', () => {
    const sheet = read('src/components/CreateSheet.tsx');
    expect(sheet).toContain('data-create-full-game=""');
    expect(sheet).toMatch(/faFilm|fa-film/);
    expect(sheet).toContain('onFullGame');
    // The four doors before it are untouched.
    for (const hook of ['data-create-post', 'data-create-sport', 'data-create-event', 'data-create-record-activity']) expect(sheet).toContain(hook);
    expect(read('src/components/AppHeader.tsx')).toContain("onFullGame={() => { setIsCreateOpen(false); router.push('/videos/new'); }}");
  });

  it('the composer keeps its "Too long" tile line byte-identical and names the full-game door in the footer hint', () => {
    const composer = read('src/components/CreatePostModal.tsx');
    expect(composer).toContain('Too long — trim in the editor');
    expect(composer).toContain('data-full-game-link=""');
    expect(composer).toContain('href="/videos/new"');
    expect(composer).toContain("'Add a caption or media to post'");
  });

  it('the Create menu spec lists five doors', () => {
    const spec = read('docs/specs/ui-conventions.md');
    expect(spec).toContain('Five doors in this order');
    expect(spec).toContain('`data-create-full-game`');
  });
});

describe('the places (Phase 1b)', () => {
  it('the round card\'s Media tab carries the Videos strip above the capture row; the live page a silent read-only strip', () => {
    const card = read('src/components/golf/SharedRoundFullCard.tsx');
    expect(card.indexOf('<RoundVideos groupPostId={group_post.id} />')).toBeLessThan(card.indexOf('<RoundMediaManager'));
    expect(read('src/components/golf/RoundVideos.tsx')).toContain('groupPostId=');
    const live = read('src/components/sport-events/EventLiveScreen.tsx');
    expect(live).toContain('<EventLiveVideos eventId={eventId} token={token} />');
    expect(read('src/components/sport-events/EventLiveVideos.tsx')).toContain('hideWhenEmpty hideDoor');
  });
  it('the activity screen lists its videos and offers the owner the door beside the capture buttons; the workout review offers it and the card lists them', () => {
    const activity = read('src/components/activities/ActivityScreen.tsx');
    expect(activity).toContain('data-activity-videos=""');
    expect(activity).toContain('label="Full recording (YouTube)"');
    expect(activity.indexOf('data-activity-photo-input')).toBeLessThan(activity.indexOf('label="Full recording (YouTube)"'));
    expect(read('src/components/workouts/WorkoutEditorScreen.tsx')).toContain('label="Full session (YouTube)"');
    expect(read('src/components/workouts/WorkoutCard.tsx')).toContain('<WorkoutVideos sessionId={session.id} />');
  });
});

describe('the public site\'s Videos tile (Phase 1b)', () => {
  it('is a server-safe srcdoc poster built from the id, gated by the gallery module, never a client component', () => {
    const tile = read('src/app/(public)/org/[slug]/_components/VideosList.tsx');
    expect(tile).not.toMatch(/^'use client'/m);
    expect(tile).toContain('srcDoc={posterDoc(v.videoId)}');
    expect(tile).not.toMatch(/from '@\/components\//);
    expect(tile).toContain("from '@/lib/videos/youtube'");
    expect(read('src/lib/site-builder/catalog.ts')).toMatch(/video_list: \{[\s\S]*?moduleKey: 'gallery'/);
    expect(read('src/lib/org-sites/public-data.ts')).toMatch(/fetchPublicOrgVideos[\s\S]*?\.eq\('org_id', orgId\)[\s\S]*?\.eq\('status', 'published'\)/);
  });
});

describe('the player', () => {
  const player = read('src/components/videos/YouTubePlayer.tsx');
  it('is an iframe built by the link helper, never a script and never a raw <video>', () => {
    expect(player).toContain('<iframe');
    expect(player).toContain("from '@/lib/videos/youtube'");
    expect(player).toContain('embedSrcAt(');
    expect(player).not.toMatch(/<script/);
    expect(player).not.toMatch(/iframe_api/);
    expect(player).not.toMatch(/<video[\s>]/);
  });
  it('seeks whenever the link carries a time (a highlight tap, or a share link\'s t= on the poster tap)', () => {
    expect(player).toContain('const seek = startMs !== null && startMs > 0;');
  });
  it('a text message\'s first YouTube link is the poster under the bubble — a preview, never a row', () => {
    const bubble = read('src/components/messages/MessageBubbleContent.tsx');
    expect(bubble).toContain('data-message-youtube=');
    expect(bubble).toContain('<YouTubePlayer videoId={youtube.id}');
    expect(bubble).not.toMatch(/<iframe/);
    expect(bubble).toContain("from '@/lib/help/body'");
  });
  it('remounts on a highlight (key = playKey) and offers the watch page', () => {
    expect(player).toContain('key={playKey}');
    expect(player).toContain('watchUrl(videoId)');
    expect(player).toContain('open it on YouTube');
  });
  it('the embed host is the CSP\'s (one list)', () => {
    expect(read('src/lib/videos/youtube.ts')).toContain('EMBED_FRAME_HOSTS[0]');
  });
});

describe('the pages', () => {
  it('/videos/[id] and /videos/new exist, the detail page is a server shell over a client screen, the new page never auto-focuses', () => {
    const detail = read('src/app/(app)/videos/[id]/page.tsx');
    expect(detail).not.toMatch(/^'use client'/);
    expect(detail).toContain('<AppHeader />');
    expect(detail).toContain('<VideoScreen videoId={id} />');
    const flow = read('src/components/videos/NewVideoFlow.tsx');
    expect(flow).not.toMatch(/autoFocus/);
    expect(flow).toContain("fetch('/api/videos'");
    expect(read('src/app/(app)/videos/new/page.tsx')).toContain("router.replace('/')");
  });
  it('the video screen answers a 404 with the not-available view and a Back that is never a dead end', () => {
    const screen = read('src/components/videos/VideoScreen.tsx');
    expect(screen).toContain('Video not available');
    expect(screen).toContain('backOr(router');
    expect(screen).toContain('initialAuthCheckComplete');
  });
});

describe('the YouTube connection (Phase 3)', () => {
  it('the channel card sits on the profile Videos tab (the owner) and in the org console website section; it navigates to the start route and confirms a disconnect', () => {
    const card = read('src/components/videos/YouTubeConnectCard.tsx');
    expect(card).toContain("'use client'");
    expect(card).toContain('/api/videos/youtube/start?owner=');
    expect(card).toContain('<ConfirmModal');
    expect(card).toContain('data-youtube-connect=""');
    expect(card).toContain('data-youtube-disconnect=""');
    expect(card).not.toMatch(/refreshToken|secret_ciphertext/);
    const tab = read('src/components/profile/ProfileVideosTab.tsx');
    expect(tab).toContain('<YouTubeConnectCard owner={`profile:${profileId}`} />');
    expect(tab).toContain('(isOwnProfile || currentUserId === profileId) &&');
    const console = read('src/app/(app)/app/org/[side]/[id]/page.tsx');
    expect(console).toContain('<YouTubeConnectCard owner={`${side}:${orgId}`} compact />');
  });
  it('the new-video flow offers the channel list and the upload only once the default owner is connected; the upload is a link to the second consent when the scope is missing', () => {
    const flow = read('src/components/videos/NewVideoFlow.tsx');
    expect(flow).toContain('<ChannelPicker owner={defaultOwnerRef} onPick={pickFromChannel} />');
    expect(flow).toContain('connection.canUpload && uploadOpen && (');
    expect(flow).toContain('data-new-video-needs-scope={needsScope}');
    expect(flow).not.toContain('window.location.assign');
    const panel = read('src/components/videos/YouTubeUploadPanel.tsx');
    expect(panel).toContain("import('@/lib/videos/youtube-upload')");
    expect(panel).toContain('data-youtube-upload-cancel=""');
    expect(panel).toContain('/api/videos/youtube/upload-session');
    const picker = read('src/components/videos/ChannelPicker.tsx');
    expect(picker).toContain('/api/videos/youtube/channel-uploads?owner=');
  });
  it('the device upload speaks Google\'s resumable protocol from the pure rules and never a Supabase or Edge Athlete host', () => {
    const up = read('src/lib/videos/youtube-upload.ts');
    expect(up).toContain("import { nextOffsetFromRange, youtubeContentRange } from './youtube-connection';");
    expect(up).toContain("xhr.setRequestHeader('Content-Range', range.header);");
    expect(up).toContain('res.status === 308');
    expect(up).not.toMatch(/supabase\.co|fetch\(/); // the only request is the XHR to the session URI
    const csp = read('src/lib/csp.ts');
    expect(csp.split('https://www.googleapis.com').length).toBe(3); // both policies, nothing else
  });
  it('the video page offers the manager "Refresh from YouTube" through its own route', () => {
    const screen = read('src/components/videos/VideoScreen.tsx');
    expect(screen).toContain('data-video-refresh=""');
    expect(screen).toContain('/refresh`, { method: \'POST\' }');
    expect(read('src/app/api/videos/[id]/refresh/route.ts')).toContain('recordVideoDetails(');
  });
});

describe('live (Phase 4a)', () => {
  it('a card and the page read the live state from the ROW through the pure rules — never a fetch to YouTube from the browser', () => {
    const cards = read('src/components/videos/VideoCards.tsx');
    expect(cards).toContain('liveBadgeFor(video)');
    expect(cards).toContain('data-video-card-live={live?.kind ?? undefined}');
    expect(cards).toContain('aria-label="Live now"');
    expect(cards).not.toMatch(/fetch\(|googleapis/);
    const screen = read('src/components/videos/VideoScreen.tsx');
    expect(screen).toContain('data-video-live={live.kind}');
    expect(screen).toContain('liveRefetchMs(load.video)');
    expect(screen).toContain("liveStartedAt={video.live_status === 'live' ? video.live_started_at : null}");
    expect(screen).not.toMatch(/googleapis/);
  });
  it('"Now" marks the moment of the live stream and the server, not the device, stamps it', () => {
    const list = read('src/components/videos/HighlightList.tsx');
    expect(list).toContain('data-highlight-now=""');
    expect(list).toContain('markNowOffsetMs(liveStartedAt, Date.now())');
    expect(list).toContain('if (d.live) meta.live = true;');
    const route = read('src/app/api/videos/[id]/highlights/route.ts');
    expect(route).toContain('if (parsed.value.meta.live) {');
    expect(route).toContain("read.row.live_status === 'live' ? markNowOffsetMs(read.row.live_started_at, Date.now()) : null");
    expect(route).toContain('parsed.value.start_ms = offset;');
  });
  it('the state is read when someone looks — the list, the page and the first link — never by a cron; the writer stays acyclic and claims its read', () => {
    expect(read('src/app/api/videos/route.ts')).toContain('(await refreshLiveViews(admin, listed)) ? await listVideos(admin, filter) : listed');
    expect(read('src/app/api/videos/route.ts')).toContain('await refreshLiveState(admin, created.value, { force: true });');
    expect(read('src/app/api/videos/[id]/route.ts')).toContain('if (await refreshLiveViews(admin, [read.view]))');
    const writer = read('src/lib/videos/videos-live-server.ts');
    expect(writer).not.toMatch(/from '\.\/videos-server'|videos-server'/);
    expect(writer).toContain("claim.or(`live_checked_at.is.null,live_checked_at.lt.${new Date(now - ttl).toISOString()}`)"); // hardening-ok: a source pin, not a query
    expect(writer).toContain('QUOTA_BACKOFF_MS');
    expect(read('src/lib/videos/videos-server.ts')).not.toMatch(/videos-live-server/);
    expect(read('vercel.json')).not.toMatch(/videos.*live|live.*videos/);
  });
  it('the key is server-only, documented, and the stand-in answers a key read', () => {
    expect(read('.env.example')).toContain('# YOUTUBE_API_KEY=');
    const google = read('src/lib/videos/google-youtube-server.ts');
    expect(google).toContain('export function youtubeReadConfig(');
    expect(google).toContain('part=snippet,contentDetails,liveStreamingDetails');
    expect(google).toContain("e?.reason === 'quotaExceeded'");
    expect(read('e2e/helpers/youtube-mock.ts')).toContain('YOUTUBE_API_KEY: YOUTUBE_E2E_API_KEY');
  });
});

describe('live, PR B — the strip, the order, the public tile', () => {
  it('Live Now reads the broadcasts from their own route (signed out included), renders them first, and the empty state names them', () => {
    const strip = read('src/components/LiveNowStrip.tsx');
    // Since the performance program's Phase 2 (Nov 2026) the strip's ONE read
    // is /api/live-now, which composes the videos route in-process; the
    // broadcasts land signed out included (only the rounds are gated on user).
    expect(strip).toContain("const LIVE_NOW_KEY = '/api/live-now'");
    expect(strip).toContain('setBroadcasts(data.videos || [])');
    expect(strip.indexOf('setBroadcasts(data.videos || [])')).toBeLessThan(strip.indexOf('setRounds(user ? data.rounds || [] : [])'));
    const aggregate = read('src/app/api/live-now/route.ts');
    expect(aggregate).toContain("import { GET as videosLiveNow } from '@/app/api/videos/live-now/route'");
    expect(strip).toContain('data-live-broadcast-card={v.id}');
    expect(strip).toContain('{broadcasts.map(broadcastCard)}\n        {events.map(eventCard)}');
    expect(strip).toContain('a round, a game, a match, a broadcast');
    const route = read('src/app/api/videos/live-now/route.ts');
    expect(route).toContain('listLiveVideos(admin, viewerId)');
    expect(route).toContain('refreshLiveViews(admin, listed)');
    expect(route).toContain("'Cache-Control': 'private, max-age=10'");
  });
  it('the live list applies the owner\'s own rule row by row and every list puts a live broadcast first', () => {
    const server = read('src/lib/videos/videos-server.ts');
    expect(server).toContain("export async function listLiveVideos(");
    expect(server).toContain(".eq('live_status', 'live')\n    .eq('status', 'published')");
    expect(server).toContain('anonymousProfileCanView(admin, row.profile_id)');
    expect(server).toContain('orgVideoAccess(admin, isOrgKind(org?.kind)');
    expect(server.split('sortLiveFirst(').length - 1).toBe(2);
  });
  it('the public tile shows the pill from the org\'s own row, and a change on an org\'s broadcast purges its site', () => {
    expect(read('src/lib/org-sites/public-data.ts')).toContain("live: v.live_status === 'live',");
    const tile = read('src/app/(public)/org/[slug]/_components/VideosList.tsx');
    expect(tile).toContain('data-site-video-live=""');
    expect(tile).not.toMatch(/fetch\(|'use client'/);
    expect(read('src/lib/videos/videos-live-server.ts')).toContain('await revalidateOrgSiteForOrg(admin, owner.side, owner.orgId)');
  });
});

describe('live, 4b — the broadcast created from Edge Athlete', () => {
  it('the door is the connector\'s (canBroadcast), the panel shows the key once and never stores or logs it', () => {
    const flow = read('src/components/videos/NewVideoFlow.tsx');
    expect(flow).toContain('connection.canBroadcast && !uploadOpen && !broadcastOpen && (');
    expect(flow).toContain('data-new-video-broadcast-door=""');
    expect(flow).toContain("onNeedsScope={() => setNeedsScope('live')}");
    expect(flow).toContain('&scope=${needsScope}');
    const panel = read('src/components/videos/YouTubeBroadcastPanel.tsx');
    expect(panel).toContain('/api/videos/youtube/broadcast');
    expect(panel).toContain('data-youtube-broadcast-key=""');
    expect(panel).toContain('data-youtube-broadcast-continue=""');
    expect(panel).toContain('rel="noopener noreferrer"');
    expect(panel).not.toMatch(/localStorage|sessionStorage|console\.|document\.cookie/);
    expect(panel).toContain('50 subscribers');
  });
  it('the route asks the live scope at the moment of need, speaks the eligibility words, leaves no orphan broadcast, and the key is in its answer only', () => {
    const route = read('src/app/api/videos/youtube/broadcast/route.ts');
    expect(route).toContain("requireActiveWriter(request, { limit: 'video-write' })");
    expect(route).toContain('broadcastRight(admin, owner, user.id)');
    expect(route).toContain("needs_scope: 'live'");
    expect(route).toContain('broadcastErrorWord(status, reason)');
    expect(route.split('youtubeDeleteBroadcast(cfg, accessToken, broadcast.value.videoId)').length - 1).toBe(2);
    expect(route).toContain('stream_key: stream.value.streamKey');
    expect(route).not.toMatch(/console\./);
    const google = read('src/lib/videos/google-youtube-server.ts');
    expect(google).toContain('/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails');
    expect(google).toContain('enableAutoStart: true, enableAutoStop: true, monitorStream: { enableMonitorStream: false }');
    expect(google).toContain('/youtube/v3/liveStreams?part=snippet,cdn,contentDetails');
    expect(google).toContain('/youtube/v3/liveBroadcasts/bind?part=id&id=');
    expect(read('src/lib/videos/youtube-connections-server.ts')).toContain('export const broadcastRight = ');
  });
  it('the privacy page says the key is shown once and never stored; no new host for the CSP', () => {
    expect(read('src/app/(app)/privacy/page.tsx')).toMatch(/show you\s+the stream key once/);
    const hosts = read('src/lib/videos/google-youtube-server.ts').match(/https:\/\/[a-z0-9.-]+/g) ?? [];
    expect(hosts.every(h => ['https://accounts.google.com', 'https://oauth2.googleapis.com', 'https://www.googleapis.com'].includes(h))).toBe(true);
  });
});

describe('paste and go (Nov 6 2026)', () => {
  it('the flow looks a pasted id up once (debounced, the latest wins), prefills only an empty title, refuses a private video through the step rule, and imports chapters in ONE write', () => {
    const flow = read('src/components/videos/NewVideoFlow.tsx');
    expect(flow).toContain('/api/videos/youtube/lookup?id=');
    expect(flow).toContain('}, 400);');
    expect(flow).toContain('if (t) setTitle(prev => (prev.trim() ? prev : t.slice(0, VIDEO_TITLE_MAX)));');
    expect(flow).toContain("blocked: refusal === 'private' ? LOOKUP_NOTES.private : null");
    expect(flow).toContain('data-new-video-lookup={refusal}');
    expect(flow).toContain('data-new-video-chapters={looked.chapters.length}');
    expect(flow.split('/highlights/import').length - 1).toBe(1);
    expect(read('src/lib/videos/video-steps.ts')).toContain('if (s.videoId && s.blocked) return { ok: false, refusal: s.blocked };');
  });
  it('the lookup route is signed-in, one read per paste, the owner\'s token first then the key, and unavailable is a quiet answer', () => {
    const route = read('src/app/api/videos/youtube/lookup/route.ts');
    expect(route).toContain("enforceRateLimit(request, 'video-lookup', { userId: user.id })");
    expect(route).toContain('ownerManaged(admin, owner, user.id)');
    expect(route).toContain('youtubeReadConfig()');
    expect(route).toContain('{ lookup: UNAVAILABLE }');
    expect(route).toContain('chapters: parseChapters(v.description)');
    expect(read('src/lib/rate-limit-core.ts')).toContain("'video-lookup': { max: 60, windowSeconds: 60, keyBy: 'user' }");
    expect(read('src/lib/videos/google-youtube-server.ts')).toContain('part=snippet,contentDetails,status,liveStreamingDetails');
  });
  it('the import is one insert refused on a non-empty list; the page shows the watch door for a video that will not embed and offers the chapters while the list is empty; the card shows the duration', () => {
    const route = read('src/app/api/videos/[id]/highlights/import/route.ts');
    expect(route).toContain("getServerAuth(request, { limit: 'video-write' })");
    expect(route).toContain('addHighlights(admin, id, inputs, user.id)');
    expect(read('src/lib/videos/videos-server.ts')).toContain("if ((count ?? 0) > 0) return { ok: false, status: 409, error: 'This video already has highlights");
    const screen = read('src/components/videos/VideoScreen.tsx');
    expect(screen).toContain("lookupRefusal(lookup) === 'no_embed' ? (");
    expect(screen).toContain('data-video-no-embed=""');
    expect(screen).toContain('chapters && chapters.length > 0 && highlights.length === 0 && (');
    expect(screen).toContain('data-video-import-chapters={chapters.length}');
    expect(read('src/components/videos/VideoCards.tsx')).toContain('data-video-card-duration={video.duration_ms}');
  });
});

describe('the player that knows the time (polish B, Nov 6 2026)', () => {
  it('the API is loaded once by trusted code — createElement, never parser-inserted — and the plain frame stays the fallback; no CSP line changes', () => {
    const api = read('src/lib/videos/youtube-player-api.ts');
    expect(api).toContain("document.createElement('script')");
    expect(api).toContain('document.head.appendChild(script)');
    expect(api).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
    expect(api).toContain('PLAYER_READY_TIMEOUT_MS');
    const player = read('src/components/videos/YouTubePlayer.tsx');
    expect(player).toContain("host: PLAYER_HOST");
    expect(player).toContain("data-video-player-mode={mode ?? (playing ? 'loading' : 'poster')}");
    expect(player).toContain("mode === 'frame' ? (");
    expect(player).toContain('youtube-nocookie');
    expect(read('src/lib/csp.ts')).not.toMatch(/iframe_api|script-src[^\n]*youtube\.com/);
  });
  it('"This moment" reads the player for a VOD and is absent in frame mode; the live "Now" keeps the server stamp', () => {
    const list = read('src/components/videos/HighlightList.tsx');
    expect(list).toContain('const canMark = !!currentMs && !liveStartedAt;');
    expect(list).toContain('data-highlight-mark=""');
    expect(list).toContain('data-highlight-now=""');
    expect(list).toContain("setD(prev => ({ ...prev, time: formatTimestamp(ms), live: false }));");
    const screen = read('src/components/videos/VideoScreen.tsx');
    expect(screen).toContain("currentMs={playerMode === 'api' ? () => playerRef.current?.currentMs() ?? null : undefined}");
  });
  it('"Play highlights" walks the pure playlist; the active row follows the playhead; resume is a fail-open local chip, never automatic', () => {
    const screen = read('src/components/videos/VideoScreen.tsx');
    expect(screen).toContain("data-video-play-highlights={playAll ? 'on' : 'off'}");
    expect(screen).toContain('nextInPlaylist(pa.list, pa.index, ms)');
    expect(screen).toContain('setActiveId(activeHighlightAt(load.highlights, ms))');
    expect(screen).toContain('data-video-resume={resumeAt}');
    expect(screen).toContain('resumeOffer(readResumeMs(defaultPlayerStorage()');
    expect(screen).toContain('clearResumeMs(defaultPlayerStorage(), providerVideoId)');
    expect(screen).not.toMatch(/autoplay.*resume|resume.*autoplay/i);
    // Off the video page nothing loads the API: the feed card and the message poster stay poster-first, plain frame on tap.
    for (const f of ['src/components/videos/VideoCards.tsx', 'src/components/messages/MessageBubbleContent.tsx']) expect(read(f)).not.toMatch(/youtube-player-api|loadYouTubeApi|<YouTubePlayer[^>]*\bapi\b/);
    expect(screen).toContain('<YouTubePlayer\n          api\n');
    expect(read('src/components/videos/YouTubePlayer.tsx')).toContain("(api ? loadYouTubeApi() : Promise.reject(new Error('plain frame')))");
  });
});

describe('self-healing (Nov 10 2026)', () => {
  it('a screen that is told `reconnect` shows the one Reconnect door; the flow names a problem instead of dropping its doors; the card asks YouTube at most every ten minutes', () => {
    const link = read('src/components/videos/YouTubeReconnectLink.tsx');
    expect(link).toContain('/api/videos/youtube/start?owner=');
    expect(link).toContain('data-youtube-reconnect-link={scope}');
    expect(read('src/components/videos/ChannelPicker.tsx')).toContain('<YouTubeReconnectLink owner={owner} scope="readonly" />');
    expect(read('src/components/videos/ChannelPicker.tsx')).toContain('data-channel-picker-retry=""');
    expect(read('src/components/videos/YouTubeUploadPanel.tsx')).toContain('<YouTubeReconnectLink owner={owner} scope="upload" />');
    expect(read('src/components/videos/YouTubeBroadcastPanel.tsx')).toContain('<YouTubeReconnectLink owner={owner} scope="live" />');
    const flow = read('src/components/videos/NewVideoFlow.tsx');
    expect(flow).toContain('data-new-video-youtube-problem={connection.status ?? \'\'}');
    expect(flow).toContain("connection.status !== 'revoked' && <ChannelPicker");
    const card = read('src/components/videos/YouTubeConnectCard.tsx');
    expect(card).toContain("${check ? '&check=1' : ''}");
    expect(card).toContain('healthCheckDue(');
    expect(card).toContain("next.status === 'revoked' || !checkDue(owner)");
    expect(card).toContain('reconnectScope(view.scopes)');
  });
});


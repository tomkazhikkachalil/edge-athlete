'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import StepFlow from '@/components/StepFlow';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { backOr } from '@/lib/nav-back';
import { COPY } from '@/lib/copy';
import { getEnabledSports } from '@/lib/sports/SportRegistry';
import { isOrgKind, type OrgKind } from '@/lib/orgs/org-ref';
import { UUID_RE } from '@/lib/uuid';
import { formatTimestamp, VIDEO_DESCRIPTION_MAX, VIDEO_TITLE_MAX } from '@/lib/videos/rules';
import { formatLiveWhen } from '@/lib/videos/live-rules';
import { channelRefusalText, chaptersToHighlights, LOOKUP_NOTES, lookupRefusal, type VideoLookup } from '@/lib/videos/youtube-connection';
import { canAdvanceVideoStep, VIDEO_STEPS } from '@/lib/videos/video-steps';
import { parseYouTubeLink, thumbUrl, watchUrl } from '@/lib/videos/youtube';
import { CONNECT_ERRORS, connectedLine, connectReturnPath, FLOW_DRAFT_KEY, parseFlowDraft, reconnectScope, UNVERIFIED_NOTE, type FlowDraft, type ScopeKey, type YouTubeConnectionView } from '@/lib/videos/youtube-connection';
import { faYoutubeBrands } from '@/lib/icons/fa/youtube-brands';
import YouTubeReconnectLink from '@/components/videos/YouTubeReconnectLink';
import ChannelPicker from '@/components/videos/ChannelPicker';
import YouTubeUploadPanel from '@/components/videos/YouTubeUploadPanel';
import YouTubeBroadcastPanel from '@/components/videos/YouTubeBroadcastPanel';
import FaIcon from '@/components/FaIcon';
import { faArrowLeft } from '@/lib/icons/fa/arrow-left';
import { faChevronRight } from '@/lib/icons/fa/chevron-right';
import { faCloudArrowUp } from '@/lib/icons/fa/cloud-arrow-up';
import { faTowerBroadcast } from '@/lib/icons/fa/tower-broadcast';

const FIELD = 'w-full border border-border-strong rounded-lg px-3 min-h-[44px] text-base bg-surface text-primary';

interface OrgOption {
  id: string;
  side: OrgKind;
  name: string;
}

/**
 * Link a full game (Videos program, 296): paste a YouTube link (the id is
 * what we keep; the preview is the poster), name it, say where it goes —
 * your profile (or an athlete you guard, through ?profileId=) or an org you
 * manage — and it is on the video page. A door from an event tab, a
 * contest or an org bubble arrives with the place pre-filled. No
 * auto-focus (an iPhone zooms to a field focused after the tap).
 *
 * The flow round (Nov 10 2026): the Link step carries the Connect door when
 * no channel is connected; every door to Google (connect, allow uploads,
 * allow live, reconnect) asks to be returned HERE (`&return=`), and what the
 * person had typed is kept on the device meanwhile (sessionStorage, fifteen
 * minutes) and put back on the way in — a chosen file cannot be kept, and
 * the line says so. The connect's result is read from the address once.
 */
/** The draft a return from Google restores — read only when the address carries a connect result. */
function readDraft(hasResult: boolean): FlowDraft | null {
  if (!hasResult) return null;
  try {
    return parseFlowDraft(window.sessionStorage.getItem(FLOW_DRAFT_KEY), Date.now());
  } catch {
    return null;
  }
}

export default function NewVideoFlow({ userId }: { userId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const sideParam = params.get('side');
  const prefillOrg = sideParam === 'league' || sideParam === 'club' ? params.get('orgId') : null;
  const prefillProfile = params.get('profileId');
  const sportEventId = params.get('sportEventId');
  const contestId = params.get('contestId');
  // Phase 1b (297): a golf round, an activity, a workout — the door arrives from the place; the owner is the person's own profile.
  const groupPostId = params.get('groupPostId');
  const activityId = params.get('activityId');
  const workoutSessionId = params.get('workoutSessionId');
  const placeKind = groupPostId ? 'round' : activityId ? 'activity' : workoutSessionId ? 'workout' : sportEventId ? 'event' : contestId ? 'game' : null;
  const profileOnly = !!(groupPostId || activityId || workoutSessionId);

  // The connect's result and the draft it comes back to: read ONCE (this component mounts on the client only, after the auth check).
  const [landed] = useState(() => {
    const connected = params.get('youtube') === 'connected';
    const errorWord = params.get('youtube_error');
    const scope = params.get('scope');
    return { connected, errorWord, scope, was: params.get('was'), draft: readDraft(connected || !!errorWord) };
  });
  const draft = landed.draft;
  const [index, setIndex] = useState(draft?.index ?? 0);
  const [url, setUrl] = useState(draft?.url ?? '');
  const [title, setTitle] = useState(draft?.title ?? '');
  const [description, setDescription] = useState(draft?.description ?? '');
  const [sportKey, setSportKey] = useState(draft?.sportKey ?? '');
  const [owner, setOwner] = useState<'me' | { orgId: string } | null>(draft?.owner ?? (prefillOrg && UUID_RE.test(prefillOrg) ? { orgId: prefillOrg } : prefillProfile || groupPostId || activityId || workoutSessionId ? 'me' : null));
  const [existingId, setExistingId] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<OrgOption[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = useMemo(() => (url.trim() ? parseYouTubeLink(url) : null), [url]);
  const sports = useMemo(() => getEnabledSports(), []);

  // Phase 3 (298): the owner this door would default to — the org it came
  // from, else the profile — and that owner's YouTube connection. Connected:
  // the Link step offers the channel's uploads in one tap and, for the person
  // whose grant it is, an upload from this device straight to YouTube.
  const defaultOwnerRef = prefillOrg && UUID_RE.test(prefillOrg) && (sideParam === 'league' || sideParam === 'club')
    ? `${sideParam}:${prefillOrg}`
    : `profile:${prefillProfile && UUID_RE.test(prefillProfile) ? prefillProfile : userId}`;
  // Correct state (Nov 10 2026): the connection shown is the one of the owner actually PICKED (an org chosen at Where, else the default) —
  // the channel named on a door is the channel of the owner the video will belong to.
  const activeOwnerRef = useMemo(() => {
    if (owner && owner !== 'me') {
      const side = (orgs ?? []).find(o => o.id === owner.orgId)?.side ?? (owner.orgId === prefillOrg && (sideParam === 'league' || sideParam === 'club') ? sideParam : null);
      if (side) return `${side}:${owner.orgId}`;
    }
    if (owner === 'me') return `profile:${prefillProfile && UUID_RE.test(prefillProfile) ? prefillProfile : userId}`;
    return defaultOwnerRef;
  }, [owner, orgs, prefillOrg, sideParam, prefillProfile, userId, defaultOwnerRef]);
  // The view is kept WITH the owner it was read for: a view of the previous owner is never shown under the new one.
  const [fetched, setFetched] = useState<{ ref: string; view: YouTubeConnectionView | null } | null>(null);
  const connection = fetched && fetched.ref === activeOwnerRef ? fetched.view : null;
  // Back from "Allow uploads" / "Allow live broadcasts": the door they were at is open again.
  const [uploadOpen, setUploadOpen] = useState(landed.connected && landed.scope === 'upload');
  // Phase 4b: the third door — schedule a live broadcast (the connector only).
  const [broadcastOpen, setBroadcastOpen] = useState(landed.connected && landed.scope === 'live');

  // Every door to Google returns HERE, with the form kept on the device meanwhile.
  const returnTo = useMemo(() => connectReturnPath(`/videos/new${params.toString() ? `?${params.toString()}` : ''}`) ?? '/videos/new', [params]);
  const startHref = (scope: ScopeKey) => `/api/videos/youtube/start?owner=${encodeURIComponent(activeOwnerRef)}&scope=${scope}&return=${encodeURIComponent(returnTo)}`;
  const saveDraft = useCallback(() => {
    try {
      const d: FlowDraft = { url, title, description, sportKey, owner, index, at: Date.now() };
      window.sessionStorage.setItem(FLOW_DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* without storage the person comes back to an empty form — the connect still works */
    }
  }, [url, title, description, sportKey, owner, index]);
  // The result has been read: its words leave the address and the draft leaves the device.
  useEffect(() => {
    if (!landed.connected && !landed.errorWord) return;
    try {
      window.sessionStorage.removeItem(FLOW_DRAFT_KEY);
    } catch {
      /* nothing to clear */
    }
    router.replace(returnTo, { scroll: false });
  }, [landed, returnTo, router]);
  const landedLine = landed.errorWord
    ? (CONNECT_ERRORS[landed.errorWord] ?? CONNECT_ERRORS.failed)
    : !landed.connected
      ? null
      : landed.scope === 'upload'
        ? 'Uploads are allowed now. Choose the file to upload — a file cannot be kept while you are at Google.'
        : landed.scope === 'live'
          ? 'Live broadcasts are allowed now.'
          : connectedLine(connection?.channelTitle, landed.was);
  const [uploadedNote, setUploadedNote] = useState<string | null>(null);
  const [needsScope, setNeedsScope] = useState<'upload' | 'live' | null>(null);
  useEffect(() => {
    let live = true;
    const fetchConnection = async (): Promise<YouTubeConnectionView | null> => {
      try {
        const res = await fetch(`/api/videos/youtube/connection?owner=${encodeURIComponent(activeOwnerRef)}`, { cache: 'no-store' });
        if (!res.ok) return null;
        const body = (await res.json()) as { connection?: YouTubeConnectionView };
        return body.connection ?? null;
      } catch {
        return null;
      }
    };
    void fetchConnection().then(next => { if (live) setFetched({ ref: activeOwnerRef, view: next }); });
    return () => { live = false; };
  }, [activeOwnerRef]);
// Paste and go (Nov 6 2026): what YouTube says about the pasted id — the title, the duration, whether it plays here, its chapters.
  // One read per link (debounced; the latest paste wins); unavailable = the flow behaves as before.
  const [lookup, setLookup] = useState<{ id: string; value: VideoLookup } | null>(null);
  const [importChapters, setImportChapters] = useState(true);
  const linkId = link?.id ?? null;
  useEffect(() => {
    if (!linkId) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/videos/youtube/lookup?id=${encodeURIComponent(linkId)}&owner=${encodeURIComponent(activeOwnerRef)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { lookup?: VideoLookup };
        if (!live || !body.lookup) return;
        setLookup({ id: linkId, value: body.lookup });
        // YouTube's title fills an EMPTY title field once per link (editable afterwards).
        const t = body.lookup.title;
        if (t) setTitle(prev => (prev.trim() ? prev : t.slice(0, VIDEO_TITLE_MAX)));
      } catch {
        /* the preview stays YouTube's poster alone */
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [linkId, activeOwnerRef]);
  const looked = lookup && linkId && lookup.id === linkId ? lookup.value : null;
  const refusal = lookupRefusal(looked);
  // Only the connected channel (Nov 11 2026): no channel connected, or YouTube says the video is another channel's — said here, before Save; the server's check is the truth.
  const channelWord = connection?.available && !connection.connected ? 'unconnected' as const : looked?.channel && looked.channel !== 'own' ? looked.channel : null;
  const channelBlocked = channelWord ? channelRefusalText(channelWord, looked?.channelTitle ?? connection?.channelTitle) : null;

  // Another owner is another channel: the doors opened for the previous one close.
  const pickOwner = (next: 'me' | { orgId: string }) => {
    setOwner(next);
    setUploadOpen(false);
    setBroadcastOpen(false);
    setNeedsScope(null);
  };
  const pickFromChannel = (videoId: string, pickedTitle: string) => {
    setUrl(watchUrl(videoId));
    if (!title.trim() && pickedTitle) setTitle(pickedTitle.slice(0, VIDEO_TITLE_MAX));
    setUploadOpen(false);
  };
  const uploaded = (videoId: string, uploadedTitle: string) => {
    setUrl(watchUrl(videoId));
    if (!title.trim()) setTitle(uploadedTitle.slice(0, VIDEO_TITLE_MAX));
    setUploadOpen(false);
    setUploadedNote('Uploaded to YouTube. Now the details, then where it goes.');
    setIndex(1);
  };
  // Phase 4b: the broadcast exists on YouTube; the row is an ordinary link and the first read makes it upcoming.
  const scheduled = (videoId: string, scheduledTitle: string) => {
    setUrl(watchUrl(videoId));
    if (!title.trim()) setTitle(scheduledTitle.slice(0, VIDEO_TITLE_MAX));
    setBroadcastOpen(false);
    setUploadedNote('Scheduled on YouTube — it will show as upcoming, then live, then the recording. Now the details, then where it goes.');
    setIndex(1);
  };

  // The orgs this person may link a video to: the ladder's owners and
  // managers. A website-section staff grant also manages video (the API's
  // gate is the truth); it shows here only once the console lists it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/profile/${encodeURIComponent(userId)}/organizations`, { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setOrgs([]);
          return;
        }
        const body = (await res.json()) as { organizations?: { id: string; kind: string; name: string; role: string; pending?: boolean }[] };
        const list = (body.organizations ?? [])
          .filter(o => (o.role === 'owner' || o.role === 'manager') && !o.pending && isOrgKind(o.kind))
          .map(o => ({ id: o.id, side: o.kind as OrgKind, name: o.name }));
        if (!cancelled) setOrgs(list);
      } catch {
        if (!cancelled) setOrgs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Someone who also manages a club or league can still pick it at Where — the Link step warns, Where refuses.
  const canChangeOwner = (orgs ?? []).length > 0;
  const dirty = () => url.trim().length > 0 || title.trim().length > 0 || description.trim().length > 0;
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(dirty, () => backOr(router, '/feed'));

  const step = VIDEO_STEPS[index];
  const advance = canAdvanceVideoStep(step.id, { videoId: link?.id ?? null, linkTyped: url.trim().length > 0, title, owner, blocked: refusal === 'private' ? LOOKUP_NOTES.private : null, channelBlocked, canChangeOwner });

  const finish = async () => {
    if (!advance.ok || !link || saving) return;
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      url: url.trim(),
      title: title.trim() || null,
      description: description.trim() || null,
      sport_key: sportKey || null,
    };
    if (owner && owner !== 'me') {
      const org = (orgs ?? []).find(o => o.id === owner.orgId);
      body.side = org?.side ?? sideParam;
      body.org_id = owner.orgId;
    } else if (prefillProfile && UUID_RE.test(prefillProfile) && prefillProfile !== userId) {
      body.profile_id = prefillProfile;
    }
    if (sportEventId && UUID_RE.test(sportEventId)) body.sport_event_id = sportEventId;
    if (contestId && UUID_RE.test(contestId)) body.contest_id = contestId;
    if (groupPostId && UUID_RE.test(groupPostId)) body.group_post_id = groupPostId;
    if (activityId && UUID_RE.test(activityId)) body.activity_id = activityId;
    if (workoutSessionId && UUID_RE.test(workoutSessionId)) body.workout_session_id = workoutSessionId;
    try {
      const res = await fetch('/api/videos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { video?: { id: string }; error?: string; existing_id?: string };
      if (!res.ok || !data.video) {
        setError(data.error ?? 'Could not save the video.');
        setExistingId(res.status === 409 && data.existing_id ? data.existing_id : null);
        setSaving(false);
        return;
      }
      // Paste and go: YouTube's chapters become the first highlights in ONE write; a refusal never blocks the video.
      if (importChapters && looked && looked.chapters.length > 0) {
        try {
          await fetch(`/api/videos/${encodeURIComponent(data.video.id)}/highlights/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ highlights: chaptersToHighlights(looked.chapters, looked.durationMs).map(h => ({ ...h, meta: {} })) }) });
        } catch {
          /* the video is saved; the chapters can be added from its page */
        }
      }
      router.replace(`/videos/${data.video.id}`);
    } catch {
      setError('Could not save the video. Check your connection and try again.');
      setSaving(false);
    }
  };

  return (
    <div className="bg-surface rounded-lg border border-border" data-new-video="">
      <div className="flex items-center gap-2 px-4 pt-4">
        <button type="button" onClick={requestClose} className="ea-icon-btn text-secondary" aria-label="Back" data-new-video-back="">
          <FaIcon icon={faArrowLeft} />
        </button>
        <h1 className="text-xl font-bold text-primary">Add a full game</h1>
      </div>
      <StepFlow
        id="new-video"
        steps={[...VIDEO_STEPS]}
        index={index}
        onIndex={setIndex}
        finishLabel="Add video"
        onFinish={finish}
        busy={saving}
        busyLabel="Adding…"
        canAdvance={advance.ok}
        refusal={advance.ok ? undefined : advance.refusal}
      >
        {step.id === 'link' && (
          <div className="px-4 pb-4 space-y-3">
            <label className="block text-sm text-secondary">
              YouTube link
              <input
                type="url"
                inputMode="url"
                className={`${FIELD} mt-1`}
                placeholder="https://www.youtube.com/watch?v=…"
                value={url}
                onChange={e => setUrl(e.target.value)}
                data-new-video-url=""
              />
            </label>
            <p className="text-xs text-muted">
              A full game, a tournament, a broadcast — anything long lives on YouTube, on your own channel. Only videos from {connection?.connected && connection.channelTitle ? connection.channelTitle : 'the YouTube channel you connect here'} can be added — a link to someone else&apos;s video is refused. Edge Athlete keeps the link and your highlights; it never downloads or re-hosts the video. Short clips still go in a post.
            </p>
            {landedLine && (
              <p className={`text-sm ${landed.errorWord ? 'text-red-600' : 'text-secondary'}`} role="status" data-new-video-youtube-result={landed.errorWord ? 'error' : 'connected'}>{landedLine}</p>
            )}
            {/* No channel yet: the Connect door is here, where the full game is being added — and it comes back here. */}
            {connection && !connection.connected && connection.available && connection.canManage && (
              <div className="rounded-lg border border-border p-3 space-y-2" data-new-video-youtube="connect">
                <p className="text-sm font-semibold text-primary"><FaIcon icon={faYoutubeBrands} className="text-red-600 mr-1.5" />Connect your YouTube channel</p>
                <p className="text-xs text-muted">A full game is added from your own channel: connect it, then pick from its uploads in one tap, paste a link to one of its videos, or upload a full game from here straight to YouTube. You&apos;ll sign in with Google and come back to this step.</p>
                <a href={startHref('readonly')} onClick={saveDraft} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full bg-brand text-white text-sm font-semibold hover:bg-brand-hover" data-new-video-connect="">
                  Connect YouTube
                </a>
                {connection.unverified && <p className="text-xs text-muted">{UNVERIFIED_NOTE}</p>}
              </div>
            )}
            {connection?.connected && (
              <div className="space-y-2" data-new-video-youtube={connection.canUpload ? 'upload' : 'pick'}>
                {/* Self-healing (Nov 10 2026): a connection that needs attention says so here, with its door — never doors that silently vanish. */}
                {connection.problem && (
                  <p className="text-sm text-red-600" role="status" data-new-video-youtube-problem={connection.status ?? ''}>
                    {connection.problem}{' '}
                    {connection.canManage && <YouTubeReconnectLink owner={activeOwnerRef} scope={connection.connectedByMe ? reconnectScope(connection.scopes) : 'readonly'} returnTo={returnTo} onNavigate={saveDraft} />}
                  </p>
                )}
                {connection.status !== 'revoked' && <ChannelPicker owner={activeOwnerRef} onPick={pickFromChannel} returnTo={returnTo} onLeave={saveDraft} />}
                {connection.canUpload && !uploadOpen && !broadcastOpen && (
                  <button type="button" onClick={() => setUploadOpen(true)} className="ea-interactive flex w-full items-center gap-3 rounded-lg border border-border px-3 min-h-[48px] text-left" data-new-video-upload-door="">
                    <FaIcon icon={faCloudArrowUp} className="text-brand-fg" />
                    <span className="text-sm font-semibold text-primary flex-1">Upload a file to {connection.channelTitle || 'your channel'}</span>
                    <FaIcon icon={faChevronRight} className="text-muted" />
                  </button>
                )}
                {connection.canBroadcast && !uploadOpen && !broadcastOpen && (
                  <button type="button" onClick={() => setBroadcastOpen(true)} className="ea-interactive flex w-full items-center gap-3 rounded-lg border border-border px-3 min-h-[48px] text-left" data-new-video-broadcast-door="">
                    <FaIcon icon={faTowerBroadcast} className="text-brand-fg" />
                    <span className="text-sm font-semibold text-primary flex-1">Schedule a live broadcast on {connection.channelTitle || 'your channel'}</span>
                    <FaIcon icon={faChevronRight} className="text-muted" />
                  </button>
                )}
                {needsScope && (
                  <p className="text-sm text-secondary" role="status" data-new-video-needs-scope={needsScope}>
                    {needsScope === 'live' ? 'Live broadcasts need one more yes at Google.' : 'Uploads need one more yes at Google.'}{' '}
                    <a href={startHref(needsScope)} onClick={saveDraft} className="underline font-semibold" data-new-video-allow={needsScope}>{needsScope === 'live' ? 'Allow live broadcasts' : 'Allow uploads'}</a> — you come back to this step with what you typed.{connection.unverified ? ` ${UNVERIFIED_NOTE}` : ''}
                  </p>
                )}
                {connection.canUpload && uploadOpen && (
                  <YouTubeUploadPanel
                    owner={activeOwnerRef}
                    userId={userId}
                    onUploaded={uploaded}
                    onNeedsScope={() => setNeedsScope('upload')}
                    returnTo={returnTo}
                    onLeave={saveDraft}
                  />
                )}
                {connection.canBroadcast && broadcastOpen && (
                  <YouTubeBroadcastPanel
                    owner={activeOwnerRef}
                    initialTitle={title}
                    onScheduled={scheduled}
                    onNeedsScope={() => setNeedsScope('live')}
                    returnTo={returnTo}
                    onLeave={saveDraft}
                  />
                )}
              </div>
            )}
            {link && (
              <div className="rounded-lg overflow-hidden border border-border" data-new-video-preview={link.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a third-party thumbnail; not an optimizer candidate */}
                <img src={looked?.thumbnail ?? thumbUrl(link.id)} alt="" className="w-full aspect-video object-cover bg-surface-muted" />
                {looked?.title && (
                  <p className="px-3 pt-2 text-sm font-semibold text-primary" data-new-video-lookup-title="">
                    {looked.title}
                    {looked.durationMs ? <span className="ml-2 font-mono text-xs font-normal text-muted" data-new-video-lookup-duration={looked.durationMs}>{formatTimestamp(looked.durationMs)}</span> : null}
                  </p>
                )}
                {looked?.live && looked.live.status !== 'none' && (
                  <p className="px-3 pt-1 text-xs font-semibold text-brand-fg" data-new-video-lookup-live={looked.live.status}>
                    {looked.live.status === 'live' ? 'Streaming now on YouTube' : looked.live.status === 'upcoming' ? `A live broadcast${looked.live.scheduledStartAt ? ` — scheduled ${formatLiveWhen(looked.live.scheduledStartAt)}` : ''}` : 'A past live broadcast — the recording'}
                  </p>
                )}
                {refusal && (
                  <p className={`px-3 pt-1 text-xs ${refusal === 'private' ? 'text-red-600' : 'text-secondary'}`} role="status" data-new-video-lookup={refusal}>{LOOKUP_NOTES[refusal]}</p>
                )}
                {channelWord && channelBlocked && (
                  <p className="px-3 pt-1 text-xs text-red-600" role="status" data-new-video-channel={channelWord}>{channelBlocked}{canChangeOwner ? ' Adding it for a club or league? Choose it at the last step.' : ''}</p>
                )}
                {looked && looked.chapters.length > 0 && (
                  <label className="flex items-center gap-2 px-3 pt-2 text-sm text-primary min-h-[44px]" data-new-video-chapters={looked.chapters.length}>
                    <input type="checkbox" checked={importChapters} onChange={e => setImportChapters(e.target.checked)} className="h-4 w-4" />
                    {looked.chapters.length} chapters found — add them as highlights
                  </label>
                )}
                <p className="px-3 py-2 text-xs text-secondary">
                  This is a YouTube video{link.startMs !== null ? ' — the link points into it; add that moment as a highlight once it is saved' : ''}.
                </p>
              </div>
            )}
          </div>
        )}
        {step.id === 'details' && (
          <div className="px-4 pb-4 space-y-3">
            {uploadedNote && <p className="text-sm text-secondary" role="status" data-new-video-uploaded="">{uploadedNote}</p>}
            <label className="block text-sm text-secondary">
              Title
              <input className={`${FIELD} mt-1`} maxLength={VIDEO_TITLE_MAX} placeholder="Club championship final — full game" value={title} onChange={e => setTitle(e.target.value)} data-new-video-title="" />
            </label>
            <label className="block text-sm text-secondary">
              Description (optional)
              <textarea className={`${FIELD} mt-1 py-2 min-h-[88px]`} maxLength={VIDEO_DESCRIPTION_MAX} value={description} onChange={e => setDescription(e.target.value)} />
            </label>
            <label className="block text-sm text-secondary">
              Sport (optional)
              <select className={`${FIELD} mt-1`} value={sportKey} onChange={e => setSportKey(e.target.value)}>
                <option value="">No sport</option>
                {sports.map(s => (
                  <option key={s.sport_key} value={s.sport_key}>{s.display_name}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        {step.id === 'where' && (
          <div className="px-4 pb-4 space-y-3" data-new-video-where="">
            <p className="text-sm text-secondary">Who the video belongs to decides who can see it — your profile&apos;s privacy, or the organization&apos;s.</p>
            <label className={`flex items-center gap-3 rounded-lg border px-3 min-h-[52px] ea-interactive ${owner === 'me' ? 'border-brand bg-brand-soft' : 'border-border'}`}>
              <input type="radio" name="owner" checked={owner === 'me'} onChange={() => pickOwner('me')} className="h-5 w-5" />
              <span className="text-sm font-semibold text-primary">{prefillProfile && prefillProfile !== userId ? 'The athlete\'s profile' : 'My profile'}</span>
            </label>
            {orgs === null && !profileOnly && <p className="text-xs text-muted">Loading your organizations…</p>}
            {!profileOnly && (orgs ?? []).map(o => (
              <label key={o.id} className={`flex items-center gap-3 rounded-lg border px-3 min-h-[52px] ea-interactive ${owner !== 'me' && owner?.orgId === o.id ? 'border-brand bg-brand-soft' : 'border-border'}`}>
                <input type="radio" name="owner" checked={owner !== 'me' && owner?.orgId === o.id} onChange={() => pickOwner({ orgId: o.id })} className="h-5 w-5" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-primary truncate">{o.name}</span>
                  <span className="block text-xs text-muted">{o.side === 'league' ? 'League' : 'Club'}</span>
                </span>
              </label>
            ))}
            {!profileOnly && prefillOrg && orgs !== null && !orgs.some(o => o.id === prefillOrg) && (
              <label className={`flex items-center gap-3 rounded-lg border px-3 min-h-[52px] ea-interactive ${owner !== 'me' && owner?.orgId === prefillOrg ? 'border-brand bg-brand-soft' : 'border-border'}`}>
                <input type="radio" name="owner" checked={owner !== 'me' && owner?.orgId === prefillOrg} onChange={() => pickOwner({ orgId: prefillOrg })} className="h-5 w-5" />
                <span className="text-sm font-semibold text-primary">This {sideParam}</span>
              </label>
            )}
            {placeKind && (
              <p className="text-xs text-muted" data-new-video-place={placeKind}>It will also show on the {placeKind} you came from.</p>
            )}
            {error && (
              <p className="text-sm text-red-600" role="alert" data-new-video-error="">
                {error}
                {existingId && (
                  <>
                    {' '}
                    <Link href={`/videos/${existingId}`} className="underline font-semibold" data-new-video-existing={existingId}>Open it</Link>
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </StepFlow>
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </div>
  );
}

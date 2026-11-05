'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import StepFlow from '@/components/StepFlow';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { backOr } from '@/lib/nav-back';
import { COPY } from '@/lib/copy';
import { getEnabledSports } from '@/lib/sports/SportRegistry';
import { isOrgKind, type OrgKind } from '@/lib/orgs/org-ref';
import { UUID_RE } from '@/lib/uuid';
import { VIDEO_DESCRIPTION_MAX, VIDEO_TITLE_MAX } from '@/lib/videos/rules';
import { canAdvanceVideoStep, VIDEO_STEPS } from '@/lib/videos/video-steps';
import { parseYouTubeLink, thumbUrl, watchUrl } from '@/lib/videos/youtube';
import type { YouTubeConnectionView } from '@/lib/videos/youtube-connection';
import ChannelPicker from '@/components/videos/ChannelPicker';
import YouTubeUploadPanel from '@/components/videos/YouTubeUploadPanel';

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
 */
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

  const [index, setIndex] = useState(0);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sportKey, setSportKey] = useState('');
  const [owner, setOwner] = useState<'me' | { orgId: string } | null>(prefillOrg && UUID_RE.test(prefillOrg) ? { orgId: prefillOrg } : prefillProfile || groupPostId || activityId || workoutSessionId ? 'me' : null);
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
  const [connection, setConnection] = useState<YouTubeConnectionView | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadedNote, setUploadedNote] = useState<string | null>(null);
  const [needsScope, setNeedsScope] = useState(false);
  useEffect(() => {
    let live = true;
    const fetchConnection = async (): Promise<YouTubeConnectionView | null> => {
      try {
        const res = await fetch(`/api/videos/youtube/connection?owner=${encodeURIComponent(defaultOwnerRef)}`, { cache: 'no-store' });
        if (!res.ok) return null;
        const body = (await res.json()) as { connection?: YouTubeConnectionView };
        return body.connection?.connected ? body.connection : null;
      } catch {
        return null;
      }
    };
    void fetchConnection().then(next => { if (live) setConnection(next); });
    return () => { live = false; };
  }, [defaultOwnerRef]);
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

  const dirty = () => url.trim().length > 0 || title.trim().length > 0 || description.trim().length > 0;
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(dirty, () => backOr(router, '/feed'));

  const step = VIDEO_STEPS[index];
  const advance = canAdvanceVideoStep(step.id, { videoId: link?.id ?? null, linkTyped: url.trim().length > 0, title, owner });

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
          <i className="fas fa-arrow-left" aria-hidden="true"></i>
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
              A full game, a tournament, a broadcast — anything long lives on YouTube. Upload it there first (your own channel), then paste the link. Edge Athlete keeps the link and your highlights; it never downloads or re-hosts the video. Short clips still go in a post.
            </p>
            {connection && (
              <div className="space-y-2" data-new-video-youtube={connection.canUpload ? 'upload' : 'pick'}>
                <ChannelPicker owner={defaultOwnerRef} onPick={pickFromChannel} />
                {connection.canUpload && !uploadOpen && (
                  <button type="button" onClick={() => setUploadOpen(true)} className="ea-interactive flex w-full items-center gap-3 rounded-lg border border-border px-3 min-h-[48px] text-left" data-new-video-upload-door="">
                    <i className="fas fa-cloud-arrow-up text-brand-fg" aria-hidden="true"></i>
                    <span className="text-sm font-semibold text-primary flex-1">Upload a file to {connection.channelTitle || 'your channel'}</span>
                    <i className="fas fa-chevron-right text-muted" aria-hidden="true"></i>
                  </button>
                )}
                {needsScope && (
                  <p className="text-sm text-secondary" role="status" data-new-video-needs-scope="">
                    Uploads need one more yes at Google.{' '}
                    <a href={`/api/videos/youtube/start?owner=${encodeURIComponent(defaultOwnerRef)}&scope=upload`} className="underline font-semibold">Allow uploads</a>, then come back to this door.
                  </p>
                )}
                {connection.canUpload && uploadOpen && (
                  <YouTubeUploadPanel
                    owner={defaultOwnerRef}
                    onUploaded={uploaded}
                    onNeedsScope={() => setNeedsScope(true)}
                  />
                )}
              </div>
            )}
            {link && (
              <div className="rounded-lg overflow-hidden border border-border" data-new-video-preview={link.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a third-party thumbnail; not an optimizer candidate */}
                <img src={thumbUrl(link.id)} alt="" className="w-full aspect-video object-cover bg-surface-muted" />
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
              <input type="radio" name="owner" checked={owner === 'me'} onChange={() => setOwner('me')} className="h-5 w-5" />
              <span className="text-sm font-semibold text-primary">{prefillProfile && prefillProfile !== userId ? 'The athlete\'s profile' : 'My profile'}</span>
            </label>
            {orgs === null && !profileOnly && <p className="text-xs text-muted">Loading your organizations…</p>}
            {!profileOnly && (orgs ?? []).map(o => (
              <label key={o.id} className={`flex items-center gap-3 rounded-lg border px-3 min-h-[52px] ea-interactive ${owner !== 'me' && owner?.orgId === o.id ? 'border-brand bg-brand-soft' : 'border-border'}`}>
                <input type="radio" name="owner" checked={owner !== 'me' && owner?.orgId === o.id} onChange={() => setOwner({ orgId: o.id })} className="h-5 w-5" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-primary truncate">{o.name}</span>
                  <span className="block text-xs text-muted">{o.side === 'league' ? 'League' : 'Club'}</span>
                </span>
              </label>
            ))}
            {!profileOnly && prefillOrg && orgs !== null && !orgs.some(o => o.id === prefillOrg) && (
              <label className={`flex items-center gap-3 rounded-lg border px-3 min-h-[52px] ea-interactive ${owner !== 'me' && owner?.orgId === prefillOrg ? 'border-brand bg-brand-soft' : 'border-border'}`}>
                <input type="radio" name="owner" checked={owner !== 'me' && owner?.orgId === prefillOrg} onChange={() => setOwner({ orgId: prefillOrg })} className="h-5 w-5" />
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

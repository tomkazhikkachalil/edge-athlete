'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import HighlightList from '@/components/videos/HighlightList';
import GameDetailsCard from '@/components/videos/GameDetailsCard';
import TagTimeline from '@/components/videos/TagTimeline';
import GameStatsPanel from '@/components/videos/GameStatsPanel';
import GameRecap from '@/components/videos/GameRecap';
import { advanceWatch, EMPTY_WATCH, gameWatchKey, parseGameWatch, recapPath, revealMode, serializeGameWatch, visibleHighlights, type GameWatch, type VideoPageView } from '@/lib/videos/game-view';
import type { GameView } from '@/lib/videos/game-rules';
import { LivePill } from '@/components/videos/VideoCards';
import { formatLiveWhen, liveBadgeFor, liveRefetchMs } from '@/lib/videos/live-rules';
import { watchUrl } from '@/lib/videos/youtube';
import { chaptersToHighlights, LOOKUP_NOTES, lookupRefusal, type Chapter, type VideoLookup } from '@/lib/videos/youtube-connection';
import YouTubePlayer, { type YouTubePlayerHandle } from '@/components/videos/YouTubePlayer';
import { activeHighlightAt, clearResumeMs, defaultPlayerStorage, nextInPlaylist, playlistOf, readResumeMs, RESUME_SAVE_EVERY_MS, resumeOffer, writeResumeMs, type PlayerMode, type PlaylistItem } from '@/lib/videos/player-rules';
import { formatTimestamp } from '@/lib/videos/rules';
import { useAuth } from '@/lib/auth';
import { backOr } from '@/lib/nav-back';
import { VIDEO_DESCRIPTION_MAX, VIDEO_TITLE_MAX, type HighlightInput } from '@/lib/videos/rules';
import type { HighlightRow, VideoView } from '@/lib/videos/types';
import { SPORT_REGISTRY, type SportKey } from '@/lib/sports/SportRegistry';
import FaIcon from '@/components/FaIcon';
import { faArrowLeft } from '@/lib/icons/fa/arrow-left';
import { faForward } from '@/lib/icons/fa/forward';
import { faRotateLeft } from '@/lib/icons/fa/rotate-left';
import { faStop } from '@/lib/icons/fa/stop';
import { faYoutubeBrands } from '@/lib/icons/fa/youtube-brands';

type Load =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'error' }
  | { state: 'ready'; video: VideoView; highlights: HighlightRow[]; canManage: boolean; game: GameView | null };

const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';
const FIELD = 'w-full border border-border-strong rounded-lg px-3 min-h-[44px] text-base bg-surface text-primary';

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

/** The API takes a highlight's tag fields flat, beside its time and label (absent = a plain marker / leave the tag alone). */
function highlightBody(input: HighlightInput): Record<string, unknown> {
  const { tag, ...rest } = input;
  return tag ? { ...rest, ...tag } : rest;
}

function ownerHref(v: VideoView): string {
  return v.owner.kind === 'org' ? `/${v.owner.side}/${v.owner.id}` : `/athlete/${v.owner.id}`;
}

const PLACE_PATH: Record<NonNullable<VideoView['place']>['kind'], string> = {
  sport_event: '/events/',
  contest: '/event/',
  round: '/live/',
  activity: '/activities/',
  workout: '/app/workout/',
};

function placeHref(v: VideoView): string | null {
  if (!v.place) return null;
  return `${PLACE_PATH[v.place.kind]}${v.place.id}`;
}

/**
 * A video as a place (Videos program, 296): the player, who it belongs to
 * and where it was played, the highlights in time order, and — for whoever
 * manages it — the edits (title, description, Only me / Managers only,
 * delete) and the markers. Viewer-dependent, so the page is a shell and
 * this fetches with the session; a signed-out visitor of a public owner is
 * welcome. A refusal is the same "not available" as not-found.
 */
export default function VideoScreen({ videoId, initialView = 'watch' }: { videoId: string; initialView?: VideoPageView }) {
  const router = useRouter();
  // Sprint 3 PR 5: the recap is a view of this page (`?view=recap`), so its link is shareable and Back leaves it.
  const [view, setView] = useState<VideoPageView>(initialView);
  const showView = (next: VideoPageView) => {
    setView(next);
    router.replace(next === 'recap' ? recapPath(videoId) : `/videos/${encodeURIComponent(videoId)}`, { scroll: false });
  };
  const { user, initialAuthCheckComplete } = useAuth();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [startMs, setStartMs] = useState<number | null>(null);
  const [playKey, setPlayKey] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '', sport_key: '' });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Paste and go (Nov 6): what YouTube says — a video that will not embed shows the watch door instead of a blank frame;
  // the chapters in its description are offered as highlights when the list is empty. Silent when the lookup is unavailable.
  const [lookup, setLookup] = useState<VideoLookup | null>(null);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  // Polish B (Nov 6): the player that knows the time — the IFrame API's playhead, "Play highlights", resume. All of it only in API mode.
  const playerRef = useRef<YouTubePlayerHandle | null>(null);
  const [playerMode, setPlayerMode] = useState<PlayerMode | null>(null);
  const [playAll, setPlayAll] = useState<{ list: PlaylistItem[]; index: number } | null>(null);
  const playAllRef = useRef(playAll);
  useEffect(() => {
    playAllRef.current = playAll;
  }, [playAll]);
  const lastSavedRef = useRef(0);
  const [resumeAt, setResumeAt] = useState<number | null>(null);

  const fetchVideo = useCallback(async (): Promise<Load> => {
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}`, { cache: 'no-store' });
      if (res.status === 404) return { state: 'missing' };
      if (!res.ok) return { state: 'error' };
      const body = (await res.json()) as { video: VideoView; highlights: HighlightRow[]; can_manage: boolean; game?: GameView | null };
      return { state: 'ready', video: body.video, highlights: body.highlights, canManage: body.can_manage, game: body.game ?? null };
    } catch {
      return { state: 'error' };
    }
  }, [videoId]);

  // The session decides what the API answers: fetch once the auth check has
  // settled, and again when the user changes (a login on this page).
  const viewerId = user?.id ?? null;
  useEffect(() => {
    if (!initialAuthCheckComplete) return;
    let live = true;
    void fetchVideo().then(next => {
      if (!live) return;
      setLoad(next);
      // The resume chip: a saved position worth offering, read once the video is known (polish B).
      if (next.state === 'ready') setResumeAt(resumeOffer(readResumeMs(defaultPlayerStorage(), next.video.provider_video_id), next.video.duration_ms));
    });
    return () => {
      live = false;
    };
  }, [initialAuthCheckComplete, viewerId, fetchVideo]);

  const providerVideoId = load.state === 'ready' ? load.video.provider_video_id : null;
  const ownerRef = load.state === 'ready' ? (load.video.owner.kind === 'org' ? `${load.video.owner.side}:${load.video.owner.id}` : `profile:${load.video.owner.id}`) : null;
  useEffect(() => {
    if (!providerVideoId || !ownerRef || !user) return;
    let live = true;
    void fetch(`/api/videos/youtube/lookup?id=${encodeURIComponent(providerVideoId)}&owner=${encodeURIComponent(ownerRef)}`, { cache: 'no-store' })
      .then(async res => (res.ok ? ((await res.json()) as { lookup?: VideoLookup }).lookup ?? null : null))
      .catch(() => null)
      .then(next => {
        if (!live || !next) return;
        setLookup(next);
        if (next.chapters.length > 0) setChapters(next.chapters);
      });
    return () => {
      live = false;
    };
  }, [providerVideoId, ownerRef, user]);

  // Phase 4a: while a broadcast is live (or about to be) the page re-reads on its own, so
  // the pill, the state and the archive arrive without a reload. Nothing polls otherwise.
  const refetchMs = load.state === 'ready' ? liveRefetchMs(load.video) : null;
  useEffect(() => {
    if (refetchMs === null) return;
    const timer = setInterval(() => {
      void fetchVideo().then(next => {
        if (next.state === 'ready') setLoad(prev => (prev.state === 'ready' ? { ...prev, video: next.video, highlights: next.highlights, canManage: next.canManage } : next));
      });
    }, refetchMs);
    return () => clearInterval(timer);
  }, [refetchMs, fetchVideo]);

  // Sprint 3 PR 4 — the spoiler-free view: the furthest point watched (it only moves forward) and the unlock, kept on this device per video.
  const [watch, setWatch] = useState<GameWatch>(EMPTY_WATCH);
  const watchRef = useRef(watch);
  useEffect(() => {
    watchRef.current = watch;
  }, [watch]);
  const saveWatch = useCallback((w: GameWatch) => {
    try {
      defaultPlayerStorage()?.setItem(gameWatchKey(videoId), serializeGameWatch(w));
    } catch {
      /* without storage the reveal starts over on a reload — nothing else is lost */
    }
  }, [videoId]);
  useEffect(() => {
    let stored: GameWatch = EMPTY_WATCH;
    try {
      stored = parseGameWatch(defaultPlayerStorage()?.getItem(gameWatchKey(videoId)));
    } catch {
      stored = EMPTY_WATCH;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the device's stored watch is read once per video, after mount (never during render: storage is not there on the server)
    setWatch(stored);
  }, [videoId]);
  const unlockStats = () => {
    const next = { ...watchRef.current, unlocked: true };
    setWatch(next);
    saveWatch(next);
  };
  /** What THIS viewer may be shown right now: everything, or what the video has played past. */
  const shownFor = (w: GameWatch): HighlightRow[] => {
    if (load.state !== 'ready') return [];
    return visibleHighlights(load.highlights, revealMode(load.game, load.canManage, w.unlocked), w.highWaterMs);
  };
  const onTime = (ms: number) => {
    if (!providerVideoId) return;
    // The active row follows the playhead.
    // The spoiler-free view: the furthest point only moves forward.
    const advanced = advanceWatch(watchRef.current, ms);
    if (advanced !== watchRef.current) {
      watchRef.current = advanced;
      setWatch(advanced);
    }
    if (load.state === 'ready') setActiveId(activeHighlightAt(shownFor(advanced), ms));
    // Resume: the position every few seconds (and the furthest point with it).
    if (Date.now() - lastSavedRef.current > RESUME_SAVE_EVERY_MS) {
      lastSavedRef.current = Date.now();
      writeResumeMs(defaultPlayerStorage(), providerVideoId, ms);
      saveWatch(watchRef.current);
    }
    // Play highlights: stay, step, or stop.
    const pa = playAllRef.current;
    if (pa) {
      const step = nextInPlaylist(pa.list, pa.index, ms);
      if (step.action === 'next') {
        setPlayAll({ list: pa.list, index: step.index });
        playerRef.current?.seekTo(pa.list[step.index].startMs, true);
      } else if (step.action === 'done') {
        setPlayAll(null);
      }
    }
  };
  const onEnded = () => {
    if (providerVideoId) clearResumeMs(defaultPlayerStorage(), providerVideoId);
    setResumeAt(null);
    setPlayAll(null);
  };
  /** Walk a list of clips: all the shown highlights, or (PR 6) one athlete's. Outside API mode the first one plays and the rest are a tap away. */
  const playList = (rows: HighlightRow[]) => {
    if (rows.length === 0) return;
    const list = playlistOf(rows);
    setPlayAll({ list, index: 0 });
    setActiveId(list[0].id);
    if (playerMode === 'api') playerRef.current?.seekTo(list[0].startMs, true);
    else {
      setStartMs(list[0].startMs);
      setPlayKey(k => k + 1);
    }
  };
  const playTags = (ids: string[]) => {
    const wanted = new Set(ids);
    playList(shownFor(watch).filter(h => wanted.has(h.id)));
  };
  const playTag = (id: string) => {
    const h = shownFor(watch).find(x => x.id === id);
    if (h) play(h);
  };
  const playHighlights = () => {
    const shown = shownFor(watch);
    if (load.state !== 'ready' || shown.length === 0) return;
    const list = playlistOf(shown);
    setPlayAll({ list, index: 0 });
    setActiveId(list[0].id);
    if (playerMode === 'api') playerRef.current?.seekTo(list[0].startMs, true);
    else {
      setStartMs(list[0].startMs);
      setPlayKey(k => k + 1);
    }
  };
  const resume = () => {
    if (resumeAt === null) return;
    setStartMs(resumeAt);
    setPlayKey(k => k + 1);
    setResumeAt(null);
  };

  const seekTo = (ms: number) => {
    setPlayAll(null);
    setStartMs(ms);
    setPlayKey(k => k + 1);
  };
  // PR 7: the signed-in viewer is tagged in this video — they may remove the tags of themselves (no right over the video needed).
  const [confirmUntag, setConfirmUntag] = useState(false);
  const untagMe = async () => {
    setConfirmUntag(false);
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/tags`, { method: 'DELETE' });
      if (!res.ok) { setNote('Could not remove the tags. Try again.'); return; }
      const next = await fetchVideo();
      if (next.state === 'ready') setLoad(next);
    } catch {
      setNote('Could not remove the tags. Check your connection and try again.');
    }
  };
  const play = (h: HighlightRow) => {
    setPlayAll(null);
    setStartMs(h.start_ms);
    setActiveId(h.id);
    setPlayKey(k => k + 1);
  };

  const patchVideo = async (patch: Record<string, unknown>): Promise<string | null> => {
    const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!res.ok) return readError(res);
    const body = (await res.json()) as { video: VideoView; highlights: HighlightRow[] };
    setLoad(prev => (prev.state === 'ready' ? { ...prev, video: body.video, highlights: body.highlights } : prev));
    return null;
  };

  const withHighlights = (res: Response) => async (): Promise<string | null> => {
    if (!res.ok) return readError(res);
    const body = (await res.json()) as { highlights: HighlightRow[] };
    setLoad(prev => (prev.state === 'ready' ? { ...prev, highlights: body.highlights, video: { ...prev.video, highlight_count: body.highlights.length } } : prev));
    return null;
  };

  const addHighlight = async (input: HighlightInput) => {
    const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/highlights`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(highlightBody(input)) });
    return withHighlights(res)();
  };
  const editHighlight = async (id: string, input: HighlightInput) => {
    const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/highlights/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(highlightBody(input)) });
    return withHighlights(res)();
  };
  const deleteHighlight = async (id: string) => {
    const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/highlights/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (activeId === id) setActiveId(null);
    return withHighlights(res)();
  };

  const startEdit = (v: VideoView) => {
    setDraft({ title: v.title, description: v.description ?? '', sport_key: v.sport_key ?? '' });
    setNote(null);
    setEditing(true);
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) {
      setNote('Give the video a title.');
      return;
    }
    setSaving(true);
    const err = await patchVideo({ title: draft.title.trim(), description: draft.description.trim() || null, sport_key: draft.sport_key || null });
    setSaving(false);
    if (err) {
      setNote(err);
      return;
    }
    setEditing(false);
    setNote(null);
  };

  const toggleHidden = async (v: VideoView) => {
    setSaving(true);
    const err = await patchVideo({ status: v.status === 'hidden' ? 'published' : 'hidden' });
    setSaving(false);
    setNote(err);
  };

  // Phase 3: the duration (and whatever else the Data API knows) through the owner's YouTube connection.
  const refreshFromYouTube = async () => {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/refresh`, { method: 'POST' });
      if (!res.ok) {
        setNote(res.status === 404 ? 'Connect a YouTube channel on the Videos tab to read the details.' : await readError(res));
        return;
      }
      const body = (await res.json()) as { video: VideoView | null; chapters?: Chapter[] };
      if (body.video) setLoad(prev => (prev.state === 'ready' ? { ...prev, video: body.video! } : prev));
      if (body.chapters && body.chapters.length > 0) setChapters(body.chapters);
      setNote('Details refreshed from YouTube.');
    } catch {
      setNote('Could not reach YouTube. Try again.');
    } finally {
      setSaving(false);
    }
  };

  // Paste and go: YouTube's chapters as the first highlights, ONE write; offered only while the list is empty.
  const importChapters = async () => {
    if (load.state !== 'ready' || !chapters || chapters.length === 0) return;
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/highlights/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ highlights: chaptersToHighlights(chapters, load.video.duration_ms).map(h => ({ ...h, meta: {} })) }) });
      if (!res.ok) {
        setNote(await readError(res));
        return;
      }
      const body = (await res.json()) as { highlights: HighlightRow[] };
      setLoad(prev => (prev.state === 'ready' ? { ...prev, highlights: body.highlights, video: { ...prev.video, highlight_count: body.highlights.length } } : prev));
      setNote(`${body.highlights.length} chapters added as highlights.`);
    } catch {
      setNote('Could not add the chapters. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    if (load.state !== 'ready') return;
    const home = ownerHref(load.video);
    setSaving(true);
    const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}`, { method: 'DELETE' });
    setSaving(false);
    if (!res.ok) {
      setNote(await readError(res));
      return;
    }
    router.replace(home);
  };

  if (load.state === 'loading') {
    return (
      <div className="py-16 text-center text-sm text-muted" role="status" aria-live="polite" data-video-loading="">
        Loading video…
      </div>
    );
  }

  if (load.state === 'missing' || load.state === 'error') {
    return (
      <div className="bg-surface rounded-lg border border-border p-6 text-center" data-video-unavailable="">
        <h1 className="text-xl font-bold text-primary mb-2">{load.state === 'missing' ? 'Video not available' : 'Could not load this video'}</h1>
        <p className="text-sm text-secondary mb-4">{load.state === 'missing' ? 'It may have been removed, or it is private.' : 'Check your connection and try again.'}</p>
        <button type="button" onClick={() => backOr(router, '/feed')} className={BTN}>Back</button>
      </div>
    );
  }

  const { video, highlights: allHighlights, canManage } = load;
  // A viewer of a game with hidden stats is shown only what the video has played past (PR 4).
  const mode = revealMode(load.game, canManage, watch.unlocked);
  const highlights = visibleHighlights(allHighlights, mode, watch.highWaterMs);
  const sport = video.sport_key ? SPORT_REGISTRY[video.sport_key as SportKey]?.display_name ?? null : null;
  const place = placeHref(video);
  const live = liveBadgeFor(video);

  return (
    <div className="space-y-4" data-video-screen={video.id}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => backOr(router, ownerHref(video))} className="ea-icon-btn text-secondary" aria-label="Back" data-video-back="">
          <FaIcon icon={faArrowLeft} />
        </button>
        <h1 className="text-xl sm:text-2xl font-bold text-primary min-w-0 flex-1 truncate" data-video-title="">{video.title}</h1>
        {video.status === 'hidden' && (
          <span className="shrink-0 text-xs font-semibold px-2 py-1 rounded-full bg-surface-muted text-secondary" data-video-hidden="">
            {video.owner.kind === 'org' ? 'Managers only' : 'Only me'}
          </span>
        )}
      </div>

      {view === 'recap' && load.game && (
        <GameRecap
          videoId={video.id}
          videoTitle={video.title}
          game={load.game}
          highlights={allHighlights}
          mode={mode}
          highWaterMs={watch.highWaterMs}
          onUnlock={unlockStats}
          onWatch={ms => { showView('watch'); if (ms !== undefined) seekTo(ms); }}
          onPlay={h => { showView('watch'); play(h); }}
          onPlayTag={id => { showView('watch'); playTag(id); }}
          onPlayTags={ids => { showView('watch'); playTags(ids); }}
        />
      )}

      {/* The video itself: hidden (not unmounted) under the recap, so coming back keeps the player where it was. */}
      <div className={view === 'recap' && load.game ? 'hidden' : 'space-y-4'} data-video-watch="">
      {live && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-secondary" data-video-live={live.kind}>
          {live.kind === 'live' && <LivePill />}
          {live.kind === 'live'
            ? 'Streaming now on YouTube — the player follows the broadcast.'
            : live.kind === 'upcoming'
              ? (live.at ? `Scheduled to stream ${formatLiveWhen(live.at)}.` : 'Scheduled to stream — the time is not set yet.')
              : `Streamed live${live.at ? ` ${formatLiveWhen(live.at)}` : ''} — this is the recording.`}
        </p>
      )}

      {lookupRefusal(lookup) === 'no_embed' ? (
        <a href={watchUrl(video.provider_video_id)} target="_blank" rel="noopener noreferrer" className="ea-interactive relative block aspect-video w-full overflow-hidden rounded-lg bg-surface-muted" data-video-no-embed="">
          {/* eslint-disable-next-line @next/next/no-img-element -- a third-party thumbnail; not an optimizer candidate */}
          <img src={video.thumb_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-black/70"><FaIcon icon={faYoutubeBrands} className="text-xl" /></span>
            <span className="text-sm font-semibold drop-shadow">Open on YouTube</span>
            <span className="text-xs drop-shadow">{LOOKUP_NOTES.no_embed}</span>
          </span>
        </a>
      ) : (
        <YouTubePlayer
          api
          ref={playerRef}
          videoId={video.provider_video_id}
          title={video.title}
          startMs={startMs}
          playKey={playKey}
          onTime={onTime}
          onEnded={onEnded}
          onMode={setPlayerMode}
          overlay={resumeAt !== null ? (
            <button type="button" onClick={resume} className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full bg-black/75 px-4 min-h-[44px] text-sm font-semibold text-white" data-video-resume={resumeAt}>
              <FaIcon icon={faRotateLeft} />
              Resume at {formatTimestamp(resumeAt)}
            </button>
          ) : null}
        />
      )}
      {playerMode === 'api' && highlights.length >= 2 && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={playAll ? () => setPlayAll(null) : playHighlights} className={BTN} data-video-play-highlights={playAll ? 'on' : 'off'}>
            <FaIcon icon={playAll ? faStop : faForward} className="mr-1.5" />
            {playAll ? 'Stop the highlights' : 'Play highlights'}
          </button>
          {playAll && <span className="text-xs text-secondary" role="status">Highlight {playAll.index + 1} of {playAll.list.length}</span>}
        </div>
      )}

      <div className="bg-surface rounded-lg border border-border p-4 sm:p-6 space-y-3" data-video-owner={video.owner.id}>
        <p className="text-sm text-secondary">
          {video.owner.kind === 'org' ? 'From ' : 'By '}
          <Link href={ownerHref(video)} className="font-semibold text-primary underline-offset-2 hover:underline">{video.owner.name}</Link>
          {video.place && place && (
            <>
              {' · '}
              <Link href={place} className="underline-offset-2 hover:underline" data-video-place={video.place.id}>{video.place.name}</Link>
            </>
          )}
          {sport && <> · {sport}</>}
        </p>
        {!editing && video.description && <p className="text-sm text-primary whitespace-pre-wrap">{video.description}</p>}
        <p className="text-xs text-muted">Hosted on YouTube. Edge Athlete links it and keeps the highlights; it never downloads or edits the video.</p>

        {canManage && !editing && (
          <div className="flex flex-wrap gap-2 pt-1" data-video-manage="">
            <button type="button" onClick={() => startEdit(video)} className={BTN} data-video-edit="">Edit</button>
            <button type="button" onClick={() => toggleHidden(video)} disabled={saving} className={BTN} data-video-toggle-hidden="">
              {video.status === 'hidden' ? 'Show' : video.owner.kind === 'org' ? 'Managers only' : 'Only me'}
            </button>
            <button type="button" onClick={() => void refreshFromYouTube()} disabled={saving} className={BTN} data-video-refresh="">Refresh from YouTube</button>
            {chapters && chapters.length > 0 && highlights.length === 0 && (
              <button type="button" onClick={() => void importChapters()} disabled={saving} className={BTN} data-video-import-chapters={chapters.length}>Add {chapters.length} chapters as highlights</button>
            )}
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving} className={`${BTN} text-red-600`} data-video-delete="">Delete</button>
          </div>
        )}

        {canManage && editing && (
          <form onSubmit={saveEdit} className="space-y-3" data-video-edit-form="">
            <label className="block text-sm text-secondary">
              Title
              <input className={`${FIELD} mt-1`} maxLength={VIDEO_TITLE_MAX} value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
            </label>
            <label className="block text-sm text-secondary">
              Description
              <textarea className={`${FIELD} mt-1 py-2 min-h-[88px]`} maxLength={VIDEO_DESCRIPTION_MAX} value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
            </label>
            <label className="block text-sm text-secondary">
              Sport
              <select className={`${FIELD} mt-1`} value={draft.sport_key} onChange={e => setDraft(d => ({ ...d, sport_key: e.target.value }))}>
                <option value="">No sport</option>
                {Object.values(SPORT_REGISTRY).filter(s => s.enabled).map(s => (
                  <option key={s.sport_key} value={s.sport_key}>{s.display_name}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setEditing(false); setNote(null); }} className={BTN}>Cancel</button>
              <button type="submit" disabled={saving} className="ea-cta px-4 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        )}
        {note && <p className="text-sm text-red-600" role="alert">{note}</p>}
      </div>

      <GameDetailsCard
        videoId={video.id}
        game={load.game}
        canManage={canManage}
        videoSportKey={video.sport_key}
        owner={video.owner}
        onChange={game => setLoad(prev => (prev.state === 'ready' ? { ...prev, game } : prev))}
      />

      {load.game && (
        <div className="flex justify-end">
          <button type="button" onClick={() => showView('recap')} className={BTN} data-video-open-recap="">Game recap</button>
        </div>
      )}

      {/* One stats panel at a time: under the recap it is the recap's. */}
      {load.game && view === 'watch' && <GameStatsPanel game={load.game} highlights={allHighlights} mode={mode} highWaterMs={watch.highWaterMs} onUnlock={unlockStats} onSeek={seekTo} onPlayTag={playTag} onPlayTags={playTags} />}

      {/* The marks are spoilers: a manager always has the timeline; a viewer of a game gets it once everything is shown. */}
      {(canManage || (load.game && mode === 'all')) && <TagTimeline highlights={highlights} durationMs={video.duration_ms} game={load.game} activeId={activeId} onPlay={play} />}

      <HighlightList
        highlights={highlights}
        canManage={canManage}
        activeId={activeId}
        onPlay={play}
        onAdd={addHighlight}
        onEdit={editHighlight}
        onDelete={deleteHighlight}
        liveStartedAt={video.live_status === 'live' ? video.live_started_at : null}
        currentMs={playerMode === 'api' ? () => playerRef.current?.currentMs() ?? null : undefined}
        game={load.game}
        durationMs={video.duration_ms}
      />
      </div>

      {user && allHighlights.some(h => h.people.some(p => p.profile_id === user.id)) && (
        <div className="bg-surface rounded-lg border border-border p-4 flex flex-wrap items-center gap-3" data-video-tagged-me="">
          <p className="min-w-0 flex-1 text-sm text-secondary">You are tagged in this video. The clips and stats show on your profile.</p>
          <button type="button" onClick={() => setConfirmUntag(true)} className={BTN} data-video-untag-me="">Remove my tags</button>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmUntag}
        title="Remove your tags?"
        message="Every tag of you in this video is removed: the clips leave your profile and the stats from them are no longer counted. The video itself is not changed, and the tags cannot be put back by the people who made them."
        confirmText="Remove"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onCancel={() => setConfirmUntag(false)}
        onConfirm={untagMe}
      />

      <ConfirmModal
        isOpen={confirmDelete}
        title="Delete this video?"
        message={`"${video.title}" and its ${video.highlight_count} ${video.highlight_count === 1 ? 'highlight' : 'highlights'} will be removed from Edge Athlete. The video stays on YouTube.`}
        confirmText="Delete"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    </div>
  );
}

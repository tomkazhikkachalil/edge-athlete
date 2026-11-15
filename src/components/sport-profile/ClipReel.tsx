'use client';

/**
 * The play level (Sprint 4 PR 4): a list of clips played back to back — in
 * one game or across a season's videos — without leaving the page. One
 * YouTube player; a clip in the SAME video seeks, a clip in ANOTHER video
 * remounts the player on that video at the clip's start. With YouTube's
 * API the reel steps on its own at each clip's end; without it (the plain
 * frame) Next is the step. Every clip names its game and links to that
 * moment on the game's own page.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import YouTubePlayer from '@/components/videos/YouTubePlayer';
import { reelPlaylist, reelStep, type ReelClip } from '@/lib/sport-profile/rules';
import { tagPath } from '@/lib/videos/game-view';
import { OPEN_HIGHLIGHT_MS, type PlayerMode } from '@/lib/videos/player-rules';
import { formatDateShort } from './format';

const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h > 0 ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
};

/** What a clip is called: the sheet's event, then the tagger's own label — once, when they say the same thing. */
const clipTitle = (event: string | null, label: string): string => {
  const own = label.trim();
  if (event && own && event.toLowerCase() !== own.toLowerCase()) return `${event} · ${own}`;
  return event || own || 'Clip';
};

interface Props {
  heading: string;
  clips: ReelClip[];
  /** How many clips the reel has in all (more than `clips` when there are further pages). */
  total: number;
  onLoadMore?: () => void;
  /** Leaves the reel (the level's own address). */
  closeHref?: string;
  /** Said under each clip's game line, e.g. the event's name for a sheet. */
  eventLabel?: (eventKey: string | null) => string | null;
  /** The Clips browser: where the playing clip came from — its game's stats, and each stat it made. */
  origin?: (clip: ReelClip) => { gameHref: string; stats: Array<{ key: string; label: string; href: string }> };
  /** The athlete's own page: hide the playing clip from it, or show it again (the stat still counts). */
  manage?: { busy: boolean; setHidden: (clip: ReelClip, hidden: boolean) => void };
}

export default function ClipReel({ heading, clips, total, onLoadMore, closeHref, eventLabel, origin, manage }: Props) {
  const list = useMemo(() => reelPlaylist(clips, OPEN_HIGHLIGHT_MS), [clips]);
  const [index, setIndex] = useState(0);
  // Bumped on every jump: the player seeks (same video) or mounts at the start (another video).
  const [playKey, setPlayKey] = useState(0);
  const [mode, setMode] = useState<PlayerMode | null>(null);
  const [done, setDone] = useState(false);
  const at = Math.min(index, Math.max(0, clips.length - 1));
  const clip = clips[at];

  const go = (i: number) => {
    if (i < 0 || i >= clips.length) return;
    setIndex(i);
    setDone(false);
    setPlayKey(k => k + 1);
  };
  const onTime = (ms: number) => {
    const step = reelStep(list, at, ms);
    if (step.action === 'next') go(step.index);
    else if (step.action === 'done') setDone(true);
  };

  if (!clip) {
    return (
      <section className="space-y-3" data-clip-reel="" data-clip-reel-count={0}>
        <header className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-primary">{heading}</h2>
          {closeHref && <Link href={closeHref} scroll={false} replace className="ea-interactive rounded px-2 py-1 text-sm font-medium text-secondary" data-clip-reel-close="">Close</Link>}
        </header>
        <p className="text-secondary">No clips to play here.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3" data-clip-reel="" data-clip-reel-count={total} data-clip-reel-index={at} data-clip-reel-video={clip.youtubeId}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-primary">{heading}</h2>
          <p className="text-sm text-secondary" aria-live="polite" data-clip-reel-now="">
            Clip {at + 1} of {total} · {clip.gameTitle}{clip.gameDate ? ` · ${formatDateShort(clip.gameDate)}` : ''}
          </p>
        </div>
        {closeHref && <Link href={closeHref} scroll={false} replace className="ea-interactive shrink-0 rounded px-2 py-1 text-sm font-medium text-secondary" data-clip-reel-close="">Close</Link>}
      </header>

      {/* Keyed by the video: a clip in another video is a new player, started at the clip. */}
      <YouTubePlayer
        key={clip.youtubeId}
        api
        videoId={clip.youtubeId}
        title={`${clip.gameTitle}: ${clip.label || 'clip'}`}
        startMs={clip.startMs}
        playKey={playKey}
        onTime={onTime}
        onMode={setMode}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => go(at - 1)} disabled={at === 0} className="ea-interactive min-h-[44px] rounded-lg border border-border bg-surface px-4 text-sm font-medium text-primary disabled:opacity-40" data-clip-reel-prev="">Previous</button>
        <button type="button" onClick={() => go(at + 1)} disabled={at >= clips.length - 1} className="ea-interactive min-h-[44px] rounded-lg border border-border bg-surface px-4 text-sm font-medium text-primary disabled:opacity-40" data-clip-reel-next="">Next</button>
        {playKey === 0 && <button type="button" onClick={() => go(at)} className="ea-cta inline-flex min-h-[44px] items-center rounded-lg px-4 text-sm font-semibold text-white" data-clip-reel-play="">Play {total === 1 ? 'the clip' : `these ${total}`}</button>}
        <Link href={tagPath(clip.videoId, clip.id)} className="ea-interactive ml-auto rounded px-2 py-1 text-sm font-medium text-secondary underline decoration-border underline-offset-4" data-clip-reel-game="">Open this moment in the game</Link>
      </div>
      {origin && (() => {
        const from = origin(clip);
        return (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-secondary" data-clip-origin="">
            <span>From</span>
            <Link href={from.gameHref} className="ea-interactive rounded font-medium text-primary underline decoration-border underline-offset-4" data-clip-origin-game="">{clip.gameTitle} — the game&apos;s stats</Link>
            {from.stats.map(st => (
              <Link key={st.key} href={st.href} className="ea-interactive rounded font-medium text-primary underline decoration-border underline-offset-4" data-clip-origin-stat={st.key}>{st.label}</Link>
            ))}
          </p>
        );
      })()}
      {manage && (
        <p className="flex flex-wrap items-center gap-3 text-sm text-secondary" data-clip-hide="">
          {clip.hidden && <span data-clip-hidden="">Hidden from your page — only you see it here. Its stats still count.</span>}
          <button type="button" disabled={manage.busy} onClick={() => manage.setHidden(clip, !clip.hidden)} className="ea-interactive min-h-[44px] rounded-lg border border-border bg-surface px-4 font-medium text-primary disabled:opacity-60" data-clip-hide-toggle="">
            {clip.hidden ? 'Show this clip on my page' : 'Hide this clip from my page'}
          </button>
        </p>
      )}
      {done && <p className="text-sm text-secondary" data-clip-reel-done="">That was the last clip.</p>}
      {mode === 'frame' && clips.length > 1 && <p className="text-xs text-muted">Use Next to move to the following clip.</p>}

      <ol className="max-h-72 divide-y divide-border-subtle overflow-y-auto rounded-lg border border-border-subtle" data-clip-reel-list="">
        {clips.map((c, i) => {
          const event = eventLabel?.(c.eventKey) ?? null;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => go(i)}
                aria-current={i === at ? 'true' : undefined}
                data-clip={c.id}
                className={`ea-interactive flex min-h-[44px] w-full items-center gap-3 px-3 py-2 text-left text-sm ${i === at ? 'bg-surface-muted font-medium text-primary' : 'text-secondary'}`}
              >
                <span className="w-14 shrink-0 tabular-nums text-muted">{clock(c.startMs)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-primary">{clipTitle(event, c.label)}</span>
                  <span className="block truncate text-xs text-muted">{c.gameTitle}{c.gameDate ? ` · ${formatDateShort(c.gameDate)}` : ''}{c.standing === 'recreational' ? ' · Recreational' : ''}{c.hidden ? ' · Hidden from your page' : ''}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {onLoadMore && clips.length < total && (
        <button type="button" onClick={onLoadMore} className="ea-interactive min-h-[44px] rounded-lg border border-border bg-surface px-4 text-sm font-medium text-primary" data-clip-reel-more="">Show more clips</button>
      )}
    </section>
  );
}

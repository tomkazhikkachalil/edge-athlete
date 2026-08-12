'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LazyImage from './LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { liveRoundPath } from '@/lib/golf/round-route';

interface LivePlayer {
  profile_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  total_score: number | null;
  to_par: number | null;
  thru: number;
}

interface LiveRound {
  group_post_id: string;
  post_id: string | null;
  course_name: string;
  holes_played: number;
  date: string;
  players: LivePlayer[];
}

interface LiveNowStripProps {
  /** 'strip' = horizontal scroll (feed); 'grid' = stacked cards (Explore). */
  variant?: 'strip' | 'grid';
  /** Custom open handler; when absent the component hosts its own modal. */
  /** Render a friendly empty state instead of nothing (the /live page). */
  showEmptyState?: boolean;
  /** Hide the internal "Live Now" heading (the /live page has its own). */
  hideHeading?: boolean;
}

const REFRESH_MS = 60_000;

/**
 * "Live Now" — live rounds from people you follow (and you). Renders nothing
 * when nobody's live. Same surface will later carry tournament leaderboards.
 */
export default function LiveNowStrip({ variant = 'strip', showEmptyState = false, hideHeading = false }: LiveNowStripProps) {
  const router = useRouter();
  const [rounds, setRounds] = useState<LiveRound[]>([]);

  // Inlined cancellable IIFE. The 60s poll calls the SAME effect-local
  // closure, so the cancelled flag also stops a late poll response landing
  // after unmount.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch('/api/golf/live-now', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRounds(data.rounds || []);
      } catch { /* strip is a nicety — never break the page */ }
    };
    run();
    const interval = setInterval(run, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (rounds.length === 0) {
    if (!showEmptyState) return null;
    return (
      <div className="bg-surface rounded-lg border-2 border-border p-8 text-center">
        <div className="text-faint mb-3">
          <i className="fas fa-satellite-dish text-3xl"></i>
        </div>
        <h3 className="text-lg font-semibold text-primary mb-1">No live events right now</h3>
        <p className="text-sm text-tertiary">
          When someone you follow goes live — a round, a game, a match — it shows up here.
        </p>
      </div>
    );
  }

  // A live round is a place now — cards go to the round, not to its post.
  // Participants land in the scorer, everyone else on the watch view, and it
  // works even when post_id is null.
  const open = (groupPostId: string) => {
    router.push(liveRoundPath(groupPostId));
  };

  const card = (round: LiveRound) => {
    const leader = round.players
      .filter(p => p.total_score !== null)
      .sort((a, b) => (a.total_score ?? Infinity) - (b.total_score ?? Infinity))[0];
    return (
      <button
        key={round.group_post_id}
        onClick={() => open(round.group_post_id)}
        className={`text-left bg-surface border-2 border-red-200 dark:border-red-800 hover:border-red-400 rounded-lg p-3 transition-all hover:shadow-md ${
          variant === 'strip' ? 'min-w-[220px] flex-shrink-0' : 'w-full'
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded-full">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
            LIVE
          </span>
          <span className="text-sm font-bold text-primary truncate">{round.course_name}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {round.players.slice(0, 3).map(p => {
              const name = formatDisplayName(p.first_name, null, p.last_name, p.full_name);
              return p.avatar_url ? (
                <LazyImage
                  key={p.profile_id}
                  src={p.avatar_url}
                  alt={name}
                  className="w-7 h-7 rounded-full object-cover border-2 border-white"
                  width={28}
                  height={28}
                />
              ) : (
                <div
                  key={p.profile_id}
                  className="w-7 h-7 rounded-full bg-gray-300 dark:bg-stone-700 border-2 border-white flex items-center justify-center text-[10px] font-bold text-secondary"
                >
                  {getInitials(name)}
                </div>
              );
            })}
          </div>
          <div className="text-xs text-tertiary min-w-0 truncate">
            {leader
              ? `${formatDisplayName(leader.first_name, null, leader.last_name, leader.full_name)} · ${leader.total_score} thru ${leader.thru}`
              : `${round.players.length} playing`}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="mb-4">
      {!hideHeading && (
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 bg-red-600 rounded-full animate-pulse"></span>
          <h3 className="text-sm font-bold text-primary">Live Now</h3>
        </div>
      )}
      {/* Strip variant: hidden scrollbar + edge bleed below sm, so a cut-off
          card at the screen edge is the "more here" affordance instead of a
          card cropped mid-avatar at the container's padding line. */}
      <div
        className={
          variant === 'strip'
            ? 'flex gap-3 overflow-x-auto pb-1 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0'
            : 'grid gap-3 sm:grid-cols-2'
        }
      >
        {rounds.map(card)}
      </div>

    </div>
  );
}

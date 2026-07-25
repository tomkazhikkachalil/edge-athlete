'use client';

import { useCallback, useEffect, useState } from 'react';
import LazyImage from './LazyImage';
import PostDetailModal from './PostDetailModal';
import { formatDisplayName, getInitials } from '@/lib/formatters';

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
  currentUserId?: string;
  /** 'strip' = horizontal scroll (feed); 'grid' = stacked cards (Explore). */
  variant?: 'strip' | 'grid';
  /** Custom open handler; when absent the component hosts its own modal. */
  onOpenPost?: (postId: string) => void;
}

const REFRESH_MS = 60_000;

/**
 * "Live Now" — live rounds from people you follow (and you). Renders nothing
 * when nobody's live. Same surface will later carry tournament leaderboards.
 */
export default function LiveNowStrip({ currentUserId, variant = 'strip', onOpenPost }: LiveNowStripProps) {
  const [rounds, setRounds] = useState<LiveRound[]>([]);
  const [openPostId, setOpenPostId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/golf/live-now', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setRounds(data.rounds || []);
    } catch { /* strip is a nicety — never break the page */ }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  if (rounds.length === 0) return null;

  const open = (postId: string | null) => {
    if (!postId) return;
    if (onOpenPost) onOpenPost(postId);
    else setOpenPostId(postId);
  };

  const card = (round: LiveRound) => {
    const leader = round.players
      .filter(p => p.total_score !== null)
      .sort((a, b) => (a.total_score ?? Infinity) - (b.total_score ?? Infinity))[0];
    return (
      <button
        key={round.group_post_id}
        onClick={() => open(round.post_id)}
        className={`text-left bg-white border-2 border-red-200 hover:border-red-400 rounded-lg p-3 transition-all hover:shadow-md ${
          variant === 'strip' ? 'min-w-[220px] flex-shrink-0' : 'w-full'
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded-full">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
            LIVE
          </span>
          <span className="text-sm font-bold text-gray-900 truncate">{round.course_name}</span>
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
                  className="w-7 h-7 rounded-full bg-gray-300 border-2 border-white flex items-center justify-center text-[10px] font-bold text-gray-700"
                >
                  {getInitials(name)}
                </div>
              );
            })}
          </div>
          <div className="text-xs text-gray-600 min-w-0 truncate">
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
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 bg-red-600 rounded-full animate-pulse"></span>
        <h3 className="text-sm font-bold text-gray-900">Live Now</h3>
      </div>
      <div className={variant === 'strip' ? 'flex gap-3 overflow-x-auto pb-1' : 'grid gap-3 sm:grid-cols-2'}>
        {rounds.map(card)}
      </div>

      {!onOpenPost && (
        <PostDetailModal
          postId={openPostId}
          isOpen={!!openPostId}
          onClose={() => setOpenPostId(null)}
          currentUserId={currentUserId}
        />
      )}
    </div>
  );
}

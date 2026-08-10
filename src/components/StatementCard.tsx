'use client';

import { formatDistanceToNow } from 'date-fns';
import LazyImage from './LazyImage';
import QuotedPostEmbed, { type QuotedPost } from './QuotedPostEmbed';
import { formatDisplayName, getInitials } from '@/lib/formatters';

/** The slice of a profile-media RPC row a statement card renders. */
export interface StatementItem {
  id: string;
  caption: string | null;
  created_at: string;
  profile_id: string;
  profile_first_name: string | null;
  profile_last_name: string | null;
  profile_full_name: string | null;
  profile_avatar_url: string | null;
  likes_count: number;
  comments_count: number;
  is_own_post: boolean;
  is_tagged: boolean;
  /** Repost fields — hydrated by the media route (075). */
  shared_post_id?: string | null;
  shared_post?: QuotedPost | null;
}

interface StatementCardProps {
  item: StatementItem;
  onClick?: () => void;
}

/**
 * One statement in the profile's Statements rail: author, relative time, the
 * caption (which IS the content — same last-rung rule as the grid tiles), and
 * engagement counts. Layout (width/display) belongs to the rail's wrappers,
 * never to this card — the ShelfCard lesson.
 */
export default function StatementCard({ item, onClick }: StatementCardProps) {
  const name = formatDisplayName(
    item.profile_first_name, null, item.profile_last_name, item.profile_full_name
  );

  return (
    <button
      onClick={onClick}
      className="text-left w-full h-full flex flex-col bg-surface border border-border rounded-lg p-3 transition-all hover:border-border-strong hover:shadow-md"
    >
      <div className="flex items-center gap-2 mb-2 min-w-0">
        {item.profile_avatar_url ? (
          <LazyImage
            src={item.profile_avatar_url}
            alt={name}
            className="w-6 h-6 rounded-full object-cover flex-shrink-0"
            width={24}
            height={24}
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-gray-300 dark:bg-stone-700 flex items-center justify-center text-[10px] font-bold text-secondary flex-shrink-0">
            {getInitials(name)}
          </div>
        )}
        <span className="text-sm font-bold text-primary truncate">{name}</span>
        {item.is_tagged && !item.is_own_post && (
          <span className="px-2 py-0.5 bg-green-600 text-white text-[10px] font-semibold rounded-full flex-shrink-0">
            <i className="fas fa-user-tag mr-1"></i>
            Tagged
          </span>
        )}
      </div>

      {item.shared_post_id ? (
        <div className="flex-1 min-w-0">
          {item.caption && (
            <p className="text-sm text-primary line-clamp-2 whitespace-pre-wrap mb-2">{item.caption}</p>
          )}
          <QuotedPostEmbed post={item.shared_post ?? null} compact />
        </div>
      ) : (
        <p className="text-sm text-primary line-clamp-4 whitespace-pre-wrap flex-1">
          {item.caption || 'Post'}
        </p>
      )}

      <div className="flex items-center gap-3 mt-2 text-xs text-tertiary">
        <span>
          <i className="far fa-heart mr-1"></i>
          {item.likes_count}
        </span>
        <span>
          <i className="far fa-comment mr-1"></i>
          {item.comments_count}
        </span>
        <span className="ml-auto truncate">
          {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
        </span>
      </div>
    </button>
  );
}

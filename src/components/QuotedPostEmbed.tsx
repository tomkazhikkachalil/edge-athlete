'use client';

import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';

/** The wire shape of a repost's quoted original (gated server-side —
 *  null means "not visible to this viewer" OR "original deleted"). */
export interface QuotedPost {
  id: string;
  caption: string | null;
  created_at: string;
  profile: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    avatar_url: string | null;
    handle?: string | null;
  } | null;
  media: { media_url: string; media_type: string }[];
}

interface QuotedPostEmbedProps {
  post: QuotedPost | null;
  /** StatementCard variant: author + caption only, no media block. */
  compact?: boolean;
  onClick?: () => void;
}

/**
 * The quoted original inside a repost — adapted from the messages surface's
 * SharedPostPreview (left untouched; messages have their own conventions).
 * `post === null` renders the quiet "unavailable" box: the original was
 * deleted (FK SET NULL) or isn't visible to this viewer (read-time gate).
 */
export default function QuotedPostEmbed({ post, compact = false, onClick }: QuotedPostEmbedProps) {
  if (!post) {
    return (
      <div className="rounded-lg border border-border bg-surface-muted p-3 flex items-center gap-2 text-sm text-tertiary">
        <i className="fas fa-retweet"></i>
        <span>This post is unavailable</span>
      </div>
    );
  }

  const thumbnail = post.media?.[0];
  const authorName = formatDisplayName(
    post.profile?.first_name,
    null,
    post.profile?.last_name,
    post.profile?.full_name
  );

  const body = (
    <>
      {!compact && thumbnail && (
        <div className="w-full bg-surface-sunken overflow-hidden">
          {thumbnail.media_type === 'image' ? (
            <LazyImage
              src={thumbnail.media_url}
              alt="Post media"
              className="w-full h-auto max-h-80 object-contain"
              width={320}
              height={320}
            />
          ) : (
            // A quoted video renders as an inert first-frame thumb — a
            // playable nested video inside a feed card fights the card's
            // own tap targets. Tapping the embed opens the original.
            <video
              src={thumbnail.media_url}
              className="w-full max-h-80 pointer-events-none"
              muted
              playsInline
              preload="metadata"
            />
          )}
        </div>
      )}
      <div className={compact ? 'p-2' : 'p-3'}>
        <div className="flex items-center gap-2 min-w-0">
          {post.profile?.avatar_url ? (
            <LazyImage
              src={post.profile.avatar_url}
              alt={authorName}
              className="w-5 h-5 rounded-full object-cover shrink-0"
              width={20}
              height={20}
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
              {getInitials(authorName)}
            </div>
          )}
          <span className="text-xs font-bold text-primary truncate">{authorName}</span>
          {post.profile?.handle && (
            <span className="text-xs text-tertiary truncate">@{post.profile.handle}</span>
          )}
        </div>
        {post.caption && (
          <p className={`text-sm text-primary line-clamp-2 mt-1.5 ${compact ? '' : 'whitespace-pre-wrap'}`}>
            {post.caption}
          </p>
        )}
        {compact && thumbnail && (
          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-tertiary">
            <i className={`far ${thumbnail.media_type === 'video' ? 'fa-play-circle' : 'fa-image'}`}></i>
            <span>{thumbnail.media_type === 'video' ? 'Video' : 'Photo'}</span>
          </div>
        )}
      </div>
    </>
  );

  const frame = 'w-full text-left rounded-lg border border-border bg-surface-muted overflow-hidden';

  return onClick ? (
    <button type="button" onClick={onClick} className={`${frame} hover:bg-surface-sunken transition-colors`}>
      {body}
    </button>
  ) : (
    <div className={frame}>{body}</div>
  );
}

'use client';

import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import type { SharedPostPreviewData } from '@/types/messages';

interface Props {
  post: SharedPostPreviewData;
  onClick?: () => void;
}

export default function SharedPostPreview({ post, onClick }: Props) {
  const thumbnail = post.media?.[0];
  const authorName = formatDisplayName(
    post.profile?.first_name,
    null,
    post.profile?.last_name,
    post.profile?.full_name
  );

  const handleClick = () => {
    onClick?.();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full text-left rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors overflow-hidden"
    >
      {thumbnail && (
        <div className="w-full bg-gray-200 overflow-hidden">
          {thumbnail.media_type === 'image' ? (
            <LazyImage
              src={thumbnail.media_url}
              alt="Post media"
              className="w-full h-auto max-h-80 object-contain"
              width={320}
              height={320}
            />
          ) : (
            <video
              src={thumbnail.media_url}
              className="w-full max-h-80"
              controls
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
      <div className="p-3">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1.5">
          <i className="fas fa-share-alt"></i>
          <span>Shared post</span>
        </div>
        {post.caption && (
          <p className="text-sm text-gray-800 line-clamp-2 mb-2">{post.caption}</p>
        )}
        <div className="flex items-center gap-2">
          {post.profile?.avatar_url ? (
            <LazyImage
              src={post.profile.avatar_url}
              alt={authorName}
              className="w-5 h-5 rounded-full object-cover"
              width={20}
              height={20}
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {getInitials(authorName)}
            </div>
          )}
          <span className="text-xs font-medium text-gray-700 truncate">{authorName}</span>
        </div>
      </div>
    </button>
  );
}

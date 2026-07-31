'use client';

import Image from 'next/image';
import { formatDisplayName } from '@/lib/formatters';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import type { ReplyPreview } from '@/types/messages';

interface Props {
  replyTo: ReplyPreview;
  isOwn: boolean;
  onScrollToMessage?: (messageId: string) => void;
}

function getSnippet(item: ReplyPreview): string {
  if (item.deleted_at) return 'Message deleted';

  switch (item.type) {
    case 'text':
      return item.content
        ? item.content.length > 60 ? item.content.slice(0, 60) + '…' : item.content
        : 'Message';
    case 'image':
      return item.content ? item.content.slice(0, 40) : 'Photo';
    case 'video':
      return 'Video';
    case 'gif_reaction':
      return 'GIF';
    case 'shared_post':
      return item.shared_post?.caption
        ? item.shared_post.caption.length > 50 ? item.shared_post.caption.slice(0, 50) + '…' : item.shared_post.caption
        : 'Shared a post';
    case 'shared_profile':
      return item.shared_profile
        ? formatDisplayName(item.shared_profile.first_name, null, item.shared_profile.last_name, item.shared_profile.full_name)
        : 'Shared a profile';
    default:
      return 'Message';
  }
}

function getThumbnail(item: ReplyPreview): string | null {
  if (item.deleted_at) return null;
  if ((item.type === 'image' || item.type === 'gif_reaction') && item.media_url) return item.media_url;
  if (item.type === 'shared_post' && item.shared_post?.media?.[0]?.media_url) return item.shared_post.media[0].media_url;
  if (item.type === 'shared_profile' && item.shared_profile?.avatar_url) return item.shared_profile.avatar_url;
  return null;
}

export default function QuotedReply({ replyTo, isOwn, onScrollToMessage }: Props) {
  const snippet = getSnippet(replyTo);
  const thumbnail = getThumbnail(replyTo);
  const isDeleted = !!replyTo.deleted_at;

  const barStyle = isOwn
    ? 'bg-violet-700/30 border-l-2 border-violet-300'
    : 'bg-gray-100 border-l-2 border-gray-400';

  return (
    <button
      type="button"
      onClick={() => onScrollToMessage?.(replyTo.id)}
      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 mb-1 max-w-full hover:opacity-70 transition-opacity ${barStyle}`}
    >
      {thumbnail && (
        // Same polymorphic src as the reply bar in MessageInput; next/image
        // lazy-loads by default, so the explicit loading="lazy" is dropped.
        <Image
          src={thumbnail}
          alt=""
          width={24}
          height={24}
          className="w-6 h-6 rounded object-cover shrink-0"
          unoptimized={!isOptimizableImageSrc(thumbnail)}
        />
      )}
      <span className="text-xs truncate min-w-0">
        <span className="font-bold text-gray-700">{replyTo.sender_name}</span>
        <span className="text-gray-500">: </span>
        <span className={isDeleted ? 'italic text-gray-400' : 'text-gray-600'}>{snippet}</span>
      </span>
    </button>
  );
}

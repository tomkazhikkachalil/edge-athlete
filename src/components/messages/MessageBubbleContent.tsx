'use client';

import LazyImage from '@/components/LazyImage';
import SharedPostPreview from './SharedPostPreview';
import SharedProfilePreview from './SharedProfilePreview';
import MentionText from '@/components/MentionText';
import type { Message, ParticipantProfile } from '@/types/messages';

interface Props {
  message: Message;
  isOwn: boolean;
  onViewPost?: (postId: string) => void;
  /** Active members — @tokens matching a member's handle become profile
   *  links; everything else renders as inert styled emphasis (deliberate
   *  "dummy" mentions of people outside the room). */
  participants?: ParticipantProfile[];
}

/**
 * The message body — every content type EXCEPT the editing state, which stays
 * in MessageBubble (EditMessageInline is live form state and must exist only
 * once). Shared by the real bubble in the thread and the long-press action
 * sheet's replica; the replica wraps this in `pointer-events-none`, which is
 * what neutralises SharedPostPreview's <button> and <video controls> there.
 */
export default function MessageBubbleContent({ message, isOwn, onViewPost, participants }: Props) {
  const resolveMention = (handle: string) => {
    const p = participants?.find(
      (x) => x.handle && x.handle.toLowerCase() === handle
    );
    return p?.handle ? { id: p.id, handle: p.handle } : null;
  };
  const renderText = (content: string) => (
    <MentionText text={content} resolve={resolveMention} styleUnresolved />
  );
  // The metal rim is what stops an own-bubble dissolving into the (also
  // violet) chat header in the dock. Inset shadows, so bubble geometry is
  // unchanged — a real border would add 2px to every bubble in the thread.
  const bubbleBase = isOwn
    ? 'bg-brand text-white rounded-l-2xl rounded-tr-2xl ea-metal-rim-brand'
    : 'bg-surface-sunken text-primary rounded-r-2xl rounded-tl-2xl ea-metal-rim';

  return (
    <>
      {message.type === 'text' && (
        <div className={`px-4 py-2.5 ${bubbleBase} max-w-full`}>
          <p className="text-sm whitespace-pre-wrap break-words">{message.content && renderText(message.content)}</p>
        </div>
      )}

      {message.type === 'image' && message.media_url && (
        <div className="rounded-2xl overflow-hidden max-w-xs">
          <LazyImage
            src={message.media_url}
            alt="Sent image"
            className="w-full max-h-64 object-cover"
            width={300}
            height={256}
          />
          {/* Rim stripped: this caption strip is rounded-none inside a
              rounded-2xl overflow-hidden parent, so a square inset ring
              gets sliced diagonally at the bottom corners. */}
          {message.content && (
            <div className={`px-3 py-2 ${bubbleBase.replace(/ ea-metal-rim(-brand)?/, '')} rounded-none`}>
              <p className="text-sm whitespace-pre-wrap break-words">{renderText(message.content)}</p>
            </div>
          )}
        </div>
      )}

      {message.type === 'gif_reaction' && message.media_url && (
        <div className="rounded-2xl overflow-hidden max-w-xs border border-border">
          <LazyImage
            src={message.media_url}
            alt="GIF reply"
            className="w-full max-h-64 object-contain"
            width={300}
            height={256}
          />
        </div>
      )}

      {message.type === 'video' && message.media_url && (
        <div className="rounded-2xl overflow-hidden max-w-xs">
          <video
            src={message.media_url}
            controls
            className="w-full max-h-64"
            style={{ maxWidth: 300 }}
          />
          {message.content && (
            <div className={`px-3 py-2 ${bubbleBase.replace(/ ea-metal-rim(-brand)?/, '')} rounded-none`}>
              <p className="text-sm whitespace-pre-wrap break-words">{renderText(message.content)}</p>
            </div>
          )}
        </div>
      )}

      {message.type === 'shared_post' && message.shared_post && (
        <div className="max-w-xs">
          <SharedPostPreview
            post={message.shared_post}
            onClick={message.shared_post_id && onViewPost
              ? () => onViewPost(message.shared_post_id!)
              : undefined
            }
          />
        </div>
      )}

      {message.type === 'shared_profile' && message.shared_profile && (
        <div className="max-w-xs">
          <SharedProfilePreview profile={message.shared_profile} />
        </div>
      )}
    </>
  );
}

'use client';

import { useState } from 'react';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import SharedPostPreview from './SharedPostPreview';
import SharedProfilePreview from './SharedProfilePreview';
import type { Message } from '@/types/messages';

interface Props {
  message: Message;
  isOwn: boolean;
  showSender: boolean;
  onDelete?: (messageId: string) => void;
}

function getRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function MessageBubble({ message, isOwn, showSender, onDelete }: Props) {
  const [showMenu, setShowMenu] = useState(false);

  if (message.deleted_at) {
    return (
      <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1`}>
        <p className="text-sm italic text-gray-400 px-2">Message deleted</p>
      </div>
    );
  }

  const senderName = formatDisplayName(
    message.sender?.first_name,
    null,
    message.sender?.last_name,
    message.sender?.full_name
  );

  const bubbleBase = isOwn
    ? 'bg-blue-600 text-white rounded-l-2xl rounded-tr-2xl'
    : 'bg-gray-100 text-gray-900 rounded-r-2xl rounded-tl-2xl';

  const isMediaOrShare = ['image', 'video', 'shared_post', 'shared_profile'].includes(message.type);

  const handleCopy = () => {
    if (message.content) navigator.clipboard.writeText(message.content);
    setShowMenu(false);
  };

  const handleDelete = () => {
    onDelete?.(message.id);
    setShowMenu(false);
  };

  return (
    <div className={`flex flex-col mb-2 ${isOwn ? 'items-end' : 'items-start'}`}>
      {/* Sender name + avatar for group chats */}
      {showSender && !isOwn && (
        <div className="flex items-center gap-1.5 mb-1 ml-1">
          {message.sender?.avatar_url ? (
            <LazyImage
              src={message.sender.avatar_url}
              alt={senderName}
              className="w-5 h-5 rounded-full object-cover"
              width={20}
              height={20}
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">
              {getInitials(senderName)}
            </div>
          )}
          <span className="text-xs font-medium text-gray-600">{senderName}</span>
        </div>
      )}

      <div className={`flex items-end gap-2 max-w-xs sm:max-w-sm md:max-w-md ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Message content */}
        <div className="relative group">
          {message.type === 'text' && (
            <div className={`px-4 py-2.5 ${bubbleBase} max-w-full`}>
              <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
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
            </div>
          )}

          {message.type === 'shared_post' && message.shared_post && (
            <div className="max-w-xs">
              <SharedPostPreview post={message.shared_post} />
            </div>
          )}

          {message.type === 'shared_profile' && message.shared_profile && (
            <div className="max-w-xs">
              <SharedProfilePreview profile={message.shared_profile} />
            </div>
          )}

          {/* Context menu trigger (hover/tap) */}
          {!isMediaOrShare && (
            <button
              type="button"
              onClick={() => setShowMenu(prev => !prev)}
              className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-gray-600 ${
                isOwn ? '-left-6' : '-right-6'
              }`}
              aria-label="Message options"
            >
              <i className="fas fa-ellipsis-h text-xs"></i>
            </button>
          )}

          {/* Context menu */}
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div
                className={`absolute z-20 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[120px] ${
                  isOwn ? 'right-0' : 'left-0'
                } top-full`}
              >
                {message.type === 'text' && (
                  <button
                    onClick={handleCopy}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <i className="fas fa-copy text-xs w-4"></i>
                    Copy
                  </button>
                )}
                {isOwn && (
                  <button
                    onClick={handleDelete}
                    className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <i className="fas fa-trash text-xs w-4"></i>
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Timestamp */}
      <span className={`text-xs text-gray-400 mt-0.5 px-1 ${isOwn ? 'text-right' : 'text-left'}`}>
        {getRelativeTime(message.created_at)}
      </span>
    </div>
  );
}

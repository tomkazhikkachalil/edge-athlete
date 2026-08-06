'use client';

import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import type { Conversation } from '@/types/messages';

interface Props {
  conversation: Conversation;
  currentUserId: string;
  isActive: boolean;
  onClick: () => void;
}

export function getRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getLastMessagePreview(conversation: Conversation, currentUserId: string): string {
  const msg = conversation.last_message;
  if (!msg) return 'No messages yet';
  if (msg.deleted_at) return 'Message deleted';
  const isOwn = msg.sender_id === currentUserId;
  const prefix = isOwn ? 'You: ' : '';
  switch (msg.type) {
    case 'text': return prefix + (msg.content?.slice(0, 60) || '');
    case 'image': return prefix + 'Photo';
    case 'video': return prefix + 'Video';
    case 'shared_post': return prefix + 'Shared a post';
    case 'shared_profile': return prefix + 'Shared a profile';
    default: return prefix + 'Message';
  }
}

function getConversationAvatar(conversation: Conversation, currentUserId: string) {
  if (conversation.type === 'group') {
    return { url: conversation.avatar_url, name: conversation.name || 'Group' };
  }
  const other = conversation.participants.find(p => p.profile_id !== currentUserId);
  if (!other?.profile) return { url: null, name: 'Unknown' };
  const name = formatDisplayName(other.profile.first_name, null, other.profile.last_name, other.profile.full_name);
  return { url: other.profile.avatar_url, name };
}

function getConversationName(conversation: Conversation, currentUserId: string): string {
  if (conversation.type === 'group') return conversation.name || 'Group Chat';
  const other = conversation.participants.find(p => p.profile_id !== currentUserId);
  if (!other?.profile) return 'Unknown';
  return formatDisplayName(other.profile.first_name, null, other.profile.last_name, other.profile.full_name);
}

export default function ConversationItem({ conversation, currentUserId, isActive, onClick }: Props) {
  const { url: avatarUrl, name: avatarName } = getConversationAvatar(conversation, currentUserId);
  const displayName = getConversationName(conversation, currentUserId);
  const preview = getLastMessagePreview(conversation, currentUserId);
  const timestamp = conversation.last_message?.created_at || conversation.updated_at;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-center gap-3 px-4 py-3 transition-colors ${
        isActive
          ? 'bg-brand-soft border-l-4 border-brand'
          : 'hover:bg-surface-muted border-l-4 border-transparent'
      }`}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        {avatarUrl ? (
          <LazyImage
            src={avatarUrl}
            alt={avatarName}
            className="w-12 h-12 rounded-full object-cover"
            width={48}
            height={48}
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-violet-500 flex items-center justify-center text-white font-semibold text-sm shrink-0">
            {getInitials(avatarName)}
          </div>
        )}
        {conversation.type === 'group' && (
          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-gray-200 dark:bg-stone-800 rounded-full flex items-center justify-center">
            <i className="fas fa-users text-tertiary" style={{ fontSize: '7px' }}></i>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-semibold truncate ${conversation.unread_count > 0 ? 'text-primary' : 'text-secondary'}`}>
            {displayName}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {conversation.my_participant?.is_muted && (
              <i className="fas fa-bell-slash text-faint" style={{ fontSize: '10px' }}></i>
            )}
            <span className="text-xs text-faint">{getRelativeTime(timestamp)}</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={`text-xs truncate ${conversation.unread_count > 0 ? 'text-primary font-medium' : 'text-muted'}`}>
            {preview}
          </p>
          {conversation.unread_count > 0 && (
            <span className="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 text-xs font-bold text-white bg-red-600 rounded-full px-1">
              {conversation.unread_count > 99 ? '99+' : conversation.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

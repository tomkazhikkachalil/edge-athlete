'use client';

import { useState, useMemo } from 'react';
import ConversationItem from './ConversationItem';
import type { Conversation } from '@/types/messages';

interface Props {
  conversations: Conversation[];
  currentUserId: string;
  loading: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
}

function searchConversations(conversations: Conversation[], query: string, currentUserId: string): Conversation[] {
  if (!query.trim()) return conversations;
  const q = query.toLowerCase();
  return conversations.filter(c => {
    if (c.type === 'group' && c.name?.toLowerCase().includes(q)) return true;
    return c.participants.some(p => {
      if (p.profile_id === currentUserId) return false;
      const name = [p.profile?.first_name, p.profile?.last_name, p.profile?.full_name, p.profile?.handle]
        .filter(Boolean).join(' ').toLowerCase();
      return name.includes(q);
    });
  });
}

export default function ConversationList({
  conversations,
  currentUserId,
  loading,
  activeId,
  onSelect,
  onNewConversation,
}: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () => searchConversations(conversations, search, currentUserId),
    [conversations, search, currentUserId]
  );

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
        <h2 className="text-lg font-bold text-gray-900">Messages</h2>
        <button
          type="button"
          onClick={onNewConversation}
          className="w-10 h-10 flex items-center justify-center text-gray-600 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
          aria-label="New conversation"
        >
          <i className="fas fa-edit text-base"></i>
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-gray-100">
        <div className="relative">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="w-full pl-8 pr-3 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <i className="fas fa-spinner fa-spin text-gray-400 text-xl"></i>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            {search ? (
              <>
                <i className="fas fa-search text-gray-300 text-3xl mb-3"></i>
                <p className="text-sm text-gray-500">No conversations match &ldquo;{search}&rdquo;</p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                  <i className="fas fa-comment-alt text-gray-400 text-xl"></i>
                </div>
                <p className="text-sm font-semibold text-gray-700 mb-1">No conversations yet</p>
                <p className="text-xs text-gray-500 mb-4">Start a conversation with another athlete.</p>
                <button
                  onClick={onNewConversation}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors"
                >
                  <i className="fas fa-plus text-xs"></i>
                  New Message
                </button>
              </>
            )}
          </div>
        ) : (
          <div>
            {filtered.map(conv => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                currentUserId={currentUserId}
                isActive={activeId === conv.id}
                onClick={() => onSelect(conv.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

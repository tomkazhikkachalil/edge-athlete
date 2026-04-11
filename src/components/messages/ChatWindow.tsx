'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useMessages } from '@/lib/messages';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import LazyImage from '@/components/LazyImage';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import TypingIndicator from './TypingIndicator';
import GroupSettingsModal from './GroupSettingsModal';
import type { Message, Conversation } from '@/types/messages';

interface Props {
  conversationId: string;
  onBack?: () => void;
}

export default function ChatWindow({ conversationId, onBack }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const { markConversationRead, addOptimisticMessage, removeConversation } = useMessages();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]); // newest first
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [error, setError] = useState('');

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentUserId = user?.id ?? '';

  // Load initial conversation + messages
  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/messages/${conversationId}`);
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to load conversation');
        }
        const d = await res.json();
        if (cancelled) return;
        setConversation(d.conversation);
        setMessages(d.messages || []);
        setHasMore(d.has_more ?? false);
        setNextCursor(d.next_cursor ?? null);

        // Mark as read
        markConversationRead(conversationId);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime subscription for this conversation
  useEffect(() => {
    if (!conversationId || !user) return;

    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload: { new: unknown }) => {
          const newMsg = payload.new as Message;
          // Fetch the full message with sender profile
          const res = await fetch(`/api/messages/${conversationId}?limit=1`);
          if (res.ok) {
            const d = await res.json();
            const full = (d.messages as Message[]).find(m => m.id === newMsg.id);
            const msg = full ?? newMsg;
            setMessages(prev => {
              if (prev.some(m => m.id === msg.id)) return prev;
              return [msg, ...prev];
            });
            if (msg.sender_id !== currentUserId) {
              markConversationRead(conversationId);
            }
          } else {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [newMsg, ...prev];
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: { new: unknown }) => {
          const updated = payload.new as Message;
          setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [conversationId, user, currentUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll — load older messages when sentinel enters view
  useEffect(() => {
    if (!hasMore || loadingMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadOlderMessages();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, nextCursor]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOlderMessages = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/messages/${conversationId}?cursor=${encodeURIComponent(nextCursor)}`);
      if (res.ok) {
        const d = await res.json();
        setMessages(prev => [...prev, ...(d.messages || [])]);
        setHasMore(d.has_more ?? false);
        setNextCursor(d.next_cursor ?? null);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, nextCursor, loadingMore]);

  const handleSend = useCallback((message: Message) => {
    setMessages(prev => {
      if (prev.some(m => m.id === message.id)) return prev;
      return [message, ...prev];
    });
    addOptimisticMessage(conversationId, message);
  }, [conversationId, addOptimisticMessage]);

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    try {
      const res = await fetch(`/api/messages/${conversationId}/messages/${messageId}`, { method: 'DELETE' });
      if (res.ok) {
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...m, deleted_at: new Date().toISOString() } : m
        ));
      }
    } catch {
      // ignore
    }
  }, [conversationId]);

  const handleMuteToggle = useCallback(async () => {
    if (!conversation) return;
    const isMuted = conversation.my_participant?.is_muted;
    try {
      const res = await fetch(`/api/messages/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_muted: !isMuted }),
      });
      if (res.ok) {
        setConversation(prev => prev ? {
          ...prev,
          my_participant: { ...prev.my_participant, is_muted: !isMuted },
        } : prev);
      }
    } catch {
      // ignore
    }
    setShowMenu(false);
  }, [conversation, conversationId]);

  const handleLeave = useCallback(async () => {
    if (!confirm('Leave this conversation?')) return;
    setShowMenu(false);
    try {
      const res = await fetch(`/api/messages/${conversationId}/participants/${currentUserId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        removeConversation(conversationId);
        router.push('/messages');
      }
    } catch {
      // ignore
    }
  }, [conversationId, currentUserId, removeConversation, router]);

  const handleBlock = useCallback(async () => {
    if (!conversation || conversation.type !== 'direct') return;
    const other = conversation.participants.find(p => p.profile_id !== currentUserId);
    if (!other) return;
    if (!confirm('Block this user? They will not be able to message you.')) return;
    setShowMenu(false);
    try {
      const res = await fetch('/api/messages/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockedId: other.profile_id }),
      });
      if (res.ok) {
        removeConversation(conversationId);
        router.push('/messages');
      }
    } catch {
      // ignore
    }
  }, [conversation, currentUserId, conversationId, removeConversation, router]);

  // Conversation header helpers
  const getHeaderName = () => {
    if (!conversation) return '';
    if (conversation.type === 'group') return conversation.name || 'Group Chat';
    const other = conversation.participants.find(p => p.profile_id !== currentUserId);
    if (!other?.profile) return 'Unknown';
    return formatDisplayName(other.profile.first_name, null, other.profile.last_name, other.profile.full_name);
  };

  const getHeaderAvatar = () => {
    if (!conversation) return null;
    if (conversation.type === 'group') return conversation.avatar_url;
    const other = conversation.participants.find(p => p.profile_id !== currentUserId);
    return other?.profile?.avatar_url ?? null;
  };

  const getHeaderAvatarName = () => {
    if (!conversation) return '';
    if (conversation.type === 'group') return conversation.name || 'Group';
    const other = conversation.participants.find(p => p.profile_id !== currentUserId);
    if (!other?.profile) return 'Unknown';
    return formatDisplayName(other.profile.first_name, null, other.profile.last_name, other.profile.full_name);
  };

  const isAdmin = conversation?.my_participant?.role === 'admin';
  const isMuted = conversation?.my_participant?.is_muted ?? false;
  const isDM = conversation?.type === 'direct';
  const otherParticipant = isDM
    ? conversation?.participants.find(p => p.profile_id !== currentUserId)
    : null;

  // Determine if sender name should be shown for each message
  // Show sender name in group chats for consecutive messages from different senders
  const shouldShowSender = (msg: Message, index: number): boolean => {
    if (!conversation || conversation.type !== 'group') return false;
    if (msg.sender_id === currentUserId) return false;
    // In the display (flex-col-reverse), index 0 = newest. Prev message (older, rendered above) is at index+1
    const prevMsg = messages[index + 1];
    return !prevMsg || prevMsg.sender_id !== msg.sender_id;
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-white items-center justify-center">
        <i className="fas fa-spinner fa-spin text-gray-400 text-2xl"></i>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full bg-white items-center justify-center px-4 text-center">
        <i className="fas fa-exclamation-circle text-red-400 text-3xl mb-3"></i>
        <p className="text-sm text-gray-700 mb-4">{error}</p>
        <button
          onClick={() => router.push('/messages')}
          className="text-blue-600 text-sm hover:underline"
        >
          Back to messages
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 shrink-0">
        {/* Back button (mobile) */}
        {onBack && (
          <button
            onClick={onBack}
            className="shrink-0 text-gray-600 hover:text-gray-900 p-1 -ml-1 lg:hidden"
            aria-label="Back"
          >
            <i className="fas fa-arrow-left text-lg"></i>
          </button>
        )}

        {/* Avatar */}
        <div className="relative shrink-0">
          {getHeaderAvatar() ? (
            <LazyImage
              src={getHeaderAvatar()!}
              alt={getHeaderAvatarName()}
              className="w-10 h-10 rounded-full object-cover"
              width={40}
              height={40}
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold text-sm shrink-0">
              {getInitials(getHeaderAvatarName())}
            </div>
          )}
          {conversation?.type === 'group' && (
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-gray-200 rounded-full flex items-center justify-center">
              <i className="fas fa-users text-gray-600" style={{ fontSize: '7px' }}></i>
            </div>
          )}
        </div>

        {/* Name + subtitle */}
        <div className="flex-1 min-w-0">
          <button
            onClick={() => {
              if (isDM && otherParticipant) {
                router.push(`/athlete/${otherParticipant.profile_id}`);
              }
            }}
            className={`text-sm font-bold text-gray-900 truncate block text-left ${isDM ? 'hover:underline' : ''}`}
          >
            {getHeaderName()}
          </button>
          {conversation?.type === 'group' && (
            <p className="text-xs text-gray-400 truncate">
              {conversation.participants.filter(p => !p.left_at).length} members
            </p>
          )}
          {isMuted && (
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <i className="fas fa-bell-slash" style={{ fontSize: '9px' }}></i>
              Muted
            </p>
          )}
        </div>

        {/* Context menu */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setShowMenu(prev => !prev)}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Conversation options"
          >
            <i className="fas fa-ellipsis-v"></i>
          </button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px] z-20">
                <button
                  onClick={handleMuteToggle}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                >
                  <i className={`fas ${isMuted ? 'fa-bell' : 'fa-bell-slash'} w-4 text-center`}></i>
                  {isMuted ? 'Unmute' : 'Mute'}
                </button>

                {isDM && otherParticipant && (
                  <button
                    onClick={() => {
                      router.push(`/athlete/${otherParticipant.profile_id}`);
                      setShowMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                  >
                    <i className="fas fa-user w-4 text-center"></i>
                    View Profile
                  </button>
                )}

                {!isDM && isAdmin && (
                  <button
                    onClick={() => { setShowGroupSettings(true); setShowMenu(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                  >
                    <i className="fas fa-cog w-4 text-center"></i>
                    Group Settings
                  </button>
                )}

                <div className="border-t border-gray-100 my-1" />

                <button
                  onClick={handleLeave}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
                >
                  <i className="fas fa-sign-out-alt w-4 text-center"></i>
                  Leave Conversation
                </button>

                {isDM && (
                  <button
                    onClick={handleBlock}
                    className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
                  >
                    <i className="fas fa-ban w-4 text-center"></i>
                    Block User
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Messages (flex-col-reverse: newest at DOM top = visual bottom) */}
      <div className="flex-1 overflow-y-auto flex flex-col-reverse px-4 py-4 gap-0">
        {messages.map((msg, index) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isOwn={msg.sender_id === currentUserId}
            showSender={shouldShowSender(msg, index)}
            onDelete={handleDeleteMessage}
          />
        ))}

        {/* Sentinel: visually at top (end of flex-col-reverse), triggers loading older messages */}
        {hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center py-4">
            {loadingMore ? (
              <i className="fas fa-spinner fa-spin text-gray-400"></i>
            ) : (
              <div className="h-4" />
            )}
          </div>
        )}

        {/* Empty state */}
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center flex-1 text-center py-12">
            <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mb-3">
              <i className="fas fa-comment-alt text-gray-400 text-xl"></i>
            </div>
            <p className="text-sm font-semibold text-gray-700 mb-1">No messages yet</p>
            <p className="text-xs text-gray-400">Send the first message!</p>
          </div>
        )}
      </div>

      {/* Typing indicator */}
      <TypingIndicator conversationId={conversationId} currentUserId={currentUserId} />

      {/* Message input */}
      <MessageInput
        conversationId={conversationId}
        currentUserId={currentUserId}
        onSend={handleSend}
      />

      {/* Group Settings Modal */}
      {showGroupSettings && conversation && (
        <GroupSettingsModal
          conversation={conversation}
          currentUserId={currentUserId}
          onClose={() => setShowGroupSettings(false)}
          onUpdated={(updates) => {
            setConversation(prev => prev ? { ...prev, ...updates } : prev);
          }}
          onLeft={() => {
            setShowGroupSettings(false);
            removeConversation(conversationId);
            router.push('/messages');
          }}
        />
      )}
    </div>
  );
}

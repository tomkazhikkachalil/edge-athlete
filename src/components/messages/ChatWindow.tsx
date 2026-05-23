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
import PostDetailModal from '@/components/PostDetailModal';
import GifPickerModal from '@/components/GifPickerModal';
import type { Message, Conversation, AggregatedReaction } from '@/types/messages';

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
  const [viewingPostId, setViewingPostId] = useState<string | null>(null);
  const [gifReactingMessageId, setGifReactingMessageId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const replyingToRef = useRef<Message | null>(null);
  const [error, setError] = useState('');

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const messageRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());

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

          // All messages — including GIF reactions — flow through the same
          // fetch-full-and-prepend path. GIF reactions render as standalone
          // messages with a QuotedReply preview of their parent.
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
      // Listen for reaction_update broadcasts (emoji reactions from other users).
      // GIF reactions are now standalone messages, so a single top-level
      // search is sufficient.
      .on('broadcast', { event: 'reaction_update' }, (payload: { payload: { message_id: string; reactions: AggregatedReaction[] } }) => {
        const { message_id, reactions } = payload.payload;
        setMessages(prev => prev.map(m =>
          m.id === message_id ? { ...m, reactions } : m
        ));
      })
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
      } else {
        console.error('Failed to load older messages — status:', res.status);
      }
    } catch (e) {
      console.error('Failed to load older messages:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, nextCursor, loadingMore]);

  const handleSend = useCallback((message: Message) => {
    // Enrich with reply_to if this was a reply
    const replyTarget = replyingToRef.current;
    let enriched = message;
    if (message.parent_message_id && replyTarget && replyTarget.id === message.parent_message_id) {
      const senderName = replyTarget.sender
        ? (replyTarget.sender.full_name
          || [replyTarget.sender.first_name, replyTarget.sender.last_name].filter(Boolean).join(' ')
          || 'Unknown')
        : 'Unknown';
      enriched = {
        ...message,
        reply_to: {
          id: replyTarget.id,
          sender_id: replyTarget.sender_id,
          sender_name: senderName,
          type: replyTarget.type,
          content: replyTarget.content,
          media_url: replyTarget.media_url,
          deleted_at: replyTarget.deleted_at,
          shared_post: replyTarget.shared_post ?? null,
          shared_profile: replyTarget.shared_profile ?? null,
        },
      };
    }
    setMessages(prev => {
      if (prev.some(m => m.id === enriched.id)) return prev;
      return [enriched, ...prev];
    });
    addOptimisticMessage(conversationId, enriched);
  }, [conversationId, addOptimisticMessage]);

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    try {
      const res = await fetch(`/api/messages/${conversationId}/messages/${messageId}`, { method: 'DELETE' });
      if (res.ok) {
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...m, deleted_at: new Date().toISOString() } : m
        ));
      } else {
        console.error('Failed to delete message — status:', res.status);
      }
    } catch (e) {
      console.error('Failed to delete message:', e);
    }
  }, [conversationId]);

  // Helper: update reactions on a message. GIF reactions are now standalone
  // messages, so a single top-level search is sufficient.
  const updateMessageReactions = useCallback(
    (messageId: string, updater: (reactions: AggregatedReaction[]) => AggregatedReaction[]) => {
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, reactions: updater([...(m.reactions || [])]) }
          : m
      ));
    },
    []
  );

  // Helper: set reactions to an exact value (for authoritative server updates)
  const setMessageReactions = useCallback(
    (messageId: string, reactions: AggregatedReaction[]) => {
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, reactions } : m
      ));
    },
    []
  );

  // Toggle emoji reaction on a message (works for any message in the stream,
  // including standalone GIF reactions).
  const handleToggleReaction = useCallback(async (messageId: string, emoji: string) => {
    // Snapshot current reactions BEFORE the optimistic mutation so we can revert on failure.
    let priorReactions: AggregatedReaction[] = [];

    // Optimistic update
    updateMessageReactions(messageId, (reactions) => {
      priorReactions = [...reactions]; // shallow copy is sufficient — items below are replaced, not mutated
      const idx = reactions.findIndex(r => r.emoji === emoji);
      if (idx >= 0) {
        const r = reactions[idx];
        if (r.reacted) {
          if (r.count <= 1) {
            reactions.splice(idx, 1);
          } else {
            reactions[idx] = { ...r, count: r.count - 1, reacted: false };
          }
        } else {
          reactions[idx] = { ...r, count: r.count + 1, reacted: true };
        }
      } else {
        reactions.push({ emoji, count: 1, reacted: true });
      }
      return reactions;
    });

    try {
      const res = await fetch(
        `/api/messages/${conversationId}/messages/${messageId}/reactions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emoji }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        // Update with authoritative server state
        setMessageReactions(messageId, data.reactions);

        // Broadcast to other users
        channelRef.current?.send({
          type: 'broadcast',
          event: 'reaction_update',
          payload: { message_id: messageId, reactions: data.reactions },
        });
      } else {
        // Server rejected the toggle — restore the prior reactions so UI matches server state.
        setMessageReactions(messageId, priorReactions);
        console.error('Failed to toggle reaction — status:', res.status);
      }
    } catch (e) {
      // Network failure — restore the prior reactions so UI matches server state.
      setMessageReactions(messageId, priorReactions);
      console.error('Failed to toggle reaction:', e);
    }
  }, [conversationId, setMessageReactions, updateMessageReactions]);

  // Reply to a message
  const handleReply = useCallback((message: Message) => {
    setReplyingTo(message);
    replyingToRef.current = message;
    // Scroll the target into view so user sees what they're replying to
    const el = messageRefsMap.current.get(message.id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const handleCancelReply = useCallback(() => {
    setReplyingTo(null);
    replyingToRef.current = null;
  }, []);

  // Apply an authoritative edit to a message in local state.
  const handleMessageEdited = useCallback(
    (messageId: string, content: string, edited_at: string) => {
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, content, edited_at } : m
      ));
    },
    []
  );

  // Scroll to a specific message (when tapping a quoted reply)
  const handleScrollToMessage = useCallback((messageId: string) => {
    const el = messageRefsMap.current.get(messageId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight
      el.classList.add('ring-2', 'ring-blue-400', 'ring-offset-1', 'rounded-xl');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-1', 'rounded-xl');
      }, 1500);
    }
  }, []);

  // Initiate a GIF reaction on a message
  const handleGifReact = useCallback((parentMessageId: string) => {
    setGifReactingMessageId(parentMessageId);
  }, []);

  // Send the GIF reaction message
  const handleGifReactSelect = useCallback(async (gifUrl: string) => {
    if (!gifReactingMessageId) return;
    const parentId = gifReactingMessageId;
    setGifReactingMessageId(null);

    try {
      const res = await fetch(`/api/messages/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'gif_reaction',
          media_url: gifUrl,
          media_type: 'image',
          parent_message_id: parentId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const gifMsg = data.message as Message;
        // GIF reaction is a standalone reply now — prepend to the main
        // messages list (newest-first ordering). The POST response does
        // not include reply_to, so we synthesize it from the parent
        // message already in local state (same shape as handleSend does
        // for text replies). Dedupe in case the realtime INSERT got
        // there first.
        setMessages(prev => {
          if (prev.some(m => m.id === gifMsg.id)) return prev;
          const parentMsg = prev.find(m => m.id === parentId);
          let enriched = gifMsg;
          if (parentMsg) {
            const senderName = parentMsg.sender
              ? (parentMsg.sender.full_name
                || [parentMsg.sender.first_name, parentMsg.sender.last_name].filter(Boolean).join(' ')
                || 'Unknown')
              : 'Unknown';
            enriched = {
              ...gifMsg,
              reply_to: {
                id: parentMsg.id,
                sender_id: parentMsg.sender_id,
                sender_name: senderName,
                type: parentMsg.type,
                content: parentMsg.content,
                media_url: parentMsg.media_url,
                deleted_at: parentMsg.deleted_at,
                shared_post: parentMsg.shared_post ?? null,
                shared_profile: parentMsg.shared_profile ?? null,
              },
            };
          }
          return [enriched, ...prev];
        });
      } else {
        console.error('Failed to send GIF reaction — status:', res.status);
      }
    } catch (e) {
      console.error('Failed to send GIF reaction:', e);
    }
  }, [conversationId, gifReactingMessageId]);

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
      } else {
        console.error('Failed to toggle mute — status:', res.status);
      }
    } catch (e) {
      console.error('Failed to toggle mute:', e);
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
      } else {
        console.error('Failed to leave conversation — status:', res.status);
      }
    } catch (e) {
      console.error('Failed to leave conversation:', e);
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
      } else {
        console.error('Failed to block user — status:', res.status);
      }
    } catch (e) {
      console.error('Failed to block user:', e);
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
          <div
            key={msg.id}
            ref={(el) => {
              if (el) messageRefsMap.current.set(msg.id, el);
              else messageRefsMap.current.delete(msg.id);
            }}
            className={`transition-colors duration-300 rounded-xl ${
              replyingTo?.id === msg.id ? 'bg-blue-50 ring-1 ring-blue-200' : ''
            }`}
          >
            <MessageBubble
              message={msg}
              isOwn={msg.sender_id === currentUserId}
              showSender={shouldShowSender(msg, index)}
              onDelete={handleDeleteMessage}
              onViewPost={setViewingPostId}
              onToggleReaction={handleToggleReaction}
              onGifReact={handleGifReact}
              onReply={handleReply}
              onScrollToMessage={handleScrollToMessage}
              onMessageEdited={handleMessageEdited}
            />
          </div>
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
        replyingTo={replyingTo}
        onCancelReply={handleCancelReply}
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

      {/* Post Detail Modal — opens when tapping a shared post */}
      <PostDetailModal
        postId={viewingPostId}
        isOpen={!!viewingPostId}
        onClose={() => setViewingPostId(null)}
        currentUserId={currentUserId}
      />

      {/* GIF Reaction Picker Modal */}
      {gifReactingMessageId && (
        <GifPickerModal
          title="React with a GIF"
          onGifSelect={handleGifReactSelect}
          onClose={() => setGifReactingMessageId(null)}
        />
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import type { Conversation, ConversationParticipant } from '@/types/messages';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

interface SharePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  postId: string;
  postCaption?: string | null;
  postAuthorName: string;
  shareUrl: string;
}

export default function SharePostModal({
  isOpen,
  onClose,
  postId,
  postAuthorName,
  shareUrl,
}: SharePostModalProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null); // conversation ID being sent to
  const [sent, setSent] = useState<Set<string>>(new Set()); // conversation IDs already sent
  const [search, setSearch] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);

  useBodyScrollLock(isOpen);

  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/messages');
      if (!response.ok) {
        console.error('Failed to fetch conversations for share — status:', response.status);
        return;
      }
      const data = await response.json();
      setConversations(data.conversations || []);
    } catch (e) {
      console.error('Failed to fetch conversations for share:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchConversations();
      setSent(new Set());
      setSearch('');
      setCopySuccess(false);
    }
  }, [isOpen, fetchConversations]);

  // Get the "other" participant for DM conversations
  const getConversationDisplay = useCallback((conv: Conversation) => {
    if (conv.type === 'group') {
      return {
        name: conv.name || 'Group Chat',
        avatarUrl: conv.avatar_url,
        initials: conv.name ? conv.name.charAt(0).toUpperCase() : 'G',
      };
    }

    // DM: find the other participant
    const other = conv.participants.find(
      (p: ConversationParticipant) => p.profile_id !== conv.my_participant?.profile_id
    );

    if (!other?.profile) {
      return { name: 'Unknown', avatarUrl: null, initials: '?' };
    }

    const name = formatDisplayName(
      other.profile.first_name,
      null,
      other.profile.last_name,
      other.profile.full_name
    );

    return {
      name,
      avatarUrl: other.profile.avatar_url,
      initials: getInitials(name),
      profileId: other.profile_id,
    };
  }, []);

  // Frequent contacts: first 8 DM conversations (sorted by recency from API)
  const frequentContacts = useMemo(() => {
    return conversations
      .filter(c => c.type === 'direct')
      .slice(0, 8)
      .map(c => ({ ...getConversationDisplay(c), conversationId: c.id }));
  }, [conversations, getConversationDisplay]);

  // Filtered conversations based on search
  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter(conv => {
      const display = getConversationDisplay(conv);
      return display.name.toLowerCase().includes(q);
    });
  }, [conversations, search, getConversationDisplay]);

  const handleSendToConversation = async (conversationId: string) => {
    if (sending || sent.has(conversationId)) return;

    setSending(conversationId);
    try {
      const response = await fetch(`/api/messages/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'shared_post',
          shared_post_id: postId,
        }),
      });

      if (!response.ok) throw new Error('Failed to send');

      setSent(prev => new Set(prev).add(conversationId));
    } catch (e) {
      console.error('Failed to send shared post to conversation:', e);
    } finally {
      setSending(null);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share && navigator.canShare) {
      try {
        const shareData = {
          title: `Post by ${postAuthorName}`,
          url: shareUrl,
        };
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData);
        }
      } catch {
        // User cancelled
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface-raised rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-modal flex flex-col overflow-hidden modal-sheet-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-lg font-bold text-primary">Share Post</h2>
          <button
            onClick={onClose}
            className="p-2 text-faint hover:text-tertiary transition-colors"
          >
            <i className="fas fa-times text-lg"></i>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-border-subtle">
          <div className="relative">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-faint text-sm"></i>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-9 pr-3 py-2 bg-surface-sunken rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand"></div>
            </div>
          ) : (
            <>
              {/* Frequent contacts row */}
              {frequentContacts.length > 0 && !search.trim() && (
                <div className="px-4 py-3 border-b border-border-subtle">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Quick Share</p>
                  <div className="flex gap-4 overflow-x-auto pb-1">
                    {frequentContacts.map((contact) => (
                      <button
                        key={contact.conversationId}
                        onClick={() => handleSendToConversation(contact.conversationId)}
                        disabled={!!sending || sent.has(contact.conversationId)}
                        className="flex flex-col items-center gap-1.5 min-w-[60px] disabled:opacity-60"
                      >
                        <div className="relative">
                          {contact.avatarUrl ? (
                            <Image
                              src={contact.avatarUrl}
                              alt={contact.name}
                              width={48}
                              height={48}
                              className="w-12 h-12 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-sm font-semibold">
                              {contact.initials}
                            </div>
                          )}
                          {sent.has(contact.conversationId) && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                              <i className="fas fa-check text-white text-[10px]"></i>
                            </div>
                          )}
                          {sending === contact.conversationId && (
                            <div className="absolute inset-0 bg-surface/60 rounded-full flex items-center justify-center">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand"></div>
                            </div>
                          )}
                        </div>
                        <span className="text-xs text-secondary truncate max-w-[60px]">
                          {contact.name.split(' ')[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Conversation list */}
              {filteredConversations.length > 0 && (
                <div className="px-4 py-3">
                  {!search.trim() && (
                    <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">All Conversations</p>
                  )}
                  <div className="space-y-1">
                    {filteredConversations.map((conv) => {
                      const display = getConversationDisplay(conv);
                      const isSent = sent.has(conv.id);
                      const isSending = sending === conv.id;

                      return (
                        <button
                          key={conv.id}
                          onClick={() => handleSendToConversation(conv.id)}
                          disabled={!!sending || isSent}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-muted transition-colors disabled:opacity-60"
                        >
                          {/* Avatar */}
                          {display.avatarUrl ? (
                            <Image
                              src={display.avatarUrl}
                              alt={display.name}
                              width={40}
                              height={40}
                              className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                              {display.initials}
                            </div>
                          )}

                          {/* Name + type */}
                          <div className="flex-1 min-w-0 text-left">
                            <p className="text-sm font-medium text-primary truncate">{display.name}</p>
                            {conv.type === 'group' && (
                              <p className="text-xs text-muted">{conv.participants.length} members</p>
                            )}
                          </div>

                          {/* Send / Sent indicator */}
                          {isSent ? (
                            <span className="text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                              <i className="fas fa-check"></i> Sent
                            </span>
                          ) : isSending ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand"></div>
                          ) : (
                            <span className="text-xs font-medium text-brand-fg">Send</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!loading && filteredConversations.length === 0 && (
                <div className="text-center py-8 px-4">
                  {search.trim() ? (
                    <p className="text-sm text-muted">No conversations match &ldquo;{search}&rdquo;</p>
                  ) : (
                    <>
                      <i className="fas fa-paper-plane text-3xl text-gray-300 dark:text-stone-600 mb-2"></i>
                      <p className="text-sm text-muted">No conversations yet</p>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Secondary share options */}
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Other ways to share</p>
          <div className="flex gap-3">
            <button
              onClick={handleCopyLink}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-surface-sunken rounded-lg text-sm font-medium text-secondary hover:bg-gray-200 dark:hover:bg-stone-800 transition-colors"
            >
              <i className={`fas ${copySuccess ? 'fa-check text-green-600 dark:text-green-400' : 'fa-link'}`}></i>
              {copySuccess ? 'Copied!' : 'Copy Link'}
            </button>
            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <button
                onClick={handleNativeShare}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-surface-sunken rounded-lg text-sm font-medium text-secondary hover:bg-gray-200 dark:hover:bg-stone-800 transition-colors"
              >
                <i className="fas fa-share-alt"></i>
                More
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

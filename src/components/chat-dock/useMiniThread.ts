'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useMessages } from '@/lib/messages';
import type { AggregatedReaction, Message } from '@/types/messages';

// The mini window's thread engine — a faithful, lean mirror of the full
// page's ChatWindow logic (load → realtime INSERT refetch-enriched →
// optimistic reactions + reaction_update broadcast → reply/GIF synthesis),
// against the SAME endpoints. Lives entirely inside chat-dock/ so deleting
// the dock leaves messaging untouched; nothing is extracted out of
// ChatWindow. Channel topic 'dockchat:<id>' is distinct from the page's
// 'chat:<id>' and the provider's 'messages:<id>' (coexisting channels on
// one filter are the codebase's proven pattern).
//
// Read-marking: mark on open and on incoming non-own messages — but ONLY
// while the window is open (not minimized). The minimized flag is read
// through a ref inside the realtime handler (stale-closure guard, same
// trick as ChatWindow's replyingToRef): a minimized window must accumulate
// unread badges, not silently mark conversations read.

const PAGE_SIZE = 25;

export function useMiniThread(
  conversationId: string,
  currentUserId: string,
  minimized: boolean
) {
  const { markConversationRead, addOptimisticMessage } = useMessages();
  const [messages, setMessages] = useState<Message[]>([]); // newest first
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [gifReactingMessageId, setGifReactingMessageId] = useState<string | null>(null);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const replyingToRef = useRef<Message | null>(null);
  const minimizedRef = useRef(minimized);
  useEffect(() => {
    minimizedRef.current = minimized;
  }, [minimized]);

  // When the user restores a minimized window with unread messages, mark
  // them read at that moment.
  useEffect(() => {
    if (!minimized && !loading) markConversationRead(conversationId);
  }, [minimized]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/messages/${conversationId}?limit=${PAGE_SIZE}`);
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled) return;
        setMessages(d.messages || []);
        setHasMore(d.has_more ?? false);
        setNextCursor(d.next_cursor ?? null);
        if (!minimizedRef.current) markConversationRead(conversationId);
      } catch (e) {
        console.error('[DOCK] thread load failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: INSERT (refetch enriched row), UPDATE (edits/deletes),
  // reaction_update broadcasts — the ChatWindow pattern verbatim.
  useEffect(() => {
    const channel = supabase
      .channel(`dockchat:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        async (payload: { new: unknown }) => {
          const newMsg = payload.new as Message;
          const res = await fetch(`/api/messages/${conversationId}?limit=1`);
          const full = res.ok
            ? ((await res.json()).messages as Message[]).find(m => m.id === newMsg.id)
            : undefined;
          const msg = full ?? newMsg;
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev;
            return [msg, ...prev].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
          });
          if (msg.sender_id !== currentUserId && !minimizedRef.current) {
            markConversationRead(conversationId);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload: { new: unknown }) => {
          const updated = payload.new as Message;
          setMessages(prev => prev.map(m => (m.id === updated.id ? { ...m, ...updated } : m)));
        }
      )
      .on(
        'broadcast',
        { event: 'reaction_update' },
        (payload: { payload: { message_id: string; reactions: AggregatedReaction[] } }) => {
          const { message_id, reactions } = payload.payload;
          setMessages(prev =>
            prev.map(m => {
              if (m.id !== message_id) return m;
              const localized = reactions.map(r => ({
                ...r,
                reacted: r.reactors
                  ? r.reactors.some(p => p.id === currentUserId)
                  : (m.reactions?.find(pr => pr.emoji === r.emoji)?.reacted ?? false),
              }));
              return { ...m, reactions: localized };
            })
          );
        }
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [conversationId, currentUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOlder = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/messages/${conversationId}?cursor=${encodeURIComponent(nextCursor)}&limit=${PAGE_SIZE}`
      );
      if (res.ok) {
        const d = await res.json();
        setMessages(prev => [...prev, ...(d.messages || [])]);
        setHasMore(d.has_more ?? false);
        setNextCursor(d.next_cursor ?? null);
      }
    } catch (e) {
      console.error('[DOCK] load older failed:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, nextCursor, loadingMore]);

  const synthesizeReplyTo = (message: Message, parent: Message): Message => {
    const senderName = parent.sender
      ? (parent.sender.full_name ||
          [parent.sender.first_name, parent.sender.last_name].filter(Boolean).join(' ') ||
          'Unknown')
      : 'Unknown';
    return {
      ...message,
      reply_to: {
        id: parent.id,
        sender_id: parent.sender_id,
        sender_name: senderName,
        type: parent.type,
        content: parent.content,
        media_url: parent.media_url,
        deleted_at: parent.deleted_at,
        shared_post: parent.shared_post ?? null,
        shared_profile: parent.shared_profile ?? null,
      },
    };
  };

  /** MessageInput onSend: append locally + bump the provider preview. */
  const handleSend = useCallback((message: Message) => {
    const replyTarget = replyingToRef.current;
    const enriched =
      message.parent_message_id && replyTarget && replyTarget.id === message.parent_message_id
        ? synthesizeReplyTo(message, replyTarget)
        : message;
    setMessages(prev => (prev.some(m => m.id === enriched.id) ? prev : [enriched, ...prev]));
    addOptimisticMessage(conversationId, enriched);
    setReplyingTo(null);
    replyingToRef.current = null;
  }, [conversationId, addOptimisticMessage]);

  const handleReply = useCallback((message: Message) => {
    setReplyingTo(message);
    replyingToRef.current = message;
  }, []);

  const handleCancelReply = useCallback(() => {
    setReplyingTo(null);
    replyingToRef.current = null;
  }, []);

  const handleDelete = useCallback(async (messageId: string) => {
    try {
      const res = await fetch(`/api/messages/${conversationId}/messages/${messageId}`, { method: 'DELETE' });
      if (res.ok) {
        setMessages(prev =>
          prev.map(m => (m.id === messageId ? { ...m, deleted_at: new Date().toISOString() } : m))
        );
      }
    } catch (e) {
      console.error('[DOCK] delete failed:', e);
    }
  }, [conversationId]);

  const handleMessageEdited = useCallback((messageId: string, content: string, edited_at: string) => {
    setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, content, edited_at } : m)));
  }, []);

  const setMessageReactions = useCallback((messageId: string, reactions: AggregatedReaction[]) => {
    setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, reactions } : m)));
  }, []);

  const handleToggleReaction = useCallback(async (messageId: string, emoji: string) => {
    let priorReactions: AggregatedReaction[] = [];
    // Optimistic toggle (ChatWindow logic verbatim).
    setMessages(prev =>
      prev.map(m => {
        if (m.id !== messageId) return m;
        const reactions = [...(m.reactions || [])];
        priorReactions = [...reactions];
        const idx = reactions.findIndex(r => r.emoji === emoji);
        if (idx >= 0) {
          const r = reactions[idx];
          if (r.reacted) {
            if (r.count <= 1) reactions.splice(idx, 1);
            else reactions[idx] = { ...r, count: r.count - 1, reacted: false };
          } else {
            reactions[idx] = { ...r, count: r.count + 1, reacted: true };
          }
        } else {
          reactions.push({ emoji, count: 1, reacted: true });
        }
        return { ...m, reactions };
      })
    );
    try {
      const res = await fetch(`/api/messages/${conversationId}/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessageReactions(messageId, data.reactions);
        channelRef.current?.send({
          type: 'broadcast',
          event: 'reaction_update',
          payload: { message_id: messageId, reactions: data.reactions },
        });
      } else {
        setMessageReactions(messageId, priorReactions);
      }
    } catch {
      setMessageReactions(messageId, priorReactions);
    }
  }, [conversationId, setMessageReactions]);

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
        const gifMsg = (await res.json()).message as Message;
        setMessages(prev => {
          if (prev.some(m => m.id === gifMsg.id)) return prev;
          const parent = prev.find(m => m.id === parentId);
          return [parent ? synthesizeReplyTo(gifMsg, parent) : gifMsg, ...prev];
        });
      }
    } catch (e) {
      console.error('[DOCK] gif reaction failed:', e);
    }
  }, [conversationId, gifReactingMessageId]);

  return {
    messages,
    loading,
    hasMore,
    loadingMore,
    loadOlder,
    replyingTo,
    handleSend,
    handleReply,
    handleCancelReply,
    handleDelete,
    handleMessageEdited,
    handleToggleReaction,
    gifReactingMessageId,
    setGifReactingMessageId,
    handleGifReactSelect,
  };
}

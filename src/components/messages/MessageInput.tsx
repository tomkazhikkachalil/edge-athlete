'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import EmojiPickerButton from '@/components/EmojiPickerButton';
import GifPickerModal from '@/components/GifPickerModal';
import { formatDisplayName } from '@/lib/formatters';
import type { Message } from '@/types/messages';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import { uploadPostMedia } from '@/lib/media/upload';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';

interface Props {
  conversationId: string;
  currentUserId: string;
  onSend: (message: Message) => void;
  disabled?: boolean;
  replyingTo?: Message | null;
  onCancelReply?: () => void;
}

const MESSAGE_EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['free', '1:1', '16:9'],
  allowVideo: true, // videos pass through untouched until the video phase
  maxAssets: 1,
  output: { maxDimension: 1600, mime: 'image/jpeg', quality: 0.85 },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export default function MessageInput({ conversationId, currentUserId, onSend, disabled, replyingTo, onCancelReply }: Props) {
  const [text, setText] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null);
  const [attachedType, setAttachedType] = useState<'image' | 'video' | null>(null);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autofocus textarea when entering reply mode
  useEffect(() => {
    if (replyingTo && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [replyingTo]);

  // Broadcast typing indicator
  const broadcastTyping = useCallback(() => {
    if (!typingChannelRef.current) {
      typingChannelRef.current = supabase.channel(`typing:${conversationId}`);
      typingChannelRef.current.subscribe();
    }
    typingChannelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: currentUserId },
    });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      typingChannelRef.current?.unsubscribe();
      typingChannelRef.current = null;
    }, 2000);
  }, [conversationId, currentUserId]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (e.target.value) broadcastTyping();

    // Auto-resize
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      const maxHeight = 5 * 24; // ~5 lines
      ta.style.height = Math.min(ta.scrollHeight, maxHeight) + 'px';
    }
  };

  // Insert emoji at cursor position
  const handleEmojiSelect = (emoji: string) => {
    const ta = textareaRef.current;
    const pos = ta?.selectionStart ?? text.length;
    const next = text.slice(0, pos) + emoji + text.slice(pos);
    setText(next);
    // Restore cursor after the inserted emoji
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus();
        ta.setSelectionRange(pos + emoji.length, pos + emoji.length);
      }
    });
  };

  // GIF selected — no upload needed, URL goes straight to API
  const handleGifSelect = (url: string) => {
    // Clear any file attachment
    if (attachedPreview && !gifUrl) URL.revokeObjectURL(attachedPreview);
    setAttachedFile(null);
    setGifUrl(url);
    setAttachedPreview(url);
    setAttachedType('image');
    setError('');
  };

  // Picked file goes through the shared media editor before attaching;
  // validation mirrors the server allowlist at pick time.
  const [editorAssets, setEditorAssets] = useState<MediaAsset[] | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const { accepted, rejected } = validateFiles([file], {
      maxBytes: MAX_FILE_SIZE,
      allowVideo: true,
      maxCount: 1,
    });
    if (rejected.length > 0) {
      setError(rejected[0].message);
      return;
    }
    setError('');
    setEditorAssets([{
      id: `${Date.now()}`,
      file: accepted[0],
      kind: accepted[0].type.startsWith('video/') ? 'video' as const : 'image' as const,
    }]);
  };

  const handleEditorDone = (results: EditedMedia[]) => {
    setEditorAssets(null);
    const result = results[0];
    if (!result) return;
    // Clear any GIF
    setGifUrl(null);
    if (attachedPreview) URL.revokeObjectURL(attachedPreview);
    setAttachedFile(result.file);
    setAttachedPreview(result.previewUrl);
    setAttachedType(result.kind);
    setError('');
  };

  const removeAttachment = () => {
    if (attachedPreview && !gifUrl) URL.revokeObjectURL(attachedPreview);
    setAttachedFile(null);
    setAttachedPreview(null);
    setAttachedType(null);
    setGifUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = async () => {
    if (sending || disabled) return;
    if (!text.trim() && !attachedFile && !gifUrl) return;

    setSending(true);
    setError('');

    try {
      let mediaUrl: string | null = null;
      let mediaType: 'image' | 'video' | null = null;

      if (gifUrl) {
        // GIF: use CDN URL directly, no upload
        mediaUrl = gifUrl;
        mediaType = 'image';
      } else if (attachedFile) {
        // Regular file: upload first (owner derived server-side from session)
        const uploaded = await uploadPostMedia(attachedFile);
        mediaUrl = uploaded.url;
        mediaType = uploaded.type;
      }

      const msgType = (attachedFile || gifUrl) ? attachedType! : 'text';
      const body: Record<string, unknown> = { type: msgType };
      if (text.trim()) body.content = text.trim();
      if (mediaUrl) { body.media_url = mediaUrl; body.media_type = mediaType; }
      if (replyingTo) body.parent_message_id = replyingTo.id;

      const res = await fetch(`/api/messages/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send');
      }

      const data = await res.json();
      onSend(data.message as Message);

      // Reset
      setText('');
      removeAttachment();
      onCancelReply?.();
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const canSend = (text.trim().length > 0 || attachedFile !== null || gifUrl !== null) && !sending && !disabled;

  const replyingSenderName = replyingTo?.sender
    ? formatDisplayName(replyingTo.sender.first_name, null, replyingTo.sender.last_name, replyingTo.sender.full_name)
    : '';

  const replyPreviewText = replyingTo
    ? (replyingTo.content
        ? (replyingTo.content.length > 80 ? replyingTo.content.slice(0, 80) + '…' : replyingTo.content)
        : replyingTo.type === 'image' ? 'Photo'
        : replyingTo.type === 'video' ? 'Video'
        : replyingTo.type === 'gif_reaction' ? 'GIF'
        : replyingTo.type === 'shared_post'
          ? (replyingTo.shared_post?.caption
              ? (replyingTo.shared_post.caption.length > 50 ? replyingTo.shared_post.caption.slice(0, 50) + '…' : replyingTo.shared_post.caption)
              : 'Shared a post')
        : replyingTo.type === 'shared_profile' ? 'Shared a profile'
        : 'Message')
    : '';

  // Determine the best thumbnail for the reply preview
  const replyThumbnailUrl = replyingTo
    ? (replyingTo.media_url && (replyingTo.type === 'image' || replyingTo.media_type === 'image' || replyingTo.type === 'gif_reaction')
        ? replyingTo.media_url
        : replyingTo.type === 'shared_post' && replyingTo.shared_post?.media?.[0]?.media_type === 'image'
          ? replyingTo.shared_post.media[0].media_url
          : replyingTo.type === 'shared_profile' && replyingTo.shared_profile?.avatar_url
            ? replyingTo.shared_profile.avatar_url
            : null)
    : null;

  return (
    <div className="border-t border-gray-200 bg-white">
      {/* Reply preview bar */}
      {replyingTo && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
          <div className="w-1 h-8 bg-blue-500 rounded-full shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-blue-600 truncate">
              Replying to {replyingSenderName}
            </p>
            <p className="text-xs text-gray-500 truncate">{replyPreviewText}</p>
          </div>
          {replyThumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={replyThumbnailUrl}
              alt=""
              className="w-10 h-10 rounded object-cover shrink-0"
            />
          )}
          {replyingTo.type === 'video' && !replyThumbnailUrl && (
            <div className="w-10 h-10 bg-gray-800 rounded flex items-center justify-center shrink-0">
              <i className="fas fa-play-circle text-white text-sm"></i>
            </div>
          )}
          <button
            type="button"
            onClick={onCancelReply}
            className="shrink-0 p-1 text-gray-400 hover:text-gray-600 transition-colors"
            title="Cancel reply"
          >
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>
      )}

      <div className="px-4 py-3">
      {/* Attachment preview */}
      {attachedPreview && (
        <div className="mb-2 relative inline-block">
          {attachedType === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={attachedPreview} alt="Attachment" className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
          ) : (
            <div className="h-16 w-16 bg-gray-800 rounded-lg flex items-center justify-center">
              <i className="fas fa-play-circle text-white text-2xl"></i>
            </div>
          )}
          <button
            type="button"
            onClick={removeAttachment}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
          >
            <i className="fas fa-times text-xs"></i>
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}

      <div className="flex items-end gap-1">
        {/* Emoji picker */}
        <div className="relative shrink-0">
          <EmojiPickerButton onEmojiSelect={handleEmojiSelect} />
        </div>

        {/* GIF picker */}
        <button
          type="button"
          onClick={() => setShowGifPicker(prev => !prev)}
          disabled={disabled || sending}
          className="shrink-0 p-2.5 text-gray-400 hover:text-blue-500 transition-colors disabled:opacity-40 text-xs font-bold"
          aria-label="Send GIF"
          title="Send a GIF"
        >
          GIF
        </button>
        {showGifPicker && (
          <GifPickerModal
            title="Send a GIF"
            onGifSelect={handleGifSelect}
            onClose={() => setShowGifPicker(false)}
          />
        )}

        {/* Attachment button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || sending}
          className="shrink-0 p-2.5 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
          aria-label="Attach file"
        >
          <i className="fas fa-paperclip text-lg"></i>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={handleFileSelect}
          onClick={e => { (e.target as HTMLInputElement).value = ''; }}
        />

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder={replyingTo ? 'Reply…' : 'Message…'}
          rows={1}
          disabled={disabled || sending}
          className="flex-1 resize-none border border-gray-300 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40 overflow-hidden"
          style={{ minHeight: 40, maxHeight: 120 }}
        />

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="shrink-0 w-11 h-11 bg-blue-600 text-white rounded-full flex items-center justify-center hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Send message"
        >
          {sending ? (
            <i className="fas fa-spinner fa-spin text-sm"></i>
          ) : (
            <i className="fas fa-paper-plane text-sm"></i>
          )}
        </button>
      </div>
      </div>

      {/* Shared media editor (z-[65]) */}
      {editorAssets && (
        <MediaEditor
          assets={editorAssets}
          config={MESSAGE_EDITOR_CONFIG}
          onDone={handleEditorDone}
          onCancel={() => {
            setEditorAssets(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
      )}
    </div>
  );
}

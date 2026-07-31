'use client';

import { useState, useRef, useCallback, useEffect, useReducer } from 'react';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import EmojiPickerButton from '@/components/EmojiPickerButton';
import GifPickerModal from '@/components/GifPickerModal';
import { formatDisplayName } from '@/lib/formatters';
import type { Message } from '@/types/messages';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import {
  CHEVRON_PX,
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  GIF_POPOVER_MIN_VIEWPORT_PX,
  LEADING_OPEN_PX,
  canSendMessage,
  composerLeadingReducer,
  composerTextareaHeight,
  initialLeadingOpen,
} from './composer-layout';
import GifPicker from '@/components/GifPicker';
import { uploadPostMedia } from '@/lib/media/upload';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';

interface Props {
  conversationId: string;
  currentUserId: string;
  onSend: (message: Message) => void;
  disabled?: boolean;
  replyingTo?: Message | null;
  onCancelReply?: () => void;
  // Draft support (chat dock): seed the input and observe every text
  // change (typing, emoji insertion, clear-on-send) from one place.
  // Behavior is unchanged when these props are absent.
  initialText?: string;
  onTextChange?: (text: string) => void;
}

const MESSAGE_EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['free', '1:1', '16:9'],
  allowVideo: true, // videos pass through untouched until the video phase
  maxAssets: 1,
  output: { maxDimension: 1600, mime: 'image/jpeg', quality: 0.85 },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export default function MessageInput({ conversationId, currentUserId, onSend, disabled = false, replyingTo, onCancelReply, initialText, onTextChange }: Props) {
  const [text, setText] = useState(initialText ?? '');
  // iMessage-style leading cluster. One-way latch: typing collapses it,
  // emptying the field does NOT re-expand (see composer-layout for why).
  // Seeded from initialText so a restored dock draft mounts already collapsed
  // instead of flashing expand->collapse.
  const [{ leadingOpen }, dispatchLeading] = useReducer(
    composerLeadingReducer,
    initialText,
    initialLeadingOpen
  );
  // GIF picker presentation. A popover on desktop (anchored to the field, like
  // the emoji panel); a bottom sheet below sm, where the keyboard leaves only
  // ~350px of visible viewport and a 360px popover would be off-screen.
  // SSR-safe default false -> sheet; no flash is possible because the picker
  // only renders after a click, long after this effect has settled.
  const [gifPopover, setGifPopover] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${GIF_POPOVER_MIN_VIEWPORT_PX}px)`);
    const apply = () => setGifPopover(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

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

  // Draft observer (chat dock): one effect covers every text mutation —
  // typing, emoji insertion, and the clear-on-send reset.
  const onTextChangeRef = useRef(onTextChange);
  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  }, [onTextChange]);
  useEffect(() => {
    onTextChangeRef.current?.(text);
  }, [text]);

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
    dispatchLeading({ type: 'TEXT_CHANGED', text: e.target.value });
    if (e.target.value) broadcastTyping();

    // Auto-resize. The bounds live in composer-layout so the inline style
    // below and this measurement cannot drift apart.
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = composerTextareaHeight(ta.scrollHeight) + 'px';
    }
  };

  // Insert emoji at cursor position
  const handleEmojiSelect = (emoji: string) => {
    const ta = textareaRef.current;
    const pos = ta?.selectionStart ?? text.length;
    const next = text.slice(0, pos) + emoji + text.slice(pos);
    setText(next);
    // An emoji is text: inserting one into an empty field collapses the
    // leading cluster exactly as typing a character does.
    dispatchLeading({ type: 'TEXT_CHANGED', text: next });
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
    // isComposing guard: without it, pressing Enter to COMMIT a Japanese or
    // Chinese IME composition sends the half-composed text instead.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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

      // Reset. Send is the session boundary, so the full leading cluster
      // comes back without the user asking for it.
      setText('');
      dispatchLeading({ type: 'SENT' });
      removeAttachment();
      onCancelReply?.();
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const canSend = canSendMessage({
    text,
    hasAttachment: attachedFile !== null,
    hasGif: gifUrl !== null,
    sending,
    disabled,
  });

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
    <div className="border-t border-gray-200 bg-white shrink-0 safe-bottom">
      {/* Reply preview bar */}
      {replyingTo && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
          <div className="w-1 h-8 bg-violet-500 rounded-full shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-violet-600 truncate">
              Replying to {replyingSenderName}
            </p>
            <p className="text-xs text-gray-500 truncate">{replyPreviewText}</p>
          </div>
          {replyThumbnailUrl && (
            // src is polymorphic — Supabase media/avatar, a Google OAuth
            // avatar, or a Giphy gif_reaction. The guard optimizes only the
            // first and passes the rest through untouched.
            <Image
              src={replyThumbnailUrl}
              alt=""
              width={40}
              height={40}
              className="w-10 h-10 rounded object-cover shrink-0"
              unoptimized={!isOptimizableImageSrc(replyThumbnailUrl)}
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
            // Raw <img>: blob: object URL (or a Giphy URL when a GIF is
            // attached). The optimizer fetches server-side and cannot read a
            // client-only URL; next/image force-sets unoptimized for these.
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
        <p role="alert" className="text-xs text-red-600 mb-2">{error}</p>
      )}

      <div className="flex items-end gap-1">
        {/* Leading media cluster — ONE flex item holding two counter-animating
            boxes, so the collapsed state has one gap-1, not two stray ones.
            Both stay mounted and animate width between explicit px constants:
            `auto` cannot be interpolated, and the buttons carry explicit w-10
            because FontAwesome is an icon FONT whose glyph width differs
            before and after load — a padding-sized button would not reliably
            add up to LEADING_OPEN_PX on a cold cache.
            inert + aria-hidden keeps whichever box is at zero width out of the
            tab order and unclickable. Same idiom as the chat dock's morph. */}
        <div className="shrink-0 flex items-end">
          <div
            className="overflow-hidden transition-[width,opacity] duration-200 ease-out"
            style={{ width: leadingOpen ? 0 : CHEVRON_PX, opacity: leadingOpen ? 0 : 1 }}
            inert={leadingOpen}
            aria-hidden={leadingOpen}
          >
            <button
              type="button"
              onClick={() => dispatchLeading({ type: 'TOGGLE' })}
              disabled={disabled || sending}
              className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-violet-500 transition-colors disabled:opacity-40"
              aria-label="Show attachment and GIF buttons"
              title="More options"
              aria-expanded={leadingOpen}
            >
              <i className="fas fa-chevron-right text-sm"></i>
            </button>
          </div>

          <div
            className="overflow-hidden transition-[width,opacity] duration-200 ease-out flex items-end"
            style={{ width: leadingOpen ? LEADING_OPEN_PX : 0, opacity: leadingOpen ? 1 : 0 }}
            inert={!leadingOpen}
            aria-hidden={!leadingOpen}
          >
            {/* Attachment */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || sending}
              className="w-10 h-10 shrink-0 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
              aria-label="Attach file"
              title="Attach a photo or video"
            >
              <i className="fas fa-paperclip text-lg"></i>
            </button>
            {/* GIF */}
            <button
              type="button"
              onClick={() => setShowGifPicker(prev => !prev)}
              disabled={disabled || sending}
              data-gif-picker-toggle
              className="w-10 h-10 shrink-0 flex items-center justify-center text-gray-400 hover:text-violet-500 transition-colors disabled:opacity-40 text-xs font-bold"
              aria-label="Send GIF"
              title="Send a GIF"
            >
              GIF
            </button>
          </div>
        </div>
        {/* Text field. The wrapper is the emoji button's positioning context,
            so it must never get overflow-hidden — that would clip the picker
            panel. `pr-12` reserves the button's gutter on EVERY line, which is
            why text can't run underneath it at any height. */}
        <div className="relative flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={replyingTo ? 'Reply…' : 'Message…'}
            rows={1}
            disabled={disabled || sending}
            className="w-full resize-none border border-gray-300 rounded-2xl pl-4 pr-12 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-40 overflow-hidden block"
            style={{ minHeight: COMPOSER_MIN_HEIGHT, maxHeight: COMPOSER_MAX_HEIGHT }}
          />
          {/* Emoji stays pinned inside the field's trailing edge in every
              state — it is text entry, unlike GIF/attachments which are media
              insertion and collapse away.

              This strip is CONGRUENT WITH THE FIELD (inset-y-0 right-0), not
              shrink-wrapped around the button, and that is the whole trick:
              the panel anchors to the strip, so `bottom-full` resolves to the
              FIELD'S TOP at every height and `right-0` to the field's right
              edge. The panel therefore lines up with the chat box and rises
              with it as it grows 40->120px, with no measurement or observer.
              `pr-1` lives inside the containing block, so the button still
              sits 4px in and looks identical to before.
              pointer-events-none is load-bearing: the strip now spans the full
              field height, so without it clicking the right gutter of a
              multi-line composer would stop moving the caret. */}
          <div className="absolute inset-y-0 right-0 pr-1 flex items-end pointer-events-none">
            <EmojiPickerButton
              onEmojiSelect={handleEmojiSelect}
              align="right"
              anchor="container"
              disabled={disabled || sending}
              className="pointer-events-auto"
            />
          </div>

          {/* GIF popover is a SIBLING of the emoji strip inside the field
              wrapper, so it shares the same containing block and gets the
              identical right-edge alignment and growth tracking. It must not
              live in the leading cluster — that box is overflow-hidden and
              would clip it to zero width the moment the user types, and it
              would vanish when the GIF button collapses away. */}
          {showGifPicker && gifPopover && (
            <GifPicker
              variant="popover"
              onGifSelect={handleGifSelect}
              onClose={() => setShowGifPicker(false)}
            />
          )}
        </div>

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="shrink-0 w-11 h-11 bg-violet-600 text-white rounded-full flex items-center justify-center hover:bg-violet-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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

      {/* Hidden file input lives at the component root, NOT inside the button
          row: the leading buttons sit in an `inert` subtree when collapsed,
          and an inert ancestor can swallow a programmatic .click(). */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileSelect}
        onClick={e => { (e.target as HTMLInputElement).value = ''; }}
      />

      {/* GIF picker is a fixed-inset modal — rendering it as a flex child of
          the button row made it a zero-width flex item plus a stray gap. */}
      {showGifPicker && !gifPopover && (
        <GifPickerModal
          title="Send a GIF"
          onGifSelect={handleGifSelect}
          onClose={() => setShowGifPicker(false)}
        />
      )}

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

'use client';

import { useState, useRef, useEffect } from 'react';
import { useToast } from '@/components/Toast';
import { getHashtagSuggestions } from '@/lib/sports/post-tags';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import ConfirmModal from '@/components/ConfirmModal';
import MediaTile from '@/components/media/MediaTile';
import { MediaEditor } from '@/components/media-editor';
import { assetFromRemote, type EditablePostMediaRow } from '@/lib/media/rehydrate';
import { recipeEnvelope } from '@/lib/media/recipes';
import { uploadPostMedia } from '@/lib/media/upload';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';
import { COPY } from '@/lib/copy';

interface Post {
  id: string;
  caption: string | null;
  sport_key: string | null;
  visibility: string;
  tags?: string[];
  hashtags?: string[];
}

interface EditPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  post: Post;
  onPostUpdated?: (post: unknown) => void;
}

// Hashtag suggestions are registry-driven — see src/lib/sports/post-tags.ts.

// Same output shape as the composer's posts config.
const MEDIA_EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['free', '1:1', '4:5', '16:9'],
  allowVideo: true, // trim/split/cover via WebCodecs; degrades to pass-through without it
  maxAssets: 1, // re-edit is per item
  output: { maxDimension: 2048, mime: 'image/jpeg', quality: 0.9 },
};

export default function EditPostModal({
  isOpen,
  onClose,
  post,
  onPostUpdated
}: EditPostModalProps) {
  const { showSuccess, showError } = useToast();
  const captionRef = useRef<HTMLTextAreaElement>(null);

  const [caption, setCaption] = useState(post.caption || '');
  const [hashtags, setHashtags] = useState<string[]>(post.hashtags || []);
  const [visibility, setVisibility] = useState(post.visibility || 'public');
  const [showHashtagSuggestions, setShowHashtagSuggestions] = useState(false);
  const [customHashtag, setCustomHashtag] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const postType = post.sport_key || 'general';
  const currentHashtagSuggestions = getHashtagSuggestions(postType);

  // ── Media re-edit (non-destructive round, migration 120) ──
  // Rows come from the owner-only media route (it carries source_url +
  // edit_recipe, which public payloads never do). Media changes SAVE
  // IMMEDIATELY on the editor's Done — independent of the Update button —
  // so they never count toward the dirty check.
  const [mediaRows, setMediaRows] = useState<EditablePostMediaRow[]>([]);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[] | null>(null);
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/posts/${post.id}/media`, { credentials: 'include' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setMediaRows(data.media ?? []);
      } catch {
        /* media strip is progressive — the text edit form works without it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, post.id]);

  const openMediaEditor = async (row: EditablePostMediaRow) => {
    if (mediaBusy) return;
    setMediaBusy(row.id);
    try {
      const asset = await assetFromRemote(row);
      setEditingMediaId(row.id);
      setMediaAssets([asset]);
    } catch {
      showError('Could not load media', 'Please try again.');
    } finally {
      setMediaBusy(null);
    }
  };

  const handleMediaEditorDone = async (results: EditedMedia[]) => {
    const result = results[0];
    const targetId = editingMediaId;
    setMediaAssets(null);
    setEditingMediaId(null);
    if (!result || !targetId) return;
    setMediaBusy(targetId);
    try {
      const { url } = await uploadPostMedia(result.file);
      let thumbnailUrl: string | undefined;
      if (result.posterBlob) {
        try {
          const poster = new File([result.posterBlob], 'poster.jpg', { type: 'image/jpeg' });
          thumbnailUrl = (await uploadPostMedia(poster)).url;
        } catch (e) {
          console.warn('Poster upload failed:', e);
        }
      }
      const res = await fetch(`/api/posts/${post.id}/media/${targetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mediaUrl: url,
          thumbnailUrl,
          editRecipe: result.edited ? recipeEnvelope(result.recipe) : null,
          width: result.width,
          height: result.height,
          duration: result.durationSeconds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError('Could not update media', data.error || 'Please try again.');
        return;
      }
      setMediaRows(prev => prev.map(r => (r.id === targetId ? { ...r, ...data.media } : r)));
      showSuccess(
        data.pending_approval
          ? 'Media updated — sent to your guardian for review'
          : 'Media updated'
      );
      // Hand the parent a freshly hydrated post so the feed card re-renders
      // with the new media URL (reuses the API's gated single-post branch).
      if (onPostUpdated) {
        try {
          const fresh = await fetch(`/api/posts?postId=${post.id}`, { credentials: 'include' });
          if (fresh.ok) onPostUpdated((await fresh.json()).post);
        } catch {
          /* the next feed load has it */
        }
      }
    } catch {
      showError('Could not update media', 'Please try again.');
    } finally {
      setMediaBusy(null);
    }
  };

  // Reset the form when the post changes. Done during render rather than in an
  // effect: this is state synchronisation, and in an effect the old post's
  // values paint for one frame first.
  const [syncedPost, setSyncedPost] = useState(post);
  if (syncedPost !== post) {
    setSyncedPost(post);
    setCaption(post.caption || '');
    setHashtags(post.hashtags || []);
    setVisibility(post.visibility || 'public');
  }

  const addHashtag = (tag: string) => {
    const formattedTag = tag.startsWith('#') ? tag : `#${tag}`;
    if (!hashtags.includes(formattedTag)) {
      setHashtags([...hashtags, formattedTag]);
    }
    setCustomHashtag('');
    setShowHashtagSuggestions(false);
  };

  const removeHashtag = (tag: string) => {
    setHashtags(hashtags.filter(h => h !== tag));
  };

  const handleCustomHashtagSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customHashtag.trim()) {
      addHashtag(customHashtag.trim());
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/posts', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postId: post.id,
          caption: caption.trim(),
          hashtags: hashtags,
          visibility: visibility
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update post');
      }

      showSuccess(data.message || 'Post updated successfully!');

      if (onPostUpdated) {
        onPostUpdated(data.post);
      }

      onClose();
    } catch (e) {
      console.error('Failed to update post:', e);
      showError('Failed to update post');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Lock background scroll while open (iOS scroll-chaining behind overlays)
  // Edits count as unsaved when they differ from the post as loaded.
  const isDirty = () =>
    caption !== (post.caption || '') ||
    JSON.stringify(hashtags) !== JSON.stringify(post.hashtags || []) ||
    visibility !== (post.visibility || 'public') ||
    customHashtag.trim() !== '';

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, onClose);

  useBodyScrollLock(isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      <div className="bg-surface-raised rounded-lg max-w-2xl w-full max-h-modal flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-xl font-bold text-primary">Edit Post</h2>
          <button
            onClick={requestClose}
            className="text-faint hover:text-tertiary transition-colors"
          >
            <i className="fas fa-times text-xl"></i>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Media (re-edit in place — saves immediately on the editor's Done) */}
          {mediaRows.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-semibold text-secondary mb-2">
                Media
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {mediaRows.map(row => (
                  <div
                    key={row.id}
                    className="relative aspect-square bg-surface-sunken rounded-lg overflow-hidden"
                  >
                    <MediaTile
                      src={row.media_url}
                      thumbnailUrl={row.thumbnail_url}
                      kind={row.media_type}
                      alt=""
                      className="h-full w-full"
                      sizes="(max-width: 640px) 30vw, 150px"
                    />
                    <button
                      type="button"
                      onClick={() => openMediaEditor(row)}
                      disabled={mediaBusy !== null}
                      aria-label="Edit media"
                      className="absolute bottom-0 right-0 p-2 group disabled:opacity-60"
                    >
                      <span className="bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center group-hover:bg-black/80 transition-colors">
                        <i
                          className={`fas ${mediaBusy === row.id ? 'fa-spinner fa-spin' : 'fa-pen'} text-xs`}
                        ></i>
                      </span>
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                Media changes save right away — the rest of the post saves with Update.
              </p>
            </div>
          )}

          {/* Caption */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-secondary mb-2">
              Caption
            </label>
            <textarea
              ref={captionRef}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write your caption here..."
              className="w-full px-4 py-3 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 min-h-[120px] resize-none"
            />
          </div>

          {/* Hashtags */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-secondary mb-2">
              Hashtags
            </label>

            {/* Selected Hashtags */}
            {hashtags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {hashtags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-2 px-3 py-1 bg-brand-soft text-brand-fg-strong rounded-full text-sm"
                  >
                    {tag}
                    <button
                      onClick={() => removeHashtag(tag)}
                      className="hover:text-violet-900 dark:hover:text-violet-200"
                    >
                      <i className="fas fa-times text-xs"></i>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Add Custom Hashtag */}
            <form onSubmit={handleCustomHashtagSubmit} className="relative mb-3">
              <input
                type="text"
                value={customHashtag}
                onChange={(e) => setCustomHashtag(e.target.value)}
                onFocus={() => setShowHashtagSuggestions(true)}
                placeholder="Add custom hashtag..."
                className="w-full px-4 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              {customHashtag && (
                <button
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 after:absolute after:content-[''] after:-inset-y-2 after:inset-x-0 px-3 py-1 bg-violet-500 text-white rounded text-sm hover:bg-brand active:bg-brand"
                >
                  Add
                </button>
              )}
            </form>

            {/* Hashtag Suggestions */}
            {showHashtagSuggestions && (
              <div className="mb-3">
                <p className="text-xs text-muted mb-2">Popular suggestions:</p>
                <div className="flex flex-wrap gap-2">
                  {currentHashtagSuggestions
                    .filter(tag => !hashtags.includes(tag))
                    .map((tag) => (
                      <button
                        key={tag}
                        onClick={() => addHashtag(tag)}
                        className="relative after:absolute after:content-[''] after:-inset-y-2.5 after:inset-x-0 px-2 py-1 bg-surface-sunken text-secondary rounded text-xs hover:bg-gray-200 dark:hover:bg-stone-800 transition-colors"
                      >
                        {tag}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Visibility */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-secondary mb-2">
              Privacy
            </label>
            <div className="flex gap-4">
              <button
                onClick={() => setVisibility('public')}
                className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                  visibility === 'public'
                    ? 'border-violet-500 bg-brand-soft'
                    : 'border-border hover:border-border-strong'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <i className="fas fa-globe text-lg"></i>
                  <span className="font-medium">Public</span>
                </div>
                <p className="text-xs text-muted mt-1">Anyone can see this post</p>
              </button>
              <button
                onClick={() => setVisibility('private')}
                className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                  visibility === 'private'
                    ? 'border-violet-500 bg-brand-soft'
                    : 'border-border hover:border-border-strong'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <i className="fas fa-lock text-lg"></i>
                  <span className="font-medium">Private</span>
                </div>
                <p className="text-xs text-muted mt-1">Only you can see this</p>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border flex justify-end gap-3">
          <button
            onClick={requestClose}
            disabled={isSubmitting}
            className="px-6 py-2 border border-border-strong rounded-lg text-secondary font-medium hover:bg-surface-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-6 py-2 bg-violet-500 text-white rounded-lg font-medium hover:bg-brand transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                Updating...
              </>
            ) : (
              <>
                <i className="fas fa-check"></i>
                Update Post
              </>
            )}
          </button>
        </div>
      </div>

      {/* Shared editor (z-[65], above this z-50 modal) */}
      {mediaAssets && (
        <MediaEditor
          assets={mediaAssets}
          config={MEDIA_EDITOR_CONFIG}
          onDone={handleMediaEditorDone}
          onCancel={() => {
            setMediaAssets(null);
            setEditingMediaId(null);
          }}
        />
      )}
    </div>
  );
}

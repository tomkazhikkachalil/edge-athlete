'use client';

import { useState, useRef } from 'react';
import { useToast } from '@/components/Toast';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import ConfirmModal from '@/components/ConfirmModal';
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

// Tags for categorization
// Popular hashtags suggestions
const HASHTAG_SUGGESTIONS = {
  general: ['#Athletics', '#SportLife', '#Training', '#Fitness', '#Athlete', '#PersonalBest', '#GameDay', '#Champions'],
  golf: ['#Golf', '#GolfLife', '#GolfSwing', '#GolfCourse', '#Birdie', '#Eagle', '#Par', '#HoleInOne', '#PGA', '#18Holes']
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
  const currentHashtagSuggestions = HASHTAG_SUGGESTIONS[postType as keyof typeof HASHTAG_SUGGESTIONS] || HASHTAG_SUGGESTIONS.general;

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
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-violet-500 text-white rounded text-sm hover:bg-brand"
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
                        className="px-2 py-1 bg-surface-sunken text-secondary rounded text-xs hover:bg-gray-200 dark:hover:bg-stone-800 transition-colors"
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
    </div>
  );
}
